import { SerializableBase } from './misc/SerializableBase';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

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

export type ExportLogLevel = 'info' | 'warn' | 'error';

export type ExportLogEntry = {
	timestamp: string;
	source: string;
	level: ExportLogLevel;
	message: string;
};

export default class Exportation extends SerializableBase {
	exportId: number;
	finalFileName: string;
	finalFilePath: string;
	destinationUri: string | null;
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
	currentBatchSize: number | null;
	exportLogs: ExportLogEntry[] = $state([]);
	date: string;
	totalExportTimeMs: number | null;
	sourceProjectId: number | null;

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
		exportLabel: string = '',
		sourceProjectId: number | null = null,
		destinationUri: string | null = null
	) {
		super();
		const safeStartTime = videoStartTime ?? 0;
		const safeEndTime = videoEndTime ?? safeStartTime;
		this.exportId = exportId;
		this.finalFileName = finalFileName;
		this.finalFilePath = finalFilePath;
		this.destinationUri = destinationUri;
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
		this.currentBatchSize = $state(null);
		this.date = $state(new Date().toISOString());
		this.totalExportTimeMs = $state(null);
		this.sourceProjectId = sourceProjectId;
	}

	/**
	 * Serialise l'export sans les logs runtime.
	 * @returns {Record<string, unknown>} Donnees serialisees.
	 */
	toJSON(): Record<string, unknown> {
		const data = super.toJSON();
		delete data.exportLogs;
		return data;
	}

	/**
	 * Ajoute une ligne de log runtime sans la rendre serialisable.
	 * @param {ExportLogEntry} log Ligne de log a afficher dans le monitor.
	 * @returns {void}
	 */
	addExportLog(log: ExportLogEntry): void {
		this.exportLogs = [...(this.exportLogs ?? []), log];
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
		console.log('Canceling export', this.exportId);
		this.currentState = ExportState.Canceled;
		try {
			// Le marqueur natif doit exister avant l'événement pour couvrir le montage tardif du renderer.
			await invoke('cancel_export', { exportId: this.exportId.toString() });
		} catch (error) {
			console.warn('Unable to cancel native export:', error);
		}
		try {
			await emit('cancel-export-renderer', { exportId: this.exportId.toString() });
		} catch (error) {
			console.warn('Unable to notify export renderer:', error);
		}
	}
}
