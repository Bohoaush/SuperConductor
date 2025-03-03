import _ from 'lodash'
import sharp from 'sharp'
import { AttentionLevel, KeyDisplay, LoggerLike, PeripheralInfo, PeripheralType } from '@shared/api'
import { stringToRGB, RGBToString, stringifyError } from '@shared/lib'
import { openStreamDeck, listStreamDecks, StreamDeck, DeviceModelId } from '@elgato-stream-deck/node'
import { onKnownPeripheralCallback, Peripheral, WatchReturnType } from './peripheral'
import { limitTextWidth } from './lib/estimateTextSize'
import PQueue from 'p-queue'
import { StreamDeckDeviceInfo } from '@elgato-stream-deck/node/dist/device'

export class PeripheralStreamDeck extends Peripheral {
	private static Watching = false
	static Watch(this: void, onKnownPeripheral: onKnownPeripheralCallback): WatchReturnType {
		if (PeripheralStreamDeck.Watching) {
			throw new Error('Already watching')
		}

		PeripheralStreamDeck.Watching = true

		let lastSeenStreamDecks: StreamDeckDeviceInfo[] = []

		// Check for new or removed Stream Decks every second.
		const interval = setInterval(() => {
			// List the connected Stream Decks.
			const streamDecks = listStreamDecks()

			// If the list has not changed since the last poll, do nothing.
			if (_.isEqual(streamDecks, lastSeenStreamDecks)) {
				return
			}

			// Figure out which Stream Decks have been unplugged since the last check.
			const disconnectedStreamDeckIds = new Set(
				lastSeenStreamDecks.map(PeripheralStreamDeck.GetStreamDeckId).filter((id) => {
					return !streamDecks.some((sd) => PeripheralStreamDeck.GetStreamDeckId(sd) === id)
				})
			)

			// Figure out which Stream Decks are being seen now that weren't seen in the last completed poll.
			for (const streamDeck of streamDecks) {
				const id = PeripheralStreamDeck.GetStreamDeckId(streamDeck)
				const alreadySeen = lastSeenStreamDecks.some((sd) => {
					return PeripheralStreamDeck.GetStreamDeckId(sd) === id
				})

				if (alreadySeen) {
					continue
				}

				// Tell the watcher about the discovered Stream Deck.
				onKnownPeripheral(id, {
					name: PeripheralStreamDeck.GetStreamDeckName(streamDeck),
					type: PeripheralType.STREAMDECK,
					devicePath: streamDeck.path,
				})
			}

			// Tell the watcher about disconnected Stream Decks.
			for (const id of disconnectedStreamDeckIds) {
				onKnownPeripheral(id, null)
			}

			// Update for the next iteration.
			lastSeenStreamDecks = streamDecks
		}, 1000)

		return {
			stop: () => {
				clearInterval(interval)
				PeripheralStreamDeck.Watching = false
			},
		}
	}

	private static GetStreamDeckId(this: void, streamDeck: StreamDeckDeviceInfo): string {
		return streamDeck.serialNumber
			? `streamdeck-serial_${streamDeck.serialNumber}`
			: `streamdeck-path_${streamDeck.path}`
	}

	private static GetStreamDeckName(streamDeck: StreamDeckDeviceInfo | StreamDeck): string {
		const model = 'model' in streamDeck ? streamDeck.model : streamDeck.MODEL
		let name = 'Stream Deck'
		if (model === DeviceModelId.MINI) name += ' Mini'
		else if (model === DeviceModelId.XL) name += ' XL'
		return name
	}

	private streamDeck?: StreamDeck
	private _info: PeripheralInfo | undefined
	private sentKeyDisplay: { [identifier: string]: KeyDisplay } = {}
	private connectedToParent = false
	private queue = new PQueue({ concurrency: 1 })
	private keys: { [identifier: string]: boolean } = {}
	constructor(log: LoggerLike, id: string, private path: string) {
		super(log, id)
	}

	async init(): Promise<void> {
		try {
			this.initializing = true

			this.streamDeck = openStreamDeck(this.path)

			const name = PeripheralStreamDeck.GetStreamDeckName(this.streamDeck)

			this._info = {
				name: name,
				gui: {
					type: PeripheralType.STREAMDECK,
					layout: {
						height: this.streamDeck.KEY_ROWS,
						width: this.streamDeck.KEY_COLUMNS,
					},
				},
			}

			this.connected = true

			this.streamDeck.on('down', (keyIndex) => {
				const identifier = keyIndexToIdentifier(keyIndex)
				this.keys[identifier] = true
				this.emit('keyDown', identifier)
			})

			this.streamDeck.on('up', (keyIndex) => {
				const identifier = keyIndexToIdentifier(keyIndex)
				this.keys[identifier] = false
				this.emit('keyUp', identifier)
			})

			this.streamDeck.on('error', (error) => {
				if (`${error}`.match(/could not read from/)) {
					// disconnected
					this.connected = false
					this.emit('disconnected')
					this.streamDeck?.close().catch(this.log.error)
					delete this.streamDeck
				} else {
					this.log.error('Streamdeck error: ' + stringifyError(error))
				}
			})
			await sleep(10) // to avoid an common initial "unable to write to HID device" error.
			await this._updateAllKeys('Initializing')

			this.initializing = false
		} catch (e) {
			this.initializing = false
			throw e
		}
		this.emit('initialized')
	}
	get info(): PeripheralInfo {
		if (!this._info) throw new Error('Peripheral not initialized')
		return this._info
	}
	async _setKeyDisplay(identifier: string, keyDisplay: KeyDisplay, force = false): Promise<void> {
		if (!this.streamDeck) return

		if (!keyDisplay) keyDisplay = { attentionLevel: AttentionLevel.IGNORE }

		const oldKeyDisplay = this.sentKeyDisplay[identifier] as KeyDisplay | undefined
		if (force || !_.isEqual(oldKeyDisplay, keyDisplay)) {
			this.sentKeyDisplay[identifier] = keyDisplay

			if (!this.connectedToParent) {
				// Intercept:

				if (identifier === '0') {
					keyDisplay = {
						attentionLevel: AttentionLevel.INFO,
						header: {
							long: 'Disconnected',
						},
					}
				} else {
					keyDisplay = {
						attentionLevel: AttentionLevel.IGNORE,
					}
				}
			}

			await this.drawKeyDisplay(this.streamDeck, this.queue, identifierToKeyIndex(identifier), keyDisplay)

			if (oldKeyDisplay?.area?.areaId !== keyDisplay.area?.areaId) {
				const adjacentButtons = this.getAdjacentKeys(identifierToKeyIndex(identifier))

				for (const keyIndex of Object.values(adjacentButtons)) {
					if (keyIndex !== null) {
						const identifier = keyIndexToIdentifier(keyIndex)
						await this._setKeyDisplay(identifier, this.sentKeyDisplay[identifier], true)
					}
				}
			}
		}
	}
	async _updateAllKeys(specialMessage?: string): Promise<void> {
		if (!this.streamDeck) return

		if (!this.connectedToParent || specialMessage) {
			// We might as well clear everything a little early:
			await this.queue.add(async () => {
				await this.streamDeck?.clearPanel()
			})
		}

		for (let keyIndex = 0; keyIndex < this.streamDeck?.NUM_KEYS; keyIndex++) {
			const identifier = keyIndexToIdentifier(keyIndex)
			let keyDisplay = this.sentKeyDisplay[identifier]

			if (keyIndex === 0 && !this.connectedToParent) {
				keyDisplay = {
					attentionLevel: AttentionLevel.NEUTRAL,
					header: {
						long: 'Disconnected',
					},
				}
			}
			if (keyIndex === 0 && specialMessage) {
				keyDisplay = {
					attentionLevel: AttentionLevel.NEUTRAL,
					header: {
						long: specialMessage,
					},
				}
			}
			await this._setKeyDisplay(identifier, keyDisplay, true)
		}
	}
	async setConnectedToParent(connected: boolean): Promise<void> {
		this.connectedToParent = connected
		await this._updateAllKeys()

		if (connected) {
			setTimeout(() => {
				this.emitAllKeys()
			}, 1)
		}
	}
	async close(): Promise<void> {
		if (this.streamDeck) {
			this.connectedToParent = false
			await this._updateAllKeys('Closed')
		}
		await super._close()
		if (this.streamDeck) {
			await this.streamDeck.close()
		}
		this.connected = false
		this.emit('disconnected')
		this.streamDeck = undefined
	}

	private emitAllKeys() {
		if (!this.streamDeck) return
		for (let keyIndex = 0; keyIndex < this.streamDeck?.NUM_KEYS; keyIndex++) {
			const identifier = keyIndexToIdentifier(keyIndex)
			if (this.keys[identifier]) this.emit('keyDown', keyIndexToIdentifier(keyIndex))
			else this.emit('keyUp', keyIndexToIdentifier(keyIndex))
		}
	}
	private async drawKeyDisplay(
		streamDeck: StreamDeck,
		queue: PQueue,
		keyIndex: number,
		keyDisplay: KeyDisplay,
		darkBG = false
	) {
		let img: sharp.Sharp | null = null
		let svg = ''
		const inputs: sharp.OverlayOptions[] = []

		const SIZE = streamDeck.ICON_SIZE
		const fontsize = SIZE >= 96 ? 20 : 16 // XL vs original
		const padding = 5
		let bgColor = '#000'
		const borders = {
			top: true,
			bottom: true,
			left: true,
			right: true,
		}

		if (keyDisplay.intercept) {
			// Normal functionality is intercepted / disabled

			let textColor = '#fff'

			if (keyDisplay.area) {
				bgColor = keyDisplay.area.color

				if (keyDisplay.area.areaInDefinition) {
					textColor = '#fff'
				} else {
					textColor = '#bbb'
				}
				// Area label:
				svg += `<text
			font-family="Arial, Helvetica, sans-serif"
			font-size="${fontsize}px"
			x="0"
			y="${fontsize}"
			fill="${textColor}"
			text-anchor="start"
			>${keyDisplay.area.areaLabel}</text>`
				// Key label:
				svg += `<text
			font-family="Arial, Helvetica, sans-serif"
			font-size="${Math.floor(SIZE / 2)}px"
			x="${Math.floor(SIZE / 2)}"
			y="${fontsize + Math.floor(SIZE / 2)}"
			fill="${textColor}"
			text-anchor="middle"
			>${keyDisplay.area.keyLabel}</text>`
			} else {
				bgColor = '#000'
			}
		} else {
			const maxTextWidth = SIZE - padding // note

			const dampenText = keyDisplay.attentionLevel === AttentionLevel.IGNORE
			const dampenBackgroundImage = dampenText || keyDisplay.attentionLevel === AttentionLevel.ALERT

			let x = 0
			let y = 0

			x = padding
			y = padding + fontsize

			// Background:

			let hasBackgroundImage = false
			if (keyDisplay.thumbnail) {
				const uri = keyDisplay.thumbnail.split(';base64,').pop()

				if (uri) {
					try {
						const imgBuffer = Buffer.from(uri, 'base64')
						img = sharp(imgBuffer).trim().flatten().resize(SIZE, SIZE)
						// .modulate({
						// 	brightness: 0.5,
						// })
						// .blur()

						if (dampenBackgroundImage || darkBG) img.modulate({ brightness: 0.5 })

						img.blur()
						hasBackgroundImage = true
					} catch (e) {
						this.log.error('Error when processing thumbnail')
						this.log.error(e)
						img = null
					}
				}
			}
			if (!hasBackgroundImage) {
				if (keyDisplay.area) {
					// Darken the color:
					const rgb = stringToRGB(keyDisplay.area.color)
					bgColor = RGBToString({
						r: rgb.r * 0.5,
						g: rgb.g * 0.5,
						b: rgb.b * 0.5,
					})
				}
			}
			let averageBackgroundColor: { r: number; g: number; b: number } | undefined
			// Calculate background brightness
			if (img) {
				const averagePixel = await img.clone().resize(1, 1).raw().toBuffer()

				averageBackgroundColor = {
					r: Number(averagePixel[0]),
					g: Number(averagePixel[1]),
					b: Number(averagePixel[1]),
				}
			}

			// Border:
			{
				let borderWidth = 0
				let borderColor = '#000'

				if (keyDisplay.attentionLevel === AttentionLevel.IGNORE) {
					borderWidth = 0
					borderColor = '#666'
				} else if (keyDisplay.attentionLevel === AttentionLevel.NEUTRAL) {
					borderWidth = 3
					borderColor = '#666'
				} else if (keyDisplay.attentionLevel === AttentionLevel.INFO) {
					borderWidth = 3
					borderColor = '#bbb'
				} else if (keyDisplay.attentionLevel === AttentionLevel.NOTIFY) {
					borderColor = '#ff0'
					borderWidth = 4
				} else if (keyDisplay.attentionLevel === AttentionLevel.ALERT) {
					borderWidth = 10
					borderColor = '#f00'
					if (!hasBackgroundImage) {
						bgColor = '#ff3'
					}
				}

				if (keyDisplay.area) {
					bgColor = keyDisplay.area.color

					if (keyDisplay.attentionLevel <= AttentionLevel.NEUTRAL) {
						borderWidth = 5

						// Remove borders to adjacent buttons with the same area:
						const adjacentKeys = this.getAdjacentKeys(keyIndex)
						borders.top = !(
							adjacentKeys.top !== null &&
							this.sentKeyDisplay[keyIndexToIdentifier(adjacentKeys.top)]?.area?.areaId ===
								keyDisplay.area.areaId
						)
						borders.bottom = !(
							adjacentKeys.bottom !== null &&
							this.sentKeyDisplay[keyIndexToIdentifier(adjacentKeys.bottom)]?.area?.areaId ===
								keyDisplay.area.areaId
						)
						borders.left = !(
							adjacentKeys.left !== null &&
							this.sentKeyDisplay[keyIndexToIdentifier(adjacentKeys.left)]?.area?.areaId ===
								keyDisplay.area.areaId
						)
						borders.right = !(
							adjacentKeys.right !== null &&
							this.sentKeyDisplay[keyIndexToIdentifier(adjacentKeys.right)]?.area?.areaId ===
								keyDisplay.area.areaId
						)
					}
				}

				if (borderWidth) {
					borderWidth += 3
					if (hasBackgroundImage) borderWidth += 3

					const radius = 10

					let x = 0
					let y = 0
					let width = SIZE
					let height = SIZE

					// It's a hack, but it works..
					// Hide borders by drawing ourside:
					if (!borders.top) {
						y -= radius
						height += radius
					}
					if (!borders.bottom) {
						height += radius
					}
					if (!borders.left) {
						x -= radius
						width += radius
					}
					if (!borders.right) {
						width += radius
					}

					svg += `<rect
						x="${x}"
						y="${y}"
						width="${width}"
						height="${height}"
						rx="${radius}"
						stroke="${borderColor}"
						stroke-width="${borderWidth}"
						fill="none"
					/>`
				}
			}
			// Calculate background brightness:
			if (!averageBackgroundColor) averageBackgroundColor = stringToRGB(bgColor)
			/** 0 - 255 */
			const brightness =
				(averageBackgroundColor.r * 299 + averageBackgroundColor.g * 587 + averageBackgroundColor.b * 114) /
				1000
			const backgroundIsDark = brightness < 127

			// Determine text color:
			let textColor: string
			if (backgroundIsDark) {
				textColor = dampenText ? '#999' : '#fff'
			} else {
				textColor = dampenText ? '#333' : '#000'
			}

			if (keyDisplay.header) {
				const text = keyDisplay.header.short || limitTextWidth(keyDisplay.header.long, fontsize, maxTextWidth)

				const textFontSize = Math.floor(fontsize * (text.length > 7 ? 0.8 : 1))
				svg += `<text
							font-family="Arial, Helvetica, sans-serif"
							font-size="${textFontSize}px"
							x="${x}"
							y="${y}"
							fill="${textColor}"
							text-anchor="start"
							>${text}</text>`
				y += Math.max(textFontSize, fontsize)
			}
			if (keyDisplay.info) {
				const textFontSize = Math.floor(fontsize * 0.8)
				if (keyDisplay.info.short) {
					svg += `<text
						font-family="Arial, Helvetica, sans-serif"
						font-size="${textFontSize}px"
						x="${x}"
						y="${y}"
						fill="${textColor}"
						text-anchor="start"
						>${keyDisplay.info.short}</text>`
					y += textFontSize
				} else if (keyDisplay.info.long) {
					let text = keyDisplay.info.long

					if (text.includes('\n')) {
						const lines = text.split('\n')
						for (const line of lines) {
							if (line) {
								svg += `<text
									font-family="Arial, Helvetica, sans-serif"
									font-size="${textFontSize}px"
									x="${x}"
									y="${y}"
									fill="${textColor}"
									text-anchor="start"
									>${line}</text>`
								y += textFontSize
							} else {
								break
							}
						}
					} else {
						let line = ''
						for (let i = 0; i < 3; i++) {
							line = limitTextWidth(text, fontsize, maxTextWidth)
							text = text.slice(line.length)
							if (line) {
								svg += `<text
									font-family="Arial, Helvetica, sans-serif"
									font-size="${textFontSize}px"
									x="${x}"
									y="${y}"
									fill="${textColor}"
									text-anchor="start"
									>${line}</text>`
								y += textFontSize
							} else {
								break
							}
						}
					}
				}
			}
		}

		if (svg) {
			inputs.push({
				input: Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" version="1.1">${svg}</svg>`
				),
				top: 0,
				left: 0,
			})
		}

		let keyGotAnyContent = false

		if (!img) {
			img = sharp({
				create: {
					width: SIZE,
					height: SIZE,
					channels: 3,
					background: bgColor,
				},
			}).ensureAlpha()
		} else {
			keyGotAnyContent = true
		}

		if (inputs.length) {
			keyGotAnyContent = true
			img = img.composite(inputs)
		}

		try {
			const img2: sharp.Sharp = img

			await queue.add(async () => {
				// Do an additional check if we're still connected to the device:
				if (!this.connected) return

				// Remporary hack fix:
				// There is an strange, unsolved bug where sharp .toBuffer() doesn't resolve,
				// but only when two streamdecks are connected.
				// Adding a temporary timeout for now to lessen the impact of this bug.
				const tmpImg: Buffer | null = await Promise.race([
					img2.raw().toBuffer(),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
				])
				if (!tmpImg) return

				// Do an additional check if we're still connected to the device:
				if (!this.connected) return

				if (keyGotAnyContent) {
					await streamDeck.fillKeyBuffer(keyIndex, tmpImg, { format: 'rgba' })
				} else {
					const bgRGB = stringToRGB(bgColor)
					if (bgRGB.r + bgRGB.g + bgRGB.b === 0) {
						await streamDeck.clearKey(keyIndex)
					} else {
						await streamDeck.fillKeyColor(keyIndex, bgRGB.r, bgRGB.g, bgRGB.b)
					}
				}
			})
		} catch (e) {
			this.log.error(keyDisplay)
			throw e
		}
	}
	private getAdjacentKeys(keyIndex: number) {
		if (!this.streamDeck) throw new Error('No streamdeck connected')

		const center = this.keyIndexToRowColumn(keyIndex)

		const rowcolumns = {
			top: { row: center.row - 1, column: center.column }, // Above
			bottom: { row: center.row + 1, column: center.column }, // Below
			left: { row: center.row, column: center.column - 1 }, // Left
			right: { row: center.row, column: center.column + 1 }, // Right
		}

		return {
			top: rowcolumns.top.row >= 0 ? this.rowColumnToKeyIndex(rowcolumns.top) : null,
			bottom:
				rowcolumns.bottom.row < this.streamDeck.KEY_ROWS ? this.rowColumnToKeyIndex(rowcolumns.bottom) : null,
			left: rowcolumns.left.column >= 0 ? this.rowColumnToKeyIndex(rowcolumns.left) : null,
			right:
				rowcolumns.right.column < this.streamDeck.KEY_COLUMNS
					? this.rowColumnToKeyIndex(rowcolumns.right)
					: null,
		}
	}
	private keyIndexToRowColumn(keyIndex: number): { row: number; column: number } {
		if (!this.streamDeck) throw new Error('No streamdeck connected')

		const columns = this.streamDeck.KEY_COLUMNS

		const row = Math.floor(keyIndex / columns)
		const column = keyIndex % columns
		return { row, column }
	}
	private rowColumnToKeyIndex(rowColumn: { row: number; column: number }): number {
		if (!this.streamDeck) throw new Error('No streamdeck connected')
		const columns = this.streamDeck.KEY_COLUMNS
		return rowColumn.row * columns + rowColumn.column
	}
}
function keyIndexToIdentifier(keyIndex: number): string {
	return `${keyIndex}`
}
function identifierToKeyIndex(identifier: string): number {
	return parseInt(identifier)
}
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
