const modals = {
	speakerRemoval: {
		title: 'Remove speaker',
		usage: '{speaker} is assigned to {count} transcript segment{plural}.',
		description:
			'Choose what should happen to those segments before removing the speaker from the project.',
		mainSpeakerWarning:
			"This is also the project's main speaker. That project field will be replaced or cleared.",
		reassignSegments: 'Reassign the segments',
		noReplacement: 'No other speaker available',
		reassignAndRemove: 'Reassign and remove',
		leaveUnassigned: 'Leave the segments without a speaker',
		unassignedDescription:
			'The affected segments will be marked as {speaker} and can be reviewed later.',
		markUnassignedAndRemove: 'Mark unassigned and remove'
	},
	removeAsset: 'Remove Asset',
	alsoDeleteFile: 'Also delete file from computer',
	actionCannotBeUndone: 'Warning: This action cannot be undone.',
	inputDefaultPlaceholder: 'Enter text here',
	searchSpeakers: 'Start typing to search speakers...',
	speakerLabel: 'Speaker',
	deleteConfirmation: 'Delete Confirmation',
	deleteConfirmMessage: 'Are you sure you want to delete this item?',
	deleteWarning: 'This action cannot be undone.',
	deleteItem: 'Delete "{name}"?',
	saveChanges: 'Save Changes',
	unsavedChanges: 'Unsaved Changes',
	unsavedChangesMessage: 'You have unsaved changes. Do you want to save before closing?',
	discard: 'Discard',
	save: 'Save',
	newVersionAvailable: 'New Version Available',
	newVersionDescription:
		'A new version of Minbar Studio is available. Would you like to update now?',
	updateNow: 'Update Now',
	remindLater: 'Remind Later',
	restartRequired: 'Restart Required',
	restartRequiredMessage: 'The application needs to restart to apply the update.',
	restart: 'Restart'
};

export default modals;
