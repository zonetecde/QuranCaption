import { getAllWindows } from '@tauri-apps/api/window';
import { SerializableBase } from './misc/SerializableBase';
import { invoke } from '@tauri-apps/api/core';

export enum ExportState {
	WaitingForRecord = 'Pending',
	Recording = 'Recording',
	AddingAudio = 'Adding Audio',
	ProcessingBackground = 'Processing Background',
	AddingSubtitles = 'Adding Subtitles',
	Exported = 'Exported',
	Error = 'Error',
	Canceled = 'Canceled',
	CreatingVideo = 'Creating Video',
	MergingFiles = 'Merging Files',
	CapturingFrames = 'Capturing Frames',
	Initializing = 'Initializing...'
}

export enum ExportKind {
	Video = 'Video',
	Text = 'Text'
}

export default class Exportation extends SerializableBase {
	exportId: number;
	finalFileName: string;
	finalFilePath: string;
	exportKind: ExportKind;
	exportLabel: string;
	videoDimensions: { width: number; height: number };
	videoLength: number;
	videoStartTime: number;
	videoEndTime: number;
	verseRange: string;
	currentState: ExportState;
	percentageProgress: number;
	currentTreatedTime: number;
	hasSecondarySegmentProgress: boolean;
	processingBackgroundProgress: number;
	processingBackgroundCurrentSegment: number;
	processingBackgroundTotalSegments: number;
	mergingFilesProgress: number;
	mergingFilesCurrentSegment: number;
	mergingFilesTotalSegments: number;
	errorLog: string;
	fps: number;
	date: string;

	constructor(
		exportId: number,
		finalFileName: string,
		finalFilePath: string,
		videoDimensions: { width: number; height: number },
		videoStartTime: number,
		videoEndTime: number,
		verseRange: string,
		currentState: ExportState,
		fps: number,
		percentageProgress: number = 0,
		currentTreatedTime: number = 0,
		errorLog: string = '',
		exportKind: ExportKind = ExportKind.Video,
		exportLabel: string = ''
	) {
		super();
		const safeStartTime = videoStartTime ?? 0;
		const safeEndTime = videoEndTime ?? safeStartTime;
		this.exportId = exportId;
		this.finalFileName = finalFileName;
		this.finalFilePath = finalFilePath;
		this.exportKind = $state(exportKind ?? ExportKind.Video);
		this.exportLabel = $state(exportLabel ?? '');
		this.videoDimensions = videoDimensions ?? { width: 0, height: 0 };
		this.videoStartTime = safeStartTime;
		this.videoEndTime = safeEndTime;
		this.videoLength = safeEndTime - safeStartTime;
		this.verseRange = verseRange;
		this.fps = fps ?? 0;
		this.currentState = $state(currentState);
		this.percentageProgress = $state(percentageProgress);
		this.currentTreatedTime = $state(currentTreatedTime);
		this.hasSecondarySegmentProgress = $state(false);
		this.processingBackgroundProgress = $state(0);
		this.processingBackgroundCurrentSegment = $state(0);
		this.processingBackgroundTotalSegments = $state(0);
		this.mergingFilesProgress = $state(0);
		this.mergingFilesCurrentSegment = $state(0);
		this.mergingFilesTotalSegments = $state(0);
		this.errorLog = $state(errorLog);
		this.date = $state(new Date().toISOString());
	}

	isOnGoing() {
		return (
			this.currentState === ExportState.WaitingForRecord ||
			this.currentState === ExportState.Recording ||
			this.currentState === ExportState.AddingAudio ||
			this.currentState === ExportState.ProcessingBackground ||
			this.currentState === ExportState.AddingSubtitles ||
			this.currentState === ExportState.CreatingVideo ||
			this.currentState === ExportState.MergingFiles ||
			this.currentState === ExportState.CapturingFrames ||
			this.currentState === ExportState.Initializing
		);
	}

	async cancelExport() {
		if (
			this.currentState === ExportState.Initializing ||
			this.currentState === ExportState.ProcessingBackground ||
			this.currentState === ExportState.AddingSubtitles ||
			this.currentState === ExportState.CreatingVideo ||
			this.currentState === ExportState.MergingFiles
		) {
			console.log('Canceling export', this.exportId);
			// Envoie à rust de tuer le processus ffmpeg pour cette exportation
			await invoke('cancel_export', { exportId: this.exportId.toString() });
		}

		// Ferme la fenêtre d'exportation si elle est ouverte
		(await getAllWindows()).forEach((win) => {
			console.log(win.label, this.exportId.toString());
			if (win.label === this.exportId.toString()) {
				win.close();
				// La fenêtre d'exportation va supprimer le dossier temporaire des images à sa fermeture
			}
		});

		// Set state to canceled
		this.currentState = ExportState.Canceled;
	}
}

