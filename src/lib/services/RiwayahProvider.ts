import { globalState } from '$lib/runes/main.svelte';

export const RIWAYAH_OPTIONS = [
	'Hafs',
	'Warsh',
	'Qaloon',
	'Shouba',
	'Doori',
	'Soosi',
	'Bazzi',
	'Qumbul'
] as const;

export type Riwayah = (typeof RIWAYAH_OPTIONS)[number];
export type NonHafsRiwayah = Exclude<Riwayah, 'Hafs'>;

const RIWAYAH_CONFIG: Record<NonHafsRiwayah, { slug: string; fontFamily: string }> = {
	Warsh: { slug: 'warsh', fontFamily: 'warsh10' },
	Qaloon: { slug: 'qaloon', fontFamily: 'qaloon10' },
	Shouba: { slug: 'shouba', fontFamily: 'shouba8' },
	Doori: { slug: 'doori', fontFamily: 'doori9' },
	Soosi: { slug: 'soosi', fontFamily: 'soosi9' },
	Bazzi: { slug: 'bazzi', fontFamily: 'bazzi7' },
	Qumbul: { slug: 'qumbul', fontFamily: 'qumbul7' }
};

type RiwayahWord = {
	text: string;
	owner: number;
	source: number[];
	verseEnd?: number;
};

type RiwayahPayload = {
	verses: Record<string, { words: RiwayahWord[] }>;
};

type RiwayahAyahMapping = {
	hafs_to_riwayah: Record<string, Record<string, { targets: number[]; relation: string }>>;
	riwayah_to_hafs: Record<string, Record<string, { targets: number[]; relation: string }>>;
};

type RiwayahData = {
	verses: RiwayahPayload['verses'];
	mapping: RiwayahAyahMapping;
};

export type RiwayahRenderSlice = {
	text: string;
	words: string[];
	sourceWordIndexes: number[][];
	suffix: string;
	targetAyahs: number[];
	relation: string;
};

const dataCache = new Map<NonHafsRiwayah, RiwayahData>();
const loadingPromises = new Map<NonHafsRiwayah, Promise<void>>();

/**
 * Convertit un numéro d'āyah vers les chiffres arabes utilisés par les muṣḥafs KFGQPC.
 * @param {number} value Numéro occidental.
 * @returns {string} Numéro en chiffres arabes.
 */
function formatArabicNumber(value: number): string {
	return value.toString().replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
}

/**
 * Charge le texte, les alignements de mots et le mapping d'une riwāyah embarquée.
 * @param {NonHafsRiwayah} riwayah Riwāyah à charger.
 * @returns {Promise<void>} Promesse résolue lorsque les données sont disponibles.
 */
async function loadRiwayahData(riwayah: NonHafsRiwayah): Promise<void> {
	if (dataCache.has(riwayah)) return;
	const currentPromise = loadingPromises.get(riwayah);
	if (currentPromise) return currentPromise;

	const { slug } = RIWAYAH_CONFIG[riwayah];
	const loadingPromise = Promise.all([
		fetch(`/riwayat/${slug}/verses.json`),
		fetch(`/riwayat/${slug}/ayah-map.json`)
	])
		.then(async ([versesResponse, mappingResponse]) => {
			if (!versesResponse.ok) {
				throw new Error(`Failed to load ${riwayah} verses: ${versesResponse.status}`);
			}
			if (!mappingResponse.ok) {
				throw new Error(`Failed to load Hafs/${riwayah} ayah mapping: ${mappingResponse.status}`);
			}
			const [payload, mapping] = await Promise.all([
				versesResponse.json() as Promise<RiwayahPayload>,
				mappingResponse.json() as Promise<RiwayahAyahMapping>
			]);
			dataCache.set(riwayah, { verses: payload.verses, mapping });
			try {
				globalState.updateVideoPreviewUI();
			} catch {
				// Le préchargement peut aussi être lancé avant l'ouverture d'un projet.
			}
		})
		.finally(() => loadingPromises.delete(riwayah));

	loadingPromises.set(riwayah, loadingPromise);
	return loadingPromise;
}

/**
 * Vérifie qu'une valeur correspond à une riwāyah prise en charge.
 * @param {unknown} value Valeur à vérifier.
 * @returns {value is Riwayah} `true` pour une option connue.
 */
export function isRiwayah(value: unknown): value is Riwayah {
	return typeof value === 'string' && RIWAYAH_OPTIONS.includes(value as Riwayah);
}

/**
 * Vérifie qu'une valeur correspond à une riwāyah distincte de Hafs.
 * @param {unknown} value Valeur à vérifier.
 * @returns {value is NonHafsRiwayah} `true` si des données dédiées doivent être chargées.
 */
export function isNonHafsRiwayah(value: unknown): value is NonHafsRiwayah {
	return isRiwayah(value) && value !== 'Hafs';
}

/**
 * Retourne la police KFGQPC imposée par une riwāyah.
 * @param {NonHafsRiwayah} riwayah Riwāyah sélectionnée.
 * @returns {string} Famille CSS embarquée.
 */
export function getRiwayahFontFamily(riwayah: NonHafsRiwayah): string {
	return RIWAYAH_CONFIG[riwayah].fontFamily;
}

/**
 * Retrouve la riwāyah associée à une famille de police KFGQPC.
 * @param {unknown} fontFamily Famille CSS à identifier.
 * @returns {NonHafsRiwayah | null} Riwāyah correspondante, ou `null`.
 */
export function getRiwayahForFontFamily(fontFamily: unknown): NonHafsRiwayah | null {
	if (typeof fontFamily !== 'string') return null;
	return (
		(Object.entries(RIWAYAH_CONFIG).find(([, config]) => config.fontFamily === fontFamily)?.[0] as
			| NonHafsRiwayah
			| undefined) ?? null
	);
}

export class RiwayahProvider {
	/**
	 * Précharge les données d'une riwāyah avant un rendu ou un export synchrone.
	 * @param {NonHafsRiwayah} riwayah Riwāyah à charger.
	 * @returns {Promise<void>} Promesse résolue après le chargement.
	 */
	static async prefetch(riwayah: NonHafsRiwayah): Promise<void> {
		await loadRiwayahData(riwayah);
	}

	/**
	 * Indique si le texte et le mapping d'une riwāyah sont disponibles en mémoire.
	 * @param {NonHafsRiwayah} riwayah Riwāyah à vérifier.
	 * @returns {boolean} `true` lorsque le provider est prêt.
	 */
	static isReady(riwayah: NonHafsRiwayah): boolean {
		return dataCache.has(riwayah);
	}

	/**
	 * Retourne le numéro de riwāyah à afficher autour d'une traduction indexée selon Hafs.
	 * @param {NonHafsRiwayah} riwayah Riwāyah sélectionnée.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro d'āyah selon le comptage Hafs/Kufi du projet.
	 * @param {'before' | 'after'} position Position configurée du numéro de verset.
	 * @returns {string | null | undefined} Numéro ou plage, `null` s'il est porté par une āyah adjacente, ou `undefined` pendant le chargement.
	 */
	static getTranslationVerseNumber(
		riwayah: NonHafsRiwayah,
		surah: number,
		verse: number,
		position: 'before' | 'after'
	): string | null | undefined {
		const data = dataCache.get(riwayah);
		if (!data) {
			void loadRiwayahData(riwayah);
			return undefined;
		}

		const surahMapping = data.mapping.hafs_to_riwayah[String(surah)];
		const targets = surahMapping?.[String(verse)]?.targets ?? [];
		if (targets.length === 0) return null;

		const adjacentVerse = position === 'before' ? verse - 1 : verse + 1;
		const adjacentTargets = surahMapping?.[String(adjacentVerse)]?.targets ?? [];
		const visibleTargets = targets.filter((target) => !adjacentTargets.includes(target));
		return visibleTargets.length > 0 ? visibleTargets.join('-') : null;
	}

	/**
	 * Retourne le segment d'une riwāyah correspondant à une plage de mots Hafs.
	 * @param {NonHafsRiwayah} riwayah Riwāyah sélectionnée.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro d'āyah selon le comptage Hafs/Kufi du projet.
	 * @param {number} startWordIndex Premier index Hafs inclus.
	 * @param {number} endWordIndex Dernier index Hafs inclus.
	 * @param {boolean} showVerseNumbers Indique si les numéros de la riwāyah doivent être ajoutés.
	 * @returns {RiwayahRenderSlice | null} Segment aligné, ou `null` pendant le chargement.
	 */
	static getVerseSlice(
		riwayah: NonHafsRiwayah,
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number,
		showVerseNumbers: boolean
	): RiwayahRenderSlice | null {
		const data = dataCache.get(riwayah);
		if (!data) {
			void loadRiwayahData(riwayah);
			return null;
		}

		const key = `${surah}:${verse}`;
		const verseData = data.verses[key];
		const mapping = data.mapping.hafs_to_riwayah[String(surah)]?.[String(verse)];
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

export default RiwayahProvider;
