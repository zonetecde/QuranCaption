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
	globalState.currentProject = { projectEditorState, content } as never;
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
