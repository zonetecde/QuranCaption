import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AITranscriptionResult } from '$lib/services/AITranscription';
import {
	applyTranscriptAnnotations,
	applyTranscriptCorrections,
	buildQuranCorpus,
	buildTimedTranscriptTokens,
	canonicalizeQuranMatches,
	findQuranMatches,
	finalizeTranscriptProcessing,
	prepareTranscriptForAnalysis,
	renderProcessedSubtitleText,
	segmentProcessedTranscript,
	type ProcessedTranscriptToken,
	type TranscriptAiAnalysis
} from '$lib/services/TranscriptPostProcessor';

const corpus = buildQuranCorpus({
	'2:153': ['إِنَّ', 'اللَّهَ', 'مَعَ', 'الصَّابِرِينَ'],
	'9:117': ['لَقَد', 'تابَ', 'اللَّهُ', 'عَلَى', 'النَّبِيِّ', 'وَالمُهاجِرينَ'],
	'19:6': ['يَرِثُني', 'وَيَرِثُ', 'مِن', 'آلِ', 'يَعقوبَ', 'وَاجعَلهُ', 'رَبِّ', 'رَضِيًّا'],
	'19:7': ['يا زَكَرِيّا', 'إِنّا', 'نُبَشِّرُكَ', 'بِغُلامٍ', 'اسمُهُ', 'يَحيىٰ'],
	'19:12': ['يا يَحيىٰ', 'خُذِ', 'الكِتابَ', 'بِقُوَّةٍ'],
	'33:45': [
		'يا أَيُّهَا',
		'النَّبِيُّ',
		'إِنّا',
		'أَرسَلناكَ',
		'شاهِدًا',
		'وَمُبَشِّرًا',
		'وَنَذيرًا'
	],
	'37:104': ['وَنادَيناهُ', 'أَن', 'يا إِبراهيمُ'],
	'37:105': ['قَد', 'صَدَّقتَ', 'الرُّؤيا ۚ', 'إِنّا', 'كَذٰلِكَ', 'نَجزِي', 'المُحسِنينَ'],
	'53:5': ['عَلَّمَهُ', 'شَدِيدُ', 'القُوىٰ'],
	'94:5': ['فَإِنَّ', 'مَعَ', 'العُسرِ', 'يُسرًا'],
	'94:6': ['إِنَّ', 'مَعَ', 'العُسرِ', 'يُسرًا']
});

/**
 * Construit un résultat ASR mot à mot pour les tests du post-traitement.
 * @param {string[]} words Mots reconnus.
 * @param {string} speaker Identifiant de voix.
 * @returns {AITranscriptionResult} Résultat minimal valide.
 */
function buildResult(words: string[], speaker = 'SPEAKER_00'): AITranscriptionResult {
	return {
		language: 'ar',
		device: 'cpu',
		model: 'test',
		speakers: [speaker],
		wordTimestampsAvailable: true,
		segments: [
			{
				start: 0,
				end: words.length,
				text: words.join(' '),
				speaker,
				confidence: 0.9,
				words: words.map((word, index) => ({
					word,
					start: index,
					end: index + 0.8,
					confidence: 0.9,
					speaker
				}))
			}
		]
	};
}

/**
 * Construit un token ordinaire avec un timing stable.
 * @param {number} id Identifiant du token.
 * @param {string} text Texte du token.
 * @returns {ProcessedTranscriptToken} Token prêt pour le segmenter.
 */
function token(id: number, text: string): ProcessedTranscriptToken {
	return {
		id,
		text,
		start: id * 0.45,
		end: id * 0.45 + 0.4,
		speaker: 'SPEAKER_00',
		confidence: 0.9,
		punctuationAfter: '',
		preferredBreakAfter: false,
		sourceIds: [id],
		quran: null,
		quoteId: null,
		quoteType: null
	};
}

describe('TranscriptPostProcessor Quran corpus', () => {
	it('keeps compact word indexes aligned with every rendered Quran verse', () => {
		const minimal = JSON.parse(
			readFileSync(resolve('static/minimal-quran/verses.json'), 'utf8')
		) as { verses: Record<string, string[]> };
		let checkedVerses = 0;
		for (let surah = 1; surah <= 114; surah += 1) {
			const rendered = JSON.parse(
				readFileSync(resolve(`static/quran/${surah}.json`), 'utf8')
			) as Record<string, { w: unknown[] }>;
			for (const [verse, data] of Object.entries(rendered)) {
				expect(minimal.verses[`${surah}:${verse}`]).toHaveLength(data.w.length);
				checkedVerses += 1;
			}
		}
		expect(checkedVerses).toBe(6236);
	});
});

describe('TranscriptPostProcessor Quran matching', () => {
	it('repairs a clear ASR error and emits a complete verse marker', () => {
		const source = buildResult(['ان', 'اللاه', 'مع', 'الصابرين']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);
		const segments = segmentProcessedTranscript(prepared.tokens, {
			maxWords: 14,
			maxChars: 90,
			maxGap: 1.2
		});

		expect(prepared.quranPassages).toBe(1);
		expect(segments).toHaveLength(1);
		expect(segments[0].text).toBe('{{2:153}}');
		expect(segments[0].words.map((word) => word.word)).toEqual([
			'إِنَّ',
			'اللَّهَ',
			'مَعَ',
			'الصَّابِرِينَ'
		]);
	});

	it('emits a 1-based partial verse range', () => {
		const source = buildResult(['اللَّهَ', 'مَعَ', 'الصَّابِرِينَ']);
		const tokens = buildTimedTranscriptTokens(source);
		const matches = findQuranMatches(tokens, corpus);
		const canonical = canonicalizeQuranMatches(tokens, matches, corpus);

		expect(matches).toHaveLength(1);
		expect(renderProcessedSubtitleText(canonical)).toBe('{{2:153:2-4}}');
	});

	it('keeps consecutive verses as separate validated markers', () => {
		const source = buildResult(['فإن', 'مع', 'العسر', 'يسرا', 'إن', 'مع', 'العسر', 'يسرا']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);
		const text = renderProcessedSubtitleText(prepared.tokens);

		expect(text).toBe('{{94:5}} {{94:6}}');
	});

	it('rejects a common three-word phrase taken from the middle of a verse', () => {
		const source = buildResult(['الله', 'على', 'النبي']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);

		expect(prepared.quranPassages).toBe(0);
		expect(renderProcessedSubtitleText(prepared.tokens)).toBe('الله على النبي');
	});

	it('does not include an unrelated leading word in a Quran marker', () => {
		const source = buildResult(['قال', 'يا', 'زكريا', 'إنا', 'نبشرك', 'بغلام']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);

		expect(renderProcessedSubtitleText(prepared.tokens)).toBe('قال {{19:7:1-4}}');
	});

	it('matches a split Quran word despite a minor ASR spelling variant', () => {
		const source = buildResult(['قال', 'يا', 'يحيا', 'خذ', 'الكتاب', 'بقوة']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);

		expect(renderProcessedSubtitleText(prepared.tokens)).toBe('قال {{19:12}}');
	});

	it('recognizes a complete three-word verse with one close ASR variant', () => {
		const source = buildResult(['زكاه', 'في', 'معلمه', 'فقال', 'علمه', 'شديد', 'القوة']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);

		expect(renderProcessedSubtitleText(prepared.tokens)).toBe('زكاه في معلمه فقال {{53:5}}');
	});

	it('does not accept an unrelated ending as a short complete verse', () => {
		const source = buildResult(['علمه', 'شديد', 'الرجل']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);

		expect(prepared.quranPassages).toBe(0);
		expect(renderProcessedSubtitleText(prepared.tokens)).toBe('علمه شديد الرجل');
	});

	it('recognizes an anchored cross-verse phrase despite shifted ASR consonants', () => {
		const source = buildResult(['قال', 'يا', 'إبراهيم', 'قصد', 'دقت', 'الرؤية']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);

		expect(prepared.quranPassages).toBe(2);
		expect(renderProcessedSubtitleText(prepared.tokens)).toBe('قال {{37:104:3-3}} {{37:105:1-3}}');
	});

	it('absorbs a preceding token when the Quran corpus stores two words as one unit', () => {
		const source = buildResult([
			'قال',
			'يا',
			'أيها',
			'النبي',
			'إنا',
			'أرسلناك',
			'شاهدا',
			'ومبشرا',
			'ونذيرا'
		]);
		const prepared = prepareTranscriptForAnalysis(source, corpus);

		expect(renderProcessedSubtitleText(prepared.tokens)).toBe('قال {{33:45}}');
	});
});

describe('TranscriptPostProcessor token preparation', () => {
	it('preserves punctuation from segment text when aligned words omit it', () => {
		const source = buildResult(['قال', 'أنس', 'لما', 'جاء', 'النبي', 'ﷺ', 'شيء']);
		source.segments[0].text = 'قال أنس لما جاء النبي ﷺ شيء.';
		const tokens = buildTimedTranscriptTokens(source);

		expect(tokens.at(-1)?.punctuationAfter).toBe('.');
	});
});

describe('TranscriptPostProcessor controlled AI operations', () => {
	it('does not rewrite Quran tokens even for a high-confidence correction', () => {
		const source = buildResult(['ان', 'اللاه', 'مع', 'الصابرين']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);
		const corrected = applyTranscriptCorrections(prepared.tokens, [
			{
				startId: prepared.tokens[0].sourceIds[0],
				endId: prepared.tokens.at(-1)!.sourceIds.at(-1)!,
				replacement: 'نص مختلف',
				confidence: 'high'
			}
		]);

		expect(corrected.applied).toBe(0);
		expect(renderProcessedSubtitleText(corrected.tokens)).toBe('{{2:153}}');
	});

	it('detects Quran on the second pass after a certain contextual correction', () => {
		const source = buildResult(['قال', 'النص']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);
		const processed = finalizeTranscriptProcessing(
			source,
			prepared.tokens,
			corpus,
			{
				corrections: [
					{
						startId: 1,
						endId: 1,
						replacement: 'إن الله مع الصابرين',
						confidence: 'high'
					}
				],
				quotes: [],
				breakAfter: [],
				punctuationAfter: []
			},
			{ maxWords: 14, maxChars: 90, maxGap: 1.2 }
		);
		const text = processed.result.segments.map((segment) => segment.text).join(' ');

		expect(prepared.quranPassages).toBe(0);
		expect(processed.correctionsApplied).toBe(1);
		expect(processed.quranPassages).toBe(1);
		expect(text).toBe('قال {{2:153}}');
	});

	it('wraps only a certain non-Quran quotation and keeps surrounding speech plain', () => {
		const tokens = ['قال', 'النبي', 'إنما', 'الأعمال', 'بالنيات', 'ثم', 'شرح'].map((word, id) =>
			token(id, word)
		);
		const analysis: TranscriptAiAnalysis = {
			corrections: [],
			quotes: [{ startId: 2, endId: 4, type: 'hadith', confidence: 'high' }],
			breakAfter: [],
			punctuationAfter: [{ id: 4, value: '.' }]
		};
		const annotated = applyTranscriptAnnotations(tokens, analysis);

		expect(renderProcessedSubtitleText(annotated)).toBe(
			'قال النبي {{إنما الأعمال بالنيات.}} ثم شرح'
		);
	});

	it('never infers a reported quotation without an explicit AI range', () => {
		const source = buildResult([
			'قال',
			'أنس',
			'لما',
			'جاء',
			'النبي',
			'ﷺ',
			'إلى',
			'المدينة',
			'أبغى',
			'منها',
			'كل',
			'شيء.'
		]);
		const processed = finalizeTranscriptProcessing(
			source,
			buildTimedTranscriptTokens(source),
			corpus,
			{ corrections: [], quotes: [], breakAfter: [], punctuationAfter: [] },
			{ maxWords: 14, maxChars: 90, maxGap: 1.2 }
		);

		expect(processed.quotePassages).toBe(0);
		expect(processed.result.segments.every((segment) => !segment.text.includes('{{'))).toBe(true);
	});

	it('ignores medium-confidence quotations', () => {
		const tokens = ['قال', 'العالم', 'العلم', 'نور'].map((word, id) => token(id, word));
		const annotated = applyTranscriptAnnotations(tokens, {
			corrections: [],
			quotes: [{ startId: 2, endId: 3, type: 'scholar', confidence: 'medium' }],
			breakAfter: [],
			punctuationAfter: []
		});

		expect(renderProcessedSubtitleText(annotated)).toBe('قال العالم العلم نور');
	});
});

describe('TranscriptPostProcessor smart segmentation', () => {
	it('avoids leaving a two-word orphan after the hard preferred length', () => {
		const tokens = Array.from({ length: 16 }, (_, id) => token(id, `word${id + 1}`));
		tokens[9].punctuationAfter = '.';
		const segments = segmentProcessedTranscript(tokens, {
			maxWords: 14,
			maxChars: 90,
			maxGap: 1.2
		});

		expect(segments.length).toBeGreaterThan(1);
		expect(segments.every((segment) => segment.words.length > 2)).toBe(true);
		expect(segments[0].words).toHaveLength(10);
	});

	it('keeps a short complete verse together even when it exceeds the soft word limit', () => {
		const source = buildResult(['ان', 'اللاه', 'مع', 'الصابرين']);
		const prepared = prepareTranscriptForAnalysis(source, corpus);
		const segments = segmentProcessedTranscript(prepared.tokens, {
			maxWords: 3,
			maxChars: 30,
			maxGap: 1.2
		});

		expect(segments).toHaveLength(1);
		expect(segments[0].text).toBe('{{2:153}}');
	});
});
