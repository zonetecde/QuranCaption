import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { get } from 'svelte/store';
import StepExistingSubtitles from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/steps/StepExistingSubtitles.svelte';
import { useAutoSegmentationWizard } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/useAutoSegmentationWizard.svelte';
import { setSharedWizard } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/sharedWizard';
import {
	Project,
	ProjectContent,
	ProjectDetail,
	SubtitleClip,
	Timeline,
	TrackType
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { globalState } from '$lib/runes/main.svelte';
import LL, { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';

describe('JSON subtitle import modes', () => {
	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		const track = new SubtitleTrack();
		track.clips = [new SubtitleClip(0, 4999, 1, 1, 0, 1, 'original', [], true, true)];
		globalState.currentProject = new Project(
			new ProjectDetail('Import', 'reciter'),
			new ProjectContent(new Timeline([track, new AssetTrack(TrackType.Audio)]))
		);
	});

	afterEach(() => {
		cleanup();
		setSharedWizard(null);
		globalState.currentProject = null;
	});

	test('allows append after a single existing subtitle in the JSON import view', async () => {
		const wizard = useAutoSegmentationWizard();
		setSharedWizard(wizard);
		expect(wizard.hasExistingSubtitles).toBe(true);
		expect(wizard.showExistingSubtitlesStep).toBe(false);
		expect(wizard.subtitleApplicationMode).toBe('replace');
		const component = render(StepExistingSubtitles, { isImport: true });
		const appendLabel = Reflect.get(get(LL).editor, 'appendImportedSubtitles') as () => string;
		const append = component.getByRole('button', { name: appendLabel(), exact: false });
		await append.click();
		expect(wizard.subtitleApplicationMode).toBe('append');
		await expect.element(append).toHaveClass('bg-accent');
	});

	test('keeps append out of the regular segmentation choices', () => {
		setSharedWizard(useAutoSegmentationWizard());
		const component = render(StepExistingSubtitles);
		expect(component.container.querySelectorAll('button')).toHaveLength(2);
	});
});
