import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import { Edition, ProjectEditorState, VideoStyle } from '$lib/classes';
import Settings from '$lib/classes/Settings.svelte';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import ArabicText from '$lib/components/projectEditor/tabs/translationsEditor/workspace/ArabicText.svelte';
import Translation from '$lib/components/projectEditor/tabs/translationsEditor/workspace/translation/Translation.svelte';
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
			content: { projectTranslation, videoStyle: new VideoStyle() },
			detail: { updatePercentageTranslated: vi.fn() }
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

	test('shows only source-backed free text and inserts ﷺ with Ctrl+S', async () => {
		const subtitle = createSubtitle('قال أنس: {{حديث}}', '{{}}');
		const component = render(Translation, { props: { edition, subtitle } });
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
		const component = render(ArabicText, { props: { subtitle } });
		await tick();

		const arabicText = component.container.querySelector<HTMLElement>('.noto-sans-arabic');
		expect(arabicText).not.toBeNull();
		expect(getComputedStyle(arabicText!).fontFamily).toContain('Noto Sans Arabic');
	});

	test('shows a WBW helper for the cited part of a Quran verse', async () => {
		const wbwSpy = vi
			.spyOn(WbwTranslationService, 'getWordsForRange')
			.mockResolvedValue(['Je vais te reprendre', "et t'élever", 'vers Moi']);
		const subtitle = createSubtitle('{{3:55:4-8}}', '{{3:55:4-8}}');
		projectTranslation.versesTranslations[edition.name] = {
			'3:55': 'Ô Jésus ! Certes, Je vais mettre fin à ta vie terrestre et t’élever vers Moi.'
		};

		const component = render(Translation, { props: { edition, subtitle } });
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
		const component = render(Translation, { props: { edition, subtitle } });
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
