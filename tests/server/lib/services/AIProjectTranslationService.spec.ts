import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	Category,
	Edition,
	Project,
	ProjectContent,
	ProjectDetail,
	Style,
	StylesData,
	SubtitleClip,
	Timeline,
	TrackType,
	VideoStyle
} from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import {
	applyAIProjectTranslationResults,
	buildAIProjectTranslationBatches,
	estimateAIProjectTranslationBatchCount,
	resolveAIProjectTranslationSuccessContext,
	validateAIProjectTranslationBatch,
	type AIProjectTranslationBatch,
	type AIProjectTranslationCandidate
} from '$lib/services/AIProjectTranslationService';
import { getStructuredTranslationDraft } from '$lib/services/StructuredTranslationService';

/**
 * Construit un batch de test avec un passage Quran partiel et une citation.
 * @returns {AIProjectTranslationBatch} Batch structuré minimal.
 */
function createBatch(): AIProjectTranslationBatch {
	const subtitle = new SubtitleClip(0, 1000, 'قال {{2:255:1-2}} ثم {{إنما الأعمال بالنيات}}');
	const translation = new VerseTranslation('{{2:255:1-2}}{{}}', 'to translate');
	translation.isStructuredTranslation = true;
	subtitle.translations.test = translation;
	const draft = getStructuredTranslationDraft(subtitle.text, translation.text);
	const quranAnchor = draft.anchors[0];
	const citationAnchor = draft.anchors[1];
	const candidate: AIProjectTranslationCandidate = {
		subtitle,
		translation,
		payload: {
			i: subtitle.id,
			f: draft.sourceFreeTexts,
			a: [
				{
					i: quranAnchor.id,
					k: 'q',
					s: quranAnchor.sourceValue,
					r: '2:255',
					f: false,
					l: false,
					a: 'اللَّهُ لَا',
					u: ['God', 'there', 'is', 'no', 'deity'],
					w: ['Allah', 'not']
				},
				{
					i: citationAnchor.id,
					k: 'c',
					s: citationAnchor.sourceValue
				}
			]
		},
		citationIds: [citationAnchor.id],
		quranExpectations: [
			{
				anchor: quranAnchor,
				unitCount: 5,
				locked: false,
				fullVerse: false,
				resetToFullVerse: false
			}
		],
		wordCount: 8
	};

	return {
		batchId: 'test-batch',
		candidates: [candidate],
		request: { b: [], i: [candidate.payload], a: [] },
		wordCount: 8
	};
}

/**
 * Crée un projet minimal capable de sauvegarder une opération d'historique.
 * @returns {Project} Projet de test.
 */
function createProject(): Project {
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [new Style({ id: 'font-size', value: 90, valueType: 'number' })]
			})
		])
	];
	return new Project(
		new ProjectDetail('AI translation test', 'speaker'),
		new ProjectContent(new Timeline([new SubtitleTrack()]), [], undefined, videoStyle)
	);
}

describe('AIProjectTranslationService', () => {
	afterEach(() => {
		globalState.currentProject = null;
		vi.unstubAllGlobals();
	});

	test('builds contextual batches with Quran edition units and English WBW helpers', async () => {
		const project = createProject();
		const quranEdition = new Edition(
			'quran-en',
			'quran-en',
			'Test edition',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		const edition = new Edition(
			'language-english',
			'language-english',
			'English',
			'English',
			'ltr',
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);
		project.content.projectTranslation.addedTranslationEditions = [edition];
		project.content.projectTranslation.versesTranslations[edition.name] = {
			'2:255': 'God there is no deity except Him'
		};
		const before = new SubtitleClip(0, 1000, 'مقدمة');
		const target = new SubtitleClip(1000, 2000, 'قال {{2:255:1-2}} ثم {{حديث}}');
		const after = new SubtitleClip(2000, 3000, 'خاتمة');
		before.translations[edition.name] = new VerseTranslation('Introduction', 'reviewed');
		target.translations[edition.name] = new VerseTranslation('{{2:255:1-2}}{{}}', 'to translate');
		after.translations[edition.name] = new VerseTranslation('Conclusion', 'reviewed');
		for (const translation of Object.values(target.translations)) {
			(translation as VerseTranslation).isStructuredTranslation = true;
		}
		project.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(before, target, after);
		globalState.currentProject = project;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				return {
					ok: true,
					json: async () =>
						url.includes('minimal-quran')
							? { verses: { '2:255': ['اللَّهُ', 'لَا'] } }
							: { '2': { '255': [['Allah', 'not']] } }
				} as Response;
			})
		);

		const batches = await buildAIProjectTranslationBatches(edition, {
			retryErrors: true,
			overwriteAiTranslated: false,
			overwriteReviewed: false,
			overwriteManualQuran: false
		});

		expect(batches).toHaveLength(1);
		expect(batches[0].request.b.map((item) => item.i)).toEqual([before.id]);
		expect(batches[0].request.a.map((item) => item.i)).toEqual([after.id]);
		expect(batches[0].request.i[0].f).toEqual(['قال ', ' ثم ', '']);
		expect(batches[0].request.i[0].a).toEqual([
			expect.objectContaining({
				i: 'quran-0',
				k: 'q',
				a: 'اللَّهُ لَا',
				u: ['God', 'there', 'is', 'no', 'deity', 'except', 'Him'],
				w: ['Allah', 'not']
			}),
			expect.objectContaining({ i: 'citation-1', k: 'c', s: 'حديث' })
		]);
		expect(
			estimateAIProjectTranslationBatchCount(
				edition,
				{
					retryErrors: true,
					overwriteAiTranslated: false,
					overwriteReviewed: false,
					overwriteManualQuran: false
				},
				160
			)
		).toBe(1);
	});
	test('accepts structured free text, citation translations and Quran ranges', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', ' then he recalled ', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});

		expect(report.errors).toEqual([]);
		expect(report.validItems).toHaveLength(1);
		expect(report.validItems[0].quranRanges['quran-0']).toEqual({
			startUnitIndex: 1,
			endUnitIndex: 3
		});
		expect(report.validItems[0].citations['citation-1']).toBe('Actions are judged by intentions.');
	});

	test('rejects missing anchors and generated marker braces', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['{{unsafe}}', '', ''],
					c: [],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});

		expect(report.validItems).toEqual([]);
		expect(report.errors).toContain(`Subtitle ${subtitleId}: invalid free text slots.`);
	});

	test('accepts omitted empty anchor arrays when the source has no editable anchors', () => {
		const batch = createBatch();
		const candidate = batch.candidates[0];
		candidate.payload.a = [];
		candidate.citationIds = [];
		candidate.quranExpectations = [];
		const subtitleId = candidate.subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [{ i: subtitleId, f: ['Plain translation'] }]
		});

		expect(report.errors).toEqual([]);
		expect(report.validItems).toHaveLength(1);
	});

	test('rejects Quran ranges outside the associated edition translation', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', '', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 2, e: 12 }]
				}
			]
		});

		expect(report.validItems).toEqual([]);
		expect(report.errors).toContain(
			`Subtitle ${subtitleId}: Quran ranges do not match the editable partial passages.`
		);
	});

	test('applies validated values without changing Quran markers', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;
		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', ' then he recalled ', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});
		const project = createProject();
		const quranEdition = new Edition(
			'quran-en',
			'quran-en',
			'Test edition',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		const edition = new Edition(
			'language-english',
			'language-english',
			'English',
			'English',
			'ltr',
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);
		globalState.currentProject = project;
		project.content.projectTranslation.addedTranslationEditions = [edition];
		batch.candidates[0].subtitle.translations[edition.name] = batch.candidates[0].translation;
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)!
			.clips.push(batch.candidates[0].subtitle);

		project.content.projectTranslation.versesTranslations[edition.name] = {
			'2:255': 'God there is no deity except Him'
		};
		expect(resolveAIProjectTranslationSuccessContext(edition, report.validItems[0])).toBe(
			'there is no then he recalled Actions are judged by intentions.'
		);

		const applied = applyAIProjectTranslationResults(edition, report.validItems);
		const translation = batch.candidates[0].translation;

		expect(applied.appliedSubtitles).toBe(1);
		expect(translation.text).toBe(
			'{{2:255:1-2}} then he recalled {{Actions are judged by intentions.}}'
		);
		expect(translation.quranSegments['quran-0']).toMatchObject({
			reference: '2:255:1-2',
			startUnitIndex: 1,
			endUnitIndex: 3,
			isBruteForce: false
		});
		expect(translation.status).toBe('ai translated');
		expect(translation.isStatusComplete()).toBe(false);
	});

	test('resets manual full-verse translations while preserving AI trims for partial verses', () => {
		const batch = createBatch();
		const partialId = batch.candidates[0].subtitle.id;
		const partialReport = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: partialId,
					f: ['', ' then ', ''],
					c: [{ i: 'citation-1', t: 'the narration' }],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});
		const project = createProject();
		const quranEdition = new Edition(
			'quran-en',
			'quran-en',
			'Test edition',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		const edition = new Edition(
			'language-english',
			'language-english',
			'English',
			'English',
			'ltr',
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);
		project.content.projectTranslation.addedTranslationEditions = [edition];
		project.content.projectTranslation.versesTranslations[edition.name] = {
			'2:255': 'God there is no deity except Him'
		};
		batch.candidates[0].subtitle.translations[edition.name] = batch.candidates[0].translation;

		const fullOnly = new SubtitleClip(1000, 2000, '{{2:255}}');
		const fullOnlyTranslation = new VerseTranslation('{{2:255}}', 'reviewed');
		fullOnlyTranslation.isStructuredTranslation = true;
		fullOnlyTranslation.quranSegments['quran-0'] = {
			reference: '2:255',
			startUnitIndex: 2,
			endUnitIndex: 3,
			isBruteForce: true,
			manualText: 'Custom verse'
		};
		fullOnly.translations[edition.name] = fullOnlyTranslation;
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)!
			.clips.push(batch.candidates[0].subtitle, fullOnly);
		globalState.currentProject = project;

		applyAIProjectTranslationResults(edition, partialReport.validItems, {
			retryErrors: true,
			overwriteAiTranslated: true,
			overwriteReviewed: true,
			overwriteManualQuran: true
		});

		expect(fullOnlyTranslation.quranSegments).toEqual({});
		expect(fullOnlyTranslation.status).toBe('completed by default');
		expect(
			project.content.projectTranslation.resolveStructuredTranslationText(
				edition,
				fullOnly,
				fullOnlyTranslation
			)
		).toBe('God there is no deity except Him');
		expect(batch.candidates[0].translation.quranSegments['quran-0']).toMatchObject({
			startUnitIndex: 1,
			endUnitIndex: 3,
			isBruteForce: false
		});
	});

	test('does not accept a Quran range for a locked passage', () => {
		const batch = createBatch();
		batch.candidates[0].quranExpectations[0].locked = true;
		batch.candidates[0].payload.a[0].l = true;
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', '', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 0, e: 1 }]
				}
			]
		});

		expect(report.validItems).toEqual([]);
		expect(report.errors).toContain(
			`Subtitle ${subtitleId}: Quran ranges do not match the editable partial passages.`
		);
	});
});
