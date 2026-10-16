import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Asset, AssetClip, Project, ProjectContent, ProjectDetail, Timeline } from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { TrackType } from '$lib/classes/enums';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import AudioEffectsModal from '$lib/components/modals/tools/AudioEffectsModal.svelte';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn()
}));
vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/plugin-fs')>()),
	exists: vi.fn(async () => false)
}));

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	initializeClassRegistry();
	vi.clearAllMocks();
	vi.spyOn(Asset.prototype, 'ensureDurationLoaded').mockResolvedValue(undefined);
	vi.mocked(invoke).mockResolvedValue(undefined);
	const asset = new Asset('C:/lecture/speaker.wav');
	const track = new AssetTrack(TrackType.Audio);
	const clip = new AssetClip(500, 1500, asset.id);
	clip.sourceStartTime = 2000;
	track.clips = [clip];
	globalState.currentProject = new Project(
		new ProjectDetail('Lecture', 'Speaker'),
		new ProjectContent(new Timeline([new SubtitleTrack(), track]), [asset])
	);
	ProjectHistoryManager.resetForCurrentProject();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	ProjectHistoryManager.clear();
	globalState.currentProject = null;
});

test('applies the chosen effect without changing clip timing and undoes the source replacement', async () => {
	const clip = globalState.getAudioTrack.clips[0] as AssetClip;
	const originalAssetId = clip.assetId;
	const close = vi.fn();
	const component = render(AudioEffectsModal, {
		close,
		initialClipId: clip.id,
		initialEffectId: 'clarity'
	});
	await component.getByRole('button', { name: 'Apply effect' }).click();
	await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
	expect(invoke).toHaveBeenCalledWith(
		'apply_audio_effect',
		expect.objectContaining({
			effect: 'clarity',
			sourcePath: 'C:/lecture/speaker.wav',
			primary: 80,
			secondary: 2
		})
	);
	expect(clip.assetId).not.toBe(originalAssetId);
	expect([clip.startTime, clip.endTime, clip.sourceStartTime]).toEqual([500, 1500, 2000]);
	expect(ProjectHistoryManager.undo()).toBe(true);
	expect((globalState.getAudioTrack.clips[0] as AssetClip).assetId).toBe(originalAssetId);
	expect(globalState.currentProject!.content.assets).toHaveLength(1);
});

test('discards a completed effect if the active project changed during processing', async () => {
	let finish!: () => void;
	vi.mocked(invoke).mockReturnValue(
		new Promise<void>((resolve) => {
			finish = resolve;
		})
	);
	const project = globalState.currentProject!;
	const clip = globalState.getAudioTrack.clips[0] as AssetClip;
	const originalAssetId = clip.assetId;
	const component = render(AudioEffectsModal, { close: vi.fn(), initialClipId: clip.id });
	await component.getByRole('button', { name: 'Apply effect' }).click();
	await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
	globalState.currentProject = new Project(
		new ProjectDetail('Another lecture', 'Another speaker'),
		new ProjectContent(new Timeline([new SubtitleTrack(), new AssetTrack(TrackType.Audio)]))
	);
	finish();
	await vi.waitFor(() => expect(Asset.prototype.ensureDurationLoaded).toHaveBeenCalled());
	expect(clip.assetId).toBe(originalAssetId);
	expect(project.content.assets).toHaveLength(1);
	expect(globalState.currentProject.content.assets).toHaveLength(0);
});
