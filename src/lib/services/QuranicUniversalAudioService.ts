import { invoke } from '@tauri-apps/api/core';

/**
 * Client de l'API "Quranic Universal Audio" (mode Preload de l'app aligner Hugging Face).
 *
 * Les deux endpoints sont publics/ungated : ils exposent un catalogue de récitations
 * pré-alignées et révisées à la main, plus les segments + timestamps mot à mot. Les
 * appels passent par les commandes Tauri `preload_recitations` / `preload_segments`
 * (mêmes infra reqwest + SSE Gradio que la segmentation cloud).
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

export class QuranicUniversalAudioService {
	/**
	 * Liste toutes les récitations publiées avec leurs chapitres disponibles.
	 * @returns {Promise<QuaRecitation[]>} Récitations triées par label.
	 * @throws {Error} Si le catalogue ne peut pas être chargé.
	 */
	static async getRecitations(): Promise<QuaRecitation[]> {
		const response = (await invoke('preload_recitations')) as QuaRecitationsResponse;
		if (response?.error) {
			throw new Error(response.error);
		}
		const recitations = response?.recitations ?? [];
		return [...recitations].sort((a, b) => a.label.localeCompare(b.label));
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
	 * Liste les récitations audio-only : le catalogue audio complet (récitateurs
	 * non publiés, depuis de nombreux serveurs) — mutuellement exclusif avec
	 * {@link getRecitations}. Ces récitations n'offrent que l'audio (pas de
	 * segments révisés).
	 * @returns {Promise<QuaRecitation[]>} Récitations triées par label.
	 * @throws {Error} Si le catalogue ne peut pas être chargé.
	 */
	static async getAudioRecitations(): Promise<QuaRecitation[]> {
		const response = (await invoke('preload_audio_recitations')) as QuaRecitationsResponse;
		if (response?.error) {
			throw new Error(response.error);
		}
		const recitations = response?.recitations ?? [];
		return [...recitations].sort((a, b) => a.label.localeCompare(b.label));
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
}
