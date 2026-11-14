import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import VideoPreviewWorkspace from '$lib/components/projectEditor/videoPreview/VideoPreviewWorkspace.svelte';
import {
	Asset,
	AssetClip,
	AssetType,
	ProjectContent,
	ProjectEditorState,
	Style,
	Timeline,
	TrackType
} from '$lib/classes';
import { AssetTrack } from '$lib/classes/Track.svelte';
import { globalState } from '$lib/runes/main.svelte';
import toast from 'svelte-5-french-toast';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

vi.mock('svelte-5-french-toast', () => ({ default: { error: vi.fn() } }));

vi.mock('$lib/components/projectEditor/videoPreview/VideoOverlay.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn().mockResolvedValue(undefined),
	convertFileSrc: (path: string) => path
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	globalState.currentProject = null;
	globalState.uiState.showVideoPreview = true;
});

test('reloads replaced audio without switching tabs and keeps it loaded during cursor updates', async () => {
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android');
	vi.spyOn(globalState, 'getStyle').mockReturnValue(
		new Style({ id: 'video-dimension', value: { width: 1080, height: 1920 } })
	);
	const original = new Asset();
	original.id = 1;
	original.filePath = '/audio/original.mp3';
	original.type = AssetType.Audio;
	const replacement = new Asset();
	replacement.id = 2;
	replacement.filePath = '/audio/speed-2x.mp3';
	replacement.type = AssetType.Audio;
	const clip = new AssetClip(0, 10000, original.id);
	const audioTrack = new AssetTrack(TrackType.Audio);
	audioTrack.clips.push(clip);
	const projectEditorState = new ProjectEditorState();
	projectEditorState.timeline.cursorPosition = 1000;
	const content = new ProjectContent(new Timeline([audioTrack, new AssetTrack(TrackType.Video)]), [
		original,
		replacement
	]);
	globalState.currentProject = { detail: { id: 1 }, projectEditorState, content } as never;
	render(VideoPreviewWorkspace, { showControls: false });
	await tick();
	expect(invoke).toHaveBeenCalledWith(
		'native_audio_load',
		expect.objectContaining({ filePath: original.filePath })
	);
	vi.mocked(invoke).mockClear();
	const initialTab = projectEditorState.currentTab;
	const initialSeek = projectEditorState.timeline.movePreviewTo;

	clip.assetId = replacement.id;
	clip.duration = 5000;
	clip.endTime = 5000;
	await tick();
	expect(invoke).toHaveBeenCalledWith(
		'native_audio_load',
		expect.objectContaining({ filePath: replacement.filePath })
	);
	expect(projectEditorState.currentTab).toBe(initialTab);
	expect(projectEditorState.timeline.movePreviewTo).toBe(initialSeek);
	vi.mocked(invoke).mockClear();

	projectEditorState.timeline.cursorPosition = 1500;
	await tick();
	expect(
		vi.mocked(invoke).mock.calls.filter(([command]) => command === 'native_audio_load')
	).toEqual([]);

	clip.assetId = original.id;
	await tick();
	expect(invoke).toHaveBeenCalledWith(
		'native_audio_load',
		expect.objectContaining({ filePath: original.filePath })
	);
});

test('unloads hidden video and restores its cursor and speed without reloading audio', async () => {
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android');
	vi.spyOn(globalState, 'getStyle').mockReturnValue(
		new Style({ id: 'video-dimension', value: { width: 1080, height: 1920 } })
	);
	vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
	vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === 'get_local_media_url' ? '/video.mp4' : undefined
	);
	const audio = new Asset();
	audio.id = 1;
	audio.type = AssetType.Audio;
	audio.filePath = '/audio.mp3';
	const video = new Asset();
	video.id = 2;
	video.type = AssetType.Video;
	video.filePath = '/video.mp4';
	const audioTrack = new AssetTrack(TrackType.Audio);
	audioTrack.clips = [new AssetClip(0, 10000, audio.id)];
	const videoTrack = new AssetTrack(TrackType.Video);
	videoTrack.clips = [new AssetClip(0, 10000, video.id)];
	const projectEditorState = new ProjectEditorState();
	projectEditorState.timeline.cursorPosition = 1000;
	projectEditorState.videoPreview.playbackSpeed = 1.5;
	globalState.currentProject = {
		detail: { id: 2 },
		projectEditorState,
		content: new ProjectContent(new Timeline([audioTrack, videoTrack]), [audio, video])
	} as never;
	const { container } = render(VideoPreviewWorkspace, { showControls: false });
	await tick();
	const originalVideo = container.querySelector('video')!;
	expect(originalVideo).not.toBeNull();
	vi.mocked(invoke).mockClear();
	globalState.uiState.showVideoPreview = false;
	await tick();
	expect(container.querySelector('video')).toBeNull();
	expect(originalVideo.hasAttribute('src')).toBe(false);
	projectEditorState.timeline.cursorPosition = 2500;
	globalState.uiState.showVideoPreview = true;
	await tick();
	const restored = container.querySelector('video')!;
	restored.dispatchEvent(new Event('loadedmetadata'));
	expect(restored.currentTime).toBe(2.5);
	expect(restored.playbackRate).toBe(1.5);
	expect(
		vi.mocked(invoke).mock.calls.filter(([command]) => command === 'native_audio_load')
	).toEqual([]);
});

test('notifies native audio errors once per project and ignores stale loads', async () => {
	loadLocale('en');
	setLocale('en');
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android');
	vi.spyOn(globalState, 'getStyle').mockReturnValue(
		new Style({ id: 'video-dimension', value: { width: 1080, height: 1920 } })
	);
	let rejectLoad!: (error: Error) => void;
	vi.mocked(invoke).mockImplementation(async (command) => {
		if (command === 'native_audio_load')
			return new Promise((_resolve, reject) => {
				rejectLoad = reject;
			});
	});
	const audio = new Asset();
	audio.type = AssetType.Audio;
	audio.filePath = '/audio.mkv';
	const track = new AssetTrack(TrackType.Audio);
	track.clips = [new AssetClip(0, 10000, audio.id)];
	globalState.currentProject = {
		detail: { id: 3 },
		projectEditorState: new ProjectEditorState(),
		content: new ProjectContent(new Timeline([track, new AssetTrack(TrackType.Video)]), [audio])
	} as never;
	render(VideoPreviewWorkspace, { showControls: false });
	await tick();
	const rejectStale = rejectLoad;
	audio.mediaReloadToken++;
	await tick();
	rejectStale(new Error('stale'));
	await tick();
	expect(toast.error).not.toHaveBeenCalled();
	rejectLoad(new Error('unsupported'));
	await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
	expect(toast.error).toHaveBeenCalledWith(expect.any(String), {
		id: 'audio-preview-error-3',
		position: 'bottom-left'
	});
	audio.mediaReloadToken++;
	await tick();
	rejectLoad(new Error('unsupported again'));
	await tick();
	expect(toast.error).toHaveBeenCalledOnce();
});
