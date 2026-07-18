import type { Batch, BatchProjectItem, Project } from '$lib/classes';
import type { Asset } from '$lib/classes/Asset.svelte';
import LL from '$lib/i18n/i18n-svelte';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { ProjectService } from './ProjectService';

interface CbrConversionProgressEvent {
	conversionRequestId: string;
	progress: number;
}

export type BatchCbrActivity = 'converting' | 'completed' | 'failed';

export interface BatchCbrQueueProgress {
	activeProjectId: number | null;
	completed: number;
	failed: number;
	remaining: number;
	progress: number;
	total: number;
}

type BatchCbrUpdate = (
	item: BatchProjectItem,
	activity: BatchCbrActivity,
	queue: BatchCbrQueueProgress
) => void;

export interface BatchCbrServiceOptions {
	processItem?: (
		batch: Batch,
		item: BatchProjectItem,
		report: (progress: number) => void
	) => Promise<void>;
	onUpdate?: BatchCbrUpdate;
}

/**
 * Convertit séquentiellement les assets principaux d'un Batch en CBR.
 */
export class BatchCbrService {
	private readonly processItem: NonNullable<BatchCbrServiceOptions['processItem']>;
	private readonly onUpdate?: BatchCbrUpdate;
	private executionItems: BatchProjectItem[] = [];
	private activeItem: BatchProjectItem | null = null;
	private activeProgress = 0;
	private completed = 0;
	private failed = 0;

	/**
	 * Crée la queue avec des dépendances injectables pour les tests.
	 * @param {BatchCbrServiceOptions} options Traitement et callback éventuels.
	 */
	constructor(options: BatchCbrServiceOptions = {}) {
		this.processItem = options.processItem ?? this.processProjectItem.bind(this);
		this.onUpdate = options.onUpdate;
	}

	/**
	 * Traite les projets dans l'ordre du manifeste sans interrompre la queue sur une erreur.
	 * @param {Batch} batch Batch parent.
	 * @param {BatchProjectItem[]} items Projets dont le média est prêt.
	 * @returns {Promise<BatchCbrQueueProgress>} Résultat terminal de la queue.
	 */
	async run(batch: Batch, items: BatchProjectItem[]): Promise<BatchCbrQueueProgress> {
		this.executionItems = [...items].sort((left, right) => left.order - right.order);
		this.completed = 0;
		this.failed = 0;
		for (const item of this.executionItems) {
			this.activeItem = item;
			this.activeProgress = 0;
			this.notify(item, 'converting');
			try {
				await this.processItem(batch, item, (progress) => {
					this.activeProgress = Math.max(0, Math.min(99, Number.isFinite(progress) ? progress : 0));
					this.notify(item, 'converting');
				});
				this.activeProgress = 100;
				this.completed++;
				this.activeItem = null;
				this.notify(item, 'completed');
			} catch (error) {
				this.failed++;
				this.activeItem = null;
				console.error(`Unable to convert batch project ${item.projectId} to CBR:`, error);
				this.notify(item, 'failed');
			}
		}
		this.activeItem = null;
		this.activeProgress = 0;
		return this.getQueueProgress();
	}

	/**
	 * Charge l'asset principal, ignore un fichier déjà CBR puis le convertit sur place.
	 * @param {Batch} _batch Batch parent réservé aux traitements injectés.
	 * @param {BatchProjectItem} item Projet cible.
	 * @param {(progress: number) => void} report Callback de progression ffmpeg.
	 * @returns {Promise<void>} Résolution après conversion du fichier.
	 */
	private async processProjectItem(
		_batch: Batch,
		item: BatchProjectItem,
		report: (progress: number) => void
	): Promise<void> {
		const project = await ProjectService.load(item.projectId);
		const asset = this.findPrimaryAsset(project, item);
		if (!asset) throw new Error(this.message('cbrAssetMissing'));
		if (await invoke<boolean>('is_constant_bitrate', { filePath: asset.filePath })) return;

		const conversionRequestId = `batch-cbr-${item.projectId}-${Date.now()}`;
		let unlisten: UnlistenFn | undefined;
		try {
			unlisten = await listen<CbrConversionProgressEvent>(
				'cbr-conversion-progress',
				({ payload }) => {
					if (payload.conversionRequestId === conversionRequestId) report(payload.progress);
				}
			);
			await invoke('convert_audio_to_cbr', {
				filePath: asset.filePath,
				conversionRequestId
			});
		} finally {
			unlisten?.();
		}
	}

	/**
	 * Retrouve l'asset média principal enregistré par l'import Batch.
	 * @param {Project} project Projet chargé.
	 * @param {BatchProjectItem} item Ligne correspondante.
	 * @returns {Asset | undefined} Asset principal éventuel.
	 */
	private findPrimaryAsset(project: Project, item: BatchProjectItem): Asset | undefined {
		return item.media.assetId
			? project.content.assets.find((asset) => asset.id === item.media.assetId)
			: project.content.assets.find((asset) => asset.filePath === item.media.resolvedAssetPath);
	}

	/**
	 * Publie la progression agrégée de la queue.
	 * @param {BatchProjectItem} item Ligne courante.
	 * @param {BatchCbrActivity} activity Activité courante.
	 * @returns {void}
	 */
	private notify(item: BatchProjectItem, activity: BatchCbrActivity): void {
		this.onUpdate?.(item, activity, this.getQueueProgress());
	}

	/**
	 * Calcule la progression globale en incluant le fichier actif.
	 * @returns {BatchCbrQueueProgress} Compteurs actuels.
	 */
	private getQueueProgress(): BatchCbrQueueProgress {
		const total = this.executionItems.length;
		const finished = this.completed + this.failed;
		return {
			activeProjectId: this.activeItem?.projectId ?? null,
			completed: this.completed,
			failed: this.failed,
			remaining: Math.max(0, total - finished - (this.activeItem ? 1 : 0)),
			progress:
				total === 0
					? 100
					: Math.round(
							((finished + (this.activeItem ? this.activeProgress / 100 : 0)) / total) * 100
						),
			total
		};
	}

	/**
	 * Résout un message Batch sans attendre la génération automatique des types i18n.
	 * @param {string} key Clé de traduction.
	 * @returns {string} Message localisé.
	 */
	private message(key: string): string {
		const translator = Reflect.get(get(LL).batch, key) as (() => string) | undefined;
		return translator?.() ?? key;
	}
}
