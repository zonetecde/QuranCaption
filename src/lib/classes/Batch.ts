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

export interface BatchProjectItem {
	order: number;
	projectId: number;
	projectName: string;
	reciter: string;
	source: BatchSource;
	media: BatchMediaState;
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
