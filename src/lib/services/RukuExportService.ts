export type RukuDefinition = {
	surah: number;
	rukuNumber: number;
	startAyah: number;
	endAyah: number;
};

export type RukuSourceClip = {
	surah: number;
	verse: number;
	startTime: number;
	endTime: number;
};

export type RukuExportTarget = RukuDefinition & {
	startTime: number;
	endTime: number;
};

type VerseTiming = {
	startTime: number;
	endTime: number;
};

const DEFAULT_RANGE_MARGIN_MS = 1000;

// Chaque valeur est le dernier ayah inclusif du ruku correspondant.
const RUKU_END_AYAHS_BY_SURAH: Record<number, readonly number[]> = {
	1: [7],
	2: [
		7, 20, 29, 39, 46, 59, 61, 71, 82, 86, 96, 103, 112, 121, 129, 141, 147, 152, 163, 167, 176,
		182, 188, 196, 210, 216, 221, 228, 231, 235, 242, 248, 253, 257, 260, 266, 273, 281, 283, 286
	],
	3: [9, 20, 30, 41, 54, 63, 71, 80, 91, 101, 109, 120, 129, 143, 148, 155, 171, 180, 189, 200],
	4: [
		10, 14, 22, 25, 33, 42, 50, 59, 70, 76, 87, 91, 96, 100, 104, 112, 115, 126, 134, 141, 152, 162,
		171, 176
	],
	5: [5, 11, 19, 26, 34, 43, 50, 56, 66, 77, 86, 93, 100, 108, 115, 120],
	6: [10, 20, 30, 41, 50, 55, 60, 70, 82, 90, 94, 100, 110, 121, 129, 140, 144, 150, 154, 165],
	7: [
		10, 25, 31, 47, 53, 58, 64, 72, 84, 93, 99, 108, 126, 129, 141, 147, 151, 157, 162, 171, 181,
		188, 206
	],
	8: [10, 19, 28, 37, 44, 48, 58, 64, 69, 75],
	9: [6, 16, 24, 29, 37, 42, 49, 59, 66, 72, 80, 89, 99, 110, 118, 122, 129],
	10: [10, 20, 30, 40, 53, 60, 70, 82, 92, 103, 109],
	11: [8, 24, 35, 49, 60, 68, 83, 95, 109, 123],
	12: [6, 20, 29, 35, 42, 49, 57, 68, 79, 93, 104, 111],
	13: [7, 18, 31, 37, 39, 43],
	14: [6, 12, 21, 27, 34, 41, 52],
	15: [15, 25, 44, 60, 79, 99],
	16: [9, 21, 25, 34, 40, 50, 60, 65, 70, 76, 83, 89, 100, 110, 119, 128],
	17: [10, 22, 30, 40, 52, 60, 70, 77, 84, 93, 100, 111],
	18: [12, 17, 22, 31, 44, 49, 53, 59, 70, 82, 101, 110],
	19: [15, 40, 50, 65, 82, 98],
	20: [24, 54, 76, 89, 104, 115, 128, 135],
	21: [10, 29, 41, 50, 75, 93, 112],
	22: [10, 13, 22, 33, 38, 48, 57, 64, 72, 78],
	23: [22, 32, 50, 77, 92, 118],
	24: [10, 20, 26, 34, 40, 50, 57, 61, 64],
	25: [9, 20, 34, 44, 57, 77],
	26: [9, 33, 51, 68, 104, 122, 140, 159, 175, 191, 227],
	27: [14, 31, 44, 58, 66, 75, 93],
	28: [13, 21, 28, 42, 50, 60, 75, 82, 88],
	29: [13, 22, 30, 44, 63, 69],
	30: [10, 19, 28, 40, 53, 60],
	31: [11, 19, 30, 34],
	32: [11, 21, 30],
	33: [8, 20, 27, 34, 40, 52, 58, 68, 73],
	34: [9, 21, 30, 36, 45, 54],
	35: [6, 14, 26, 37, 45],
	36: [12, 32, 50, 70, 83],
	37: [21, 74, 113, 138, 182],
	38: [14, 26, 40, 64, 70, 88],
	39: [9, 21, 31, 41, 52, 63, 70, 75],
	40: [9, 20, 37, 50, 60, 68, 78, 85],
	41: [8, 18, 25, 32, 44, 54],
	42: [9, 19, 29, 43, 53],
	43: [9, 25, 35, 45, 56, 67, 89],
	44: [18, 29, 59],
	45: [11, 21, 26, 37],
	46: [10, 20, 26, 35],
	47: [11, 19, 29, 38],
	48: [10, 17, 26, 29],
	49: [10, 18],
	50: [15, 29, 45],
	51: [23, 46, 60],
	52: [28, 49],
	53: [32, 62],
	54: [22, 40, 55],
	55: [25, 45, 60, 78],
	56: [38, 74, 96],
	57: [10, 19, 25, 29],
	58: [6, 13, 22],
	59: [10, 17, 24],
	60: [6, 13],
	61: [9, 14],
	62: [8, 11],
	63: [8, 11],
	64: [10, 18],
	65: [7, 12],
	66: [7, 12],
	67: [14, 30],
	68: [33, 52],
	69: [37, 52],
	70: [35, 44],
	71: [20, 28],
	72: [19, 28],
	73: [19, 20],
	74: [31, 56],
	75: [30, 40],
	76: [22, 31],
	77: [40, 50],
	78: [30, 40],
	79: [26, 46],
	80: [42],
	81: [29],
	82: [19],
	83: [36],
	84: [25],
	85: [22],
	86: [17],
	87: [19],
	88: [26],
	89: [30],
	90: [20],
	91: [15],
	92: [21],
	93: [11],
	94: [8],
	95: [8],
	96: [19],
	97: [5],
	98: [8],
	99: [8],
	100: [11],
	101: [11],
	102: [8],
	103: [3],
	104: [9],
	105: [5],
	106: [4],
	107: [7],
	108: [3],
	109: [6],
	110: [3],
	111: [5],
	112: [4],
	113: [5],
	114: [6]
};

/**
 * Retourne la cle stable d'un verset.
 * @param {number} surah Numero de sourate.
 * @param {number} verse Numero de verset.
 * @returns {string} Cle au format `surah:verse`.
 */
function getVerseKey(surah: number, verse: number): string {
	return `${surah}:${verse}`;
}

/**
 * Convertit les fins de rukus d'une sourate en plages completes.
 * @param {number} surah Numero de sourate.
 * @returns {RukuDefinition[]} Plages de rukus connues pour la sourate.
 */
export function getRukuDefinitionsForSurah(surah: number): RukuDefinition[] {
	const endAyahs = RUKU_END_AYAHS_BY_SURAH[surah] ?? [];
	let startAyah = 1;

	return endAyahs.map((endAyah, index) => {
		const ruku = {
			surah,
			rukuNumber: index + 1,
			startAyah,
			endAyah
		};
		startAyah = endAyah + 1;
		return ruku;
	});
}

/**
 * Regroupe les clips par verset pour ne jamais assimiler un clip a un verset.
 * @param {RukuSourceClip[]} clips Clips de sous-titres Quran.
 * @returns {Map<string, VerseTiming>} Timings min/max par verset.
 */
function getVerseTimingsByVerse(clips: RukuSourceClip[]): Map<string, VerseTiming> {
	const timingsByVerse = new Map<string, VerseTiming>();

	for (const clip of clips) {
		const key = getVerseKey(clip.surah, clip.verse);
		const timing = timingsByVerse.get(key);
		if (!timing) {
			timingsByVerse.set(key, {
				startTime: clip.startTime,
				endTime: clip.endTime
			});
			continue;
		}

		timing.startTime = Math.min(timing.startTime, clip.startTime);
		timing.endTime = Math.max(timing.endTime, clip.endTime);
	}

	return timingsByVerse;
}

/**
 * Verifie que chaque verset d'un ruku a au moins un clip de sous-titre.
 * @param {Map<string, VerseTiming>} timingsByVerse Timings disponibles par verset.
 * @param {RukuDefinition} ruku Ruku a verifier.
 * @returns {boolean} `true` si toute la plage du ruku est captionnee.
 */
function hasCompleteRukuVerseCoverage(
	timingsByVerse: Map<string, VerseTiming>,
	ruku: RukuDefinition
): boolean {
	for (let verse = ruku.startAyah; verse <= ruku.endAyah; verse++) {
		if (!timingsByVerse.has(getVerseKey(ruku.surah, verse))) return false;
	}

	return true;
}

/**
 * Construit les segments video exportables par ruku depuis des clips sous-titres.
 * @param {RukuSourceClip[]} clips Clips de sous-titres Quran.
 * @param {number} rangeStart Debut de la plage d'export globale en millisecondes.
 * @param {number} rangeEnd Fin de la plage d'export globale en millisecondes.
 * @param {number} marginMs Marge acceptee autour de la plage d'export.
 * @returns {RukuExportTarget[]} Segments complets de ruku contenus dans la plage.
 */
export function getRukuExportTargets(
	clips: RukuSourceClip[],
	rangeStart: number,
	rangeEnd: number,
	marginMs: number = DEFAULT_RANGE_MARGIN_MS
): RukuExportTarget[] {
	const timingsByVerse = getVerseTimingsByVerse(clips);
	const surahs = Array.from(new Set(clips.map((clip) => clip.surah))).sort((a, b) => a - b);
	const targets: RukuExportTarget[] = [];

	for (const surah of surahs) {
		for (const ruku of getRukuDefinitionsForSurah(surah)) {
			if (!hasCompleteRukuVerseCoverage(timingsByVerse, ruku)) continue;

			const startTiming = timingsByVerse.get(getVerseKey(surah, ruku.startAyah));
			const endTiming = timingsByVerse.get(getVerseKey(surah, ruku.endAyah));
			if (!startTiming || !endTiming) continue;

			const startTime = startTiming.startTime;
			const endTime = endTiming.endTime;
			if (startTime < rangeStart - marginMs || endTime > rangeEnd + marginMs) continue;

			targets.push({
				...ruku,
				startTime,
				endTime
			});
		}
	}

	return targets.sort((a, b) => a.startTime - b.startTime);
}
