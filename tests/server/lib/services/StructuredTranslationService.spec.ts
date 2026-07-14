import { describe, expect, test } from 'vitest';

import { Edition } from '$lib/classes/Edition';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import {
	createStructuredTranslationSkeleton,
	getStructuredTranslationDraft,
	getUniqueQuranReferences,
	isCompleteQuranOnlySubtitle,
	serializeStructuredTranslation
} from '$lib/services/StructuredTranslationService';

describe('StructuredTranslationService', () => {
	test('creates protected Quran and citation anchors with free slots around them', () => {
		const source = 'قال {{2:255:1-3}} ثم روى {{إنما الأعمال بالنيات}}';
		const skeleton = createStructuredTranslationSkeleton(source);
		const draft = getStructuredTranslationDraft(source, skeleton);

		expect(skeleton).toBe('{{2:255:1-3}}{{}}');
		expect(draft.freeTexts).toEqual(['', '', '']);
		expect(draft.sourceFreeTexts).toEqual(['قال ', ' ثم روى ', '']);
		expect(draft.anchors.map((anchor) => anchor.type)).toEqual(['quran', 'citation']);
		expect(draft.anchors[0].sourceValue).toBe('2:255:1-3');
	});

	test('allows attribution text to move after a protected quotation', () => {
		const source = 'قال {{إنما الأعمال بالنيات}}';
		const draft = getStructuredTranslationDraft(
			source,
			createStructuredTranslationSkeleton(source)
		);
		draft.anchors[0].value = 'Actions are judged by intentions.';
		draft.freeTexts[1] = ' he said.';

		expect(serializeStructuredTranslation(draft)).toBe(
			'{{Actions are judged by intentions.}} he said.'
		);
	});

	test('keeps Quran references unchanged while sanitizing accidental nested markers', () => {
		const source = '{{1:1}} text {{citation}}';
		const draft = getStructuredTranslationDraft(source, '{{1:1}}{{translated}}');
		draft.freeTexts[1] = ' {{unsafe}} ';
		draft.anchors[1].value = '{{nested}}';

		expect(serializeStructuredTranslation(draft)).toBe('{{1:1}} {unsafe} {{nested}}');
	});

	test('recognizes only an untrimmed Quran verse as completed by default', () => {
		expect(isCompleteQuranOnlySubtitle('{{2:255}}')).toBe(true);
		expect(isCompleteQuranOnlySubtitle('{{2:255:1-4}}')).toBe(false);
		expect(isCompleteQuranOnlySubtitle('قال {{2:255}}')).toBe(false);
	});

	test('deduplicates Quran references by verse', () => {
		expect(
			getUniqueQuranReferences(['{{2:255:1-2}}', 'text {{2:255:3-4}} {{3:18}}']).map(
				(reference) => `${reference.surah}:${reference.verse}`
			)
		).toEqual(['2:255', '3:18']);
	});

	test('creates default statuses from the source structure', () => {
		const projectTranslation = new ProjectTranslation();

		expect(projectTranslation.createTranslationForText('{{2:255}}').status).toBe(
			'completed by default'
		);
		expect(projectTranslation.createTranslationForText('{{2:255:1-3}}').status).toBe(
			'to translate'
		);
		expect(projectTranslation.createTranslationForText('قال {{2:255}}').status).toBe(
			'to translate'
		);
	});

	test('migrates a legacy Quran edition into a project language without changing its key', () => {
		const projectTranslation = new ProjectTranslation();
		const legacyEdition = new Edition(
			'fr-test',
			'fr-test',
			'Legacy author',
			'French',
			'ltr',
			'legacy-api',
			'Legacy comments',
			'https://example.test',
			''
		);
		projectTranslation.addedTranslationEditions = [legacyEdition];

		projectTranslation.normalizeProjectLanguages();

		expect(legacyEdition.name).toBe('fr-test');
		expect(legacyEdition.author).toBe('French');
		expect(legacyEdition.source).toBe('project-language');
		expect(legacyEdition.quranEdition?.author).toBe('Legacy author');
		expect(legacyEdition.quranEdition?.source).toBe('legacy-api');
	});

	test('reads Quran occurrence defaults without mutating translation state', () => {
		const translation = new VerseTranslation('{{2:255}}', 'to review');

		const settings = translation.getQuranSegment('quran-0', '2:255', 4);

		expect(settings).toEqual({
			reference: '2:255',
			startUnitIndex: 0,
			endUnitIndex: 4,
			isBruteForce: false,
			manualText: ''
		});
		expect(translation.quranSegments).toEqual({});
	});

	test('persists Quran occurrence settings only when explicitly initialized', () => {
		const translation = new VerseTranslation('{{2:255}}', 'to review');

		const settings = translation.getOrCreateQuranSegment('quran-0', '2:255', 4);

		expect(translation.quranSegments['quran-0']).toBe(settings);
		expect(translation.quranSegments['quran-0'].endUnitIndex).toBe(4);
	});

	test('persists Quran occurrence settings through serialization', () => {
		const translation = new VerseTranslation('{{2:255}}', 'to review');
		translation.isStructuredTranslation = true;
		translation.quranSegments['quran-0'] = {
			reference: '2:255',
			startUnitIndex: 2,
			endUnitIndex: 5,
			isBruteForce: true,
			manualText: 'Manual Quran translation'
		};

		const restored = VerseTranslation.fromJSON(
			translation.toJSON() as Record<string, unknown>
		) as VerseTranslation;

		expect(restored.isStructuredTranslation).toBe(true);
		expect(restored.quranSegments['quran-0']).toEqual(translation.quranSegments['quran-0']);
	});

	test('resolves edition ranges and manual Quran overrides without changing stored markers', () => {
		const projectTranslation = new ProjectTranslation();
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
		const language = new Edition(
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
		projectTranslation.addedTranslationEditions = [language];
		projectTranslation.versesTranslations[language.name] = {
			'2:255': 'God, there is no deity except Him, the Ever-Living.'
		};

		const subtitle = new SubtitleClip(0, 1000, 'قال {{2:255:1-2}} ثم {{حديث}}');
		const translation = new VerseTranslation(
			'He said {{2:255:1-2}} then {{a narration}}',
			'to review'
		);
		translation.isStructuredTranslation = true;
		translation.quranSegments['quran-0'] = {
			reference: '2:255:1-2',
			startUnitIndex: 1,
			endUnitIndex: 4,
			isBruteForce: false,
			manualText: ''
		};

		expect(
			projectTranslation.resolveStructuredTranslationText(language, subtitle, translation)
		).toBe('He said there is no deity then a narration');
		expect(translation.text).toBe('He said {{2:255:1-2}} then {{a narration}}');

		translation.quranSegments['quran-0'].isBruteForce = true;
		translation.quranSegments['quran-0'].manualText = 'God alone';
		expect(
			projectTranslation.resolveStructuredTranslationText(language, subtitle, translation)
		).toBe('He said God alone then a narration');
	});
});
