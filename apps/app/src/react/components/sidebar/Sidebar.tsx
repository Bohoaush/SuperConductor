import React from 'react'
import { SidebarResourceLibrary } from './SidebarResourceLibrary'

import { SideBarEditTimelineObject } from './SideBarEditTimelineObject'
import { Project } from '../../../models/project/Project'
import { store } from '../../mobx/store'
import { observer } from 'mobx-react-lite'
import { useMemoComputedObject, useMemoComputedValue } from '../../mobx/lib'
import { assertNever } from '@shared/lib'
import { SideBarEditGroup } from './editGroup/SideBarEditGroup'
import { SideBarEditPart } from './editPart/SideBarEditPart'
import { TimelineObj } from '../../../models/rundown/TimelineObj'
import { ErrorBoundary } from '../util/ErrorBoundary'
import { Mapping } from 'timeline-state-resolver-types'

export const Sidebar: React.FC<{ mappings: Project['mappings'] }> = observer(function Sidebar(props) {
	const currentRundownId = useMemoComputedValue(() => {
		return store.rundownsStore.currentRundownId
	}, [])

	const editing = useMemoComputedObject(
		() => {
			const mainSelected = store.guiStore.mainSelected

			if (mainSelected && currentRundownId) {
				if (mainSelected.type === 'group') {
					const group =
						store.rundownsStore.hasGroup(mainSelected.groupId) &&
						store.rundownsStore.getGroup(mainSelected.groupId)
					if (group) return { type: 'group', groupId: group.id } as { type: 'group'; groupId: string }
				} else if (mainSelected.type === 'part') {
					const group =
						store.rundownsStore.hasGroup(mainSelected.groupId) &&
						store.rundownsStore.getGroup(mainSelected.groupId)
					const part =
						store.rundownsStore.hasPart(mainSelected.partId) &&
						store.rundownsStore.getPart(mainSelected.partId)
					if (group && part)
						return { type: 'part', groupId: group.id, groupLocked: group.locked, partId: part.id } as {
							type: 'part'
							groupId: string
							groupLocked: boolean
							partId: string
						}
				} else if (mainSelected.type === 'timelineObj') {
					const group =
						store.rundownsStore.hasGroup(mainSelected.groupId) &&
						store.rundownsStore.getGroup(mainSelected.groupId)
					const part =
						store.rundownsStore.hasPart(mainSelected.partId) &&
						store.rundownsStore.getPart(mainSelected.partId)
					const timelineObj =
						store.rundownsStore.hasTimelineObj(mainSelected.timelineObjId) &&
						store.rundownsStore.getTimelineObj(mainSelected.timelineObjId)
					if (group && part && timelineObj) {
						const mapping = props.mappings[timelineObj.obj.layer] as Mapping | undefined
						return {
							type: 'timelineObj',
							groupId: group.id,
							groupLocked: group.locked,
							partId: part.id,
							partLocked: part.locked,
							timelineObj,
							deviceId: mapping?.deviceId,
						} as {
							type: 'timelineObj'
							groupId: string
							groupLocked: boolean
							partId: string
							partLocked: boolean
							timelineObj: TimelineObj
							deviceId: string | undefined
						}
					}
				} else {
					assertNever(mainSelected)
				}
			}

			return undefined
		},
		[currentRundownId],
		true
	)

	if (!currentRundownId) {
		return null
	}
	if (!editing) {
		// Not editing
		return (
			<ErrorBoundary>
				<SidebarResourceLibrary />
			</ErrorBoundary>
		)
	} else if (editing.type === 'group') {
		return (
			<ErrorBoundary>
				<SideBarEditGroup rundownId={currentRundownId} groupId={editing.groupId} />
			</ErrorBoundary>
		)
	} else if (editing.type === 'part') {
		return (
			<ErrorBoundary>
				<SideBarEditPart
					rundownId={currentRundownId}
					groupId={editing.groupId}
					partId={editing.partId}
					groupLocked={!!editing.groupLocked}
				/>
			</ErrorBoundary>
		)
	} else if (editing.type === 'timelineObj') {
		const groupOrPartLocked = editing.groupLocked || editing.partLocked
		return (
			<ErrorBoundary>
				<SideBarEditTimelineObject
					rundownId={currentRundownId}
					groupId={editing.groupId}
					partId={editing.partId}
					timelineObj={editing.timelineObj}
					mappings={props.mappings}
					disabled={groupOrPartLocked}
					deviceId={editing.deviceId}
				/>
			</ErrorBoundary>
		)
	} else {
		assertNever(editing)
		return null
	}
})
