import EventEmitter from 'events'
import { ResourceAny } from '@shared/models'
import { BridgeStatus } from '../models/project/Bridge'
import { Peripheral } from '../models/project/Peripheral'
import _ from 'lodash'
import { ActiveTrigger, ActiveTriggers } from '../models/rundown/Trigger'

/** This class handles all non-persistant data */
export class SessionHandler extends EventEmitter {
	private resources: { [resourceId: string]: ResourceAny } = {}
	private resourcesHasChanged: { [resourceId: string]: true } = {}

	private bridgeStatuses: { [bridgeId: string]: BridgeStatus } = {}
	private bridgeStatusesHasChanged: { [bridgeId: string]: true } = {}

	private peripherals: { [peripheralId: string]: Peripheral } = {}
	private peripheralsHasChanged: { [peripheralId: string]: true } = {}

	private allTriggers: { [fullIdentifier: string]: ActiveTrigger } = {}
	private allTriggersHasChanged: { [fullIdentifier: string]: true } = {}
	private activeTriggers: { [fullIdentifier: string]: ActiveTrigger } = {}
	private activeTriggersHasChanged = false

	private emitTimeout: NodeJS.Timeout | null = null

	private emitEverything = false

	triggerEmitAll() {
		this.emitEverything = true
		this.triggerUpdate()
	}

	getResources() {
		return this.resources
	}
	getResource(id: string): ResourceAny | undefined {
		return this.resources[id]
	}
	getResourceIds(deviceId: string): string[] {
		const ids: string[] = []
		for (const [id, resource] of Object.entries(this.resources)) {
			if (resource.deviceId === deviceId) ids.push(id)
		}
		return ids
	}
	updateResource(id: string, resource: ResourceAny | null) {
		if (resource) {
			this.resources[id] = resource
			this.resourcesHasChanged[id] = true
		} else {
			delete this.resources[id]
			this.resourcesHasChanged[id] = true
		}

		this.triggerUpdate()
	}

	getBridgeStatuses() {
		return this.bridgeStatuses
	}
	getBridgeStatus(id: string): BridgeStatus | undefined {
		return this.bridgeStatuses[id]
	}
	updateBridgeStatus(id: string, bridgeStatus: BridgeStatus | null) {
		if (bridgeStatus) {
			this.bridgeStatuses[id] = bridgeStatus
			this.bridgeStatusesHasChanged[id] = true
		} else {
			if (this.bridgeStatuses[id]) {
				delete this.bridgeStatuses[id]
				this.bridgeStatusesHasChanged[id] = true
			}
		}

		this.triggerUpdate()
	}
	getPeripheralStatus(bridgeId: string, deviceId: string): Peripheral | undefined {
		const peripheralId = `${bridgeId}-${deviceId}`

		return this.peripherals[peripheralId]
	}
	updatePeripheralStatus(bridgeId: string, deviceId: string, deviceName: string, connected: boolean) {
		const peripheralId = `${bridgeId}-${deviceId}`

		const existing: Peripheral | undefined = this.peripherals[peripheralId]

		const newDevice: Peripheral = {
			id: deviceId,
			bridgeId: bridgeId,
			name: deviceName,
			status: {
				lastConnected: connected ? Date.now() : existing?.status.lastConnected ?? 0,
				connected: connected,
			},
		}
		if (!_.isEqual(newDevice, this.peripherals[peripheralId])) {
			this.peripherals[peripheralId] = newDevice
			this.peripheralsHasChanged[peripheralId] = true
		}

		this.triggerUpdate()
	}
	resetPeripheralTriggerStatuses(bridgeId: string) {
		// Reset all peripheralStatuses for a bridge (like when a bridge is reconnected)

		for (const [fullIdentifier, trigger] of Object.entries(this.allTriggers)) {
			if (trigger.bridgeId === bridgeId) {
				delete this.allTriggers[fullIdentifier]
				delete this.allTriggersHasChanged[fullIdentifier]
			}
		}
		for (const [fullIdentifier, trigger] of Object.entries(this.activeTriggers)) {
			if (trigger.bridgeId === bridgeId) {
				delete this.activeTriggers[fullIdentifier]
				this.activeTriggersHasChanged = true
			}
		}
	}
	updatePeripheralTriggerStatus(bridgeId: string, deviceId: string, identifier: string, down: boolean) {
		// This is called from a peripheral, when a key is pressed or released

		const fullIdentifier = `${bridgeId}-${deviceId}-${identifier}`
		const peripheralId = `${bridgeId}-${deviceId}`

		const device = this.peripherals[peripheralId]
		const trigger: ActiveTrigger = {
			fullIdentifier: fullIdentifier,
			bridgeId: bridgeId,
			deviceId: deviceId,
			deviceName: device?.name ?? '',
			identifier: identifier,
		}

		if (!this.allTriggers[fullIdentifier]) {
			this.allTriggers[fullIdentifier] = trigger
			this.allTriggersHasChanged[fullIdentifier] = true
		}

		if (down) {
			if (!this.activeTriggers[fullIdentifier]) {
				this.activeTriggers[fullIdentifier] = trigger
				this.activeTriggersHasChanged = true
			}
		} else {
			if (this.activeTriggers[fullIdentifier]) {
				delete this.activeTriggers[fullIdentifier]
				this.activeTriggersHasChanged = true
			}
		}

		this.triggerUpdate()
	}

	private triggerUpdate() {
		if (!this.emitTimeout) {
			this.emitTimeout = setTimeout(() => {
				this.emitTimeout = null
				this.emitChanges()
			}, 5)
		}
	}
	private emitChanges() {
		if (this.emitEverything) {
			for (const resourceId of Object.keys(this.resources)) {
				this.resourcesHasChanged[resourceId] = true
			}
			for (const bridgeId of Object.keys(this.bridgeStatuses)) {
				this.bridgeStatusesHasChanged[bridgeId] = true
			}
			for (const peripheralId of Object.keys(this.peripherals)) {
				this.peripheralsHasChanged[peripheralId] = true
			}
			this.activeTriggersHasChanged = true

			this.emitEverything = false
		}

		for (const resourceId of Object.keys(this.resourcesHasChanged)) {
			this.emit('resource', resourceId, this.resources[resourceId] ?? null)
			delete this.resourcesHasChanged[resourceId]
		}
		for (const bridgeId of Object.keys(this.bridgeStatusesHasChanged)) {
			this.emit('bridgeStatus', bridgeId, this.bridgeStatuses[bridgeId] ?? null)
			delete this.bridgeStatusesHasChanged[bridgeId]
		}
		for (const peripheralId of Object.keys(this.peripheralsHasChanged)) {
			this.emit('peripheral', peripheralId, this.peripherals[peripheralId] ?? null)
			delete this.peripheralsHasChanged[peripheralId]
		}
		for (const fullIdentifier of Object.keys(this.allTriggersHasChanged)) {
			this.emit('allTrigger', fullIdentifier, this.allTriggers[fullIdentifier] ?? null)
			delete this.allTriggersHasChanged[fullIdentifier]
		}
		if (this.activeTriggersHasChanged) {
			const activeTriggers: ActiveTriggers = Object.values(this.activeTriggers)
			this.emit('activeTriggers', activeTriggers)
			this.activeTriggersHasChanged = false
		}
	}
}
