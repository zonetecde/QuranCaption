import type { AITranscriptionResult, AITranscriptionSegment } from '$lib/types/transcription';
import {
	buildTimedTranscriptTokens,
	normalizeArabicForMatching,
	wordSimilarity
} from './TranscriptPostProcessor';

/**
 * Retrouve les mots du texte fourni dans l'ordre entendu, avec retours et reprises possibles.
 * @param {AITranscriptionResult} source Reconnaissance utilisée comme repère temporel.
 * @param {string} referenceText Texte de référence, un vers par ligne si possible.
 * @param {boolean} [preserveLines] Conserve un vers entier malgré sa durée ou ses pauses internes.
 * @returns {{ segments: AITranscriptionSegment[]; matched: boolean[]; unmatchedWords: number }} Passages à réaligner et mots non reconnus dans la référence.
 */
export function matchReferenceTranscript(
	source: AITranscriptionResult,
	referenceText: string,
	preserveLines = false
): { segments: AITranscriptionSegment[]; matched: boolean[]; unmatchedWords: number } {
	const reference = referenceText
		.split(/\r?\n/u)
		.flatMap((line, lineIndex) =>
			line
				.trim()
				.split(/\s+/u)
				.filter(Boolean)
				.map((text) => ({
					text,
					line: lineIndex,
					normalized: normalizeArabicForMatching(text)
				}))
		)
		.filter((word) => word.normalized);
	const tokens = buildTimedTranscriptTokens(source);
	const width = reference.length + 1;
	// La matrice est bornée pour éviter de bloquer l'interface sur un texte démesuré.
	if (!reference.length || tokens.length * width > 8_000_000) {
		throw new Error(!reference.length ? 'REFERENCE_TEXT_REQUIRED' : 'REFERENCE_TEXT_TOO_LONG');
	}
	const trace = new Int32Array(tokens.length * width);
	let previous = new Float64Array(width).fill(-Infinity);
	previous[0] = 0;
	for (let input = 0; input < tokens.length; input += 1) {
		const normalized = normalizeArabicForMatching(tokens[input].text);
		let bestPrevious = 0;
		for (let position = 1; position < width; position += 1) {
			if (previous[position] > previous[bestPrevious]) bestPrevious = position;
		}
		const current = new Float64Array(width);
		for (let position = 0; position < width; position += 1) {
			let score = previous[position] - 1.5;
			let origin = position;
			let matched = false;
			if (position > 0) {
				const similarity = wordSimilarity(normalized, reference[position - 1].normalized);
				const reward = similarity >= 0.65 ? 3 * similarity : -2;
				for (let skipped = 0; skipped <= 2 && position - skipped - 1 >= 0; skipped += 1) {
					const candidate = previous[position - skipped - 1] + reward - skipped * 1.5;
					if (candidate > score) {
						score = candidate;
						origin = position - skipped - 1;
						matched = true;
					}
				}
				// Un retour dans le texte coûte moins que l'abandon d'une répétition entière.
				const restarted = previous[bestPrevious] + reward - 3;
				if (similarity >= 0.72 && restarted > score) {
					score = restarted;
					origin = bestPrevious;
					matched = true;
				}
			}
			current[position] = score;
			trace[input * width + position] = origin * 2 + Number(matched);
		}
		previous = current;
	}
	let position = 0;
	for (let index = 1; index < width; index += 1) {
		if (previous[index] > previous[position]) position = index;
	}
	const mapping = new Int32Array(tokens.length).fill(-1);
	for (let input = tokens.length - 1; input >= 0; input -= 1) {
		const step = trace[input * width + position];
		if (step % 2) mapping[input] = position - 1;
		position = Math.floor(step / 2);
	}

	const segments: AITranscriptionSegment[] = [];
	const matched: boolean[] = [];
	let unmatchedWords = 0;
	for (let start = 0; start < tokens.length; ) {
		let end = start;
		if (mapping[start] >= 0) {
			while (
				end + 1 < tokens.length &&
				mapping[end + 1] > mapping[end] &&
				mapping[end + 1] - mapping[end] <= 3 &&
				reference[mapping[end + 1]].line === reference[mapping[start]].line &&
				tokens[end + 1].speaker === tokens[start].speaker &&
				(preserveLines || (tokens[end + 1].start - tokens[end].end < 1.2 && end - start < 39))
			) {
				end += 1;
			}
		}
		const similarities = tokens
			.slice(start, end + 1)
			.map((token, offset) =>
				mapping[start + offset] < 0
					? 0
					: wordSimilarity(
							normalizeArabicForMatching(token.text),
							reference[mapping[start + offset]].normalized
						)
			);
		const anchors = similarities.filter((score) => score >= 0.72).length;
		const reliable =
			anchors > 0 &&
			similarities[0] >= 0.72 &&
			similarities.at(-1)! >= 0.72 &&
			similarities.reduce((sum, score) => sum + score, 0) / similarities.length >= 0.65;
		if (!reliable) {
			// Un mot erroné ou hors texte reste visible, sans inventer sa correction.
			end = start;
			while (
				end + 1 < tokens.length &&
				mapping[end + 1] < 0 &&
				tokens[end + 1].speaker === tokens[start].speaker &&
				tokens[end + 1].start - tokens[end].end < 1.2 &&
				end - start < 39
			) {
				end += 1;
			}
			unmatchedWords += end - start + 1;
		}
		const passage = tokens.slice(start, end + 1);
		const words = passage.map((token) => ({
			word: `${token.text}${token.punctuationAfter}`,
			start: token.start,
			end: token.end,
			speaker: token.speaker,
			confidence: token.confidence
		}));
		segments.push({
			start: passage[0].start,
			end: passage.at(-1)!.end,
			speaker: passage[0].speaker,
			text: reliable
				? reference
						.slice(mapping[start], mapping[end] + 1)
						.map((word) => word.text)
						.join(' ')
				: words.map((word) => word.word).join(' '),
			words
		});
		matched.push(reliable);
		start = end + 1;
	}
	return { segments, matched, unmatchedWords };
}
