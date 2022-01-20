import React, { useEffect, useRef, useState, useContext, useCallback } from 'react'
import Toggle from '@atlaskit/toggle'
import { TrashBtn } from '../../inputs/TrashBtn'
import { Group } from '@/models/rundown/Group'
import { MovePartFn, PartView } from './PartView'
import { getGroupPlayhead, GroupPlayhead } from '@/lib/playhead'
import { GroupPreparedPlayheadData } from '@/models/GUI/PreparedPlayhead'
import { IPCServerContext } from '@/react/contexts/IPCServer'
import { PartPropertiesDialog } from './PartPropertiesDialog'
import { Part } from '../../../../models/rundown/Part'
import { ItemTypes, PartDragItem } from '../../../api/ItemTypes'
import { DropTargetMonitor, useDrop } from 'react-dnd'
import { getCurrentlyPlayingInfo } from '../../../../lib/util'
import { Mappings } from 'timeline-state-resolver-types'

export const GroupView: React.FC<{
	rundownId: string
	group: Group
	groupIndex: number
	mappings: Mappings
	movePart: MovePartFn
}> = ({ group, groupIndex, rundownId, mappings, movePart }) => {
	const ipcServer = useContext(IPCServerContext)

	const playheadData = useRef<GroupPreparedPlayheadData | null>(null)
	const [activeParts, setActiveParts] = useState<{ [partId: string]: true }>({})
	useEffect(() => {
		playheadData.current = group.playheadData

		const activeParts0: { [partId: string]: true } = {}

		if (group.playheadData) {
			for (const part of group.playheadData.parts) {
				activeParts0[part.part.id] = true
			}
			if (group.playheadData.repeating) {
				for (const part of group.playheadData.repeating.parts) {
					activeParts0[part.part.id] = true
				}
			}
		}
		setActiveParts(activeParts0)
	}, [group])

	const [playhead, setPlayhead] = useState<GroupPlayhead | null>(null)
	const requestRef = useRef<number>(0)
	const updatePlayhead = () => {
		setPlayhead(getGroupPlayhead(playheadData.current))
		requestRef.current = window.requestAnimationFrame(updatePlayhead)
	}
	useEffect(() => {
		requestRef.current = window.requestAnimationFrame(updatePlayhead)
		return () => {
			window.cancelAnimationFrame(requestRef.current)
		}
	}, [])

	/** Whether we're allowed to stop playing */
	const wasPlayingRef = useRef(false)
	const stopPlayingRef = useRef(true)
	useEffect(() => {
		if (group.playheadData && !playhead && wasPlayingRef.current) {
			// We believe that we are are playing, but we don't have a playhead.
			// That probably means that we have reached the end.

			if (stopPlayingRef.current) {
				console.log('Auto-stopping group', group.id)

				ipcServer.stopGroup({ rundownId, groupId: group.id })
				stopPlayingRef.current = false
			}
		} else {
			stopPlayingRef.current = true
		}

		// We are definitely playing
		if (group.playheadData && playhead) {
			wasPlayingRef.current = true
		} else {
			wasPlayingRef.current = false
		}
	}, [playhead])

	const isGroupPlaying = !!playhead
	const wrapperRef = useRef<HTMLDivElement>(null)
	const [{ handlerId }, drop] = useDrop(
		{
			accept: ItemTypes.PART_ITEM,
			collect(monitor) {
				return {
					handlerId: monitor.getHandlerId(),
				}
			},
			canDrop: (item: PartDragItem) => {
				// Don't allow dropping into a transparent group.
				if (group.transparent) {
					return false
				}

				// Don't allow dropping a currently-playing Part onto a Group which is currently playing
				const { partPlayheadData: fromGroupPartPlayheadData } = getCurrentlyPlayingInfo(item.group)
				const movedPartIsPlaying = Boolean(
					fromGroupPartPlayheadData && fromGroupPartPlayheadData.part.id === item.part.id
				)
				const isMovingToNewGroup = item.group.id !== group.id
				if (movedPartIsPlaying && isMovingToNewGroup && isGroupPlaying) {
					return false
				}

				return true
			},
			async hover(item: PartDragItem, monitor: DropTargetMonitor) {
				// Don't use the GroupView as a drop target when there are Parts present.
				if (group.parts.length > 0) {
					return
				}

				// Don't allow dropping a currently-playing Part onto a Group which is currently playing
				const { partPlayheadData: fromGroupPartPlayheadData } = getCurrentlyPlayingInfo(item.group)
				const movedPartIsPlaying = Boolean(
					fromGroupPartPlayheadData && fromGroupPartPlayheadData.part.id === item.part.id
				)
				const isMovingToNewGroup = item.group.id !== group.id
				if (movedPartIsPlaying && isMovingToNewGroup && isGroupPlaying) {
					return
				}

				const dragGroup = item.group
				const dragPart = item.part
				const dragIndex = item.index
				const hoverIndex = 0
				const hoverGroup = group

				// Don't allow dragging into transparent groups, which can only have one part.
				if (hoverGroup.transparent) {
					return
				}

				// Don't replace items with themselves
				if (dragGroup.id === hoverGroup.id && dragIndex === hoverIndex) {
					return
				}

				// Time to actually perform the action
				const newGroup = await movePart({ dragGroup, dragPart, hoverGroup, hoverIndex })
				if (!newGroup) {
					// The backend rejected the move, so do nothing.
					return
				}

				// Note: we're mutating the monitor item here!
				// Generally it's better to avoid mutations,
				// but it's good here for the sake of performance
				// to avoid expensive index searches.
				item.index = hoverIndex
				item.group = newGroup
			},
		},
		[group]
	)
	drop(wrapperRef)

	if (group.transparent) {
		const firstPart = group.parts[0]
		return firstPart ? (
			<div ref={wrapperRef} data-handler-id={handlerId}>
				<PartView
					rundownId={rundownId}
					part={firstPart}
					parentGroup={group}
					parentGroupIndex={groupIndex}
					playhead={playhead}
					mappings={mappings}
					movePart={movePart}
				/>
			</div>
		) : null
	} else {
		return (
			<div ref={wrapperRef} className="group" data-handler-id={handlerId}>
				<div className="group__header">
					<div className="title">{group.name}</div>
					<div className="controls">
						<div className="toggle">
							<Toggle
								id="auto-play"
								isChecked={group.autoPlay}
								onChange={() => {
									ipcServer.toggleGroupAutoplay({ rundownId, groupId: group.id, value: !group.autoPlay })
								}}
							/>
							<label htmlFor="auto-play" className="toggle-label">
								Auto-play
							</label>
						</div>

						<div className="toggle">
							<Toggle
								id="loop"
								isChecked={group.loop}
								onChange={() => {
									ipcServer.toggleGroupLoop({ rundownId, groupId: group.id, value: !group.loop })
								}}
							/>
							<label htmlFor="loop" className="toggle-label">
								Loop
							</label>
						</div>
						<TrashBtn
							onClick={() => {
								ipcServer.deleteGroup({ rundownId, groupId: group.id })
							}}
						/>
					</div>
				</div>
				<div className="group__content">
					{group.parts.map((part) => (
						<PartView
							key={part.id}
							rundownId={rundownId}
							part={part}
							parentGroup={group}
							parentGroupIndex={groupIndex}
							playhead={playhead}
							mappings={mappings}
							movePart={movePart}
						/>
					))}

					<GroupOptions rundownId={rundownId} group={group} />
				</div>
			</div>
		)
	}
}

const GroupOptions: React.FC<{ rundownId: string; group: Group }> = ({ rundownId, group }) => {
	const ipcServer = useContext(IPCServerContext)
	const [newPartOpen, setNewPartOpen] = React.useState(false)

	return (
		<>
			<div className="group-list__control-row">
				<button className="btn form" onClick={() => setNewPartOpen(true)}>
					New part
				</button>
			</div>
			{newPartOpen && (
				<PartPropertiesDialog
					acceptLabel="Create"
					onAccepted={(part) => {
						ipcServer.newPart({
							rundownId,
							name: part.name,
							groupId: group.id,
						})
						setNewPartOpen(false)
					}}
					onDiscarded={() => setNewPartOpen(false)}
				/>
			)}
		</>
	)
}
