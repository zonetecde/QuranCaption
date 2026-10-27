import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import { Edition, ProjectDetail, ProjectEditorState, Timeline, VideoStyle } from '$lib/classes';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import ProjectEditor from '$lib/components/projectEditor/ProjectEditor.svelte';
import { globalState } from '$lib/runes/main.svelte';

vi.mock('$lib/components/projectEditor/Navigator.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/ProjectSearchOverlay.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/videoEditor/VideoEditor.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesEditor.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock(
	'$lib/components/projectEditor/tabs/translationsEditor/TranslationsEditor.svelte',
	async () => ({
		default: (await import('../../../stubs/EmptyComponent.svelte')).default
	})
);
vi.mock('$lib/components/projectEditor/tabs/styleEditor/StyleEditor.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/export/Export.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));

describe('Project Quran translation loading', () => {
	let translations: ProjectTranslation;
	let subtitle: SubtitleClip;

	beforeEach(() => {
		translations = new ProjectTranslation();
		for (const language of ['English', 'French']) {
			const edition = new Edition(
				language,
				language,
				language,
				language,
				'ltr',
				'test',
				'',
				'',
				''
			);
			translations.addedTranslationEditions.push(
				new Edition(
					`language-${language}`,
					`language-${language}`,
					language,
					language,
					'ltr',
					'project-language',
					'',
					'',
					'',
					true,
					edition
				)
			);
		}
		subtitle = new SubtitleClip(0, 1000, 'Source');
		subtitle.translations = translations.createTranslationsForSubtitleText(subtitle.text);
		for (const language of translations.addedTranslationEditions) {
			subtitle.translations[language.name].text = 'Existing AI translation';
			subtitle.translations[language.name].status = 'ai translated';
		}
		const track = new SubtitleTrack();
		track.clips.push(subtitle);
		globalState.currentProject = {
			projectEditorState: new ProjectEditorState(),
			content: {
				projectTranslation: translations,
				timeline: new Timeline([track]),
				videoStyle: new VideoStyle()
			},
			detail: new ProjectDetail('Quran loading test', 'Speaker'),
			toJSON: () => ({})
		} as never;
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
	});

	test('loads added and edited references for every language without mounting the translations tab', async () => {
		const download = vi
			.spyOn(translations, 'downloadVerseTranslation')
			.mockImplementation(async (edition, surah, verse) => `${edition.language} ${surah}:${verse}`);
		render(ProjectEditor);
		await tick();
		expect(download).not.toHaveBeenCalled();

		subtitle.text = 'Source {{1:1}}';
		await vi.waitFor(() => {
			for (const language of translations.addedTranslationEditions) {
				expect(translations.versesTranslations[language.name]?.['1:1']).toBe(
					`${language.language} 1:1`
				);
				expect(
					translations.resolveStructuredTranslationText(
						language,
						subtitle,
						subtitle.translations[language.name] as VerseTranslation
					)
				).toBe(`Existing AI translation${language.language} 1:1`);
			}
		});

		subtitle.text = 'Source {{2:255:1-3}}';
		await vi.waitFor(() => {
			for (const language of translations.addedTranslationEditions) {
				expect(translations.versesTranslations[language.name]?.['2:255']).toBe(
					`${language.language} 2:255`
				);
				expect(translations.versesTranslations[language.name]?.['1:1']).toBe(
					`${language.language} 1:1`
				);
				expect(subtitle.translations[language.name].text).toBe('Existing AI translation');
				expect(subtitle.translations[language.name].status).toBe('ai translated');
			}
		});
		const completedCalls = download.mock.calls.length;
		subtitle.text += ' {{2:255:4-5}}';
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(download).toHaveBeenCalledTimes(completedCalls);
	});

	test('discards a pending response after closing the project', async () => {
		let finish!: (value: string) => void;
		const response = new Promise<string>((resolve) => {
			finish = resolve;
		});
		const download = vi.spyOn(translations, 'downloadVerseTranslation').mockReturnValue(response);
		subtitle.text = '{{1:1}}';
		render(ProjectEditor);
		await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
		cleanup();
		globalState.currentProject = null;
		finish('Late translation');
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(translations.versesTranslations).toEqual({});
	});
});
