import React from 'react'
import { Field, Form, Formik } from 'formik'
import { Part } from '../../../models/rundown/Part'
import * as Yup from 'yup'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { TextField } from 'formik-mui'

interface IProps {
	initial?: Part
	open: boolean
	onAccepted: (newPart: Partial<Part> & Pick<Part, 'name'>) => void
	onDiscarded: () => void
	acceptLabel: string
	title: string
}

const partValidationSchema = Yup.object({
	name: Yup.string().label('Part Name').required(),
})

export function PartPropertiesDialog({ initial, open, title, acceptLabel, onAccepted, onDiscarded }: IProps) {
	return (
		<Formik
			initialValues={{ name: initial?.name ?? '' }}
			validationSchema={partValidationSchema}
			enableReinitialize={true}
			onSubmit={(values, actions) => {
				onAccepted({
					name: values.name,
				})
				actions.setSubmitting(false)
				actions.resetForm()
			}}
		>
			{(formik) => (
				<Dialog open={open}>
					<DialogTitle>{title}</DialogTitle>
					<DialogContent>
						<Form>
							<Field
								component={TextField}
								margin="normal"
								fullWidth
								name="name"
								type="text"
								label="Part Name"
								autoFocus={true}
								required
							/>
						</Form>
					</DialogContent>
					<DialogActions>
						<Button
							onClick={() => {
								formik.submitForm().catch(console.error)
							}}
						>
							{acceptLabel}
						</Button>
						<Button onClick={onDiscarded}>Cancel</Button>
					</DialogActions>
				</Dialog>
			)}
		</Formik>
	)
}
