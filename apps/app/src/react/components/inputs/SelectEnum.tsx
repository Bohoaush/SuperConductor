import { MenuItem, TextField, Tooltip } from '@mui/material'
import React, { useCallback, useState } from 'react'

export const SelectEnum: React.FC<{
	label: React.ReactNode
	currentValue: any
	indeterminate?: boolean
	options: { [key: string]: any }
	onChange: (newValue: any) => void
	allowUndefined?: boolean
	defaultValue?: any
	fullWidth?: boolean
	width?: string
	disabled?: boolean
	tooltip?: string
	focusTooltip?: string
}> = ({
	currentValue,
	indeterminate,
	options,
	onChange,
	allowUndefined,
	defaultValue,
	label,
	fullWidth,
	width,
	disabled,
	tooltip,
	focusTooltip,
}) => {
	const [hasFocus, setHasFocus] = useState<boolean>(false)

	const allOptions: { [key: string]: { value: string | number; label: string } } = {}

	// Convert Typescript-enum to key-values:

	let foundAny = false
	// If the enum has numbers as values:
	for (const key in options) {
		if (!isNaN(Number(key))) {
			foundAny = true
			allOptions[key] = { value: Number(key), label: options[key] }
		}
	}
	if (!foundAny) {
		// If the enum has strings as values:
		for (const key in options) {
			if (isNaN(Number(key))) {
				foundAny = true
				allOptions[options[key]] = { value: options[key], label: key }
			}
		}
	}
	if (allowUndefined) {
		allOptions['__undefined'] = { value: '__undefined', label: 'Not set' }
	}
	if (currentValue === undefined) {
		if (defaultValue !== undefined) {
			currentValue = defaultValue
		} else {
			currentValue = '__undefined'
		}
	}

	if (!allOptions[currentValue]) {
		if (currentValue === '__undefined') {
			allOptions[currentValue] = { value: currentValue, label: 'Not set' }
		} else {
			allOptions[currentValue] = { value: currentValue, label: String(currentValue) }
		}
	}

	const allOptionsList = Object.entries(allOptions)

	if (indeterminate) {
		allOptionsList.unshift(['__indeterminate', { value: '__indeterminate', label: '-- Different values --' }])
		currentValue = '__indeterminate'
	}

	const onFocus = useCallback(() => {
		setHasFocus(true)
	}, [setHasFocus])

	let elInput = (
		<TextField
			select
			margin="dense"
			size="small"
			fullWidth={fullWidth}
			label={label}
			value={currentValue}
			onChange={(e) => {
				if (e.target.value === '__indeterminate') return // ignore

				if (allowUndefined && e.target.value === '__undefined') {
					onChange(undefined)
				} else {
					const selectedOption = allOptions[e.target.value]
					if (selectedOption) onChange(selectedOption.value)
					else throw new Error('Unknown option: ' + e.target.value)
				}
			}}
			onFocus={onFocus}
			sx={{ width: width }}
			disabled={disabled}
		>
			{allOptionsList.map(([key, value]) => {
				return (
					<MenuItem key={key} value={key}>
						{value.label}
					</MenuItem>
				)
			})}
		</TextField>
	)

	if (tooltip || focusTooltip) {
		let displayTooltip = tooltip ?? ''
		if (focusTooltip && hasFocus) displayTooltip = focusTooltip

		elInput = (
			<Tooltip arrow={true} title={displayTooltip}>
				{elInput}
			</Tooltip>
		)
	}

	return elInput
}
