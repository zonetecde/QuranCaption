import type { TranscriptWordTiming } from '$lib/types/transcription';

/**
 * Normalise des timestamps mot par mot pour couvrir toute la durée du segment sans trou.
 * Le premier mot commence à 0, chaque mot reste affiché jusqu'au début réel du suivant,
 * et le dernier mot se termine exactement à la fin du segment.
 * @param {TranscriptWordTiming[]} words Timings relatifs reçus du moteur.
 * @param {number} clipDurationSeconds Durée du clip en secondes.
 * @returns {TranscriptWordTiming[]} Timings bornés et continus.
 */
export function normalizeTranscriptWordTimings(
	words: TranscriptWordTiming[],
	clipDurationSeconds: number
): TranscriptWordTiming[] {
	const duration = Number.isFinite(clipDurationSeconds) ? Math.max(0, clipDurationSeconds) : 0;
	if (words.length === 0) return [];

	const sanitized = words.map((word) => {
		const rawStart = Number.isFinite(word.start) ? word.start : 0;
		const rawEnd = Number.isFinite(word.end) ? word.end : rawStart;
		const start = Math.max(0, Math.min(duration, rawStart));
		const end = Math.max(start, Math.min(duration, rawEnd));
		return { ...word, start, end };
	});

	let sharedBoundary = 0;
	return sanitized.map((word, index) => {
		const isLastWord = index === sanitized.length - 1;
		const nextWord = sanitized[index + 1];
		const boundaryCandidate = nextWord ? nextWord.start : duration;
		const end = isLastWord
			? duration
			: Math.max(sharedBoundary, Math.min(duration, boundaryCandidate));
		const normalized = { ...word, start: sharedBoundary, end };
		sharedBoundary = end;
		return normalized;
	});
}
