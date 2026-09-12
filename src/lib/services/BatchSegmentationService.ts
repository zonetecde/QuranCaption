import type { Batch, BatchProjectItem, BatchSegmentationReviewCounts } from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import type { SubtitleTrack } from '$lib/classes/Track.svelte';
import { TrackType } from '$lib/classes/enums';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { exists } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { AutoSegmentationExecutionCoordinator } from './AutoSegmentationExecutionCoordinator';
import { getAutoSegmentationAudioClips, type AutoSegmentationResult } from './AutoSegmentation';
import { runAutoSegmentationForProject } from './autoSegmentation/run-segmentation';
import { BatchService } from './BatchService';
import { ProjectService } from './ProjectService';
import type { BatchSegmentationRunConfiguration } from './BatchSegmentationSettings';
import {
	classifyBatchSegmentationStatus,
	getBatchSegmentationReviewCounts
} from './BatchSegmentationReview';
import { runBatchWorkerPool } from './BatchWorkerPool';

export const BATCH_SEGMENTATION_CONCURRENCY = 1;
export const CLOUD_BATCH_SEGMENTATION_CONCURRENCY = 6;

export interface CloudAlignmentBatch {
	batchId: string;
}

export type BatchSegmentationActivity =
	| 'queued'
	| 'waiting'
	| 'processing'
	| 'applying'
	| 'saving'
	| 'completed'
	| 'failed';

export interface BatchSegmentationQueueProgress {
	active: number;
	completed: number;
	needsReview: number;
	failed: number;
	remaining: number;
	progress: number;
	total: number;
}

export interface BatchSegmentationLiveStatus {
	message: string | null;
	indeterminate: boolean;
}

export type BatchSegmentationEligibilityReason =
	| 'PROJECT_MISSING'
	| 'MEDIA_NOT_READY'
	| 'SEGMENTATION_IN_PROGRESS'
	| 'ALREADY_VALIDATED'
	| 'AUDIO_TRACK_EMPTY'
	| 'AUDIO_FILE_MISSING'
	| 'EXISTING_SUBTITLES';

export interface BatchSegmentationEligibility {
	item: BatchProjectItem;
	project: Project | null;
	reason: BatchSegmentationEligibilityReason | null;
	hasExistingSubtitles: boolean;
}

interface BatchSegmentationProcessResult {
	segmentsApplied: number;
	review: BatchSegmentationReviewCounts;
}

type BatchSegmentationUpdate = (
	item: BatchProjectItem,
	activity: BatchSegmentationActivity,
	queue: BatchSegmentationQueueProgress,
	live: BatchSegmentationLiveStatus
) => void;

export interface BatchSegmentationServiceOptions {
	processItem?: (
		item: BatchProjectItem,
		configuration: BatchSegmentationRunConfiguration,
		overwriteExistingSubtitles: boolean,
		report: (progress: number, activity: BatchSegmentationActivity) => void,
		cloudBatch?: { batchId: string; itemId: string }
	) => Promise<BatchSegmentationProcessResult>;
	saveBatch?: (batch: Batch) => Promise<void>;
	onUpdate?: BatchSegmentationUpdate;
	listenStatus?: (
		handler: (payload: { message?: string; progress?: number; itemId?: string | null }) => void
	) => Promise<UnlistenFn>;
	createCloudBatch?: (
		configuration: BatchSegmentationRunConfiguration
	) => Promise<CloudAlignmentBatch>;
	loadProject?: (projectId: number) => Promise<Project>;
	saveProject?: (project: Project) => Promise<void>;
	runForProject?: (
		project: Project,
		configuration: BatchSegmentationRunConfiguration,
		overwriteExistingSubtitles: boolean,
		onApplying: () => void,
		cloudBatch?: { batchId: string; itemId: string }
	) => Promise<AutoSegmentationResult | null>;
	getReview?: (project: Project) => BatchSegmentationReviewCounts;
}

/**
 * Inspecte une sélection en chargeant chaque projet une seule fois avant confirmation.
 * @param {BatchProjectItem[]} items Projets sélectionnés dans l'ordre du batch.
 * @returns {Promise<BatchSegmentationEligibility[]>} Éligibilité et projets chargés.
 */
export async function inspectBatchSegmentationEligibility(
	items: BatchProjectItem[]
): Promise<BatchSegmentationEligibility[]> {
	const results: BatchSegmentationEligibility[] = [];
	for (const item of [...items].sort((left, right) => left.order - right.order)) {
		if (item.media.status !== 'completed') {
			results.push({ item, project: null, reason: 'MEDIA_NOT_READY', hasExistingSubtitles: false });
			continue;
		}
		if (item.segmentation.status === 'queued' || item.segmentation.status === 'processing') {
			results.push({
				item,
				project: null,
				reason: 'SEGMENTATION_IN_PROGRESS',
				hasExistingSubtitles: false
			});
			continue;
		}
		try {
			const project = await ProjectService.load(item.projectId);
			const subtitleTrack = project.content.timeline.getFirstTrack(TrackType.Subtitle);
			const hasExistingSubtitles = subtitleTrack.clips.some(
				(clip) => clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'
			);
			const audioClips = getAutoSegmentationAudioClips(project);
			let reason: BatchSegmentationEligibilityReason | null = null;
			if (audioClips.length === 0) reason = 'AUDIO_TRACK_EMPTY';
			else if (
				!(await Promise.all(audioClips.map((clip) => exists(clip.filePath)))).every(Boolean)
			) {
				reason = 'AUDIO_FILE_MISSING';
			} else if (
				item.segmentation.status === 'auto_verified' ||
				item.segmentation.status === 'needs_review' ||
				item.segmentation.status === 'manually_verified'
			) {
				reason = 'ALREADY_VALIDATED';
			} else if (hasExistingSubtitles) reason = 'EXISTING_SUBTITLES';
			results.push({ item, project, reason, hasExistingSubtitles });
		} catch {
			results.push({ item, project: null, reason: 'PROJECT_MISSING', hasExistingSubtitles: false });
		}
	}
	return results;
}

/**
 * Réconcilie une fois les projets signalés avec leurs clips sauvegardés.
 * @param {Batch} batch Batch chargé au montage du workspace.
 * @returns {Promise<boolean>} `true` lorsqu'un manifeste a été mis à jour.
 */
export async function reconcileBatchSegmentations(batch: Batch): Promise<boolean> {
	let changed = false;
	for (const item of batch.projects.filter(
		(project) =>
			project.segmentation.status === 'needs_review' ||
			project.segmentation.status === 'failed' ||
			(project.media.status === 'completed' &&
				(project.segmentation.status === 'not_started' ||
					(project.segmentation.status === 'auto_verified' &&
						!project.segmentation.startedAt &&
						!project.segmentation.settingsSnapshot)))
	)) {
		try {
			const project = await ProjectService.load(item.projectId);
			const subtitleTrack = project.content.timeline.getFirstTrack(
				TrackType.Subtitle
			) as SubtitleTrack;
			const subtitleCount = subtitleTrack.clips.filter(
				(clip) => clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'
			).length;
			if (subtitleCount === 0) continue;
			if (item.segmentation.status !== 'needs_review') {
				item.segmentation.progress = 100;
				item.segmentation.error = null;
				item.segmentation.segmentsApplied = subtitleCount;
				item.segmentation.startedAt ??= project.detail.updatedAt;
				item.segmentation.completedAt ??= project.detail.updatedAt;
				changed = true;
			}
			changed = (await reconcileBatchProjectSegmentation(batch, item, project)) || changed;
		} catch (error) {
			console.warn(`Unable to reconcile batch project ${item.projectId}:`, error);
		}
	}
	if (changed) {
		batch.updatedAt = new Date();
		await BatchService.save(batch);
	}
	return changed;
}

/**
 * Réconcilie une seule ligne Batch depuis les vrais clips du projet correspondant.
 * @param {Batch} batch Batch contenant la ligne.
 * @param {BatchProjectItem} item Ligne à actualiser.
 * @param {Project | undefined} project Projet déjà chargé, le cas échéant.
 * @returns {Promise<boolean>} `true` lorsque le statut ou les compteurs ont changé.
 */
export async function reconcileBatchProjectSegmentation(
	batch: Batch,
	item: BatchProjectItem,
	project?: Project
): Promise<boolean> {
	const loadedProject = project ?? (await ProjectService.load(item.projectId));
	const review = getBatchSegmentationReviewCounts(loadedProject);
	// Les statuts reconstruits sans snapshot n'ont jamais fait l'objet d'une revue manuelle.
	const previousStatus =
		item.segmentation.status === 'needs_review' && !item.segmentation.settingsSnapshot
			? 'not_started'
			: item.segmentation.status;
	const status = classifyBatchSegmentationStatus(previousStatus, review);
	if (
		status === item.segmentation.status &&
		JSON.stringify(review) === JSON.stringify(item.segmentation.review)
	)
		return false;
	item.segmentation.review = review;
	item.segmentation.status = status;
	batch.updatedAt = new Date();
	return true;
}

export class BatchSegmentationService {
	private readonly processItem: NonNullable<BatchSegmentationServiceOptions['processItem']>;
	private readonly saveBatch: NonNullable<BatchSegmentationServiceOptions['saveBatch']>;
	private readonly onUpdate?: BatchSegmentationUpdate;
	private readonly listenStatus: NonNullable<BatchSegmentationServiceOptions['listenStatus']>;
	private readonly loadProject: NonNullable<BatchSegmentationServiceOptions['loadProject']>;
	private readonly saveProject: NonNullable<BatchSegmentationServiceOptions['saveProject']>;
	private readonly runForProject: NonNullable<BatchSegmentationServiceOptions['runForProject']>;
	private readonly getReview: NonNullable<BatchSegmentationServiceOptions['getReview']>;
	private readonly createCloudBatch: NonNullable<
		BatchSegmentationServiceOptions['createCloudBatch']
	>;
	private batch: Batch | null = null;
	private executionItems: BatchProjectItem[] = [];
	private activeItem: BatchProjectItem | null = null;
	private liveByProject = new Map<number, BatchSegmentationLiveStatus>();
	private saveChain: Promise<void> = Promise.resolve();
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Crée le pipeline borné avec frontières injectables pour les tests.
	 * @param {BatchSegmentationServiceOptions} options Dépendances et callback éventuels.
	 */
	constructor(options: BatchSegmentationServiceOptions = {}) {
		this.processItem = options.processItem ?? this.processProjectItem.bind(this);
		this.saveBatch = options.saveBatch ?? BatchService.save.bind(BatchService);
		this.onUpdate = options.onUpdate;
		this.loadProject = options.loadProject ?? ProjectService.load.bind(ProjectService);
		this.saveProject = options.saveProject ?? ProjectService.save.bind(ProjectService);
		this.runForProject =
			options.runForProject ??
			(async (project, configuration, overwriteExistingSubtitles, onApplying, cloudBatch) =>
				await runAutoSegmentationForProject(project, configuration.options, configuration.mode, {
					overwriteExistingSubtitles,
					headless: true,
					onApplying,
					cloudBatch
				}));
		this.getReview = options.getReview ?? getBatchSegmentationReviewCounts;
		this.createCloudBatch =
			options.createCloudBatch ??
			(async (configuration) => {
				const settings = configuration.options;
				const response = await invoke<{ batch_id: string }>('create_quran_alignment_batch', {
					modelName: settings.cloudModel ?? 'Base',
					device: settings.device ?? 'GPU',
					riwayah: settings.riwayah ?? 'hafs',
					padLeftMs: settings.padLeftMs ?? 100,
					padRightMs: settings.padRightMs ?? 200,
					includeWordTimestamps: settings.includeWbwTimestamps ?? false
				});
				return { batchId: response.batch_id };
			});
		this.listenStatus =
			options.listenStatus ??
			(async (handler) =>
				await listen<{ message?: string; progress?: number; itemId?: string | null }>(
					'segmentation-status',
					({ payload }) => handler(payload)
				));
	}

	/**
	 * Traite le batch avec un pool HTTP roulant et conserve le verrou global.
	 * @param {Batch} batch Manifeste Batch à modifier.
	 * @param {BatchProjectItem[]} selectedItems Projets confirmés dans l'ordre du batch.
	 * @param {BatchSegmentationRunConfiguration} configuration Snapshot et options immuables.
	 * @param {boolean} overwriteExistingSubtitles Autorisation explicite de remplacement.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde finale forcée.
	 */
	async run(
		batch: Batch,
		selectedItems: BatchProjectItem[],
		configuration: BatchSegmentationRunConfiguration,
		overwriteExistingSubtitles: boolean
	): Promise<void> {
		const release = AutoSegmentationExecutionCoordinator.tryAcquire('batch');
		if (!release) throw new Error('SEGMENTATION_ALREADY_RUNNING');
		if (configuration.snapshot.runtime === 'hf_json') {
			release();
			throw new Error('HF_JSON_UNSUPPORTED');
		}
		this.batch = batch;
		this.executionItems = [...selectedItems].sort((left, right) => left.order - right.order);
		let unlisten: UnlistenFn | null = null;
		try {
			if (this.executionItems.length === 0) return;
			const cloudBatch =
				configuration.mode === 'api' ? await this.createCloudBatch(configuration) : null;
			unlisten = await this.listenStatus((payload) => this.handleStatus(payload));
			for (const item of this.executionItems) {
				item.segmentation.status = 'queued';
				item.segmentation.progress = 0;
				item.segmentation.error = null;
				item.segmentation.segmentsApplied = 0;
				item.segmentation.review = {
					total: 0,
					pending: 0,
					lowConfidence: 0,
					coverage: 0,
					long: 0,
					wbwTimestamps: 0
				};
				item.segmentation.settingsSnapshot = configuration.snapshot;
				item.segmentation.startedAt = null;
				item.segmentation.completedAt = null;
				this.notify(item, 'queued');
			}
			await this.saveNow();
			await runBatchWorkerPool(
				this.executionItems,
				cloudBatch ? CLOUD_BATCH_SEGMENTATION_CONCURRENCY : BATCH_SEGMENTATION_CONCURRENCY,
				async (item) => this.runItem(item, configuration, overwriteExistingSubtitles, cloudBatch)
			);
		} finally {
			this.activeItem = null;
			unlisten?.();
			try {
				await this.flushSave();
			} finally {
				release();
			}
		}
	}

	/**
	 * Applique un événement backend à sa ligne corrélée, ou à la tâche locale active.
	 * @param {{ message?: string; progress?: number; itemId?: string | null }} payload Statut backend.
	 * @returns {void}
	 */
	handleStatus(payload: { message?: string; progress?: number; itemId?: string | null }): void {
		const item = payload.itemId
			? this.executionItems.find((candidate) => String(candidate.projectId) === payload.itemId)
			: this.activeItem;
		if (!item) return;
		const current = this.liveByProject.get(item.projectId) ?? {
			message: null,
			indeterminate: false
		};
		const message = typeof payload.message === 'string' ? payload.message : current.message;
		this.liveByProject.set(item.projectId, {
			message,
			indeterminate: typeof payload.progress !== 'number'
		});
		if (typeof payload.progress === 'number') {
			const normalized = Math.max(0, Math.min(100, payload.progress));
			const fixed: Record<string, number> = {
				preparing: 2,
				queued_alignment: 10,
				queued_gpu: 12,
				queued_cpu: 12,
				segmenting: 24,
				transcribing: 42,
				matching: 60,
				building: 70,
				alignment_complete: 75,
				queued_timing: 78,
				timing: 84,
				splitting: 92
			};
			item.segmentation.progress =
				payload.itemId == null
					? Math.round(normalized * 0.9)
					: message === 'uploading'
						? Math.round(normalized * 0.08 + 2)
						: ((message ? fixed[message] : undefined) ?? item.segmentation.progress);
		}
		this.notify(item, 'processing');
		this.scheduleSave();
	}

	/**
	 * Exécute un projet puis poursuit la queue quel que soit son résultat.
	 * @param {BatchProjectItem} item Projet actif.
	 * @param {BatchSegmentationRunConfiguration} configuration Configuration commune.
	 * @param {boolean} overwriteExistingSubtitles Autorisation d'écrasement.
	 * @returns {Promise<void>} Promesse résolue après un statut terminal.
	 */
	private async runItem(
		item: BatchProjectItem,
		configuration: BatchSegmentationRunConfiguration,
		overwriteExistingSubtitles: boolean,
		cloudBatch: CloudAlignmentBatch | null
	): Promise<void> {
		if (!cloudBatch) this.activeItem = item;
		this.liveByProject.set(item.projectId, { message: null, indeterminate: true });
		item.segmentation.status = 'processing';
		item.segmentation.startedAt = new Date();
		this.notify(item, 'processing');
		try {
			await this.saveNow();
			const result = await this.processItem(
				item,
				configuration,
				overwriteExistingSubtitles,
				(progress, activity) => {
					item.segmentation.progress = Math.max(0, Math.min(99, Math.round(progress)));
					this.liveByProject.set(item.projectId, { message: null, indeterminate: false });
					this.notify(item, activity);
					this.scheduleSave();
				},
				cloudBatch
					? {
							batchId: cloudBatch.batchId,
							itemId: String(item.projectId)
						}
					: undefined
			);
			item.segmentation.segmentsApplied = result.segmentsApplied;
			item.segmentation.review = result.review;
			item.segmentation.status = classifyBatchSegmentationStatus(
				item.segmentation.status,
				result.review
			);
			item.segmentation.progress = 100;
			item.segmentation.error = null;
			item.segmentation.completedAt = new Date();
			this.notify(item, 'completed');
			await this.saveNow();
		} catch (error) {
			item.segmentation.status = 'failed';
			item.segmentation.error = error instanceof Error ? error.message : String(error);
			item.segmentation.completedAt = new Date();
			this.notify(item, 'failed');
			await this.saveNow().catch(() => undefined);
		} finally {
			if (this.activeItem === item) {
				this.activeItem = null;
			}
			this.liveByProject.delete(item.projectId);
		}
	}

	/**
	 * Charge, segmente et sauvegarde un projet sans modifier le projet global.
	 * @param {BatchProjectItem} item Projet cible.
	 * @param {BatchSegmentationRunConfiguration} configuration Configuration commune.
	 * @param {boolean} overwriteExistingSubtitles Autorisation d'écrasement.
	 * @param {(progress: number, activity: BatchSegmentationActivity) => void} report Progression applicative.
	 * @param {{ batchId: string; itemId: string } | undefined} cloudBatch Lot cloud partagé, le cas échéant.
	 * @returns {Promise<BatchSegmentationProcessResult>} Résultat relu depuis les clips appliqués.
	 */
	private async processProjectItem(
		item: BatchProjectItem,
		configuration: BatchSegmentationRunConfiguration,
		overwriteExistingSubtitles: boolean,
		report: (progress: number, activity: BatchSegmentationActivity) => void,
		cloudBatch: { batchId: string; itemId: string } | undefined
	): Promise<BatchSegmentationProcessResult> {
		const project = await this.loadProject(item.projectId);
		const response = await this.runForProject(
			project,
			configuration,
			overwriteExistingSubtitles,
			() => report(94, 'applying'),
			cloudBatch
		);
		if (!response || response.status !== 'completed') {
			throw new Error(response?.status === 'failed' ? response.message : 'SEGMENTATION_CANCELLED');
		}
		const review = this.getReview(project);
		project.detail.updateTimestamp();
		report(98, 'saving');
		await this.saveProject(project);
		return { segmentsApplied: response.segmentsApplied, review };
	}

	/**
	 * Publie l'état courant vers le workspace.
	 * @param {BatchProjectItem} item Ligne modifiée.
	 * @param {BatchSegmentationActivity} activity Activité courante.
	 * @returns {void}
	 */
	private notify(item: BatchProjectItem, activity: BatchSegmentationActivity): void {
		this.onUpdate?.(
			item,
			activity,
			this.getQueueProgress(),
			this.liveByProject.get(item.projectId) ?? { message: null, indeterminate: false }
		);
	}

	/**
	 * Calcule le résumé de l'exécution courante.
	 * @returns {BatchSegmentationQueueProgress} Compteurs de la queue.
	 */
	private getQueueProgress(): BatchSegmentationQueueProgress {
		const active = this.executionItems.filter(
			(item) => item.segmentation.status === 'processing'
		).length;
		const total = this.executionItems.length;
		return {
			active,
			completed: this.executionItems.filter((item) =>
				['auto_verified', 'manually_verified'].includes(item.segmentation.status)
			).length,
			needsReview: this.executionItems.filter((item) => item.segmentation.status === 'needs_review')
				.length,
			failed: this.executionItems.filter((item) => item.segmentation.status === 'failed').length,
			remaining: this.executionItems.filter((item) => item.segmentation.status === 'queued').length,
			progress: Math.round(
				this.executionItems.reduce(
					(sum, item) =>
						sum +
						(['auto_verified', 'needs_review', 'manually_verified', 'failed'].includes(
							item.segmentation.status
						)
							? 100
							: item.segmentation.progress),
					0
				) / Math.max(total, 1)
			),
			total
		};
	}

	/**
	 * Programme une sauvegarde Batch au plus une fois toutes les 350 ms.
	 * @returns {void}
	 */
	private scheduleSave(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.enqueueSave().catch(() => undefined);
		}, 350);
	}

	/**
	 * Sauvegarde immédiatement une transition importante.
	 * @returns {Promise<void>} Promesse de l'écriture sérialisée.
	 */
	private async saveNow(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.enqueueSave();
	}

	/**
	 * Ajoute une sauvegarde à la chaîne d'écritures.
	 * @returns {Promise<void>} Promesse de cette sauvegarde.
	 */
	private enqueueSave(): Promise<void> {
		const batch = this.batch!;
		batch.updatedAt = new Date();
		const current = this.saveChain.catch(() => undefined).then(() => this.saveBatch(batch));
		this.saveChain = current;
		return current;
	}

	/**
	 * Force toute sauvegarde différée avant la fin de la queue.
	 * @returns {Promise<void>} Promesse résolue après synchronisation.
	 */
	private async flushSave(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.enqueueSave();
	}
}
