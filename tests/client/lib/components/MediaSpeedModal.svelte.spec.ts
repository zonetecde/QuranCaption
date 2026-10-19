import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class AssetClip {
		id = 11;
		assetId = 1;
		startTime = 2000;
		endTime = 8000;
		duration = 6000;
		sourceStartTime = 3000;
	}
	class Asset {
		id = 2;
		duration = { ms: 12000 };
		/** @param {string} filePath Generated media path. */
		constructor(public filePath: string) {}
		/** @returns {Promise<void>} Completion of duration loading. */
		async ensureDurationLoaded(): Promise<void> {}
	}
	class SubtitleClip {
		startTime = 3500;
		endTime = 6500;
		duration = 3000;
		alignmentMetadata = {
			timeFrom: 3.5,
			timeTo: 6.5,
			words: [{ location: '1:1:1', start: 0.3, end: 1.2 }]
		};
	}
	const clip = new AssetClip();
	const source = {
		id: 1,
		fileName: 'recitation.mp4',
		filePath: 'C:/recitation.mp4',
		type: 'Video'
	};
	const project = {
		content: {
			assets: [source],
			timeline: {
				tracks: [
					{ type: 'Audio', clips: [clip] },
					{ type: 'Subtitle', clips: [] as SubtitleClip[] },
					{ type: 'Video', clips: [] as AssetClip[] }
				],
				getLongestTrackDurationIgnoringLoopedVideo: vi.fn(() => ({ ms: 12000 }))
			}
		},
		detail: { updateVideoDetailAttributes: vi.fn() }
	};
	return {
		Asset,
		AssetClip,
		SubtitleClip,
		clip,
		source,
		project,
		invoke: vi.fn(),
		exists: vi.fn(),
		track: vi.fn((_label: string, mutate: () => void) => mutate()),
		updateVideoPreviewUI: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		refreshSegmentationContext: vi.fn()
	};
});

vi.mock('$lib/classes', () => ({
	Asset: mocks.Asset,
	AssetClip: mocks.AssetClip,
	SubtitleClip: mocks.SubtitleClip,
	PredefinedSubtitleClip: mocks.SubtitleClip,
	AssetType: { Audio: 'Audio', Video: 'Video' },
	TrackType: { Audio: 'Audio', Video: 'Video', Subtitle: 'Subtitle' }
}));
vi.mock('$lib/runes/main.svelte', () => ({
	globalState: {
		currentProject: mocks.project,
		updateVideoPreviewUI: mocks.updateVideoPreviewUI
	}
}));
vi.mock('$lib/services/undoRedo/ProjectHistoryManager', () => ({
	ProjectHistoryManager: { track: mocks.track }
}));
vi.mock('$lib/services/autoSegmentation/context', () => ({
	refreshSegmentationContextFromTrack: mocks.refreshSegmentationContext
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: mocks.exists }));
vi.mock('svelte-5-french-toast', () => ({
	default: { success: mocks.success, error: mocks.error }
}));

import MediaSpeedModal from '$lib/components/modals/tools/MediaSpeedModal.svelte';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';

describe('media speed tool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadLocale('en');
		setLocale('en');
		Object.assign(mocks.clip, new mocks.AssetClip());
		Object.assign(mocks.source, {
			fileName: 'recitation.mp4',
			filePath: 'C:/recitation.mp4',
			type: 'Video'
		});
		mocks.project.content.assets = [mocks.source];
		mocks.project.content.timeline.tracks[0].clips = [mocks.clip];
		mocks.project.content.timeline.tracks[0].type = 'Audio';
		mocks.project.content.timeline.tracks[1].clips = [];
		mocks.exists.mockResolvedValue(false);
		mocks.invoke.mockResolvedValue(undefined);
	});
	afterEach(cleanup);

	test.each([-2, -1.75, -1.5, -1.25, 1.25, 1.5, 1.75, 2])(
		'applies the exact speed of preset %s',
		async (preset) => {
			const close = vi.fn();
			const { container } = render(MediaSpeedModal, { initialClipId: 11, close });
			const label = `${preset < 0 ? '−' : '+'}${Math.abs(preset)}×`;
			const button = Array.from(container.querySelectorAll('button')).find(
				(button) => button.textContent?.trim() === label
			);
			expect(button).toBeDefined();
			button!.click();
			const rate = preset < 0 ? 1 / Math.abs(preset) : preset;
			await vi.waitFor(() =>
				expect(container.querySelector('output')?.textContent).toBe(`${rate.toFixed(2)}×`)
			);
			expect(container.querySelector('input[type="range"]')?.getAttribute('step')).toBe('0.1');
			expect(button!.getAttribute('aria-pressed')).toBe('true');
			container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
			await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
			expect(mocks.invoke.mock.calls[0][1].rate).toBeCloseTo(rate, 12);
		}
	);

	test.each([
		{ adapt: false, speed: 3 },
		{ adapt: true, speed: 3 },
		{ adapt: true, speed: -3 }
	])('optionally adapts subtitles and WBW for the main audio: %j', async ({ adapt, speed }) => {
		Object.assign(mocks.clip, { startTime: 500, endTime: 11500, duration: 11000 });
		const subtitle = new mocks.SubtitleClip();
		const before = Object.assign(new mocks.SubtitleClip(), {
			startTime: 0,
			endTime: 300,
			duration: 300,
			alignmentMetadata: { timeFrom: 0, timeTo: 0.3, words: [] }
		});
		const after = Object.assign(new mocks.SubtitleClip(), {
			startTime: 11600,
			endTime: 12000,
			duration: 400,
			alignmentMetadata: { timeFrom: 11.6, timeTo: 12, words: [] }
		});
		mocks.project.content.timeline.tracks[1].clips = [before, subtitle, after];
		const close = vi.fn();
		const { container } = render(MediaSpeedModal, { initialClipId: 11, close });
		await vi.waitFor(() =>
			expect(container.querySelector('input[type="checkbox"]')).not.toBeNull()
		);
		const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
		expect(checkbox.checked).toBe(false);
		if (adapt) checkbox.click();
		const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
		slider.value = String(speed);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.waitFor(() =>
			expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
				false
			)
		);
		container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		const rate = 3 ** (speed / 3);
		expect(subtitle.startTime).toBe(adapt ? Math.round(500 + 3000 / rate) : 3500);
		expect(subtitle.endTime).toBe(adapt ? Math.round(500 + 6000 / rate) : 6500);
		expect(subtitle.duration).toBe(adapt ? Math.round(3000 / rate) : 3000);
		expect(subtitle.alignmentMetadata.timeFrom).toBe(subtitle.startTime / 1000);
		expect(subtitle.alignmentMetadata.timeTo).toBe(subtitle.endTime / 1000);
		expect(subtitle.alignmentMetadata.words[0].start).toBeCloseTo(adapt ? 0.3 / rate : 0.3);
		expect(subtitle.alignmentMetadata.words[0].end).toBeCloseTo(adapt ? 1.2 / rate : 1.2);
		expect(before.startTime).toBe(0);
		expect(before.endTime).toBe(300);
		const shift = adapt ? Math.round(11000 / rate) - 11000 : 0;
		expect(after.startTime).toBe(11600 + shift);
		expect(after.endTime).toBe(12000 + shift);
		expect(mocks.track).toHaveBeenCalledOnce();
		expect(mocks.refreshSegmentationContext).toHaveBeenCalledTimes(adapt ? 1 : 0);
	});

	test.each(['short-audio', 'video', 'asset', 'no-subtitles'])(
		'does not offer subtitle adaptation for %s',
		async (scenario) => {
			mocks.project.content.timeline.tracks[1].clips = [new mocks.SubtitleClip()];
			if (scenario !== 'short-audio')
				Object.assign(mocks.clip, { startTime: 0, endTime: 12000, duration: 12000 });
			if (scenario === 'video') mocks.project.content.timeline.tracks[0].type = 'Video';
			if (scenario === 'no-subtitles') mocks.project.content.timeline.tracks[1].clips = [];
			const { container } = render(MediaSpeedModal, {
				initialClipId: scenario === 'asset' ? 0 : 11,
				close: vi.fn()
			});
			if (scenario === 'asset') {
				const select = container.querySelector('select')!;
				select.value = 'asset:1';
				select.dispatchEvent(new Event('change', { bubbles: true }));
			}
			await vi.waitFor(() => expect(container.querySelector('output')?.textContent).toBe('1.00×'));
			expect(container.querySelector('input[type="checkbox"]')).toBeNull();
		}
	);

	test.each(['en', 'fr', 'ar', 'de', 'es', 'id', 'zh'] as const)(
		'provides localized speed controls in %s',
		(locale) => {
			loadLocale(locale);
			setLocale(locale);
			Object.assign(mocks.clip, { startTime: 0, endTime: 12000, duration: 12000 });
			mocks.project.content.timeline.tracks[1].clips = [new mocks.SubtitleClip()];
			const { container } = render(MediaSpeedModal, { initialClipId: 11, close: vi.fn() });
			expect(container.querySelector('h2')?.textContent?.trim().length).toBeGreaterThan(0);
			expect(container.querySelector('input')?.min).toBe('-3');
			expect(container.querySelector('input')?.max).toBe('3');
			expect(container.querySelector('input')?.value).toBe('0');
			expect(container.querySelector('output')?.textContent).toBe('1.00×');
			expect(
				container.querySelector('input[type="checkbox"]')?.closest('label')?.textContent?.trim()
					.length
			).toBeGreaterThan(0);
			expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
				true
			);
		}
	);

	test('adds a speed-adjusted audio asset without changing timeline clips', async () => {
		Object.assign(mocks.source, {
			fileName: 'recitation.wav',
			filePath: 'C:/recitation.wav',
			type: 'Audio'
		});
		mocks.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		const close = vi.fn();
		const { container } = render(MediaSpeedModal, { close });
		const select = container.querySelector('select')!;
		select.value = 'asset:1';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		const slider = container.querySelector('input')!;
		slider.value = '3';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.waitFor(() =>
			expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
				false
			)
		);
		container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith('change_media_speed', {
			sourcePath: 'C:/recitation.wav',
			outputPath: 'C:/recitation_speed_2.wav',
			rate: 3,
			isVideo: false
		});
		expect(mocks.clip.assetId).toBe(1);
		expect(mocks.clip.duration).toBe(6000);
		expect(mocks.project.content.assets).toHaveLength(2);
		expect(mocks.track).toHaveBeenCalledOnce();
	});

	test.each([-3, 3])('applies slider value %s to the selected clip and its trim', async (value) => {
		const close = vi.fn();
		const { container } = render(MediaSpeedModal, { initialClipId: 11, close });
		const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
		slider.value = String(value);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.waitFor(() =>
			expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
				false
			)
		);
		container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

		const rate = 3 ** (value / 3);
		expect(mocks.invoke).toHaveBeenCalledWith('change_media_speed', {
			sourcePath: mocks.source.filePath,
			outputPath: 'C:/recitation_speed_1.mp4',
			rate,
			isVideo: true
		});
		expect(mocks.track).toHaveBeenCalledOnce();
		expect(mocks.clip.assetId).toBe(2);
		expect(mocks.clip.startTime).toBe(2000);
		expect(mocks.clip.sourceStartTime).toBe(Math.round(3000 / rate));
		expect(mocks.clip.duration).toBe(Math.round(6000 / rate));
		expect(mocks.clip.endTime).toBe(2000 + Math.round(6000 / rate));
		expect(mocks.project.content.assets).toHaveLength(2);
	});

	test('keeps the project unchanged when processing fails', async () => {
		mocks.invoke.mockRejectedValueOnce(new Error('FFmpeg failed'));
		const close = vi.fn();
		const { container } = render(MediaSpeedModal, { initialClipId: 11, close });
		const slider = container.querySelector('input')!;
		slider.value = '3';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.waitFor(() =>
			expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
				false
			)
		);
		container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
		await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
		expect(mocks.track).not.toHaveBeenCalled();
		expect(mocks.clip.assetId).toBe(1);
		expect(mocks.project.content.assets).toHaveLength(1);
		expect(close).not.toHaveBeenCalled();
	});
});
