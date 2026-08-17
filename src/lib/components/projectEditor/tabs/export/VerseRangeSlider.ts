export type TimedVerseRangeEntry = {
	verseKey: string;
	startTime: number;
	endTime: number;
};

export type VerseRangeSliderOption = {
	key: string;
	surah: number;
	startTime: number;
	endTime: number;
};

/**
 * Regroupe les entrées temporelles consécutives appartenant au même verset.
 *
 * @param {TimedVerseRangeEntry[]} entries Entrées à convertir dans l'ordre de la timeline.
 * @returns {VerseRangeSliderOption[]} Versets utilisables par le slider.
 */
export function buildVerseRangeSliderOptions(
	entries: TimedVerseRangeEntry[]
): VerseRangeSliderOption[] {
	const options: VerseRangeSliderOption[] = [];

	for (const entry of [...entries].sort((first, second) => first.startTime - second.startTime)) {
		const previous = options.at(-1);
		if (previous?.key === entry.verseKey) {
			previous.startTime = Math.min(previous.startTime, entry.startTime);
			previous.endTime = Math.max(previous.endTime, entry.endTime);
			continue;
		}

		options.push({
			key: entry.verseKey,
			surah: Number(entry.verseKey.split(':')[0]) || 0,
			startTime: entry.startTime,
			endTime: entry.endTime
		});
	}

	return options;
}

/**
 * Retrouve les bornes de versets correspondant à une plage temporelle.
 *
 * @param {VerseRangeSliderOption[]} verses Versets disponibles.
 * @param {number} startTimeMs Début temporel courant.
 * @param {number} endTimeMs Fin temporelle courante.
 * @returns {{start: number; end: number}} Index de début et de fin bornés.
 */
export function getVerseRangeSliderIndexes(
	verses: VerseRangeSliderOption[],
	startTimeMs: number,
	endTimeMs: number
): { start: number; end: number } {
	if (verses.length === 0) return { start: 0, end: 0 };

	const exactStart = verses.findIndex((verse) => verse.startTime === startTimeMs);
	const overlappingStart = verses.findIndex((verse) => verse.endTime >= startTimeMs);
	const start =
		exactStart >= 0 ? exactStart : overlappingStart >= 0 ? overlappingStart : verses.length - 1;
	const exactEnd = verses.findLastIndex((verse) => verse.endTime === endTimeMs);
	const overlappingEnd = verses.findLastIndex((verse) => verse.startTime <= endTimeMs);
	const matchingEnd = exactEnd >= 0 ? exactEnd : overlappingEnd;

	return { start, end: Math.max(start, matchingEnd) };
}
