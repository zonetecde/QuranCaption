import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import {
	Edition,
	ProjectDetail,
	ProjectEditorState,
	Timeline,
	TrackType,
	VideoStyle
} from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import Settings from '$lib/classes/Settings.svelte';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import EditionViewer from '$lib/components/projectEditor/tabs/translationsEditor/leftPanel/EditionViewer.svelte';
import TranslationsEditorSettings from '$lib/components/projectEditor/tabs/translationsEditor/leftPanel/TranslationsEditorSettings.svelte';
import ArabicText from '$lib/components/projectEditor/tabs/translationsEditor/workspace/ArabicText.svelte';
import TranslationInlineStylePanel from '$lib/components/projectEditor/tabs/translationsEditor/TranslationInlineStylePanel.svelte';
import Workspace from '$lib/components/projectEditor/tabs/translationsEditor/workspace/Workspace.svelte';
import Translation from '$lib/components/projectEditor/tabs/translationsEditor/workspace/translation/Translation.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { WbwTranslationService } from '$lib/services/WbwTranslationService';

describe('Structured translation editor', () => {
	let projectTranslation: ProjectTranslation;
	let edition: Edition;

	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		projectTranslation = new ProjectTranslation();
		globalState.settings = new Settings();
		const quranEdition = new Edition(
			'quran-fr',
			'quran-fr',
			'Test Quran edition',
			'French',
			'ltr',
			'test',
			'',
			'',
			''
		);
		edition = new Edition(
			'language-french',
			'language-french',
			'French',
			'French',
			'ltr',
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);
		projectTranslation.addedTranslationEditions = [edition];
		globalState.availableTranslations = {};
		globalState.qdcAvailableTranslations = {};
		globalState.currentProject = {
			projectEditorState: new ProjectEditorState(),
			content: {
				projectTranslation,
				videoStyle: new VideoStyle(),
				timeline: new Timeline([new SubtitleTrack()])
			},
			detail: new ProjectDetail('Translation test', 'Speaker')
		} as never;
		vi.spyOn(ProjectHistoryManager, 'begin').mockImplementation(() => undefined);
		vi.spyOn(ProjectHistoryManager, 'commit').mockImplementation(() => undefined);
		vi.spyOn(ProjectHistoryManager, 'track').mockImplementation(((
			_label: string,
			mutate: () => unknown
		) => mutate()) as typeof ProjectHistoryManager.track);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	/**
	 * Crée un sous-titre avec sa traduction structurée.
	 * @param {string} source Texte source.
	 * @param {string} text Traduction sérialisée.
	 * @returns {SubtitleClip} Sous-titre prêt à rendre.
	 */
	function createSubtitle(source: string, text: string): SubtitleClip {
		const subtitle = new SubtitleClip(0, 1_000, source);
		const translation = new VerseTranslation(text, 'to translate');
		translation.isStructuredTranslation = true;
		subtitle.translations[edition.name] = translation;
		return subtitle;
	}

	test('initializes a second language before exposing it to the mounted workspace', async () => {
		const subtitle = createSubtitle('Source', 'Existing translation');
		globalState.getSubtitleTrack.clips.push(subtitle);
		Object.assign(globalState.currentProject!, { save: vi.fn().mockResolvedValue(undefined) });
		let finishDownload!: () => void;
		const download = new Promise<void>((resolve) => {
			finishDownload = resolve;
		});
		vi.spyOn(projectTranslation, 'downloadReferencedQuranTranslations').mockImplementation(
			async () => {
				await download;
				return {};
			}
		);
		vi.spyOn(globalState.getVideoStyle, 'addStylesForEdition').mockResolvedValue(undefined);
		const component = render(Workspace, { setAddTranslationModalVisibility: vi.fn() });
		await tick();

		const adding = projectTranslation.addLanguage('English', edition.quranEdition!);
		await tick();
		expect(projectTranslation.addedTranslationEditions).toHaveLength(1);
		expect(component.container.querySelectorAll('textarea')).toHaveLength(1);

		finishDownload();
		const addedEdition = await adding;
		await tick();
		expect(projectTranslation.addedTranslationEditions).toHaveLength(2);
		expect(subtitle.getTranslation(addedEdition)).toBeInstanceOf(VerseTranslation);
		expect(
			Array.from(component.container.querySelectorAll('textarea'), (input) => input.value)
		).toEqual(['Existing translation', '']);
	});

	test('opens AI video translation from the selected language card', async () => {
		const onTranslateWithAi = vi.fn();
		const component = render(EditionViewer, { edition, onTranslateWithAi });

		await component.getByRole('button', { name: 'Translate video with AI' }).click();

		expect(onTranslateWithAi).toHaveBeenCalledOnce();
	});

	test('preserves yellow review statuses and shows only pending review translations until confirmed', async () => {
		Object.assign(globalState.currentProject!, { save: vi.fn().mockResolvedValue(undefined) });
		const suspect = createSubtitle('Suspicious source', 'Existing safe translation');
		const translation = suspect.translations[edition.name];
		translation.status = 'to review';
		translation.reviewReason = 'The source wording needs checking against the recording.';
		const missing = createSubtitle('Missing translation source', '');
		const completed = createSubtitle('Completed source', 'Completed translation');
		completed.translations[edition.name].status = 'ai translated';
		globalState.getSubtitleTrack.clips.push(suspect, missing, completed);
		globalState.getTranslationsState.checkOnlyFilters(['to review']);
		const component = render(Workspace, { setAddTranslationModalVisibility: vi.fn() });
		await tick();
		expect(translation.status).toBe('to review');
		await expect.element(component.getByText('Suspicious source', { exact: true })).toBeVisible();
		expect(component.container.textContent).not.toContain('Missing translation source');
		expect(component.container.textContent).not.toContain('Completed source');
		const badge = component.getByText('To Review', { exact: true }).element();
		expect(badge.className).toContain('yellow');
		await expect.element(component.getByText(translation.reviewReason)).toBeVisible();
		await component.getByRole('button', { name: 'Mark as reviewed', exact: true }).click();
		expect(translation.status).toBe('reviewed');
		expect(translation.reviewReason).toBe('');
	});

	test.each([
		{ source: 'كلام عادي', text: 'Une traduction IA.', expected: ['Une traduction IA.'] },
		{
			source: 'قال: {{حديث}}',
			text: 'Il dit : {{Une citation traduite.}}',
			expected: ['Il dit : ', 'Une citation traduite.']
		}
	])(
		'refreshes mounted translation inputs after AI updates and reset: $source',
		async ({ source, text, expected }) => {
			initializeClassRegistry();
			const subtitle = SubtitleClip.fromJSON(
				createSubtitle(source, source.includes('{{') ? '{{}}' : '').toJSON()
			) as SubtitleClip;
			globalState.getSubtitleTrack.clips.push(subtitle);
			vi.spyOn(ModalManager, 'confirmModal').mockResolvedValue(true);
			vi.spyOn(projectTranslation, 'downloadReferencedQuranTranslations').mockResolvedValue({});
			const component = render(Translation, { edition, subtitle });
			await tick();

			subtitle.translations[edition.name].setTextAndClearInlineStyles(text);
			subtitle.translations[edition.name].status = 'ai translated';
			await tick();
			expect(
				Array.from(component.container.querySelectorAll('textarea'), (input) => input.value)
			).toEqual(expected);

			await projectTranslation.resetTranslation(edition);
			await tick();
			expect(
				Array.from(component.container.querySelectorAll('textarea'), (input) => input.value)
			).toEqual(expected.map(() => ''));

			subtitle.translations[edition.name].setTextAndClearInlineStyles(text);
			subtitle.translations[edition.name].status = 'ai translated';
			await tick();
			expect(
				Array.from(component.container.querySelectorAll('textarea'), (input) => input.value)
			).toEqual(expected);
		}
	);

	test('refreshes mounted Quran settings when the translation is replaced by reset', async () => {
		initializeClassRegistry();
		const subtitle = SubtitleClip.fromJSON(
			createSubtitle('{{2:255}}', '{{2:255}}').toJSON()
		) as SubtitleClip;
		projectTranslation.versesTranslations[edition.name] = { '2:255': 'one two three four' };
		const translation = subtitle.translations[edition.name] as VerseTranslation;
		const settings = translation.getOrCreateQuranSegment('quran-0', '2:255', 3);
		settings.isBruteForce = true;
		settings.manualText = 'Manual translation';
		const component = render(Translation, { edition, subtitle });
		await tick();
		expect(component.container.querySelector('textarea')?.value).toBe('Manual translation');

		subtitle.translations[edition.name] = projectTranslation.createTranslationForText(
			subtitle.text
		);
		await tick();
		await expect
			.element(component.getByRole('checkbox', { name: 'Manual translation' }))
			.not.toBeChecked();
		expect(component.container.querySelector('textarea')).toBeNull();
		await expect.element(component.getByText('one two three four')).toBeVisible();
	});

	test('ignores serialized translation metadata while counting filters and translated progress', async () => {
		initializeClassRegistry();
		const clips = (['ai translated', 'reviewed', 'completed by default', 'error'] as const).map(
			(status) => {
				const subtitle = createSubtitle('Source', 'Translation');
				subtitle.translations[edition.name].status = status;
				const serialized = subtitle.toJSON();
				serialized.translations = {
					__className: 'Translation',
					type: 'other',
					[edition.name]: subtitle.translations[edition.name].toJSON()
				};
				return SubtitleClip.fromJSON(serialized) as SubtitleClip;
			}
		);
		globalState
			.currentProject!.content.timeline.getFirstTrack(TrackType.Subtitle)!
			.clips.push(...clips);
		globalState.currentProject!.detail.translations.French = 0;
		globalState.getTranslationsState.filters['completed by default'] = false;
		globalState.getTranslationsState.filters.error = false;
		const component = render(TranslationsEditorSettings, {
			setAddTranslationModalVisibility: vi.fn(),
			setAiTranslationEdition: vi.fn()
		});
		await tick();
		expect(component.getByText('Percentage translated:')).toBeVisible();
		expect(component.getByText('75%')).toBeVisible();
		const labels = Array.from(component.container.querySelectorAll('label'));
		expect(
			labels.find((label) => label.textContent?.includes('Manually translated'))?.textContent
		).toMatch(/Manually translated\s+2/);
		expect(
			labels.find((label) => label.textContent?.includes('To translate'))?.textContent
		).toMatch(/To translate\s+1/);
		expect(component.container.textContent).not.toContain('Completed by default');
		expect(component.container.textContent).not.toContain('Reviewed');
		expect(component.container.textContent).not.toContain('Error');
		clips[3].translations[edition.name].status = 'reviewed';
		await tick();
		expect(component.getByText('100%')).toBeVisible();
		await component.getByRole('checkbox', { name: /Manually translated/ }).click();
		expect(globalState.getTranslationsState.filters.reviewed).toBe(false);
		await component.getByRole('button', { name: 'All', exact: true }).click();
		expect(globalState.getTranslationsState.filters.reviewed).toBe(true);
	});

	test('shows only source-backed free text and inserts ﷺ with Ctrl+S', async () => {
		const subtitle = createSubtitle('قال أنس: {{حديث}}', '{{}}');
		const component = render(Translation, { edition, subtitle });
		await tick();

		expect(component.container.querySelectorAll('textarea')).toHaveLength(2);
		expect(component.getByText('To translate')).toBeVisible();
		const addFreeTextAfter = Array.from(
			component.container.querySelectorAll<HTMLButtonElement>('button')
		).find((button) => button.getAttribute('aria-label')?.includes('Free text after'))!;
		expect(addFreeTextAfter).toBeDefined();
		expect(addFreeTextAfter.hasAttribute('title')).toBe(false);
		expect(
			Array.from(component.container.querySelectorAll('button')).some(
				(button) => button.textContent?.trim() === 'Mark as reviewed'
			)
		).toBe(false);

		const [freeText, citation] = Array.from(
			component.container.querySelectorAll<HTMLTextAreaElement>('textarea')
		);
		freeText.value = 'Anas a dit : ';
		freeText.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(subtitle.translations[edition.name].status).toBe('reviewed');

		citation.focus();
		citation.setSelectionRange(0, 0);
		citation.dispatchEvent(
			new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
		);
		await tick();
		expect(subtitle.translations[edition.name].text).toContain('{{ﷺ}}');

		addFreeTextAfter.click();
		await tick();
		expect(component.container.querySelectorAll('textarea')).toHaveLength(3);
		const optionalFreeText = Array.from(
			component.container.querySelectorAll<HTMLTextAreaElement>('textarea')
		).at(-1)!;
		optionalFreeText.value = 'Text to remove';
		optionalFreeText.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		const removeFreeTextAfter = Array.from(
			component.container.querySelectorAll<HTMLButtonElement>('button')
		).find((button) => button.getAttribute('aria-label')?.includes('Free text after'))!;
		removeFreeTextAfter.click();
		await tick();
		expect(component.container.querySelectorAll('textarea')).toHaveLength(2);
		expect(subtitle.translations[edition.name].text).not.toContain('Text to remove');
	});

	test('uses Noto Sans Arabic for the source subtitle', async () => {
		const subtitle = createSubtitle('قال أنس: {{حديث}}', '{{}}');
		const component = render(ArabicText, { subtitle });
		await tick();

		const arabicText = component.container.querySelector<HTMLElement>('.noto-sans-arabic');
		expect(arabicText).not.toBeNull();
		expect(getComputedStyle(arabicText!).fontFamily).toContain('Noto Sans Arabic');
	});

	test('shows the resolved translation only once while styling its words', async () => {
		const subtitle = createSubtitle('قال {{حديث}}', 'Il dit {{une citation}}');
		globalState.getTranslationsState.isInlineStyleMode = true;
		const component = render(Translation, { edition, subtitle });
		await tick();

		expect(component.container.textContent?.match(/citation/g)).toHaveLength(1);
		expect(component.container.querySelectorAll('.translation-word-style')).toHaveLength(4);
	});

	test.each(['قال إنما الأعمال بالنيات', 'قال {{إنما الأعمال بالنيات}}'])(
		'styles an Arabic word range and toggles it off without changing the source: %s',
		async (source) => {
			const subtitle = createSubtitle(source, 'Translation');
			const state = globalState.getTranslationsState;
			state.isInlineStyleMode = true;
			state.inlineStyleBoldEnabled = true;
			state.inlineStyleItalicEnabled = true;
			state.inlineStyleUnderlineEnabled = true;
			state.inlineStyleLineBreakEnabled = true;
			state.inlineStyleColorEnabled = true;
			state.inlineStyleColorValue = '#ff0000';
			state.inlineStyleGlowEnabled = true;
			state.inlineStyleGlowColorValue = '#00ff00';
			const component = render(ArabicText, { subtitle });
			await tick();
			const words = Array.from(
				component.container.querySelectorAll<HTMLButtonElement>('.translation-word-style')
			);
			expect(words.map((word) => word.textContent?.trim())).toEqual([
				'قال',
				'إنما',
				'الأعمال',
				'بالنيات'
			]);
			expect(getComputedStyle(words[0]).fontSize).toBe(
				getComputedStyle(component.container.querySelector('.noto-sans-arabic')!).fontSize
			);

			words[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			words[1].dispatchEvent(new MouseEvent('mouseenter'));
			window.dispatchEvent(new MouseEvent('mouseup'));
			await tick();

			expect(subtitle.text).toBe(source);
			expect(subtitle.arabicInlineStyleRuns).toEqual([
				{
					startWordIndex: 1,
					endWordIndex: 2,
					bold: true,
					italic: true,
					underline: true,
					lineBreak: true,
					color: '#ff0000',
					glow: '#00ff00'
				}
			]);
			expect(words[1].style.color).toBe('rgb(255, 0, 0)');
			expect(words[2].style.fontWeight).toBe('700');
			expect(words[0].style.color).toBe('');
			expect(ProjectHistoryManager.track).toHaveBeenCalledWith(
				'style arabic words',
				expect.any(Function)
			);

			words[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			words[2].dispatchEvent(new MouseEvent('mouseenter'));
			window.dispatchEvent(new MouseEvent('mouseup'));
			await tick();
			expect(subtitle.arabicInlineStyleRuns).toEqual([]);

			words[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			window.dispatchEvent(new MouseEvent('mouseup'));
			await tick();
			expect(subtitle.arabicInlineStyleRuns[0].startWordIndex).toBe(3);
			expect(subtitle.arabicInlineStyleRuns[0].endWordIndex).toBe(3);
			state.isInlineStyleMode = false;
			await tick();
			expect(component.container.querySelector('.translation-word-style')).toBeNull();
			expect(component.container.querySelector('[style*="font-weight: 700"]')?.textContent).toBe(
				'بالنيات'
			);
		}
	);

	test('resets Arabic word styles together with translation word styles', async () => {
		const subtitle = createSubtitle('كلام عادي', 'Une traduction');
		globalState.getSubtitleTrack.clips.push(subtitle);
		globalState.getTranslationsState.isInlineStyleMode = true;
		subtitle.toggleArabicInlineStyles(0, 0, {
			bold: true,
			italic: false,
			underline: false,
			color: null
		});
		(subtitle.translations[edition.name] as VerseTranslation).inlineStyleRuns = [
			{
				startWordIndex: 0,
				endWordIndex: 0,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		];
		vi.spyOn(ModalManager, 'confirmModal').mockResolvedValue(true);
		const component = render(TranslationInlineStylePanel);

		await component.getByRole('button', { name: 'Reset all segment styles' }).click();
		await tick();
		expect(subtitle.arabicInlineStyleRuns).toEqual([]);
		expect((subtitle.translations[edition.name] as VerseTranslation).inlineStyleRuns).toEqual([]);
		expect(ProjectHistoryManager.track).toHaveBeenCalledWith(
			'reset translation inline styles',
			expect.any(Function)
		);
	});

	test('shows a WBW helper for the cited part of a Quran verse', async () => {
		const wbwSpy = vi
			.spyOn(WbwTranslationService, 'getWordsForRange')
			.mockResolvedValue(['Je vais te reprendre', "et t'élever", 'vers Moi']);
		const subtitle = createSubtitle('{{3:55:4-8}}', '{{3:55:4-8}}');
		projectTranslation.versesTranslations[edition.name] = {
			'3:55': 'Ô Jésus ! Certes, Je vais mettre fin à ta vie terrestre et t’élever vers Moi.'
		};

		const component = render(Translation, { edition, subtitle });
		await vi.waitFor(() => {
			expect(component.getByText("Je vais te reprendre · et t'élever · vers Moi")).toBeVisible();
		});

		expect(wbwSpy).toHaveBeenCalledWith('en', 3, 55, 3, 7);
		globalState.settings!.persistentUiState.wbwTranslationLanguage = 'fr';
		await vi.waitFor(() => {
			expect(wbwSpy).toHaveBeenCalledWith('fr', 3, 55, 3, 7);
		});
	});

	test('restores continuous Quran word selection with mouse drag', async () => {
		const subtitle = createSubtitle('{{2:255}}', '{{2:255}}');
		projectTranslation.versesTranslations[edition.name] = {
			'2:255': 'one two three four'
		};
		const component = render(Translation, { edition, subtitle });
		await tick();

		expect(component.getByText('Full verse')).toBeVisible();
		expect(component.container.querySelectorAll('.translation-word')).toHaveLength(0);
		const editRangeButton = component
			.getByRole('button', { name: 'Edit translated range' })
			.element();
		const manualTranslationCheckbox = component
			.getByRole('checkbox', { name: 'Manual translation' })
			.element();
		expect(
			editRangeButton.compareDocumentPosition(manualTranslationCheckbox) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		const fullVerseTranslation = component.getByText('one two three four').element();
		expect(
			fullVerseTranslation.parentElement?.querySelector('.material-icons, .material-icons-outlined')
		).toBeNull();
		expect(
			Array.from(
				component.container.querySelectorAll('.material-icons, .material-icons-outlined')
			).map((icon) => icon.textContent?.trim())
		).not.toContain('menu_book');
		await component.getByRole('button', { name: 'Edit translated range' }).click();
		await tick();

		const words = Array.from(
			component.container.querySelectorAll<HTMLButtonElement>('.translation-word')
		);
		expect(words.map((word) => word.textContent?.trim())).toEqual(['one', 'two', 'three', 'four']);

		words[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		words[3].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		window.dispatchEvent(new MouseEvent('mouseup'));
		await tick();

		const translation = subtitle.translations[edition.name] as VerseTranslation;
		expect(translation.quranSegments['quran-0'].startUnitIndex).toBe(1);
		expect(translation.quranSegments['quran-0'].endUnitIndex).toBe(3);
		expect(words[1].classList.contains('translation-word-selected')).toBe(true);
		expect(words[3].classList.contains('translation-word-selected')).toBe(true);
	});
});
