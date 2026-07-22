import {
	AssetType,
	SourceType,
	TrackType,
	type Batch,
	type BatchMediaMode,
	type BatchProjectItem
} from '$lib/classes';
import type { AssetTrack } from '$lib/classes/Track.svelte';
import { basename, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { exists, remove } from '@tauri-apps/plugin-fs';
import { BatchService } from './BatchService';
import { ProjectService } from './ProjectService';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { runBatchWorkerPool } from './BatchWorkerPool';

export const BATCH_MEDIA_CONCURRENCY = 3;

export type BatchMediaActivity =
	| 'queued'
	| 'downloading'
	| 'copying'
	| 'finalizing'
	| 'saving'
	| 'completed'
	| 'failed';

export interface BatchMediaQueueProgress {
	active: number;
	completed: number;
	failed: number;
	remaining: number;
	progress: number;
}

interface TransferProgressEvent {
	downloadRequestId?: string;
	copyRequestId?: string;
	progress: number;
	status: string;
}

interface DownloadErrorEvent {
	downloadRequestId: string;
	error: string;
}

interface BatchMediaResult {
	resolvedAssetPath: string;
	assetId: number;
}

type BatchMediaUpdate = (
	item: BatchProjectItem,
	activity: BatchMediaActivity,
	queue: BatchMediaQueueProgress
) => void;

export interface BatchMediaServiceOptions {
	processItem?: (
		batch: Batch,
		item: BatchProjectItem,
		mode: BatchMediaMode,
		report: (progress: number, activity: BatchMediaActivity) => void
	) => Promise<BatchMediaResult>;
	saveBatch?: (batch: Batch) => Promise<void>;
	onUpdate?: BatchMediaUpdate;
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'aac', 'ogg', 'flac', 'm4a', 'opus', 'wav']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm']);

/**
 * Identifie le type d'un média local depuis son extension.
 * @param {string} filePath Chemin à examiner.
 * @returns {'audio' | 'video' | 'unknown'} Type compatible avec l'import batch.
 */
export function getLocalBatchMediaType(filePath: string): 'audio' | 'video' | 'unknown' {
	const extension = filePath.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
	if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
	if (VIDEO_EXTENSIONS.has(extension)) return 'video';
	return 'unknown';
}

/**
 * Indique si une source locale peut alimenter le mode demandé.
 * @param {BatchProjectItem} item Projet à vérifier.
 * @param {BatchMediaMode} mode Mode choisi.
 * @returns {boolean} `true` lorsque la source est compatible.
 */
export function isBatchMediaModeCompatible(item: BatchProjectItem, mode: BatchMediaMode): boolean {
	return !(
		mode === 'audio_video' &&
		item.source.kind === 'file' &&
		getLocalBatchMediaType(item.source.value) === 'audio'
	);
}

/**
 * Convertit le mode Batch vers le type attendu par la commande yt-dlp existante.
 * @param {BatchMediaMode} mode Mode sélectionné dans le workspace.
 * @returns {'audio' | 'video'} Type de téléchargement unique à demander.
 */
export function getBatchDownloadType(mode: BatchMediaMode): 'audio' | 'video' {
	return mode === 'audio_only' ? 'audio' : 'video';
}

export class BatchMediaService {
	private readonly processItem: NonNullable<BatchMediaServiceOptions['processItem']>;
	private readonly saveBatch: NonNullable<BatchMediaServiceOptions['saveBatch']>;
	private readonly onUpdate?: BatchMediaUpdate;
	private readonly usesTauriTransfers: boolean;
	private readonly requestItems = new Map<string, BatchProjectItem>();
	private readonly downloadErrors = new Map<string, string>();
	private unlisteners: UnlistenFn[] = [];
	private batch: Batch | null = null;
	private executionItems: BatchProjectItem[] = [];
	private saveChain: Promise<void> = Promise.resolve();
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Crée une queue média, avec dépendances injectables pour les tests déterministes.
	 * @param {BatchMediaServiceOptions} options Traitement, sauvegarde et callback éventuels.
	 */
	constructor(options: BatchMediaServiceOptions = {}) {
		this.usesTauriTransfers = !options.processItem;
		this.processItem = options.processItem ?? this.processProjectItem.bind(this);
		this.saveBatch = options.saveBatch ?? BatchService.save.bind(BatchService);
		this.onUpdate = options.onUpdate;
	}

	/**
	 * Traite les projets sélectionnés avec un pool continu de trois workers maximum.
	 * @param {Batch} batch Manifeste à modifier.
	 * @param {BatchProjectItem[]} selectedItems Projets sélectionnés dans l'ordre du batch.
	 * @param {BatchMediaMode} mode Mode média commun à cette exécution.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde finale.
	 */
	async run(batch: Batch, selectedItems: BatchProjectItem[], mode: BatchMediaMode): Promise<void> {
		this.batch = batch;
		this.executionItems = selectedItems
			.filter((item) => item.media.status !== 'completed')
			.sort((left, right) => left.order - right.order);
		if (this.executionItems.length === 0) return;

		if (this.usesTauriTransfers) await this.installTransferListeners();
		try {
			for (const item of this.executionItems) {
				item.media.status = 'queued';
				item.media.progress = 0;
				item.media.error = null;
				item.media.mode = mode;
				this.notify(item, 'queued');
			}
			await this.saveNow();

			await runBatchWorkerPool(this.executionItems, BATCH_MEDIA_CONCURRENCY, async (item) =>
				this.runItem(item, mode)
			);
		} finally {
			try {
				await this.flushSave();
			} finally {
				this.cleanupListeners();
				this.requestItems.clear();
				this.downloadErrors.clear();
			}
		}
	}

	/**
	 * Corrèle un événement de téléchargement avec une seule ligne du batch.
	 * @param {TransferProgressEvent} payload Progression publiée par Tauri.
	 * @returns {void}
	 */
	handleDownloadProgress(payload: TransferProgressEvent): void {
		if (!payload.downloadRequestId) return;
		const item = this.requestItems.get(payload.downloadRequestId);
		if (item) this.reportTransfer(item, payload.progress, 'downloading');
	}

	/**
	 * Corrèle un événement de copie avec une seule ligne du batch.
	 * @param {TransferProgressEvent} payload Progression publiée par Tauri.
	 * @returns {void}
	 */
	handleCopyProgress(payload: TransferProgressEvent): void {
		if (!payload.copyRequestId) return;
		const item = this.requestItems.get(payload.copyRequestId);
		if (item) this.reportTransfer(item, payload.progress, 'copying');
	}

	/**
	 * Traite une ligne et garantit un statut terminal même en cas d'erreur.
	 * @param {BatchProjectItem} item Projet à traiter.
	 * @param {BatchMediaMode} mode Mode média choisi.
	 * @returns {Promise<void>} Promesse résolue après la transition terminale.
	 */
	private async runItem(item: BatchProjectItem, mode: BatchMediaMode): Promise<void> {
		item.media.status = 'processing';
		this.notify(item, item.source.kind === 'url' ? 'downloading' : 'copying');
		try {
			await this.saveNow();
			const result = await this.processItem(this.batch!, item, mode, (progress, activity) => {
				item.media.progress = Math.max(0, Math.min(99, Math.round(progress)));
				this.notify(item, activity);
				this.scheduleSave();
			});
			item.media.status = 'completed';
			item.media.progress = 100;
			item.media.error = null;
			item.media.resolvedAssetPath = result.resolvedAssetPath;
			item.media.assetId = result.assetId;
			this.notify(item, 'completed');
			await this.saveNow();
		} catch (error) {
			item.media.status = 'failed';
			item.media.error = this.readableError(error);
			this.notify(item, 'failed');
			await this.saveNow().catch(() => undefined);
		}
	}

	/**
	 * Charge et modifie un projet sans jamais changer le projet global.
	 * @param {Batch} batch Batch parent.
	 * @param {BatchProjectItem} item Projet à traiter.
	 * @param {BatchMediaMode} mode Mode média choisi.
	 * @param {(progress: number, activity: BatchMediaActivity) => void} report Callback de progression.
	 * @returns {Promise<BatchMediaResult>} Asset persistant créé ou retrouvé.
	 */
	private async processProjectItem(
		batch: Batch,
		item: BatchProjectItem,
		mode: BatchMediaMode,
		report: (progress: number, activity: BatchMediaActivity) => void
	): Promise<BatchMediaResult> {
		if (!isBatchMediaModeCompatible(item, mode)) {
			throw new Error(this.batchMessage('errorLocalAudioVideo'));
		}
		const project = await ProjectService.load(item.projectId);
		const audioTrack = project.content.timeline.getFirstTrack(TrackType.Audio) as AssetTrack;
		const videoTrack = project.content.timeline.getFirstTrack(TrackType.Video) as AssetTrack;
		const existingAsset = item.media.assetId
			? project.content.assets.find((asset) => asset.id === item.media.assetId)
			: project.content.assets.find(
					(asset) =>
						asset.metadata.batchId === batch.id &&
						asset.metadata.batchProjectId === item.projectId &&
						asset.metadata.batchPrimaryMedia === true
				);
		if (
			existingAsset &&
			audioTrack.clips.some((clip) => Reflect.get(clip, 'assetId') === existingAsset.id) &&
			(mode === 'audio_only' ||
				videoTrack.clips.some((clip) => Reflect.get(clip, 'assetId') === existingAsset.id))
		) {
			return { resolvedAssetPath: existingAsset.filePath, assetId: existingAsset.id };
		}

		item.media.assetId = null;
		item.media.resolvedAssetPath = null;
		let createdFilePath: string | null = null;
		let projectSaved = false;
		try {
			const assetFolder = await ProjectService.getAssetFolderForProject(item.projectId);
			const finalPath =
				item.source.kind === 'url'
					? await this.downloadSource(batch, item, mode, assetFolder)
					: await this.copyLocalSource(batch, item, assetFolder);
			createdFilePath = finalPath;
			if (!(await exists(finalPath)))
				throw new Error(this.batchMessage('errorImportedFileMissing'));

			report(92, 'finalizing');
			const asset = project.content.addAssetHeadless(
				finalPath,
				item.source.kind === 'url' ? item.source.value : undefined,
				item.source.kind === 'url' ? SourceType.YouTube : SourceType.Local,
				{
					skipConstantBitrateWarning: true,
					suppressUiEffects: true,
					batchId: batch.id,
					batchProjectId: item.projectId,
					batchPrimaryMedia: true
				}
			);
			if (!asset || (asset.type !== AssetType.Audio && asset.type !== AssetType.Video)) {
				throw new Error(this.batchMessage('errorImportedUnsupported'));
			}
			await asset.ensureDurationLoaded();
			if (asset.durationLoadState !== 'success' || asset.duration.ms <= 0) {
				throw new Error(asset.durationLoadError ?? this.batchMessage('errorDuration'));
			}
			await asset.addToProjectTimeline(project, mode === 'audio_video', true);
			project.detail.updateMediaDetailAttributes(audioTrack);
			project.detail.updateTimestamp();
			report(98, 'saving');
			await ProjectService.save(project);
			projectSaved = true;
			item.media.resolvedAssetPath = finalPath;
			item.media.assetId = asset.id;
			await this.saveNow();
			return { resolvedAssetPath: finalPath, assetId: asset.id };
		} catch (error) {
			if (!projectSaved && createdFilePath) {
				await remove(createdFilePath).catch(() => undefined);
				item.media.assetId = null;
				item.media.resolvedAssetPath = null;
			}
			throw error;
		}
	}

	/**
	 * Télécharge une URL avec un identifiant propre au projet.
	 * @param {Batch} batch Batch parent.
	 * @param {BatchProjectItem} item Projet cible.
	 * @param {BatchMediaMode} mode Mode demandé.
	 * @param {string} assetFolder Dossier d'assets du projet.
	 * @returns {Promise<string>} Chemin du fichier téléchargé.
	 */
	private async downloadSource(
		batch: Batch,
		item: BatchProjectItem,
		mode: BatchMediaMode,
		assetFolder: string
	): Promise<string> {
		const requestId = this.createRequestId(batch.id, item.projectId);
		this.requestItems.set(requestId, item);
		try {
			return await invoke<string>('download_from_youtube', {
				url: item.source.value,
				type: getBatchDownloadType(mode),
				downloadPath: assetFolder,
				downloadRequestId: requestId
			});
		} catch (error) {
			throw new Error(this.downloadErrors.get(requestId) ?? this.readableError(error));
		} finally {
			this.requestItems.delete(requestId);
			this.downloadErrors.delete(requestId);
		}
	}

	/**
	 * Copie une source locale vers un nom sûr et libre dans les assets.
	 * @param {Batch} batch Batch parent.
	 * @param {BatchProjectItem} item Projet cible.
	 * @param {string} assetFolder Dossier d'assets du projet.
	 * @returns {Promise<string>} Chemin final de la copie.
	 */
	private async copyLocalSource(
		batch: Batch,
		item: BatchProjectItem,
		assetFolder: string
	): Promise<string> {
		const destination = await this.getUniqueDestination(assetFolder, item.source.value);
		const requestId = this.createRequestId(batch.id, item.projectId);
		this.requestItems.set(requestId, item);
		try {
			return await invoke<string>('copy_file_with_progress', {
				sourcePath: item.source.value,
				destinationPath: destination,
				copyRequestId: requestId
			});
		} finally {
			this.requestItems.delete(requestId);
		}
	}

	/**
	 * Construit un nom de destination sûr avec suffixe numérique en cas de collision.
	 * @param {string} folder Dossier d'assets.
	 * @param {string} sourcePath Chemin source.
	 * @returns {Promise<string>} Chemin de destination disponible.
	 */
	private async getUniqueDestination(folder: string, sourcePath: string): Promise<string> {
		const originalName = (await basename(sourcePath)).replace(/[/\\:*?"<>|]/g, '_');
		const dotIndex = originalName.lastIndexOf('.');
		const extension = dotIndex > 0 ? originalName.slice(dotIndex) : '';
		const stem = (dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName) || 'media';
		let suffix = 0;
		while (true) {
			const candidate = await join(
				folder,
				`${stem}${suffix === 0 ? '' : `-${suffix}`}${extension}`
			);
			if (!(await exists(candidate)) && !(await exists(`${candidate}.part`))) return candidate;
			suffix++;
		}
	}

	/**
	 * Installe les trois listeners partagés par les transferts de l'exécution.
	 * @returns {Promise<void>} Promesse résolue lorsque les listeners sont actifs.
	 */
	private async installTransferListeners(): Promise<void> {
		this.unlisteners = await Promise.all([
			listen<TransferProgressEvent>('youtube-download-progress', ({ payload }) =>
				this.handleDownloadProgress(payload)
			),
			listen<DownloadErrorEvent>('youtube-download-error', ({ payload }) => {
				if (this.requestItems.has(payload.downloadRequestId)) {
					this.downloadErrors.set(payload.downloadRequestId, payload.error);
				}
			}),
			listen<TransferProgressEvent>('batch-file-copy-progress', ({ payload }) =>
				this.handleCopyProgress(payload)
			)
		]);
	}

	/**
	 * Applique une progression de transfert bornée sur la plage 0–90 %.
	 * @param {BatchProjectItem} item Ligne corrélée.
	 * @param {number} progress Pourcentage brut.
	 * @param {BatchMediaActivity} activity Activité affichée.
	 * @returns {void}
	 */
	private reportTransfer(
		item: BatchProjectItem,
		progress: number,
		activity: BatchMediaActivity
	): void {
		item.media.progress = Math.round(Math.max(0, Math.min(100, progress)) * 0.9);
		this.notify(item, activity);
		this.scheduleSave();
	}

	/**
	 * Publie l'état courant vers le workspace.
	 * @param {BatchProjectItem} item Ligne modifiée.
	 * @param {BatchMediaActivity} activity Activité courante.
	 * @returns {void}
	 */
	private notify(item: BatchProjectItem, activity: BatchMediaActivity): void {
		this.onUpdate?.(item, activity, this.getQueueProgress());
	}

	/**
	 * Calcule le résumé de l'exécution courante.
	 * @returns {BatchMediaQueueProgress} Compteurs et progression moyenne.
	 */
	private getQueueProgress(): BatchMediaQueueProgress {
		const active = this.executionItems.filter((item) => item.media.status === 'processing').length;
		const completed = this.executionItems.filter(
			(item) => item.media.status === 'completed'
		).length;
		const failed = this.executionItems.filter((item) => item.media.status === 'failed').length;
		return {
			active,
			completed,
			failed,
			remaining: Math.max(0, this.executionItems.length - active - completed - failed),
			progress: Math.round(
				this.executionItems.reduce((total, item) => total + item.media.progress, 0) /
					this.executionItems.length
			)
		};
	}

	/**
	 * Programme une écriture batch au plus une fois toutes les 350 ms.
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
	 * Sauvegarde immédiatement après une transition importante.
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
	 * Ajoute une sauvegarde à la chaîne pour empêcher les écritures concurrentes.
	 * @returns {Promise<void>} Promesse de cette sauvegarde.
	 */
	private enqueueSave(): Promise<void> {
		const batch = this.batch!;
		batch.updatedAt = new Date();
		const currentSave = this.saveChain.catch(() => undefined).then(() => this.saveBatch(batch));
		this.saveChain = currentSave;
		return currentSave;
	}

	/**
	 * Force la dernière sauvegarde avant de terminer la queue.
	 * @returns {Promise<void>} Promesse résolue une fois le disque synchronisé.
	 */
	private async flushSave(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
			await this.enqueueSave();
		}
		await this.saveChain;
	}

	/**
	 * Retire tous les listeners de l'exécution.
	 * @returns {void}
	 */
	private cleanupListeners(): void {
		for (const unlisten of this.unlisteners) unlisten();
		this.unlisteners = [];
	}

	/**
	 * Crée un identifiant de corrélation unique et lisible.
	 * @param {number} batchId Identifiant du batch.
	 * @param {number} projectId Identifiant du projet.
	 * @returns {string} Identifiant de requête.
	 */
	private createRequestId(batchId: number, projectId: number): string {
		const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
		return `batch-${batchId}-project-${projectId}-${unique}`;
	}

	/**
	 * Transforme toute erreur en message persistant lisible.
	 * @param {unknown} error Erreur reçue.
	 * @returns {string} Message sans préfixe inutile.
	 */
	private readableError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	/**
	 * Résout un message d'erreur Batch dans la langue active.
	 * @param {string} key Clé de traduction Batch.
	 * @returns {string} Message localisé.
	 */
	private batchMessage(key: string): string {
		const translator = Reflect.get(get(LL).batch, key) as (() => string) | undefined;
		return translator?.() ?? key;
	}
}
