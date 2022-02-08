import { BrowserWindow, dialog, ipcMain } from 'electron'
import { Group } from '../models/rundown/Group'
import { IPCServer } from './IPCServer'
import { IPCClient } from './IPCClient'
import { updateTimeline, UpdateTimelineCache } from './timeline'
import { GroupPreparedPlayData } from '../models/GUI/PreparedPlayhead'
import { StorageHandler } from './storageHandler'
import { AppData } from '../models/App/AppData'
import { Project } from '../models/project/Project'
import { Rundown } from '../models/rundown/Rundown'
import { SessionHandler } from './sessionHandler'
import { ResourceAny } from '@shared/models'
import { BridgeHandler } from './bridgeHandler'
import _ from 'lodash'
import { BridgeStatus } from '../models/project/Bridge'
import { Peripheral } from '../models/project/Peripheral'
import { TriggersHandler } from './triggersHandler'
import { ActiveTriggers } from '../models/rundown/Trigger'

export class TimedPlayerThingy {
	mainWindow?: BrowserWindow
	ipcServer?: IPCServer
	ipcClient?: IPCClient
	// tptCaspar?: TPTCasparCG

	session: SessionHandler
	storage: StorageHandler
	triggers?: TriggersHandler
	bridgeHandler?: BridgeHandler

	constructor() {
		this.session = new SessionHandler()
		this.storage = new StorageHandler({
			// Default window position:
			y: undefined,
			x: undefined,
			width: 1200,
			height: 600,
		})

		this.session.on('resource', (id: string, resource: ResourceAny | null) => {
			this.ipcClient?.updateResource(id, resource)
		})
		this.session.on('bridgeStatus', (id: string, status: BridgeStatus | null) => {
			this.ipcClient?.updateBridgeStatus(id, status)
		})
		this.session.on('peripheral', (peripheralId: string, peripheral: Peripheral | null) => {
			this.ipcClient?.updatePeripheral(peripheralId, peripheral)
		})
		this.session.on('peripheralTriggers', (peripheralTriggers: ActiveTriggers) => {
			this.triggers?.updateTriggers(peripheralTriggers)
			this.ipcClient?.updatePeripheralTriggers(peripheralTriggers)
		})
		this.storage.on('appData', (appData: AppData) => {
			this.ipcClient?.updateAppData(appData)
		})
		this.storage.on('project', (project: Project) => {
			this.ipcClient?.updateProject(project)
		})
		this.storage.on('rundown', (fileName: string, rundown: Rundown) => {
			this.ipcClient?.updateRundown(fileName, rundown)
		})
	}

	initWindow(mainWindow: BrowserWindow) {
		this.mainWindow = mainWindow

		const bridgeHandler = new BridgeHandler(this.session, this.storage, {
			updatedResources: (deviceId: string, resources: ResourceAny[]): void => {
				// Added/Updated:
				const newResouceIds = new Set<string>()
				for (const resource of resources) {
					newResouceIds.add(resource.id)
					if (!_.isEqual(this.session.getResource(resource.id), resource)) {
						this.session.updateResource(resource.id, resource)
					}
				}
				// Removed:
				for (const id of this.session.getResourceIds(deviceId)) {
					if (!newResouceIds.has(id)) this.session.updateResource(id, null)
				}
			},
			onVersionMismatch: (bridgeId: string, bridgeVersion: string, ourVersion: string): void => {
				dialog
					.showMessageBox(mainWindow, {
						type: 'warning',
						title: 'Bridge version mismatch',
						message: `The connected bridge "${bridgeId}" is of a different version than SuperConductor.
						\nBridge version: v${bridgeVersion}
						SuperConductor version: v${ourVersion}
						\nThis is likely to result in errors and unexpected behavior. Please ensure that both SuperConductor and tsr-bridge are up-to-date.`,
					})
					.catch(console.error)
			},
		})
		this.bridgeHandler = bridgeHandler

		this.ipcServer = new IPCServer(ipcMain, this.storage, this.session, {
			refreshResources: () => {
				// this.tptCaspar?.fetchAndSetMedia()
				// this.tptCaspar?.fetchAndSetTemplates()
				bridgeHandler.refreshResources()
			},
			updateTimeline: (cache: UpdateTimelineCache, group: Group): GroupPreparedPlayData | null => {
				return updateTimeline(cache, this.storage, bridgeHandler, group)
			},
		})
		this.ipcClient = new IPCClient(this.mainWindow)
		this.triggers = new TriggersHandler(this.storage, this.ipcServer)
		// this.tptCaspar = new TPTCasparCG(this.session)
	}
}
