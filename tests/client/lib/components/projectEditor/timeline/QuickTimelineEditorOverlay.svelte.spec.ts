import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class SubtitleClip {
		constructor(public id: number) {}
	}

	const clips = [new SubtitleClip(1), new SubtitleClip(2), new SubtitleClip(3)];
	const quickTimelineEditor = {
		active: true,
		clipId: 2,
		mode: 'translation' as 'translation' | 'wbw' | 'subtitle' | 'wbwTimestamp'
	};
	const openQuickTimelineEditor = vi.fn((clipId: number, mode: typeof quickTimelineEditor.mode) => {
		quickTimelineEditor.clipId = clipId;
		quickTimelineEditor.mode = mode;
	});

	return {
		SubtitleClip,
		clips,
		quickTimelineEditor,
		openQuickTimelineEditor,
		goToSubtitleClip: vi.fn(),
		globalState: {
			shared: {
				quickTimelineEditor,
				wbwEdit: { active: false }
			},
			currentProject: {
				projectEditorState: {
					translationsEditor: {
						isInlineStyleMode: false,
						isTranslationWbwMappingMode: false
					}
				},
				content: { projectTranslation: { addedTranslationEditions: [] } }
			},
			getSubtitleTrack: {
				clips,
				getClipById: (clipId: number) => clips.find((clip) => clip.id === clipId) ?? null,
				getSubtitleBefore: (index: number) => clips[index - 1] ?? null,
				getSubtitleAfter: (index: number) => clips[index + 1] ?? null
			},
			getSubtitlesEditorState: { editSubtitle: null },
			getVideoPreviewState: { scrollTimelineToCursor: vi.fn() },
			openQuickTimelineEditor,
			closeQuickTimelineEditor: vi.fn()
		}
	};
});

vi.mock('$lib/classes', () => ({ SubtitleClip: mocks.SubtitleClip }));
vi.mock('$lib/runes/main.svelte', () => ({ globalState: mocks.globalState }));
vi.mock('$lib/services/SubtitleNavigation', () => ({
	goToSubtitleClip: mocks.goToSubtitleClip
}));
vi.mock('$lib/services/WbwHelper', () => ({
	enterManualWordByWordEdit: vi.fn(),
	exitManualWordByWordEdit: vi.fn()
}));

vi.mock('$lib/components/projectEditor/tabs/subtitlesEditor/VersePicker.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/subtitlesEditor/WordsSelector.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock(
	'$lib/components/projectEditor/tabs/translationsEditor/TranslationInlineStylePanel.svelte',
	async () => ({ default: (await import('../../../../stubs/EmptyComponent.svelte')).default })
);
vi.mock(
	'$lib/components/projectEditor/tabs/translationsEditor/workspace/ArabicText.svelte',
	async () => ({ default: (await import('../../../../stubs/EmptyComponent.svelte')).default })
);
vi.mock(
	'$lib/components/projectEditor/tabs/translationsEditor/workspace/translation/Translation.svelte',
	async () => ({ default: (await import('../../../../stubs/EmptyComponent.svelte')).default })
);

import QuickTimelineEditorOverlay from '$lib/components/projectEditor/timeline/QuickTimelineEditorOverlay.svelte';

describe('quick timeline editor subtitle navigation', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		mocks.quickTimelineEditor.active = true;
		mocks.quickTimelineEditor.clipId = 2;
		mocks.quickTimelineEditor.mode = 'translation';
	});

	test.each(['translation', 'subtitle', 'wbw'] as const)(
		'ArrowRight opens the next subtitle while preserving %s mode',
		(mode) => {
			mocks.quickTimelineEditor.mode = mode;
			render(QuickTimelineEditorOverlay);

			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

			expect(mocks.goToSubtitleClip).toHaveBeenCalledWith(mocks.clips[2]);
			expect(mocks.openQuickTimelineEditor).toHaveBeenCalledWith(3, mode);
		}
	);

	test('ArrowLeft opens the previous subtitle', () => {
		render(QuickTimelineEditorOverlay);

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

		expect(mocks.goToSubtitleClip).toHaveBeenCalledWith(mocks.clips[0]);
		expect(mocks.openQuickTimelineEditor).toHaveBeenCalledWith(1, 'translation');
	});

	test('arrow keys keep their native behavior in text inputs', () => {
		const component = render(QuickTimelineEditorOverlay);
		const input = document.createElement('input');
		component.container.append(input);

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

		expect(mocks.openQuickTimelineEditor).not.toHaveBeenCalled();
	});
});
