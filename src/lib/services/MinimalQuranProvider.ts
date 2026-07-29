import { globalState } from '$lib/runes/main.svelte';

type MinimalQuranPayload = { verses: Record<string, string[]> };

let versesCache: Record<string, string[]> | null = null;
let loadingPromise: Promise<Record<string, string[]>> | null = null;

/**
 * Charge le texte du Coran minimal une seule fois et rafraîchit l'aperçu.
 * @returns {Promise<Record<string, string[]>>} Versets indexés par sourate et numéro.
 */
async function loadVerses(): Promise<Record<string, string[]>> {
	if (versesCache) return versesCache;
	if (loadingPromise) return loadingPromise;

	loadingPromise = fetch('/minimal-quran/verses.json')
		.then(async (response) => {
			if (!response.ok) throw new Error(`Failed to load Minimal Quran verses: ${response.status}`);
			const payload = (await response.json()) as MinimalQuranPayload;
			versesCache = payload.verses;
			globalState.updateVideoPreviewUI();
			return versesCache;
		})
		.finally(() => {
			loadingPromise = null;
		});

	return loadingPromise;
}

export class MinimalQuranProvider {
	/**
	 * Précharge le texte avant un export synchrone.
	 * @returns {Promise<void>}
	 */
	static async prefetch(): Promise<void> {
		await loadVerses();
	}

	/**
	 * Retourne les mots correspondant aux indices du clip sans perdre leurs regroupements.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro de verset.
	 * @param {number} startWordIndex Premier indice inclus.
	 * @param {number} endWordIndex Dernier indice inclus.
	 * @returns {string[] | null} Mots minimaux, ou `null` pendant leur chargement.
	 */
	static getVerseWordsSlice(
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number
	): string[] | null {
		if (!versesCache) {
			void loadVerses();
			return null;
		}
		return versesCache[`${surah}:${verse}`]?.slice(startWordIndex, endWordIndex + 1) ?? null;
	}

	/**
	 * Retourne la plage de mots correspondant aux indices du clip.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro de verset.
	 * @param {number} startWordIndex Premier indice inclus.
	 * @param {number} endWordIndex Dernier indice inclus.
	 * @returns {string | null} Texte minimal, ou `null` pendant son chargement.
	 */
	static getVerseSlice(
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number
	): string | null {
		return this.getVerseWordsSlice(surah, verse, startWordIndex, endWordIndex)?.join(' ') ?? null;
	}
}

export default MinimalQuranProvider;
