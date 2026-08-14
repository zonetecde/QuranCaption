import { Quran } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';

const loadingPromises = new Map<number, Promise<void>>();

/**
 * Charge une sourate depuis les données coraniques locales et rafraîchit l'aperçu.
 * @param {number} surah Numéro de sourate.
 * @returns {Promise<void>} Promesse résolue lorsque la sourate est disponible.
 */
async function loadSurah(surah: number): Promise<void> {
	const loadedSurah = Quran.getSurahs().find((item) => item.id === surah);
	if (loadedSurah?.verses.length) return;
	const currentPromise = loadingPromises.get(surah);
	if (currentPromise) return currentPromise;

	const loadingPromise = Quran.load()
		.then(() => Quran.getSurah(surah))
		.then(() => {
			try {
				globalState.updateVideoPreviewUI();
			} catch {
				// Le préchargement peut être lancé avant l'ouverture d'un projet.
			}
		})
		.finally(() => loadingPromises.delete(surah));

	loadingPromises.set(surah, loadingPromise);
	return loadingPromise;
}

export class IndopakQuranProvider {
	/**
	 * Précharge les sourates nécessaires avant un export synchrone.
	 * @param {Iterable<number>} surahs Numéros des sourates à charger.
	 * @returns {Promise<void>} Promesse résolue lorsque toutes les sourates sont disponibles.
	 */
	static async prefetch(surahs: Iterable<number>): Promise<void> {
		await Promise.all([...new Set(surahs)].map((surah) => loadSurah(surah)));
	}

	/**
	 * Retourne les mots IndoPak correspondant aux indices Uthmani du clip.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro de verset.
	 * @param {number} startWordIndex Premier indice inclus.
	 * @param {number} endWordIndex Dernier indice inclus.
	 * @returns {string[] | null} Mots IndoPak, ou `null` pendant leur chargement.
	 */
	static getVerseWordsSlice(
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number
	): string[] | null {
		const loadedVerse = Quran.getSurahs()
			.find((item) => item.id === surah)
			?.verses.find((item) => item.id === verse);
		if (!loadedVerse) {
			void loadSurah(surah);
			return null;
		}

		return loadedVerse.words.slice(startWordIndex, endWordIndex + 1).map((word) => word.indopak);
	}

	/**
	 * Retourne la plage de mots IndoPak correspondant aux indices Uthmani du clip.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro de verset.
	 * @param {number} startWordIndex Premier indice inclus.
	 * @param {number} endWordIndex Dernier indice inclus.
	 * @returns {string | null} Texte IndoPak, ou `null` pendant son chargement.
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

export default IndopakQuranProvider;
