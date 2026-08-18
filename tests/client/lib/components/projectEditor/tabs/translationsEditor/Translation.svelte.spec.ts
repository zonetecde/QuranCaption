import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test } from 'vitest';

import Translation from '$lib/components/projectEditor/tabs/translationsEditor/workspace/translation/Translation.svelte';
import { PredefinedSubtitleClip } from '$lib/classes/Clip.svelte';
import { Edition } from '$lib/classes/Edition';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { PredefinedSubtitleTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';

describe('translation editor card', () => {
	afterEach(() => {
		cleanup();
		globalState.currentProject = null;
	});

	test('renders a predefined subtitle while WBW mapping mode is active', () => {
		const projectEditorState = new ProjectEditorState();
		projectEditorState.translationsEditor.isTranslationWbwMappingMode = true;
		globalState.currentProject = { projectEditorState } as never;

		const edition = new Edition('', 'english', 'Author', 'English', 'ltr', '', '', '', '');
		const subtitle = new PredefinedSubtitleClip(0, 1_000, 'Sadaqa', '', false, null, null);
		subtitle.translations[edition.name] = new PredefinedSubtitleTranslation(
			'Allah Almighty has spoken the truth'
		);

		const component = render(Translation, { edition, subtitle: subtitle as never });

		expect(component.container.querySelector('input[type="text"]')).toHaveValue(
			'Allah Almighty has spoken the truth'
		);
	});
});
