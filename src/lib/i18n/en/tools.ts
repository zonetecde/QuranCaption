const tools = {
	hifzRepetition: 'Hifz Repetition',
	hifzDescription: 'Repeat existing subtitles and generate matching audio',
	hifzBody:
		'Turn your existing subtitles into a Hifz-ready repetition track. Each verse will be repeated with configurable silence gaps.',
	repeatEachVerse: 'Repeat each verse',
	repeatEachSubtitle: 'Repeat each subtitle',
	generatingHifzAudio: 'Generating Hifz audio...',
	repeatCount: 'Repeat count',
	silenceDuration: 'Silence duration between repetitions',
	silenceDescription:
		'The silence is the duration of the repeated segment. Increase for more pause time between repetitions.',
	keepVisualMerges: 'Keep visual merges',
	keepSubtitlesVisible: 'Keep subtitles visible during pause intervals',
	stretchCompleteSubtitles: 'Stretch complete subtitles across repeated cycles',
	noAudioFoundSilentHifz: 'No audio found. A silent Hifz track will be generated.',
	addSubtitlesBeforeHifz: 'Add subtitles before generating a Hifz track.',
	readyToGenerate: 'Ready to generate.',
	generating: 'Generating...',
	generateHifz: 'Generate Hifz',
	hifzTrackGenerated: 'Hifz track generated with {count} subtitles.',
	hifzConfirmation: 'Hifz repetition confirmation',
	hifzConfirmationMessage:
		'This will create a new track with repeated subtitles. Existing subtitles will not be modified.',
	shiftAllSubtitles: 'Shift All Subtitles',
	shiftDescription: 'Move all subtitles forward or backward in time',
	shiftBody:
		'Move all subtitles forward or backward by a specified amount. Use positive values to move right, negative to move left.',
	backward: 'Backward (Left)',
	forward: 'Forward (Right)',
	shiftAmount: 'Shift Amount',
	applyFromTime: 'Apply from time (seconds)',
	usePlayhead: 'Use playhead',
	subtitlesBeforeTimeStay:
		'Subtitles starting before this time stay put. Only subtitles at or after this time will be shifted.',
	readyToApply: 'Ready to apply changes.',
	applyShift: 'Apply Shift',
	enterValidShiftAmount: 'Please enter a valid shift amount.',
	subtitlesShifted: 'Subtitles shifted by {amount} {unit} to the {direction}{scope}.',
	assetTrimmer: 'Asset Trimmer',
	trimmerDescription: 'Trim audio or video assets without affecting the original',
	selectAsset: 'SELECT ASSET',
	chooseAudioOrVideo: 'Choose an audio or video file...',
	startTime: 'START TIME',
	endTime: 'END TIME',
	totalDurationToTrim: 'Total duration to trim:',
	trimAsset: 'Trim Asset',
	pleaseSelectAsset: 'Please select an asset',
	startTimeMustBeLess: 'Start time must be less than end time',
	endTimeExceedsDuration: 'End time exceeds asset duration',
	assetTrimmedSuccess:
		'Asset trimmed successfully! The trimmed version has been added to the project.',
	failedToTrim: 'Failed to trim asset: {error}'
};

export default tools;
