import { getAllWindows } from '@tauri-apps/api/window';
import { SerializableBase } from './misc/SerializableBase';
import { invoke } from '@tauri-apps/api/core';

export enum ExportState {
	WaitingForRecord = 'Waiting for Record',
	Recording = 'Recording',
	AddingAudio = 'Adding Audio',
	Exported = 'Exported',
	Error = 'Error',
	Canceled = 'Canceled',
	CreatingVideo = 'Creating Video',
	CapturingFrames = 'Capturing Frames',
	Initializing = 'Initializing...'
}

export default class Exportation extends SerializableBase {
	exportId: number;
	finalFileName: string;
	finalFilePath: string;
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
	completedDate: string | undefined;

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
		errorLog: string = ''
	) {
		super();
		this.exportId = exportId;
		this.finalFileName = finalFileName;
		this.finalFilePath = finalFilePath;
		this.videoDimensions = videoDimensions;
		this.videoStartTime = videoStartTime;
		this.videoEndTime = videoEndTime;
		this.videoLength = videoEndTime - videoStartTime;
		this.verseRange = verseRange;
		this.fps = fps;
		this.currentState = $state(currentState);
		this.percentageProgress = $state(percentageProgress);
		this.currentTreatedTime = $state(currentTreatedTime);
		this.errorLog = $state(errorLog);
		this.date = $state(new Date().toISOString());
		this.completedDate = $state(undefined);
	}

	isOnGoing() {
		return (
			this.currentState === ExportState.WaitingForRecord ||
			this.currentState === ExportState.Recording ||
			this.currentState === ExportState.AddingAudio ||
			this.currentState === ExportState.CreatingVideo ||
			this.currentState === ExportState.CapturingFrames ||
			this.currentState === ExportState.Initializing
		);
	}

	async cancelExport() {
		if (
			this.currentState === ExportState.Initializing ||
			this.currentState === ExportState.CreatingVideo
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
