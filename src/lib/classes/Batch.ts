import { Utilities } from '.';
import { SerializableBase } from './misc/SerializableBase';

export type BatchSource = { kind: 'url'; value: string } | { kind: 'file'; value: string };

export type BatchMediaStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export type BatchMediaMode = 'audio_only' | 'audio_video';

export interface BatchMediaState {
	status: BatchMediaStatus;
	progress: number;
	error: string | null;
	resolvedAssetPath: string | null;
	mode: BatchMediaMode | null;
	assetId: number | null;
}

export type BatchSegmentationStatus =
	| 'not_started'
	| 'queued'
	| 'processing'
	| 'auto_verified'
	| 'needs_review'
	| 'manually_verified'
	| 'failed';

export interface BatchSegmentationReviewCounts {
	total: number;
	pending: number;
	lowConfidence: number;
	coverage: number;
	long: number;
	wbwTimestamps: number;
}

export interface BatchSegmentationSettingsSnapshot {
	runtime: string;
	mode: string;
	model: string;
	device: string | null;
	includeWbwTimestamps: boolean;
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
	fillBySilence: boolean;
	extendBeforeSilence: boolean;
	extendBeforeSilenceMs: number;
	surahSplitterSurah: number | null;
}

export interface BatchSegmentationState {
	status: BatchSegmentationStatus;
	progress: number;
	error: string | null;
	segmentsApplied: number;
	review: BatchSegmentationReviewCounts;
	settingsSnapshot: BatchSegmentationSettingsSnapshot | null;
	startedAt: Date | null;
	completedAt: Date | null;
}

export type BatchTranslationStatus =
	| 'not_added'
	| 'adding'
	| 'ready_to_fetch'
	| 'fetching'
	| 'auto_verified'
	| 'needs_review'
	| 'manually_verified'
	| 'failed';

export interface BatchTranslationReviewCounts {
	total: number;
	complete: number;
	pending: number;
	fetched: number;
	toReview: number;
	errors: number;
}

export interface BatchProjectTranslationState {
	editionName: string;
	editionAuthor: string;
	editionLanguage: string;
	status: BatchTranslationStatus;
	progress: number;
	error: string | null;
	review: BatchTranslationReviewCounts;
	addedAt: Date | null;
	fetchedAt: Date | null;
	completedAt: Date | null;
}

export type BatchStyleStatus = 'not_applied' | 'queued' | 'processing' | 'completed' | 'failed';

export interface BatchStyleState {
	status: BatchStyleStatus;
	presetId: number | null;
	presetName: string | null;
	progress: number;
	error: string | null;
	appliedAt: Date | null;
}

export type BatchExportStatus = 'not_started' | 'queued' | 'processing' | 'completed' | 'failed';

export interface BatchExportState {
	status: BatchExportStatus;
	progress: number;
	outputPath: string | null;
	error: string | null;
	exportedAt: Date | null;
}

/**
 * Crée l'état persistant initial d'une application de style Batch.
 * @returns {BatchStyleState} État initial sans preset appliqué.
 */
export function createDefaultBatchStyleState(): BatchStyleState {
	return {
		status: 'not_applied',
		presetId: null,
		presetName: null,
		progress: 0,
		error: null,
		appliedAt: null
	};
}

/**
 * Crée l'état persistant initial d'un export Batch.
 * @returns {BatchExportState} État initial sans export.
 */
export function createDefaultBatchExportState(): BatchExportState {
	return {
		status: 'not_started',
		progress: 0,
		outputPath: null,
		error: null,
		exportedAt: null
	};
}

/**
 * Crée l'état persistant d'une édition de traduction dans un projet Batch.
 * @param {Pick<BatchProjectTranslationState, 'editionName' | 'editionAuthor' | 'editionLanguage'>} edition Métadonnées de l'édition.
 * @returns {BatchProjectTranslationState} État initial sans texte de traduction.
 */
export function createDefaultBatchTranslationState(
	edition: Pick<BatchProjectTranslationState, 'editionName' | 'editionAuthor' | 'editionLanguage'>
): BatchProjectTranslationState {
	return {
		...edition,
		status: 'not_added',
		progress: 0,
		error: null,
		review: { total: 0, complete: 0, pending: 0, fetched: 0, toReview: 0, errors: 0 },
		addedAt: null,
		fetchedAt: null,
		completedAt: null
	};
}

/**
 * Crée l'état de segmentation rétrocompatible d'un projet Batch.
 * @returns {BatchSegmentationState} État initial indépendant.
 */
export function createDefaultBatchSegmentationState(): BatchSegmentationState {
	return {
		status: 'not_started',
		progress: 0,
		error: null,
		segmentsApplied: 0,
		review: {
			total: 0,
			pending: 0,
			lowConfidence: 0,
			coverage: 0,
			long: 0,
			wbwTimestamps: 0
		},
		settingsSnapshot: null,
		startedAt: null,
		completedAt: null
	};
}

export interface BatchProjectItem {
	order: number;
	projectId: number;
	projectName: string;
	reciter: string;
	source: BatchSource;
	media: BatchMediaState;
	segmentation: BatchSegmentationState;
	translations: Record<string, BatchProjectTranslationState>;
	style: BatchStyleState;
	export: BatchExportState;
}

/**
 * Indique si la segmentation d'un projet autorise les prochaines étapes Batch.
 * @param {BatchProjectItem} item Projet Batch à vérifier.
 * @returns {boolean} `true` après validation automatique ou manuelle.
 */
export function isBatchProjectSegmentationVerified(item: BatchProjectItem): boolean {
	return (
		item.segmentation.status === 'auto_verified' || item.segmentation.status === 'manually_verified'
	);
}

export interface BatchDetail {
	id: number;
	name: string;
	createdAt: Date;
	updatedAt: Date;
	projectCount: number;
	reciter: string | null;
	importedMediaCount: number;
}

export class Batch extends SerializableBase {
	static NAME_MAX_LENGTH = 80;

	version: 1 = 1;
	id: number;
	name: string;
	createdAt: Date;
	updatedAt: Date;
	projects: BatchProjectItem[];

	/**
	 * Crée un manifeste de batch persistant.
	 * @param {string} name Nom du batch.
	 * @param {BatchProjectItem[]} projects Projets liés au batch dans leur ordre d'import.
	 * @param {number} id Identifiant du batch.
	 * @param {Date} createdAt Date de création.
	 * @param {Date} updatedAt Date de dernière modification.
	 */
	constructor(
		name: string = '',
		projects: BatchProjectItem[] = [],
		id: number = Utilities.randomId(),
		createdAt: Date = new Date(),
		updatedAt: Date = createdAt
	) {
		super();
		this.id = id;
		this.name = name;
		this.createdAt = createdAt;
		this.updatedAt = updatedAt;
		this.projects = projects;
	}

	/**
	 * Produit les métadonnées légères nécessaires à la homepage.
	 * @returns {BatchDetail} Détails du batch sans charger ses projets complets.
	 */
	toDetail(): BatchDetail {
		const reciters = new Set(this.projects.map((project) => project.reciter));
		return {
			id: this.id,
			name: this.name,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt,
			projectCount: this.projects.length,
			reciter: reciters.size === 1 ? (reciters.values().next().value ?? null) : null,
			importedMediaCount: this.projects.filter((project) => project.media.status === 'completed')
				.length
		};
	}

	/**
	 * Restaure un manifeste de batch depuis sa représentation JSON.
	 * @param {Record<string, unknown>} data Données sérialisées du batch.
	 * @returns {T} Batch restauré avec ses dates et états média.
	 */
	static override fromJSON<T extends SerializableBase>(
		this: unknown,
		data: Record<string, unknown>
	): T {
		if (data.version !== 1) {
			throw new Error(`Unsupported batch version: ${String(data.version)}`);
		}
		const projects = Array.isArray(data.projects)
			? data.projects.map((rawProject) => {
					const project = rawProject as Partial<BatchProjectItem>;
					const segmentation = project.segmentation ?? createDefaultBatchSegmentationState();
					const style = project.style ?? createDefaultBatchStyleState();
					const exportState = project.export ?? createDefaultBatchExportState();
					const translations = Object.fromEntries(
						Object.entries(project.translations ?? {}).map(([editionName, rawState]) => {
							const state = rawState as Partial<BatchProjectTranslationState>;
							return [
								editionName,
								{
									...createDefaultBatchTranslationState({
										editionName,
										editionAuthor: String(state.editionAuthor ?? ''),
										editionLanguage: String(state.editionLanguage ?? '')
									}),
									...state,
									review: {
										...createDefaultBatchTranslationState({
											editionName,
											editionAuthor: '',
											editionLanguage: ''
										}).review,
										...(state.review ?? {})
									},
									addedAt: state.addedAt ? new Date(state.addedAt) : null,
									fetchedAt: state.fetchedAt ? new Date(state.fetchedAt) : null,
									completedAt: state.completedAt ? new Date(state.completedAt) : null
								}
							];
						})
					);
					return {
						order: Number(project.order),
						projectId: Number(project.projectId),
						projectName: String(project.projectName ?? ''),
						reciter: String(project.reciter ?? ''),
						source: project.source as BatchSource,
						media: {
							status: project.media?.status ?? 'pending',
							progress: project.media?.progress ?? 0,
							error: project.media?.error ?? null,
							resolvedAssetPath: project.media?.resolvedAssetPath ?? null,
							mode: project.media?.mode ?? null,
							assetId: project.media?.assetId ?? null
						},
						segmentation: {
							...createDefaultBatchSegmentationState(),
							...segmentation,
							review: {
								...createDefaultBatchSegmentationState().review,
								...(segmentation.review ?? {})
							},
							startedAt: segmentation.startedAt ? new Date(segmentation.startedAt) : null,
							completedAt: segmentation.completedAt ? new Date(segmentation.completedAt) : null
						},
						translations,
						style: {
							...createDefaultBatchStyleState(),
							...style,
							appliedAt: style.appliedAt ? new Date(style.appliedAt) : null
						},
						export: {
							...createDefaultBatchExportState(),
							...exportState,
							exportedAt: exportState.exportedAt ? new Date(exportState.exportedAt) : null
						}
					};
				})
			: [];

		return new Batch(
			String(data.name ?? ''),
			projects,
			Number(data.id),
			new Date(String(data.createdAt)),
			new Date(String(data.updatedAt))
		) as unknown as T;
	}
}
