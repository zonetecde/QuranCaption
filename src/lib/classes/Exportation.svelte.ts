import { invoke } from '@tauri-apps/api/core';
import { SerializableBase } from './misc/SerializableBase';
import { getAllWindows } from '@tauri-apps/api/window';

export enum ExportState {
	WaitingForRecord = 'Pending',
	Exporting = 'Exporting',
	Exported = 'Exported',
	Error = 'Error',
	Canceled = 'Canceled'
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
		this.errorLog = $state(errorLog);
		this.date = $state(new Date().toISOString());
	}
	isOnGoing() {
		return this.currentState === ExportState.Exporting;
	}

	async cancelExport() {
		if (this.currentState === ExportState.Exporting) {
			console.log('Canceling export', this.exportId);
			// TODO

			// Set state to canceled
			this.currentState = ExportState.Canceled;
		}
	}
}
