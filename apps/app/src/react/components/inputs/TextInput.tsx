import React, { useCallback } from 'react'
import { ParsedValueInput } from './parsedValueInput'
export const TextInput: React.FC<
	| {
			currentValue: string
			onChange: (newValue: string) => void
			allowUndefined: false
			emptyPlaceholder?: string
			label?: React.ReactNode
			disabled?: boolean
			fullWidth?: boolean
			width?: string
			changeOnKey?: boolean
			endAdornment?: React.ReactNode
	  }
	| {
			currentValue: string | undefined
			onChange: (newValue: string | undefined) => void
			allowUndefined: true
			emptyPlaceholder?: string
			label?: React.ReactNode
			disabled?: boolean
			fullWidth?: boolean
			width?: string
			changeOnKey?: boolean
			endAdornment?: React.ReactNode
	  }
> = (props) => {
	const parse = useCallback((v: string) => v, [])

	const stringify = useCallback((v: string | undefined) => v ?? '', [])

	if (props.allowUndefined) {
		return ParsedValueInput<string | undefined>(
			props.currentValue,
			props.onChange,
			undefined,
			parse,
			stringify,
			props.label,
			props.emptyPlaceholder,
			'text',
			props.disabled,
			props.fullWidth,
			props.width,
			props.changeOnKey,
			undefined,
			props.endAdornment
		)
	} else {
		return ParsedValueInput<string>(
			props.currentValue,
			props.onChange,
			'',
			parse,
			stringify,
			props.label,
			props.emptyPlaceholder,
			'text',
			props.disabled,
			props.fullWidth,
			props.width,
			props.changeOnKey,
			undefined,
			props.endAdornment
		)
	}
}
