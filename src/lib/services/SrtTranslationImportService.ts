const SRT_TIMING_LINE_REGEX =
	/^(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})(?:\s+.*)?$/;
const SRT_MATCH_TOLERANCE_MS = 2000;

export interface SrtCue {
	index: number;
	startTime: number;
	endTime: number;
	text: string;
}

export interface TimedSubtitleClip {
	id: number;
	startTime: number;
	endTime: number;
}

export interface SrtClipMatch {
	clipId: number;
	text: string;
	cueIndexes: number[];
}

/**
 * Convertit un horodatage SRT en millisecondes.
 * @param {RegExpExecArray} match Groupes capturés par la ligne de minutage.
 * @param {number} offset Décalage du premier groupe de l'horodatage.
 * @returns {number | null} Horodatage en millisecondes, ou `null` s'il est invalide.
 */
function parseSrtTimestamp(match: RegExpExecArray, offset: number): number | null {
	const hours = Number(match[offset]);
	const minutes = Number(match[offset + 1]);
	const seconds = Number(match[offset + 2]);
	const milliseconds = Number(match[offset + 3]);

	if (minutes >= 60 || seconds >= 60 || milliseconds >= 1000) return null;

	return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

/**
 * Nettoie le formatage SRT sans modifier le contenu de la traduction.
 * @param {string} text Texte brut du cue.
 * @returns {string} Texte prêt à être utilisé comme traduction.
 */
function cleanSrtText(text: string): string {
	return text
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/\{\\[^}]*\}/g, '')
		.trim();
}

/**
 * Parse le contenu d'un fichier SubRip contenant une traduction par cue.
 * @param {string} content Contenu UTF-8 du fichier SRT.
 * @returns {SrtCue[]} Cues valides dans leur ordre d'apparition.
 * @throws {Error} Si aucun cue exploitable n'est trouvé.
 */
export function parseSrtTranslation(content: string): SrtCue[] {
	const normalizedContent = content
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n')
		.trim();
	const cues: SrtCue[] = [];

	for (const block of normalizedContent.split(/\n(?:[ \t]*\n)+/)) {
		const lines = block.split('\n');
		const timingLineIndex = lines.findIndex((line) => SRT_TIMING_LINE_REGEX.test(line.trim()));
		if (timingLineIndex < 0) continue;

		const timingMatch = SRT_TIMING_LINE_REGEX.exec(lines[timingLineIndex].trim());
		if (!timingMatch) continue;

		const startTime = parseSrtTimestamp(timingMatch, 1);
		const endTime = parseSrtTimestamp(timingMatch, 5);
		const text = cleanSrtText(lines.slice(timingLineIndex + 1).join('\n'));
		if (startTime === null || endTime === null || endTime < startTime || !text) continue;

		const indexLine = lines.slice(0, timingLineIndex).find((line) => /^\d+$/.test(line.trim()));
		cues.push({
			index: indexLine ? Number(indexLine.trim()) : cues.length + 1,
			startTime,
			endTime,
			text
		});
	}

	if (cues.length === 0) {
		throw new Error('No valid SRT subtitles found.');
	}

	return cues;
}

/**
 * Trouve les cues SRT correspondant aux clips du projet par leurs timecodes.
 * @param {SrtCue[]} cues Cues SRT à associer.
 * @param {TimedSubtitleClip[]} clips Clips de sous-titres du projet.
 * @returns {SrtClipMatch[]} Associations contenant le texte à appliquer.
 */
export function matchSrtCuesToClips(cues: SrtCue[], clips: TimedSubtitleClip[]): SrtClipMatch[] {
	const orderedCues = [...cues].sort((left, right) => left.startTime - right.startTime);
	const orderedClips = [...clips].sort((left, right) => left.startTime - right.startTime);
	const matches: SrtClipMatch[] = [];

	for (const clip of orderedClips) {
		const overlappingCues = orderedCues.filter(
			(cue) => Math.min(clip.endTime, cue.endTime) > Math.max(clip.startTime, cue.startTime)
		);
		const centeredCues = overlappingCues.filter((cue) => {
			const cueCenter = (cue.startTime + cue.endTime) / 2;
			return cueCenter >= clip.startTime && cueCenter <= clip.endTime;
		});

		let selectedCues = centeredCues;
		if (selectedCues.length === 0 && overlappingCues.length > 0) {
			selectedCues = [
				overlappingCues.reduce((best, cue) => {
					const bestOverlap =
						Math.min(clip.endTime, best.endTime) - Math.max(clip.startTime, best.startTime);
					const cueOverlap =
						Math.min(clip.endTime, cue.endTime) - Math.max(clip.startTime, cue.startTime);
					return cueOverlap > bestOverlap ? cue : best;
				})
			];
		}

		if (selectedCues.length === 0) {
			const clipCenter = (clip.startTime + clip.endTime) / 2;
			const nearestCue = orderedCues.reduce<{ cue: SrtCue; distance: number } | null>(
				(best, cue) => {
					const cueCenter = (cue.startTime + cue.endTime) / 2;
					const distance = Math.abs(clipCenter - cueCenter);
					return !best || distance < best.distance ? { cue, distance } : best;
				},
				null
			);

			if (!nearestCue || nearestCue.distance > SRT_MATCH_TOLERANCE_MS) continue;
			selectedCues = [nearestCue.cue];
		}

		matches.push({
			clipId: clip.id,
			text: selectedCues.map((cue) => cue.text).join(' '),
			cueIndexes: selectedCues.map((cue) => cue.index)
		});
	}

	return matches;
}
