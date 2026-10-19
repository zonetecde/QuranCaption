import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import StepSettings from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/steps/StepSettings.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { tick } from 'svelte';
import StepExistingSubtitles from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/steps/StepExistingSubtitles.svelte';
import { useAutoSegmentationWizard } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/useAutoSegmentationWizard.svelte';
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
		vi.spyOn(Settings, 'save').mockResolvedValue(undefined);
		globalState.settings = new Settings();
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
		vi.restoreAllMocks();
		globalState.shared.autoSegmentationWizard = null;
		globalState.currentProject = null;
	});

	test('allows append after a single existing subtitle in the JSON import view', async () => {
		const wizard = useAutoSegmentationWizard(() => '{}');
		expect(wizard.showExistingSubtitlesStep).toBe(true);
		expect(wizard.subtitleApplicationMode).toBe('replace');
		const component = render(StepExistingSubtitles, {
			target: document.body.appendChild(document.createElement('div')),
			props: { isImport: true },
			context: new Map([[Symbol.for('qurancaption.auto-segmentation-wizard'), wizard]])
		});
		const appendLabel = Reflect.get(get(LL).editor, 'appendImportedSubtitles') as () => string;
		const append = component.getByRole('button', { name: appendLabel(), exact: false });
		await append.click();
		expect(wizard.subtitleApplicationMode).toBe('append');
		await expect.element(append).toHaveClass('bg-accent');
	});

	test('keeps append out of the regular segmentation choices', () => {
		const component = render(StepExistingSubtitles, {
			target: document.body.appendChild(document.createElement('div')),
			context: new Map([
				[Symbol.for('qurancaption.auto-segmentation-wizard'), useAutoSegmentationWizard()]
			])
		});
		expect(component.container.querySelectorAll('button')).toHaveLength(2);
	});
	test('shows cloud models, device, reading and boundaries without legacy timing controls', async () => {
		const wizard = useAutoSegmentationWizard();
		const component = render(StepSettings, {
			target: document.body.appendChild(document.createElement('div')),
			context: new Map([[Symbol.for('qurancaption.auto-segmentation-wizard'), wizard]])
		});
		expect(component.container.querySelector('#min-silence-range')).toBeNull();
		expect(component.container.querySelector('#min-speech-range')).toBeNull();
		expect(component.container.querySelector('#pad-range')).toBeNull();
		expect(component.container.querySelector('input[type="range"]')).toBeNull();
		const selectors = component.container.querySelectorAll('select');
		expect(selectors).toHaveLength(3);
		for (const [index, value] of [
			[0, 'Large'],
			[1, 'CPU'],
			[2, 'warsh']
		] as const) {
			selectors[index].value = value;
			selectors[index].dispatchEvent(new Event('change', { bubbles: true }));
		}
		await tick();
		expect(wizard.selection).toMatchObject({
			cloudModel: 'Large',
			device: 'CPU',
			riwayah: 'warsh'
		});
		expect(globalState.settings!.autoSegmentationSettings).toMatchObject({
			cloudModel: 'Large',
			device: 'CPU',
			riwayah: 'warsh'
		});
	});
});
