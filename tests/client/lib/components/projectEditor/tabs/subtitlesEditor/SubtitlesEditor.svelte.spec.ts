import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import SubtitlesList from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesList.svelte';
import SubtitlesWorkspace from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesWorkspace.svelte';
import QuickTimelineEditorOverlay from '$lib/components/projectEditor/timeline/QuickTimelineEditorOverlay.svelte';
import TranscriptComposer from '$lib/components/projectEditor/tabs/subtitlesEditor/TranscriptComposer.svelte';
import TimelineSubtitleClip from '$lib/components/projectEditor/timeline/track/SubtitleClip.svelte';
import {
	buildManualWordByWordDraftWords,
	enterManualWordByWordEdit,
	exitManualWordByWordEdit,
	updateManualWordByWordBoundary
} from '$lib/services/WbwHelper';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

import { Edition } from '$lib/classes/Edition';
import { SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { ProjectEditorTabs } from '$lib/classes/enums';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import QPCFontProvider from '$lib/services/FontProvider';
import ShortcutService from '$lib/services/ShortcutService';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import {
	resetSubtitlesEditorProjectFixture,
	setupSubtitlesEditorProjectFixture,
	seedSubtitlesEditorQuranFixture
} from '../../../../../fixtures/subtitlesEditor/projectFixture';

vi.mock('$lib/services/ShortcutService', () => ({
	default: {
		registerShortcut: vi.fn(),
		unregisterShortcut: vi.fn()
	}
}));

vi.mock('svelte-5-french-toast', () => ({
	default: {
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn()
	}
}));

describe('Minbar manual word timestamps', () => {
	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		seedSubtitlesEditorQuranFixture();
		vi.spyOn(ProjectHistoryManager, 'track').mockImplementation((_label, action) => action());
	});

	afterEach(() => {
		cleanup();
		exitManualWordByWordEdit(true);
		globalState.closeQuickTimelineEditor();
		vi.useRealTimers();
		vi.restoreAllMocks();
		resetSubtitlesEditorProjectFixture();
	});

	test('opens from the edit button and stamps relative boundaries with Enter until completion', async () => {
		const subtitle = new SubtitleClip(1000, 5000, 'one two three');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle], editSubtitle: subtitle });
		globalState.getTimelineState.zoom = 42;
		const component = render(TranscriptComposer);
		await component.getByRole('button', { name: 'Edit WBW timestamp' }).click();
		await expect.poll(() => globalState.shared.wbwEdit.active).toBe(true);
		expect(globalState.getTimelineState.cursorPosition).toBe(1000);
		expect(globalState.getTimelineState.zoom).toBe(100);
		expect(subtitle.alignmentMetadata).toBeNull();
		expect(component.container.querySelector('[data-manual-wbw-words]')?.textContent).toContain(
			'three'
		);

		globalState.getTimelineState.cursorPosition = 2000;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		await tick();
		expect(globalState.shared.wbwEdit.currentWordIndex).toBe(1);
		expect(subtitle.alignmentMetadata?.words[0]).toMatchObject({ word: 'one', start: 0, end: 1 });
		expect(subtitle.wbwTimestampsManuallyEdited).toBe(true);
		expect(ProjectHistoryManager.track).toHaveBeenCalledWith(
			'edit wbw timestamps',
			expect.any(Function)
		);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true }));
		expect(globalState.shared.wbwEdit.currentWordIndex).toBe(1);

		globalState.getTimelineState.cursorPosition = 3500;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		await tick();
		expect(subtitle.alignmentMetadata?.words).toEqual([
			{ word: 'one', start: 0, end: 1 },
			{ word: 'two', start: 1, end: 2.5 },
			{ word: 'three', start: 2.5, end: 4 }
		]);
		expect(globalState.shared.wbwEdit.active).toBe(false);
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
		expect(globalState.getTimelineState.zoom).toBe(42);
	});

	test('keeps short E for editing and opens manual timing only after holding E over a subtitle', async () => {
		const subtitle = new SubtitleClip(1000, 5000, 'one two three');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle], timelineCursorPosition: 2000 });
		vi.mocked(ShortcutService.registerShortcut).mockClear();
		render(TranscriptComposer);
		await tick();
		const shortcut = vi
			.mocked(ShortcutService.registerShortcut)
			.mock.calls.find(([options]) => options.key.keys.includes('E'))![0];
		vi.useFakeTimers();
		shortcut.onKeyDown(new KeyboardEvent('keydown', { key: 'e' }));
		await vi.advanceTimersByTimeAsync(100);
		shortcut.onKeyUp!(new KeyboardEvent('keyup', { key: 'e' }));
		expect(globalState.getSubtitlesEditorState.editSubtitle?.id).toBe(subtitle.id);
		expect(globalState.shared.wbwEdit.active).toBe(false);
		shortcut.onKeyDown(new KeyboardEvent('keydown', { key: 'e' }));
		await vi.advanceTimersByTimeAsync(500);
		shortcut.onKeyUp!(new KeyboardEvent('keyup', { key: 'e' }));
		await tick();
		expect(globalState.shared.wbwEdit.active).toBe(true);
		expect(globalState.getSubtitlesEditorState.editSubtitle?.id).toBe(subtitle.id);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		expect(globalState.shared.wbwEdit.active).toBe(false);
		expect(subtitle.alignmentMetadata).toBeNull();
	});

	test('resolves Quran references and quotations into spoken words without markup', async () => {
		const subtitle = new SubtitleClip(0, 6000, 'Before{{1:1:1-2}}{{quoted words}}after');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		const words = await buildManualWordByWordDraftWords(subtitle);
		expect(words.map((word) => word.word)).toEqual([
			'Before',
			'W1V1-1',
			'W1V1-2',
			'quoted',
			'words',
			'after'
		]);
		expect(words[0]).toMatchObject({ start: 0, end: 6 });
		expect(words[1]).toMatchObject({ start: 6, end: 6 });
	});

	test('preserves existing timestamps on opening and tracks boundary changes', async () => {
		const subtitle = new SubtitleClip(0, 4000, 'one two');
		subtitle.alignmentMetadata = {
			source: 'import',
			timeFrom: 0,
			timeTo: 4,
			specialType: 'quotation',
			words: [
				{ word: 'one', start: 0, end: 1 },
				{ word: 'two', start: 1, end: 4 }
			]
		};
		setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		expect(await enterManualWordByWordEdit(subtitle)).toBe(true);
		expect(subtitle.wbwTimestampsManuallyEdited).toBe(false);
		expect(globalState.shared.wbwEdit.draftWords[0].end).toBe(1);
		updateManualWordByWordBoundary(0, 2);
		expect(subtitle.alignmentMetadata?.words[0].end).toBe(2);
		expect(subtitle.alignmentMetadata?.words[1].start).toBe(2);
		expect(subtitle.alignmentMetadata?.specialType).toBe('quotation');
		expect(ProjectHistoryManager.track).toHaveBeenCalledWith(
			'edit wbw timestamps',
			expect.any(Function)
		);
	});

	test('opens the same manual words in the quick timeline editor and closes after stamping', async () => {
		const subtitle = new SubtitleClip(1000, 3000, 'one two');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		globalState.openQuickTimelineEditor(subtitle.id, 'wbwTimestamp');
		const workspace = render(SubtitlesWorkspace);
		const overlay = render(QuickTimelineEditorOverlay);
		await expect.poll(() => globalState.shared.wbwEdit.active).toBe(true);
		await tick();
		expect(workspace.container.querySelector('[data-manual-wbw-words]')).toBeNull();
		expect(overlay.container.querySelector('[data-manual-wbw-words]')?.textContent).toContain(
			'one'
		);
		globalState.getTimelineState.cursorPosition = 2000;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		await tick();
		expect(globalState.shared.quickTimelineEditor.active).toBe(false);
		expect(subtitle.alignmentMetadata?.words).toHaveLength(2);
	});

	test('retains the legacy Quran word range', async () => {
		const { clips } = setupSubtitlesEditorProjectFixture();
		const words = await buildManualWordByWordDraftWords(clips[0]);
		expect(words.map((word) => word.location)).toEqual(['1:1:1', '1:1:2']);
		expect(words.map((word) => word.word)).toEqual(['W1V1-1', 'W1V1-2']);
	});

	test('saves the current draft before manual timing and keeps arrows within the quick subtitle editor', async () => {
		const subtitle = new SubtitleClip(1000, 4000, 'Original transcript');
		const { subtitleTrack } = setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		const editTranscript = vi
			.spyOn(subtitleTrack, 'editTranscript')
			.mockImplementation((clip, text) => {
				clip.text = text;
				return true;
			});
		globalState.getTimelineState.zoom = 42;
		globalState.openQuickTimelineEditor(subtitle.id, 'subtitle');
		const overlay = render(QuickTimelineEditorOverlay);
		await overlay.getByRole('textbox').fill('Updated spoken words');
		await overlay.getByRole('button', { name: 'Edit WBW timestamp' }).click();
		await expect.poll(() => globalState.shared.wbwEdit.active).toBe(true);
		expect(editTranscript).toHaveBeenCalledWith(
			expect.objectContaining({ id: subtitle.id }),
			'Updated spoken words'
		);
		expect(globalState.shared.wbwEdit.draftWords.map((word) => word.word)).toEqual([
			'Updated',
			'spoken',
			'words'
		]);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
		expect(globalState.shared.wbwEdit.currentWordIndex).toBe(1);
		expect(globalState.shared.quickTimelineEditor.clipId).toBe(subtitle.id);
		await overlay.getByRole('button', { name: 'Close', exact: true }).first().click();
		await tick();
		expect(globalState.shared.quickTimelineEditor.active).toBe(false);
		expect(globalState.shared.wbwEdit.active).toBe(false);
		expect(globalState.getTimelineState.zoom).toBe(42);
	});

	test('rejects an empty transcript and completes a single word with one stamp', async () => {
		const subtitle = new SubtitleClip(1000, 3000, '');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		expect(await enterManualWordByWordEdit(subtitle)).toBe(false);
		subtitle.text = 'single';
		await enterManualWordByWordEdit(subtitle);
		render(TranscriptComposer);
		await tick();
		globalState.getTimelineState.cursorPosition = 2000;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		expect(subtitle.alignmentMetadata?.words).toEqual([{ word: 'single', start: 0, end: 2 }]);
		expect(globalState.shared.wbwEdit.active).toBe(false);
	});
});

describe('Subtitles editor workflow', () => {
	test('Enter still closes a transcript edit after closing the quick timeline editor', async () => {
		loadLocale('en');
		setLocale('en');
		const subtitle = new SubtitleClip(0, 1000, 'Original transcript');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		const workspace = render(SubtitlesWorkspace);
		globalState.openQuickTimelineEditor(subtitle.id, 'subtitle');
		const overlay = render(QuickTimelineEditorOverlay);
		await tick();
		globalState.closeQuickTimelineEditor();
		overlay.unmount();
		await tick();
		globalState.getSubtitlesEditorState.editSubtitle = subtitle;
		await tick();
		await expect.element(workspace.getByRole('textbox')).toHaveValue('Original transcript');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		await expect.poll(() => globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
	});

	beforeEach(() => {
		seedSubtitlesEditorQuranFixture();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		resetSubtitlesEditorProjectFixture();
	});

	test('renders Quran references and quotations with their resolved translations in the segment list', async () => {
		loadLocale('en');
		setLocale('en');
		vi.spyOn(QPCFontProvider, 'loadQPC2Data').mockResolvedValue(undefined);
		const subtitle = new SubtitleClip(0, 1000, 'Before {{1:1:1-2}} {{quotation}} after');
		const fixture = setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		const translations = new ProjectTranslation();
		const edition = new Edition(
			'english',
			'english',
			'English',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		translations.addedTranslationEditions = [edition];
		translations.versesTranslations.english = { '1:1': 'one two three' };
		globalState.currentProject!.content.projectTranslation = translations;
		const translation = new VerseTranslation(
			'Translated {{1:1:1-2}} {{translated quotation}} end',
			'ai translated'
		);
		translation.isStructuredTranslation = true;
		const settings = translation.getOrCreateQuranSegment('quran-0', '1:1:1-2', 2);
		settings.startUnitIndex = 1;
		settings.endUnitIndex = 2;
		subtitle.translations.english = translation;
		const component = render(SubtitlesList);

		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('{W1V1-1 W1V1-2}');
			expect(component.container.textContent).toContain(
				'Translated {two three} translated quotation end'
			);
		});
		expect(component.container.textContent).not.toContain('{{');
		expect(
			getComputedStyle(component.container.querySelector('.text-emerald-200')!).fontFamily
		).toContain('Hafs');
		expect(component.container.textContent).not.toContain('W1V1-3');
		expect(component.container.querySelector('.text-amber-200')?.textContent).toBe('quotation');

		translation.quranSegments['quran-0'].isBruteForce = true;
		translation.quranSegments['quran-0'].manualText = 'Manual verse translation';
		await tick();
		expect(component.container.textContent).toContain(
			'Translated {Manual verse translation} translated quotation end'
		);
		expect(subtitle.text).toBe('Before {{1:1:1-2}} {{quotation}} after');
		expect(translation.text).toBe('Translated {{1:1:1-2}} {{translated quotation}} end');
		fixture.spies.getStyle.mockReturnValue({ value: true } as never);
		subtitle.text = 'Before {{1:1}} {{quotation}} after';
		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('{W1V1-1 W1V1-2 W1V1-3 1}');
		});
		expect(component.container.textContent).not.toContain('\u06dd');

		subtitle.text = 'Before{{1:1}}{{quotation}}after';
		translation.text = 'Translated{{1:1}}{{translated quotation}}end';
		await vi.waitFor(() => {
			expect(component.container.textContent).toContain(
				'Before {W1V1-1 W1V1-2 W1V1-3 1} quotation after'
			);
			expect(component.container.textContent).toContain(
				'Translated {Manual verse translation} translated quotation end'
			);
		});
		expect(subtitle.text).toBe('Before{{1:1}}{{quotation}}after');
		expect(translation.text).toBe('Translated{{1:1}}{{translated quotation}}end');
	});

	test('saves a transcript without any speaker controls or speaker argument', async () => {
		loadLocale('en');
		setLocale('en');
		const { subtitleTrack } = setupSubtitlesEditorProjectFixture({
			clips: [],
			timelineCursorPosition: 1000
		});
		globalState.currentProject!.detail.speaker = 'Only speaker';
		const addTranscript = vi.spyOn(subtitleTrack, 'addTranscript').mockReturnValue(true);
		const workspace = render(SubtitlesWorkspace);
		await tick();
		expect(workspace.container.textContent).not.toContain('Add speaker');
		expect(workspace.container.textContent).not.toContain('Only speaker');
		const input = workspace.getByRole('textbox');
		await input.fill('A single spoken passage');
		input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await expect.poll(() => addTranscript.mock.calls.length).toBe(1);
		expect(addTranscript).toHaveBeenCalledWith('A single spoken passage');
	});

	test.each(['S', 'P'])(
		'adds silence up to the cursor with the configured shortcut %s outside editing',
		async (key) => {
			const subtitle = new SubtitleClip(0, 1000, 'Last subtitle');
			const { subtitleTrack, spies } = setupSubtitlesEditorProjectFixture({
				clips: [subtitle],
				timelineCursorPosition: 3000
			});
			spies.addSilence.mockRestore();
			vi.spyOn(ProjectHistoryManager, 'begin').mockImplementation(() => undefined);
			vi.spyOn(ProjectHistoryManager, 'commit').mockImplementation(() => undefined);
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SILENCE.keys = [key];
			const component = render(TranscriptComposer);
			await tick();
			component
				.getByRole('textbox')
				.element()
				.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: key.toLowerCase(),
						bubbles: true,
						cancelable: true
					})
				);
			window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, cancelable: true }));
			expect(subtitleTrack.clips).toHaveLength(1);
			window.dispatchEvent(
				new KeyboardEvent('keydown', { key: key.toLowerCase(), cancelable: true })
			);
			expect(subtitleTrack.clips).toHaveLength(2);
			expect(subtitleTrack.clips[1]).toBeInstanceOf(SilenceClip);
			expect(subtitleTrack.clips[1]).toMatchObject({ startTime: 1001, endTime: 3000 });
			expect(spies.updateVideoDetailAttributes).toHaveBeenCalledTimes(1);
			expect(ProjectHistoryManager.begin).toHaveBeenCalledWith('add silence');
			expect(ProjectHistoryManager.commit).toHaveBeenCalled();
			expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
		}
	);

	test('edits a timeline subtitle with the transcript composer and saves only once', async () => {
		loadLocale('en');
		setLocale('en');
		const subtitle = new SubtitleClip(0, 1000, 'Original transcript');
		const { subtitleTrack } = setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		const editTranscript = vi
			.spyOn(subtitleTrack, 'editTranscript')
			.mockImplementation((clip, text) => {
				clip.text = text;
				return true;
			});
		const workspace = render(SubtitlesWorkspace);
		globalState.openQuickTimelineEditor(subtitle.id, 'subtitle');
		const overlay = render(QuickTimelineEditorOverlay);
		await tick();

		expect(workspace.container.querySelector('[data-structured-transcript-editor]')).toBeNull();
		const input = overlay.getByRole('textbox');
		await expect.element(input).toHaveValue('Original transcript');
		expect(overlay.container.querySelector('input[type="number"]')).toBeNull();
		await input.fill('Corrected transcript');
		await expect.poll(() => subtitle.text).toBe('Corrected transcript');
		expect(globalState.shared.quickTimelineEditor.active).toBe(true);
		input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await expect.poll(() => editTranscript.mock.calls.length).toBe(1);
		expect(editTranscript).toHaveBeenCalledWith(subtitle, 'Corrected transcript');
		await tick();
		expect(globalState.shared.quickTimelineEditor.active).toBe(false);
		expect(workspace.container.querySelector('[data-structured-transcript-editor]')).not.toBeNull();
	});

	test('saves subtitle edits immediately and reloads restored text without saving it again', async () => {
		loadLocale('en');
		setLocale('en');
		const subtitle = new SubtitleClip(0, 1000, 'Original transcript');
		const { subtitleTrack } = setupSubtitlesEditorProjectFixture({
			clips: [subtitle],
			editSubtitle: subtitle
		});
		vi.spyOn(ProjectHistoryManager, 'begin').mockImplementation(() => undefined);
		vi.spyOn(ProjectHistoryManager, 'commit').mockImplementation(() => undefined);
		const editTranscript = vi.spyOn(subtitleTrack, 'editTranscript');
		const component = render(TranscriptComposer);
		const input = component.getByRole('textbox');
		await input.fill('Corrected transcript ');
		expect(subtitle.text).toBe('Corrected transcript');
		await expect.element(input).toHaveValue('Corrected transcript ');
		expect(globalState.getSubtitlesEditorState.editSubtitle?.id).toBe(subtitle.id);
		expect(component.container.querySelector('button[aria-label="Confirm edit"]')).toBeNull();
		expect(ProjectHistoryManager.begin).toHaveBeenCalledWith('edit transcript');
		expect(ProjectHistoryManager.commit).toHaveBeenCalled();

		await input.fill('');
		expect(editTranscript).toHaveBeenCalledTimes(1);
		await input.fill('Another correction');
		expect(subtitle.text).toBe('Another correction');
		subtitle.text = 'Original transcript';
		await expect.element(input).toHaveValue('Original transcript');
		expect(editTranscript).toHaveBeenCalledTimes(2);
		await component.getByRole('button', { name: 'Exit edit' }).click();
		expect(subtitle.text).toBe('Original transcript');
	});

	test.each(['Enter', 'button'])(
		'opens a silence from the timeline and converts it only after confirming with %s',
		async (confirmation) => {
			loadLocale('en');
			setLocale('en');
			const silence = new SilenceClip(1000, 3000);
			const following = new SubtitleClip(3001, 4000, 'Following subtitle');
			const { subtitleTrack } = setupSubtitlesEditorProjectFixture({ clips: [following] });
			subtitleTrack.clips.unshift(silence);
			globalState.currentProject!.content.projectTranslation = new ProjectTranslation();
			globalState.currentProject!.projectEditorState.currentTab = ProjectEditorTabs.Transcription;
			vi.spyOn(ProjectHistoryManager, 'track').mockImplementation((_label, action) => action());
			const timelineClip = render(TimelineSubtitleClip, {
				clip: silence as SubtitleClip,
				track: subtitleTrack
			});
			const composer = render(TranscriptComposer);
			timelineClip.container.querySelector<HTMLElement>('.timeline-silence')!.click();
			await tick();
			expect(globalState.getSubtitlesEditorState.editSubtitle).toBe(silence);
			await expect.element(composer.getByRole('textbox')).toHaveValue('');
			expect(composer.container.textContent).toContain('SILENCE');
			await composer.getByRole('textbox').fill('Missed speech');
			expect(subtitleTrack.clips[0]).toBe(silence);
			if (confirmation === 'Enter') {
				composer
					.getByRole('textbox')
					.element()
					.dispatchEvent(
						new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
					);
			} else {
				await composer.getByRole('button', { name: 'Confirm edit' }).click();
			}
			await expect.poll(() => globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
			expect(subtitleTrack.clips).toHaveLength(2);
			expect(subtitleTrack.clips[0]).toBeInstanceOf(SubtitleClip);
			expect(subtitleTrack.clips[0]).toMatchObject({
				startTime: 1000,
				endTime: 3000,
				text: 'Missed speech'
			});
			expect(subtitleTrack.clips[1]).toBe(following);
			expect(ProjectHistoryManager.track).toHaveBeenCalledWith(
				'convert silence to subtitle',
				expect.any(Function)
			);
		}
	);

	test('keeps a silence unchanged when confirming empty text or cancelling its draft', async () => {
		loadLocale('en');
		setLocale('en');
		const silence = new SilenceClip(1000, 3000);
		const { subtitleTrack } = setupSubtitlesEditorProjectFixture({ clips: [] });
		subtitleTrack.clips.push(silence);
		globalState.getSubtitlesEditorState.editSubtitle = silence;
		const composer = render(TranscriptComposer);
		await composer.getByRole('button', { name: 'Confirm edit' }).click();
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBe(silence);
		await composer.getByRole('textbox').fill('Unsaved speech');
		await composer.getByRole('button', { name: 'Exit edit' }).click();
		expect(subtitleTrack.clips[0]).toBe(silence);
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
	});

	test('converts an edited subtitle to silence from the button while preserving its timing', async () => {
		loadLocale('en');
		setLocale('en');
		const subtitle = new SubtitleClip(1000, 3000, 'Unwanted speech');
		const { subtitleTrack } = setupSubtitlesEditorProjectFixture({
			clips: [subtitle],
			editSubtitle: subtitle
		});
		vi.spyOn(ProjectHistoryManager, 'track').mockImplementation((_label, action) => action());
		const composer = render(TranscriptComposer);
		await composer.getByRole('button', { name: 'SILENCE' }).click();
		expect(subtitleTrack.clips).toHaveLength(1);
		expect(subtitleTrack.clips[0]).toBeInstanceOf(SilenceClip);
		expect(subtitleTrack.clips[0]).toMatchObject({ startTime: 1000, endTime: 3000 });
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
		expect(ProjectHistoryManager.track).toHaveBeenCalledWith(
			'replace subtitle with silence',
			expect.any(Function)
		);
	});

	test('saves quotation conversions, input and removal without confirming the edit', async () => {
		loadLocale('en');
		setLocale('en');
		const subtitle = new SubtitleClip(0, 1000, 'ee{{1:1:1-2}}');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle], editSubtitle: subtitle });
		vi.spyOn(ProjectHistoryManager, 'begin').mockImplementation(() => undefined);
		vi.spyOn(ProjectHistoryManager, 'commit').mockImplementation(() => undefined);
		const component = render(TranscriptComposer);
		const convert = component.getByRole('button', { name: 'Convert to quotation' });
		expect(convert.element().getAttribute('title')).toBe('Convert to quotation');
		expect(convert.element().textContent).not.toContain('Convert to quotation');
		(convert.element() as HTMLButtonElement).click();
		await tick();
		expect(subtitle.text).toBe('{{ee}}{{1:1:1-2}}');
		await component.getByRole('textbox').nth(1).fill('Updated quotation');
		expect(subtitle.text).toBe('{{Updated quotation}}{{1:1:1-2}}');
		(
			component
				.getByRole('button', { name: 'Convert to normal text' })
				.element() as HTMLButtonElement
		).click();
		await tick();
		expect(subtitle.text).toBe('Updated quotation {{1:1:1-2}}');
		await component.getByRole('button', { name: 'Insert quotation' }).click();
		expect(subtitle.text).toBe('Updated quotation {{1:1:1-2}}');
		await component.getByRole('textbox').nth(2).fill('New quotation');
		expect(subtitle.text).toBe('Updated quotation {{1:1:1-2}}{{New quotation}}');
		(
			component
				.getByRole('button', { name: 'Remove', exact: true })
				.last()
				.element() as HTMLButtonElement
		).click();
		await tick();
		expect(subtitle.text).toBe('Updated quotation {{1:1:1-2}}');
	});

	test.each(['Enter', 'Escape'])(
		'preserves the timeline edit shortcut across repeated quick edits closed with %s',
		async (key) => {
			loadLocale('en');
			setLocale('en');
			const subtitle = new SubtitleClip(0, 1000, 'Original transcript');
			const { subtitleTrack } = setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
			globalState.currentProject!.projectEditorState.currentTab = ProjectEditorTabs.Style;
			vi.spyOn(subtitleTrack, 'editTranscript').mockReturnValue(true);
			vi.mocked(ShortcutService.registerShortcut).mockClear();
			vi.mocked(ShortcutService.unregisterShortcut).mockClear();

			for (let session = 0; session < 2; session++) {
				globalState.openQuickTimelineEditor(subtitle.id, 'subtitle');
				const overlay = render(QuickTimelineEditorOverlay);
				await tick();
				await expect.element(overlay.getByRole('textbox')).toHaveValue('Original transcript');
				overlay
					.getByRole('textbox')
					.element()
					.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
				await tick();
				expect(globalState.shared.quickTimelineEditor.active).toBe(false);
				overlay.unmount();
				await tick();
			}
			expect(ShortcutService.registerShortcut).not.toHaveBeenCalled();
			expect(ShortcutService.unregisterShortcut).not.toHaveBeenCalled();
		}
	);

	test('shows the saved passage and updates its words after changing the surah and verse', async () => {
		loadLocale('en');
		setLocale('en');
		const subtitle = new SubtitleClip(0, 1000, '{{2:1}}');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle], editSubtitle: subtitle });
		const workspace = render(SubtitlesWorkspace);
		await workspace.getByRole('button', { name: 'W2V1-1 W2V1-2', exact: true }).click();

		const surahInput = workspace.getByRole('textbox').last();
		const verseInput = workspace.getByRole('spinbutton', { name: 'Verse:' });
		await expect.element(surahInput).toHaveValue('2. Al-Baqarah');
		await expect.element(verseInput).toHaveValue(1);

		await surahInput.fill('1');
		await workspace.getByText('1. Al-Fatihah', { exact: true }).click();

		await expect.element(surahInput).toHaveValue('1. Al-Fatihah');
		await expect.element(verseInput).toHaveValue(1);
		await expect
			.element(workspace.getByRole('button', { name: 'W1V1-1', exact: true }))
			.toBeVisible();

		await verseInput.fill('2');
		(verseInput.element() as HTMLInputElement).blur();
		await expect.element(verseInput).toHaveValue(2);
		await expect
			.element(workspace.getByRole('button', { name: 'W1V2-1', exact: true }))
			.toBeVisible();
		await expect
			.element(workspace.getByRole('button', { name: 'W1V2-2', exact: true }))
			.toBeVisible();
		await workspace.getByRole('button', { name: 'Cancel', exact: true }).click();
		await tick();
	});

	test('clicking a transcript loads its saved Quran passage and word range for editing', async () => {
		loadLocale('en');
		setLocale('en');
		const subtitle = new SubtitleClip(2000, 3000, 'Before {{2:2:2-3}} after');
		setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		const workspace = render(SubtitlesWorkspace);
		const list = render(SubtitlesList);
		const targetSubtitle = list.container.querySelector<HTMLElement>(
			`[data-transcript-id="${subtitle.id}"]`
		);

		expect(targetSubtitle).not.toBeNull();
		targetSubtitle!.click();
		await tick();
		expect(globalState.getSubtitlesEditorState.editSubtitle?.id).toBe(subtitle.id);
		expect(globalState.getTimelineState.cursorPosition).toBe(2000);
		await expect.element(workspace.getByRole('textbox').first()).toHaveValue('Before ');
		await expect.element(workspace.getByRole('textbox').last()).toHaveValue(' after');
		await workspace.getByRole('button', { name: 'W2V2-2 W2V2-3', exact: true }).click();

		await expect.element(workspace.getByRole('textbox').last()).toHaveValue('2. Al-Baqarah');
		await expect.element(workspace.getByRole('spinbutton', { name: 'Verse:' })).toHaveValue(2);
		await expect
			.poll(() =>
				Array.from(workspace.container.querySelectorAll('.verse-selector-word-selected')).map(
					(node) => node.textContent?.trim()
				)
			)
			.toEqual(['W2V2-2', 'W2V2-3']);
		await workspace.getByRole('button', { name: 'Cancel', exact: true }).click();
		await tick();
	});
});
