import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ globalState: { currentProject: null as unknown } }));

vi.mock('$lib/classes/Clip.svelte', () => ({ ClipWithTranslation: class {} }));
vi.mock('$lib/classes/Translation.svelte', () => ({ VerseTranslation: class {} }));
vi.mock('$lib/classes/Settings.svelte', () => ({ default: {} }));
vi.mock('$lib/components/modals/ModalManager', () => ({ default: {} }));
vi.mock('$lib/services/WbwTranslationService', () => ({ WBW_TRANSLATION_LANGUAGES: [] }));
vi.mock('$lib/runes/main.svelte', () => ({ globalState: mocks.globalState }));

import TranslationInlineStylePanel from '$lib/components/projectEditor/tabs/translationsEditor/TranslationInlineStylePanel.svelte';

describe('translation inline style panel', () => {
	afterEach(() => {
		cleanup();
		mocks.globalState.currentProject = null;
	});

	test('clicking either color picker does not toggle its style', async () => {
		const translationsEditor = {
			isInlineStyleMode: true,
			isTranslationWbwMappingMode: false,
			inlineStyleBoldEnabled: false,
			inlineStyleItalicEnabled: false,
			inlineStyleUnderlineEnabled: false,
			inlineStyleLineBreakEnabled: false,
			inlineStyleColorEnabled: false,
			inlineStyleColorValue: '#f59e0b',
			inlineStyleGlowEnabled: false,
			inlineStyleGlowColorValue: '#ffffff'
		};
		mocks.globalState.currentProject = { projectEditorState: { translationsEditor } };

		const component = render(TranslationInlineStylePanel);
		const colorPickers =
			component.container.querySelectorAll<HTMLInputElement>('input[type="color"]');

		expect(colorPickers).toHaveLength(2);
		await colorPickers[0].click();
		await colorPickers[1].click();
		expect(translationsEditor.inlineStyleColorEnabled).toBe(false);
		expect(translationsEditor.inlineStyleGlowEnabled).toBe(false);
	});
});
