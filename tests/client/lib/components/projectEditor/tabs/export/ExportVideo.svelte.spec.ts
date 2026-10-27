import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import { Edition, ProjectDetail, ProjectEditorState, Timeline, VideoStyle } from '$lib/classes';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { Category, Style, StylesData } from '$lib/classes/VideoStyle.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import ExportVideo from '$lib/components/projectEditor/tabs/export/ExportVideo.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';

vi.mock('$lib/components/projectEditor/tabs/styleEditor/Style.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/export/ExportFolderPicker.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

describe('Export translation warning', () => {
	let edition: Edition;

	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		edition = new Edition('english', 'english', 'English', 'English', 'ltr', '', '', '', '');
		const projectTranslation = new ProjectTranslation();
		projectTranslation.addedTranslationEditions = [edition];
		const videoStyle = new VideoStyle();
		videoStyle.styles.push(
			new StylesData(edition.name, [
				new Category({
					id: 'general',
					styles: [new Style({ id: 'show-subtitles', value: true })]
				})
			])
		);
		const projectEditorState = new ProjectEditorState();
		projectEditorState.export.videoStartTime = 1000;
		projectEditorState.export.videoEndTime = 2000;
		globalState.currentProject = {
			projectEditorState,
			content: { projectTranslation, videoStyle, timeline: new Timeline([new SubtitleTrack()]) },
			detail: new ProjectDetail('Export test', 'Speaker')
		} as never;
	});

	afterEach(() => {
		cleanup();
		globalState.currentProject = null;
	});

	test.each([
		{ text: 'AI translation', status: 'ai translated', missing: false },
		{ text: 'Translation', status: 'to translate', missing: false },
		{ text: '', status: 'reviewed', missing: true },
		{ text: '   ', status: 'ai translated', missing: true },
		{ text: undefined, status: 'to translate', missing: true },
		{ text: '{{}}', status: 'reviewed', missing: true },
		{ text: '{{Translated quotation}}', status: 'ai translated', missing: false },
		{ text: '{{2:255}}', status: 'to translate', missing: false }
	] as const)(
		'checks rendered text, not status: $text / $status',
		async ({ text, status, missing }) => {
			const subtitle = new SubtitleClip(
				1000,
				2000,
				text?.includes('2:255') ? '{{2:255}}' : '{{quotation}}'
			);
			if (text !== undefined) {
				const translation = new VerseTranslation(text, status);
				translation.isStructuredTranslation = true;
				subtitle.translations[edition.name] = translation;
			}
			globalState.getProjectTranslation.versesTranslations[edition.name] = {
				'2:255': 'Quran translation'
			};
			globalState.getSubtitleTrack.clips.push(subtitle);
			const component = render(ExportVideo);
			await tick();
			expect(component.container.querySelector('[role="alert"]') !== null).toBe(missing);
			if (missing) {
				expect(component.container.textContent).toContain('1 translation(s) are missing');
			}
		}
	);

	test('counts only visible languages and subtitles overlapping the export range', async () => {
		globalState.getSubtitleTrack.clips.push(
			new SubtitleClip(0, 1000, 'Before'),
			new SubtitleClip(500, 1500, 'Overlapping'),
			new SubtitleClip(1500, 2000, 'Inside'),
			new SubtitleClip(2000, 3000, 'After')
		);
		const component = render(ExportVideo);
		await tick();
		expect(component.container.textContent).toContain('2 translation(s) are missing');

		globalState.getVideoStyle.getStylesOfTarget(edition.name).findStyle('show-subtitles')!.value =
			false;
		await tick();
		expect(component.container.querySelector('[role="alert"]')).toBeNull();

		globalState.getVideoStyle.getStylesOfTarget(edition.name).findStyle('show-subtitles')!.value =
			true;
		for (const subtitle of globalState.getSubtitleClips) {
			subtitle.translations[edition.name] = new VerseTranslation('Translation', 'ai translated');
		}
		await tick();
		expect(component.container.querySelector('[role="alert"]')).toBeNull();
	});
});
