import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

/**
 * Client de l'API "Quranic Universal Audio" (mode Preload de l'app aligner Hugging Face).
 *
 * Les deux endpoints sont publics/ungated : ils exposent un catalogue de récitations
 * pré-alignées et révisées à la main, plus les segments + timestamps mot à mot. Les
 * appels passent par les commandes Tauri `preload_recitations` / `preload_segments`
 * (mêmes infra reqwest + SSE Gradio que la segmentation cloud).
 *
 * Les deux catalogues (publié + audio-only) sont mis en cache pour éviter de rappeler
 * l'API à chaque bascule de mode (l'audio-only fait ~1,7 Mo) :
 *  - Tier 1 : cache mémoire, valable toute la session (survit aux bascules/ré-ouvertures).
 *  - Tier 2 : cache disque persistant avec TTL + stale-while-revalidate (sert la copie
 *    en cache instantanément, puis revalide en arrière-plan si elle est périmée).
 */

/** Détails du récitateur, identiques à ceux affichés dans l'UI de l'aligner. */
export type QuaReciter = {
	reciter_id: string;
	name_en: string;
	name_ar: string;
};

/** Une récitation disponible (récitateur + spécificités) et ses chapitres alignés. */
export type QuaRecitation = {
	slug: string;
	label: string;
	reciter: QuaReciter;
	riwayah: string;
	style: string;
	channel: string;
	source: string;
	chapters: number[];
};

type QuaRecitationsResponse = {
	recitations?: QuaRecitation[];
	error?: string;
};

/**
 * Réponse de `preload_segments` : enveloppe identique au téléchargement Preload
 * segment-mode, avec en plus `audio_url` (mp3 du chapitre directement fetchable).
 */
export type QuaSegmentsResponse = {
	_meta?: unknown;
	recitation?: string;
	chapter?: number;
	verse_from?: number;
	verse_to?: number;
	audio_url?: string;
	segments?: unknown[];
	error?: string;
};

/** Réponse de `preload_audio` : juste l'URL audio directe du chapitre. */
export type QuaAudioResponse = {
	recitation?: string;
	chapter?: number;
	audio_url?: string;
	error?: string;
};

/** Identifie l'un des deux catalogues mis en cache. */
type QuaCatalogKind = 'published' | 'audio';

/** Entrée de cache : récitations triées + horodatage epoch (ms) du fetch. */
type CachedQuaCatalog = {
	fetchedAt: number;
	recitations: QuaRecitation[];
};

/** Durée de validité par catalogue avant revalidation (stale-while-revalidate). */
const QUA_CATALOG_TTL_MS: Record<QuaCatalogKind, number> = {
	published: 24 * 60 * 60 * 1000, // 24 h — alimenté par les revues quotidiennes.
	audio: 7 * 24 * 60 * 60 * 1000 // 7 j — catalogue scrappé, évolue rarement.
};

/** Fichier de cache persistant (dans appDataDir). */
const QUA_CATALOG_CACHE_FILE = 'qua-recitations-cache.json';

export class QuranicUniversalAudioService {
	/** Tier 1 — cache mémoire : survit aux bascules de mode et ré-ouvertures du panneau. */
	private static memoryCache: Partial<Record<QuaCatalogKind, CachedQuaCatalog>> = {};
	/** Fetchs réseau en cours, dédupliqués par catalogue (évite les appels concurrents). */
	private static inflight: Partial<Record<QuaCatalogKind, Promise<QuaRecitation[]>>> = {};
	/** Promesse d'hydratation disque, mémoïsée pour ne lire le fichier qu'une seule fois. */
	private static hydration?: Promise<void>;

	/**
	 * Liste toutes les récitations publiées avec leurs chapitres disponibles.
	 * @returns {Promise<QuaRecitation[]>} Récitations triées par label.
	 * @throws {Error} Si le catalogue ne peut pas être chargé.
	 */
	static async getRecitations(): Promise<QuaRecitation[]> {
		return this.loadCatalog('published', async () => {
			const response = (await invoke('preload_recitations')) as QuaRecitationsResponse;
			if (response?.error) {
				throw new Error(response.error);
			}
			const recitations = response?.recitations ?? [];
			return [...recitations].sort((a, b) => a.label.localeCompare(b.label));
		});
	}

	/**
	 * Liste les récitations audio-only : le catalogue audio complet (récitateurs
	 * non publiés, depuis de nombreux serveurs) — mutuellement exclusif avec
	 * {@link getRecitations}. Ces récitations n'offrent que l'audio (pas de
	 * segments révisés).
	 * @returns {Promise<QuaRecitation[]>} Récitations triées par label.
	 * @throws {Error} Si le catalogue ne peut pas être chargé.
	 */
	static async getAudioRecitations(): Promise<QuaRecitation[]> {
		return this.loadCatalog('audio', async () => {
			const response = (await invoke('preload_audio_recitations')) as QuaRecitationsResponse;
			if (response?.error) {
				throw new Error(response.error);
			}
			const recitations = response?.recitations ?? [];
			return [...recitations].sort((a, b) => a.label.localeCompare(b.label));
		});
	}

	/**
	 * Récupère les segments pré-alignés (+ timestamps mot à mot) d'une récitation/chapitre.
	 *
	 * @param {string} recitation Slug de la récitation (delivery).
	 * @param {number} chapter Numéro de sourate.
	 * @param {number} verseFrom Verset de début (1-indexé).
	 * @param {number} verseTo Verset de fin (1-indexé, inclus).
	 * @returns {Promise<QuaSegmentsResponse>} Enveloppe segments + `audio_url`.
	 * @throws {Error} Si l'API renvoie une erreur.
	 */
	static async getSegments(
		recitation: string,
		chapter: number,
		verseFrom: number,
		verseTo: number
	): Promise<QuaSegmentsResponse> {
		const response = (await invoke('preload_segments', {
			recitation,
			chapter,
			verseFrom,
			verseTo,
			// Le callout promet des timestamps mot à mot : on les demande toujours.
			includeTimestamps: true
		})) as QuaSegmentsResponse;
		if (response?.error) {
			throw new Error(response.error);
		}
		return response;
	}

	/**
	 * Récupère l'URL audio directe d'un chapitre (audio-only, sans segments).
	 * @param {string} recitation Slug de la récitation (delivery).
	 * @param {number} chapter Numéro de sourate.
	 * @returns {Promise<QuaAudioResponse>} Enveloppe avec `audio_url`.
	 * @throws {Error} Si l'API renvoie une erreur.
	 */
	static async getAudioUrl(recitation: string, chapter: number): Promise<QuaAudioResponse> {
		const response = (await invoke('preload_audio', {
			recitation,
			chapter
		})) as QuaAudioResponse;
		if (response?.error) {
			throw new Error(response.error);
		}
		return response;
	}

	/**
	 * Charge un catalogue via le cache à deux niveaux (mémoire puis disque), avec
	 * stale-while-revalidate : une copie périmée est servie immédiatement et revalidée
	 * en arrière-plan. Un fetch réseau n'a lieu qu'en l'absence totale de cache ou en
	 * tâche de fond pour rafraîchir une copie expirée.
	 * @param {QuaCatalogKind} kind Catalogue ciblé (`published` ou `audio`).
	 * @param {() => Promise<QuaRecitation[]>} fetcher Récupère + trie la liste depuis l'API.
	 * @returns {Promise<QuaRecitation[]>} Récitations triées par label.
	 * @throws {Error} Uniquement si aucun cache n'existe et que le fetch échoue.
	 */
	private static async loadCatalog(
		kind: QuaCatalogKind,
		fetcher: () => Promise<QuaRecitation[]>
	): Promise<QuaRecitation[]> {
		await this.hydrateFromDisk();

		const cached = this.memoryCache[kind];
		if (cached) {
			const isStale = Date.now() - cached.fetchedAt >= QUA_CATALOG_TTL_MS[kind];
			if (isStale) {
				// Sert la copie en cache et revalide en arrière-plan (sans bloquer l'UI).
				void this.revalidate(kind, fetcher);
			}
			return cached.recitations;
		}

		// Aucun cache : on doit récupérer depuis l'API.
		return this.fetchAndStore(kind, fetcher);
	}

	/**
	 * Récupère un catalogue depuis l'API, met à jour le cache mémoire + disque, et
	 * déduplique les appels concurrents pour un même catalogue.
	 * @param {QuaCatalogKind} kind Catalogue ciblé.
	 * @param {() => Promise<QuaRecitation[]>} fetcher Récupère + trie la liste depuis l'API.
	 * @returns {Promise<QuaRecitation[]>} Récitations fraîchement récupérées.
	 * @throws {Error} Si le fetch échoue.
	 */
	private static fetchAndStore(
		kind: QuaCatalogKind,
		fetcher: () => Promise<QuaRecitation[]>
	): Promise<QuaRecitation[]> {
		const existing = this.inflight[kind];
		if (existing) {
			return existing;
		}

		const pending = (async () => {
			try {
				const recitations = await fetcher();
				this.memoryCache[kind] = { fetchedAt: Date.now(), recitations };
				void this.persist();
				return recitations;
			} finally {
				delete this.inflight[kind];
			}
		})();

		this.inflight[kind] = pending;
		return pending;
	}

	/**
	 * Revalide un catalogue en arrière-plan ; avale les erreurs pour que la copie
	 * périmée déjà servie reste utilisable.
	 * @param {QuaCatalogKind} kind Catalogue ciblé.
	 * @param {() => Promise<QuaRecitation[]>} fetcher Récupère + trie la liste depuis l'API.
	 * @returns {Promise<void>}
	 */
	private static async revalidate(
		kind: QuaCatalogKind,
		fetcher: () => Promise<QuaRecitation[]>
	): Promise<void> {
		try {
			await this.fetchAndStore(kind, fetcher);
		} catch (error) {
			console.error(`QUA catalog revalidation failed (${kind}):`, error);
		}
	}

	/**
	 * Hydrate le cache mémoire depuis le fichier disque, une seule fois par session.
	 * Toute erreur de lecture/parsing est non bloquante (on repart sans cache disque).
	 * @returns {Promise<void>}
	 */
	private static hydrateFromDisk(): Promise<void> {
		if (!this.hydration) {
			this.hydration = (async () => {
				try {
					const path = await this.cacheFilePath();
					if (!(await exists(path))) {
						return;
					}
					const parsed = JSON.parse(await readTextFile(path)) as Partial<
						Record<QuaCatalogKind, CachedQuaCatalog>
					>;
					for (const kind of ['published', 'audio'] as QuaCatalogKind[]) {
						const entry = parsed?.[kind];
						if (
							entry &&
							typeof entry.fetchedAt === 'number' &&
							Array.isArray(entry.recitations) &&
							!this.memoryCache[kind]
						) {
							this.memoryCache[kind] = entry;
						}
					}
				} catch (error) {
					console.error('Failed to read QUA catalog cache:', error);
				}
			})();
		}
		return this.hydration;
	}

	/**
	 * Persiste tout le cache mémoire sur disque. Non bloquant : les erreurs d'écriture
	 * sont seulement loggées (le cache mémoire reste la source de vérité de la session).
	 * @returns {Promise<void>}
	 */
	private static async persist(): Promise<void> {
		try {
			await writeTextFile(await this.cacheFilePath(), JSON.stringify(this.memoryCache));
		} catch (error) {
			console.error('Failed to persist QUA catalog cache:', error);
		}
	}

	/**
	 * Construit le chemin absolu du fichier de cache dans le dossier de données de l'app.
	 * @returns {Promise<string>} Chemin absolu du fichier de cache.
	 */
	private static async cacheFilePath(): Promise<string> {
		return join(await appDataDir(), QUA_CATALOG_CACHE_FILE);
	}
}
