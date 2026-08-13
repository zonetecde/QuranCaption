import { globalState } from '$lib/runes/main.svelte';

type WarshWord = {
	text: string;
	owner: number;
	source: number[];
	verseEnd?: number;
};

type WarshPayload = {
	verses: Record<string, { words: WarshWord[] }>;
};

type WarshAyahMapping = {
	hafs_to_warsh: Record<string, Record<string, { targets: number[]; relation: string }>>;
	warsh_to_hafs: Record<string, Record<string, { targets: number[]; relation: string }>>;
};

export type WarshRenderSlice = {
	text: string;
	words: string[];
	sourceWordIndexes: number[][];
	suffix: string;
	targetAyahs: number[];
	relation: string;
};

let versesCache: WarshPayload['verses'] | null = null;
let ayahMappingCache: WarshAyahMapping | null = null;
let loadingPromise: Promise<void> | null = null;

/**
 * Convertit un numéro d'āyah vers les chiffres arabes utilisés par le mushaf Warsh.
 * @param {number} value Numéro occidental.
 * @returns {string} Numéro en chiffres arabes.
 */
function formatArabicNumber(value: number): string {
	return value.toString().replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
}

/**
 * Charge le texte, les alignements de mots et le mapping d'āyāt Warsh embarqués.
 * @returns {Promise<void>} Promesse résolue lorsque les données sont disponibles.
 */
async function loadWarshData(): Promise<void> {
	if (versesCache && ayahMappingCache) return;
	if (loadingPromise) return loadingPromise;

	loadingPromise = Promise.all([fetch('/warsh/verses.json'), fetch('/warsh/ayah-map.json')])
		.then(async ([versesResponse, mappingResponse]) => {
			if (!versesResponse.ok) {
				throw new Error(`Failed to load Warsh verses: ${versesResponse.status}`);
			}
			if (!mappingResponse.ok) {
				throw new Error(`Failed to load Hafs/Warsh ayah mapping: ${mappingResponse.status}`);
			}
			const [payload, mapping] = await Promise.all([
				versesResponse.json() as Promise<WarshPayload>,
				mappingResponse.json() as Promise<WarshAyahMapping>
			]);
			versesCache = payload.verses;
			ayahMappingCache = mapping;
			try {
				globalState.updateVideoPreviewUI();
			} catch {
				// Le préchargement peut aussi être lancé avant l'ouverture d'un projet.
			}
		})
		.finally(() => {
			loadingPromise = null;
		});

	return loadingPromise;
}

export class WarshProvider {
	/**
	 * Précharge les données Warsh avant un rendu ou un export synchrone.
	 * @returns {Promise<void>} Promesse résolue après le chargement.
	 */
	static async prefetch(): Promise<void> {
		await loadWarshData();
	}

	/**
	 * Indique si le texte et le mapping Warsh sont disponibles en mémoire.
	 * @returns {boolean} `true` lorsque le provider est prêt.
	 */
	static isReady(): boolean {
		return versesCache !== null && ayahMappingCache !== null;
	}

	/**
	 * Retourne le numéro Warsh à afficher autour d'une traduction indexée selon Hafs.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro d'āyah selon le comptage Hafs/Kufi du projet.
	 * @param {'before' | 'after'} position Position configurée du numéro de verset.
	 * @returns {string | null | undefined} Numéro ou plage Warsh, `null` s'il est porté par une āyah Hafs adjacente, ou `undefined` pendant le chargement.
	 */
	static getTranslationVerseNumber(
		surah: number,
		verse: number,
		position: 'before' | 'after'
	): string | null | undefined {
		if (!ayahMappingCache) {
			void loadWarshData();
			return undefined;
		}

		const surahMapping = ayahMappingCache.hafs_to_warsh[String(surah)];
		const targets = surahMapping?.[String(verse)]?.targets ?? [];
		if (targets.length === 0) return null;

		const adjacentVerse = position === 'before' ? verse - 1 : verse + 1;
		const adjacentTargets = surahMapping?.[String(adjacentVerse)]?.targets ?? [];
		const visibleTargets = targets.filter((target) => !adjacentTargets.includes(target));
		return visibleTargets.length > 0 ? visibleTargets.join('-') : null;
	}

	/**
	 * Retourne le segment Warsh correspondant à une plage de mots Hafs.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro d'āyah selon le comptage Hafs/Kufi du projet.
	 * @param {number} startWordIndex Premier index Hafs inclus.
	 * @param {number} endWordIndex Dernier index Hafs inclus.
	 * @param {boolean} showVerseNumbers Indique si les numéros Warsh doivent être ajoutés.
	 * @returns {WarshRenderSlice | null} Segment aligné, ou `null` pendant le chargement.
	 */
	static getVerseSlice(
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number,
		showVerseNumbers: boolean
	): WarshRenderSlice | null {
		if (!versesCache || !ayahMappingCache) {
			void loadWarshData();
			return null;
		}

		const key = `${surah}:${verse}`;
		const verseData = versesCache[key];
		const mapping = ayahMappingCache.hafs_to_warsh[String(surah)]?.[String(verse)];
		if (!verseData || !mapping) return null;

		const selectedWords = verseData.words.filter(
			(word) => word.owner >= startWordIndex && word.owner <= endWordIndex
		);
		const words = selectedWords.map((word) => word.text);
		let suffix = '';
		if (showVerseNumbers) {
			for (let index = 0; index < selectedWords.length; index++) {
				const verseEnd = selectedWords[index].verseEnd;
				if (!verseEnd) continue;
				const number = formatArabicNumber(verseEnd);
				if (index === selectedWords.length - 1) suffix = ` ${number}`;
				else words[index] += `\u00A0${number}`;
			}
		}

		return {
			text: words.join(' '),
			words,
			sourceWordIndexes: selectedWords.map((word) => word.source),
			suffix,
			targetAyahs: mapping.targets,
			relation: mapping.relation
		};
	}
}

export default WarshProvider;
