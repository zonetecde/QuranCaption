import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
	Asset,
	AssetClip,
	AssetType,
	Duration,
	Project,
	ProjectContent,
	ProjectDetail,
	Timeline,
	TrackType
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import TimelineClip from '$lib/components/projectEditor/timeline/track/Clip.svelte';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	convertFileSrc: (path: string) => path,
	invoke: vi.fn(async () => undefined)
}));

const originalProject = globalState.currentProject;

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	const timeline = new Timeline([
		new AssetTrack(TrackType.Video),
		new AssetTrack(TrackType.Audio),
		new SubtitleTrack()
	]);
	globalState.currentProject = new Project(
		new ProjectDetail('Trim test', ''),
		new ProjectContent(timeline)
	);
	globalState.getTimelineState.zoom = 1000;
});

afterEach(() => {
	cleanup();
	globalState.currentProject = originalProject;
	ProjectHistoryManager.resetForCurrentProject();
});

it.each([TrackType.Video, TrackType.Audio])(
	'keeps both source ranges aligned when trimming a clip on the %s track',
	async (trackType) => {
		const asset = new Asset();
		asset.id = 42;
		asset.type = AssetType.Video;
		asset.duration = new Duration(5000);
		globalState.currentProject!.content.assets.push(asset);

		const video = new AssetClip(500, 2500, asset.id);
		const audio = new AssetClip(500, 2500, asset.id);
		audio.sourceStartTime = video.sourceStartTime = 200;
		globalState.getVideoTrack.clips = [
			new AssetClip(0, 499, asset.id),
			video,
			new AssetClip(2801, 3400, asset.id)
		];
		globalState.getAudioTrack.clips = [audio];
		ProjectHistoryManager.resetForCurrentProject();

		const isVideo = trackType === TrackType.Video;
		const track = isVideo ? globalState.getVideoTrack : globalState.getAudioTrack;
		const component = render(TimelineClip, {
			track,
			clip: isVideo ? video : audio,
			clipIndex: isVideo ? 1 : 0,
			thumbnailRangeStartMs: 0,
			thumbnailRangeEndMs: 0
		});
		const [left, right] = Array.from(component.container.querySelectorAll('.asset-trim-handle'));
		left.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 500 }));
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
		expect(video.startTime).toBe(500);
		expect(audio.startTime).toBe(500);
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }));
		document.dispatchEvent(new MouseEvent('mouseup'));
		expect(video).toMatchObject({ startTime: 800, duration: 1700, sourceStartTime: 500 });
		expect(audio).toMatchObject({ startTime: 800, duration: 1700, sourceStartTime: 500 });

		right.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 2500 }));
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 3100 }));
		document.dispatchEvent(new MouseEvent('mouseup'));
		expect(video).toMatchObject({ endTime: 2800, duration: 2000, sourceStartTime: 500 });
		expect(audio).toMatchObject({ endTime: 2800, duration: 2000, sourceStartTime: 500 });

		await component.unmount();
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getVideoTrack.clips[1].endTime).toBe(2500);
		expect(globalState.getAudioTrack.clips[0].endTime).toBe(2500);
	}
);
