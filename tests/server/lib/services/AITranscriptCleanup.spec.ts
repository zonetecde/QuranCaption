import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('$lib/services/TranscriptReferenceService', () => ({
	validateTranscriptQuranReferences: vi.fn(async () => null)
}));

import {
	buildTranscriptCleanupBatches,
	cleanupAITranscript,
	mergeTranscriptAiAnalyses,
	validateTranscriptCleanupBatch
} from '$lib/services/AITranscriptCleanup';
import type { AITranscriptionResult } from '$lib/services/AITranscription';
import type { ProcessedTranscriptToken } from '$lib/services/TranscriptPostProcessor';

/**
 * Construit un mot indexé pour tester le contrat du provider texte.
 * @param {number} id Identifiant stable.
 * @param {string} text Texte du mot.
 * @param {boolean} quran Indique si le mot Quran est verrouillé.
 * @returns {ProcessedTranscriptToken} Token de test.
 */
function token(id: number, text: string, quran = false): ProcessedTranscriptToken {
	return {
		id,
		text,
		start: id,
		end: id + 0.8,
		speaker: 'SPEAKER_00',
		confidence: 0.9,
		punctuationAfter: '',
		preferredBreakAfter: false,
		sourceIds: [id],
		quran: quran
			? {
					surah: 21,
					verse: 107,
					word: id + 1,
					verseWordCount: 5,
					waqf: false
				}
			: null,
		quoteId: null,
		quoteType: null
	};
}

/**
 * Construit un résultat ASR minimal pour tester le service complet.
 * @param {string[]} words Mots transcrits.
 * @returns {AITranscriptionResult} Résultat horodaté.
 */
function transcription(words: string[]): AITranscriptionResult {
	return {
		language: 'ar',
		device: 'cpu',
		model: 'test',
		speakers: ['SPEAKER_00'],
		wordTimestampsAvailable: true,
		segments: [
			{
				start: 0,
				end: words.length,
				text: words.join(' '),
				speaker: 'SPEAKER_00',
				confidence: 0.9,
				words: words.map((word, index) => ({
					word,
					start: index,
					end: index + 0.8,
					confidence: 0.9,
					speaker: 'SPEAKER_00'
				}))
			}
		]
	};
}

afterEach(() => {
	invokeMock.mockReset();
	vi.unstubAllGlobals();
});

describe('AITranscriptCleanup batches', () => {
	it('creates overlapping context windows and marks protected Quran words', () => {
		const tokens = Array.from({ length: 205 }, (_, id) => token(id, `word${id}`, id === 110));
		const batches = buildTranscriptCleanupBatches(tokens);

		expect(batches.map((batch) => batch.tokens.length)).toEqual([160, 85]);
		expect(batches[1].tokens[0].id).toBe(120);
		expect(batches[0].request.w.find((word) => word.i === 110)?.q).toBe(true);
		expect(batches[0].request.w[0].g).toBeCloseTo(0.2);
		expect(batches[1].request.w.at(-1)?.g).toBeNull();
	});

	it('includes the original ASR passage for automatic Quran candidates', () => {
		const sourceTokens = [token(0, 'هو'), token(1, 'في'), token(2, 'الجنة')];
		const quranTokens = [
			token(10, 'هُوَ', true),
			token(11, 'فِي', true),
			token(12, 'الْجَنَّةِ', true)
		];
		for (const entry of quranTokens) entry.sourceIds = [0, 1, 2];
		const batch = buildTranscriptCleanupBatches(quranTokens, 160, sourceTokens)[0];

		expect(batch.request.w[0]).toMatchObject({
			q: true,
			r: '21:107',
			o: 'هو في الجنة',
			u: 'quran-10',
			a: true,
			z: false
		});
		expect(batch.request.w[1].o).toBeNull();
		expect(batch.request.w[1]).toMatchObject({ u: 'quran-10', a: false, z: false });
		expect(batch.request.w[2]).toMatchObject({ u: 'quran-10', a: false, z: true });
	});

	it('uses a larger requested batch size while preserving the context overlap', () => {
		const tokens = Array.from({ length: 500 }, (_, id) => token(id, `word${id}`));
		const batches = buildTranscriptCleanupBatches(tokens, 320);

		expect(batches.map((batch) => batch.tokens.length)).toEqual([320, 220]);
		expect(batches[1].tokens[0].id).toBe(280);
	});
});

describe('AITranscriptCleanup response validation', () => {
	it('accepts conservative corrections, quotations, punctuation and semantic breaks', () => {
		const tokens = [
			token(0, 'قال'),
			token(1, 'أنس'),
			token(2, 'لما'),
			token(3, 'جاء'),
			token(4, 'النبي')
		];
		const batch = buildTranscriptCleanupBatches(tokens)[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [{ s: 2, e: 2, t: 'لَمَّا', f: 'high' }],
			quotes: [{ s: 2, e: 4, k: 'hadith', f: 'high' }],
			b: [4],
			p: [{ i: 4, v: '.' }]
		});

		expect(validation.errors).toEqual([]);
		expect(validation.analysis.corrections).toEqual([
			{ startId: 2, endId: 2, replacement: 'لَمَّا', confidence: 'high' }
		]);
		expect(validation.analysis.quotes).toEqual([
			{ startId: 2, endId: 4, type: 'hadith', confidence: 'high' }
		]);
		expect(validation.analysis.breakAfter).toEqual([4]);
		expect(validation.analysis.punctuationAfter).toEqual([{ id: 4, value: '.' }]);
	});

	it('accepts a high-confidence rejection of an automatic Quran candidate', () => {
		const tokens = [token(0, 'وما', true), token(1, 'أرسلناك', true)];
		for (const entry of tokens) entry.sourceIds = [0, 1];
		const batch = buildTranscriptCleanupBatches(tokens)[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [],
			quotes: [],
			x: [{ s: 0, e: 1, f: 'high' }],
			b: [],
			p: []
		});

		expect(validation.errors).toEqual([]);
		expect(validation.analysis.quranRejections).toEqual([
			{ startId: 0, endId: 1, confidence: 'high' }
		]);
	});

	it('rejects every operation that attempts to rewrite protected Quran words', () => {
		const tokens = [token(0, 'قال'), token(1, 'وما', true), token(2, 'أرسلناك', true)];
		tokens[1].sourceIds = [1, 2];
		tokens[2].sourceIds = [1, 2];
		const batch = buildTranscriptCleanupBatches(tokens)[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [{ s: 1, e: 2, t: 'نص آخر', f: 'high' }],
			quotes: [{ s: 1, e: 2, k: 'generic', f: 'high' }],
			b: [1],
			p: [{ i: 2, v: '.' }]
		});

		expect(validation.analysis.corrections).toEqual([]);
		expect(validation.analysis.quotes).toEqual([]);
		expect(validation.analysis.punctuationAfter).toEqual([]);
		expect(validation.analysis.breakAfter).toEqual([]);
		expect(validation.errors).toContain('AI attempted to rewrite a protected Quran passage.');
	});

	it('rejects malformed ranges and unsupported quote categories', () => {
		const batch = buildTranscriptCleanupBatches([token(0, 'قال'), token(1, 'العالم')])[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [{ s: 5, e: 8, t: 'missing', f: 'high' }],
			quotes: [{ s: 0, e: 1, k: 'book', f: 'high' }],
			b: [99],
			p: [{ i: 0, v: '<script>' }]
		});

		expect(validation.analysis).toEqual({
			corrections: [],
			quotes: [],
			breakAfter: [],
			punctuationAfter: []
		});
		expect(validation.errors).toContain('AI returned an invalid correction operation.');
		expect(validation.errors).toContain('AI returned an invalid quotation range.');
	});

	it('allows a break only after the final word of a protected Quran candidate', () => {
		const tokens = [token(0, 'وما', true), token(1, 'أرسلناك', true)];
		for (const entry of tokens) entry.sourceIds = [0, 1];
		const batch = buildTranscriptCleanupBatches(tokens)[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [],
			quotes: [],
			x: [],
			b: [0, 1],
			p: []
		});

		expect(validation.analysis.breakAfter).toEqual([1]);
	});

	it('rejects partial Quran candidate rejections at a batch boundary', () => {
		const tokens = Array.from({ length: 170 }, (_, id) => token(id, `word${id}`, id >= 150));
		for (const entry of tokens.slice(150)) entry.sourceIds = [150, 169];
		const batch = buildTranscriptCleanupBatches(tokens)[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [],
			quotes: [],
			x: [{ s: 150, e: 159, f: 'high' }],
			b: [],
			p: []
		});

		expect(validation.analysis.quranRejections).toBeUndefined();
		expect(validation.errors).toContain('AI attempted to reject an incomplete Quran candidate.');
	});

	it('drops overlapping corrections and their conflicting annotations', () => {
		const batch = buildTranscriptCleanupBatches([
			token(0, 'une'),
			token(1, 'phrase'),
			token(2, 'test')
		])[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [
				{ s: 0, e: 1, t: 'une phrase', f: 'high' },
				{ s: 1, e: 2, t: 'phrase test', f: 'high' }
			],
			quotes: [],
			x: [],
			b: [1],
			p: [{ i: 1, v: '...' }]
		});

		expect(validation.analysis.corrections).toEqual([]);
		expect(validation.analysis.punctuationAfter).toEqual([]);
		expect(validation.errors).toContain('AI returned overlapping correction ranges.');
	});

	it('ignores breaks and punctuation attached to a corrected word', () => {
		const batch = buildTranscriptCleanupBatches([token(0, 'une'), token(1, 'phrase')])[0];
		const validation = validateTranscriptCleanupBatch(batch, {
			c: [{ s: 0, e: 0, t: 'Une', f: 'high' }],
			quotes: [],
			x: [],
			b: [0, 1],
			p: [
				{ i: 0, v: '.' },
				{ i: 1, v: '.' }
			]
		});

		expect(validation.analysis.breakAfter).toEqual([1]);
		expect(validation.analysis.punctuationAfter).toEqual([{ id: 1, value: '.' }]);
	});
});

describe('AITranscriptCleanup complete service', () => {
	it('pauses between batches and resumes from the saved batch index', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ verses: {} }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			)
		);
		invokeMock.mockResolvedValue({ parsed: {} });
		const source = transcription(Array.from({ length: 300 }, (_, index) => `word${index}`));
		const firstReports: number[] = [];
		const paused = await cleanupAITranscript(source, {
			apiKey: 'test-key',
			endpoint: 'https://example.invalid/chat/completions',
			model: 'deepseek-chat',
			batchWords: 160,
			maxWords: 14,
			maxChars: 90,
			maxGap: 1.2,
			shouldPause: () => true,
			onBatchComplete: (report) => {
				firstReports.push(report.nextBatchIndex);
			}
		});

		expect(paused.paused).toBe(true);
		expect(paused.nextBatchIndex).toBe(1);
		expect(paused.totalBatches).toBe(3);
		expect(firstReports).toEqual([1]);

		const resumed = await cleanupAITranscript(source, {
			apiKey: 'test-key',
			endpoint: 'https://example.invalid/chat/completions',
			model: 'deepseek-chat',
			batchWords: 160,
			maxWords: 14,
			maxChars: 90,
			maxGap: 1.2,
			resume: paused
		});

		expect(resumed.paused).toBe(false);
		expect(resumed.nextBatchIndex).toBe(3);
		expect(invokeMock).toHaveBeenCalledTimes(6);
	});

	it('stops scheduling new batches when a parallel AI request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ verses: {} }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			)
		);
		invokeMock.mockRejectedValue(new Error('provider unavailable'));
		const onBatchComplete = vi.fn();

		await expect(
			cleanupAITranscript(
				transcription(Array.from({ length: 300 }, (_, index) => `word${index}`)),
				{
					apiKey: 'test-key',
					endpoint: 'https://example.invalid/chat/completions',
					model: 'deepseek-chat',
					batchWords: 160,
					maxWords: 14,
					maxChars: 90,
					maxGap: 1.2,
					onBatchComplete
				}
			)
		).rejects.toThrow('AI transcript cleanup batch 1 failed: provider unavailable');
		expect(invokeMock).toHaveBeenCalledTimes(3);
		expect(onBatchComplete).not.toHaveBeenCalled();
	});

	it('starts the next batch as soon as a worker finishes its AI request', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ verses: {} }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			)
		);
		const releaseRequests: Array<() => void> = [];
		let blockProgressiveSave = true;
		let releaseProgressiveSave = (): void => undefined;
		invokeMock.mockImplementation((command: string) =>
			command === 'run_ai_transcript_segmentation_batch_streaming'
				? Promise.resolve({ parsed: { boundaries: [] } })
				: new Promise((resolve) => {
						releaseRequests.push(() => resolve({ parsed: {} }));
					})
		);

		const cleanup = cleanupAITranscript(
			transcription(Array.from({ length: 500 }, (_, index) => `word${index}`)),
			{
				apiKey: 'test-key',
				endpoint: 'https://example.invalid/chat/completions',
				model: 'deepseek-chat',
				batchWords: 160,
				maxWords: 14,
				maxChars: 90,
				maxGap: 1.2,
				onBatchComplete: () => {
					if (!blockProgressiveSave) return;
					blockProgressiveSave = false;
					return new Promise<void>((resolve) => {
						releaseProgressiveSave = resolve;
					});
				}
			}
		);

		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
		releaseRequests[0]();
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4));
		await vi.waitFor(() => expect(blockProgressiveSave).toBe(false));
		releaseProgressiveSave();
		for (const release of releaseRequests.slice(1)) release();
		await cleanup;
	});

	it('sends indexed words to Tauri and applies the returned quotation range', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							verses: {
								'2:153': ['إِنَّ', 'اللَّهَ', 'مَعَ', 'الصَّابِرِينَ']
							}
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } }
					)
			)
		);
		invokeMock.mockResolvedValue({
			parsed: {
				c: [],
				quotes: [{ s: 2, e: 4, k: 'hadith', f: 'high' }],
				b: [4],
				p: [{ i: 4, v: '.' }]
			}
		});

		const report = await cleanupAITranscript(
			transcription(['قال', 'النبي', 'إنما', 'الأعمال', 'بالنيات', 'اليوم']),
			{
				apiKey: 'test-key',
				endpoint: 'https://example.invalid/chat/completions',
				model: 'deepseek-chat',
				reasoningEffort: 'none',
				maxWords: 14,
				maxChars: 90,
				maxGap: 1.2
			}
		);
		const request = invokeMock.mock.calls[0][1].request;
		const finalText = report.result.segments.map((segment) => segment.text).join(' ');

		expect(invokeMock).toHaveBeenCalledTimes(2);
		expect(request.batch.w).toHaveLength(6);
		expect(request.batch.s).toBeUndefined();
		expect(report.quotePassages).toBe(1);
		expect(finalText).toContain('{{إنما الأعمال بالنيات.}}');
		expect(finalText).toContain('قال النبي');
		expect(finalText).toContain('اليوم');
	});

	it('segments the cleaned transcript from the dedicated semantic boundary pass', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ verses: {} }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			)
		);
		invokeMock.mockImplementation((command: string) =>
			Promise.resolve(
				command === 'run_ai_transcript_segmentation_batch_streaming'
					? { parsed: { boundaries: [{ after: 7, kind: 'sentence' }] } }
					: { parsed: { c: [], quotes: [], x: [], p: [{ i: 4, v: '.' }] } }
			)
		);

		const source = transcription(Array.from({ length: 12 }, (_, index) => `word${index + 1}`));
		for (const [index, word] of source.segments[0].words!.entries()) {
			word.start = index * 0.45;
			word.end = index * 0.45 + 0.4;
		}
		source.segments[0].end = 5.35;
		const report = await cleanupAITranscript(source, {
			apiKey: 'test-key',
			endpoint: 'https://example.invalid/chat/completions',
			model: 'deepseek-chat',
			maxWords: 8,
			maxChars: 90,
			maxGap: 1.2
		});

		expect(report.result.segments[0].words).toHaveLength(8);
		expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
			'run_ai_transcript_cleanup_batch_streaming',
			'run_ai_transcript_segmentation_batch_streaming'
		]);
	});

	it('uses the exact AI boundaries for a narrated hadith and does not extend into commentary', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ verses: {} }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			)
		);
		invokeMock.mockResolvedValue({
			parsed: {
				c: [],
				quotes: [{ s: 2, e: 17, k: 'hadith', f: 'high' }],
				b: [11, 17, 26],
				p: []
			}
		});
		const words = [
			'قال',
			'أنس',
			'لما',
			'جاء',
			'النبي',
			'ﷺ',
			'إلى',
			'المدينة',
			'أضاء',
			'منها',
			'كل',
			'شيء.',
			'ولما',
			'مات',
			'أظلم',
			'منها',
			'كل',
			'شيء،',
			'وما',
			'جاء',
			'النبي',
			'ﷺ',
			'إلى',
			'الدنيا',
			'إلا',
			'لينشر',
			'الخير.'
		];

		const report = await cleanupAITranscript(transcription(words), {
			apiKey: 'test-key',
			endpoint: 'https://example.invalid/chat/completions',
			model: 'deepseek-chat',
			reasoningEffort: 'none',
			maxWords: 12,
			maxChars: 80,
			maxGap: 1.2
		});
		const finalText = report.result.segments.map((segment) => segment.text).join(' ');
		const commentaryStart = finalText.indexOf('وما جاء');

		expect(report.quotePassages).toBe(1);
		expect(finalText).toContain('قال أنس {{لما جاء');
		expect(finalText).toContain('شيء،}} وما جاء');
		expect(commentaryStart).toBeGreaterThan(0);
		expect(finalText.slice(commentaryStart)).not.toContain('{{');
	});
});

describe('AITranscriptCleanup overlapping batch merge', () => {
	it('drops contradictory corrections and punctuation instead of guessing', () => {
		const tokens = [token(0, 'قال'), token(1, 'كلمة'), token(2, 'أخرى')];
		const merged = mergeTranscriptAiAnalyses(
			[
				{
					corrections: [{ startId: 1, endId: 1, replacement: 'كَلِمَة', confidence: 'high' }],
					quotes: [],
					breakAfter: [2],
					punctuationAfter: [{ id: 2, value: '.' }]
				},
				{
					corrections: [{ startId: 1, endId: 1, replacement: 'كَلِمَات', confidence: 'high' }],
					quotes: [],
					breakAfter: [2],
					punctuationAfter: [{ id: 2, value: '؟' }]
				}
			],
			tokens
		);

		expect(merged.corrections).toEqual([]);
		expect(merged.punctuationAfter).toEqual([]);
		expect(merged.breakAfter).toEqual([2]);
	});

	it('merges contiguous portions of the same quotation', () => {
		const tokens = [token(0, 'قال'), token(1, 'إنما'), token(2, 'الأعمال'), token(3, 'بالنيات')];
		const merged = mergeTranscriptAiAnalyses(
			[
				{
					corrections: [],
					quotes: [{ startId: 1, endId: 2, type: 'hadith', confidence: 'high' }],
					breakAfter: [],
					punctuationAfter: []
				},
				{
					corrections: [],
					quotes: [{ startId: 2, endId: 3, type: 'hadith', confidence: 'high' }],
					breakAfter: [],
					punctuationAfter: []
				}
			],
			tokens
		);

		expect(merged.quotes).toEqual([{ startId: 1, endId: 3, type: 'hadith', confidence: 'high' }]);
	});

	it('drops overlapping quotation ranges with contradictory types', () => {
		const tokens = [token(0, 'قال'), token(1, 'العلم'), token(2, 'نور')];
		const merged = mergeTranscriptAiAnalyses(
			[
				{
					corrections: [],
					quotes: [{ startId: 1, endId: 2, type: 'hadith', confidence: 'high' }],
					breakAfter: [],
					punctuationAfter: []
				},
				{
					corrections: [],
					quotes: [{ startId: 1, endId: 2, type: 'scholar', confidence: 'high' }],
					breakAfter: [],
					punctuationAfter: []
				}
			],
			tokens
		);

		expect(merged.quotes).toEqual([]);
	});
});
