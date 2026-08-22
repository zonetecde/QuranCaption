import { getAllWindows } from '@tauri-apps/api/window';
import { SerializableBase } from './misc/SerializableBase';
import { invoke } from '@tauri-apps/api/core';
import type { QuranReflectionContext } from '$lib/services/QuranReflectionService';
import { AnalyticsService, type AnalyticsWorkflow } from '$lib/services/AnalyticsService';
import type { UnknownRecord } from '$lib/types/common';

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

export type ExportCancelSource = 'export_monitor' | 'app_close';

const ANALYTICS_EXPORT_STAGES: Record<ExportState, string> = {
	[ExportState.WaitingForRecord]: 'pending',
	[ExportState.Recording]: 'recording',
	[ExportState.AddingAudio]: 'adding_audio',
	[ExportState.ProcessingBackground]: 'processing_background',
	[ExportState.AddingSubtitles]: 'adding_subtitles',
	[ExportState.Exported]: 'exported',
	[ExportState.Error]: 'error',
	[ExportState.Canceled]: 'canceled',
	[ExportState.CreatingVideo]: 'creating_video',
	[ExportState.MergingFiles]: 'merging_files',
	[ExportState.CapturingFrames]: 'capturing_frames',
	[ExportState.Initializing]: 'initializing'
};

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
	currentBatchSize: number | null;
	exportLogs: ExportLogEntry[] = $state([]);
	date: string;
	totalExportTimeMs: number | null;
	sourceProjectId: number | null;
	reflectionContext: QuranReflectionContext | null;
	analyticsWorkflowId: string;
	analyticsStartedAt: number | null;
	analyticsTerminalTracked: boolean;

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
		reflectionContext: QuranReflectionContext | null = null
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
		this.currentBatchSize = $state(null);
		this.date = $state(new Date().toISOString());
		this.totalExportTimeMs = $state(null);
		this.sourceProjectId = sourceProjectId;
		this.reflectionContext = reflectionContext;
		this.analyticsWorkflowId = '';
		this.analyticsStartedAt = null;
		this.analyticsTerminalTracked = false;
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

	/**
	 * Commence le workflow analytique d'un export video une seule fois.
	 * @param {UnknownRecord} properties Proprietes structurelles de l'export.
	 * @returns {void}
	 */
	startAnalytics(properties: UnknownRecord): void {
		if (this.exportKind !== ExportKind.Video || this.analyticsWorkflowId) return;
		const workflow = AnalyticsService.trackVideoExportStarted(properties);
		this.analyticsWorkflowId = workflow.workflowId;
		this.analyticsStartedAt = workflow.startedAt;
	}

	/**
	 * Emet au plus une transition terminale pour le workflow video une seule fois.
	 * @param {ExportState} state Etat terminal atteint.
	 * @param {{ failureStage?: ExportState; cancelSource?: ExportCancelSource }} details Contexte terminal allowliste.
	 * @returns {boolean} Vrai lorsqu'un evenement terminal a ete emis.
	 */
	trackAnalyticsTerminal(
		state: ExportState,
		details: { failureStage?: ExportState; cancelSource?: ExportCancelSource } = {}
	): boolean {
		if (
			this.exportKind !== ExportKind.Video ||
			this.analyticsTerminalTracked ||
			!this.analyticsWorkflowId ||
			this.analyticsStartedAt === null
		) {
			return false;
		}
		if (
			state !== ExportState.Exported &&
			state !== ExportState.Error &&
			state !== ExportState.Canceled
		) {
			return false;
		}

		const workflow: AnalyticsWorkflow = {
			workflowId: this.analyticsWorkflowId,
			startedAt: this.analyticsStartedAt
		};
		const properties = {
			video_duration_seconds: this.videoLength / 1000,
			video_width: this.videoDimensions.width,
			video_height: this.videoDimensions.height,
			fps: this.fps,
			failure_stage: details.failureStage
				? ANALYTICS_EXPORT_STAGES[details.failureStage]
				: undefined,
			cancel_source: details.cancelSource
		};
		this.analyticsTerminalTracked = true;
		if (state === ExportState.Exported) {
			AnalyticsService.trackVideoExported(workflow, properties);
		} else if (state === ExportState.Error) {
			AnalyticsService.trackVideoExportFailed(workflow, properties);
		} else {
			AnalyticsService.trackVideoExportCanceled(workflow, properties);
		}
		return true;
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

	async cancelExport(source: ExportCancelSource = 'export_monitor') {
		const wasOnGoing = this.isOnGoing();
		if (
			this.currentState === ExportState.Initializing ||
			this.currentState === ExportState.ProcessingBackground ||
			this.currentState === ExportState.AddingSubtitles ||
			this.currentState === ExportState.CreatingVideo ||
			this.currentState === ExportState.MergingFiles
		) {
			console.log('Canceling export', this.exportId);
			await invoke('cancel_export', { exportId: this.exportId.toString() });
		}

		(await getAllWindows()).forEach((win) => {
			console.log(win.label, this.exportId.toString());
			if (
				win.label === this.exportId.toString() ||
				win.label.startsWith(`${this.exportId.toString()}-capture-`)
			) {
				win.close();
			}
		});

		this.currentState = ExportState.Canceled;
		if (wasOnGoing) {
			this.trackAnalyticsTerminal(ExportState.Canceled, { cancelSource: source });
		}

		// Le monitor est partagé : une annulation depuis n'importe quelle fenêtre doit
		// immédiatement devenir l'état canonique et être diffusée aux autres fenêtres.
		await invoke('merge_export_entries', {
			ownedExportIds: [this.exportId],
			exports: [this.toJSON()]
		});
	}
}
