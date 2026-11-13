import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { HowlOptions } from 'howler';
import toast from 'svelte-5-french-toast';
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
import Settings from '$lib/classes/Settings.svelte';
import { Category, Style, StylesData } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import VideoPreviewWorkspace from '$lib/components/projectEditor/videoPreview/VideoPreviewWorkspace.svelte';

const audio = vi.hoisted(() => ({ options: [] as HowlOptions[] }));
vi.mock('howler', () => ({
	Howl: vi.fn(function (options: HowlOptions) {
		audio.options.push(options);
		return {
			unload: vi.fn(),
			volume: vi.fn(),
			rate: vi.fn(),
			pause: vi.fn(),
			playing: vi.fn(() => false),
			seek: vi.fn(() => 0),
			once: vi.fn(),
			mute: vi.fn()
		};
	})
}));
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
	convertFileSrc: (path: string) => path
}));
vi.mock('svelte-5-french-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('$lib/services/ShortcutService', () => ({
	default: { registerShortcut: vi.fn(), unregisterShortcut: vi.fn() }
}));
vi.mock('$lib/components/projectEditor/videoPreview/VideoOverlay.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));

const originalSettings = globalState.settings;

/** Prépare un projet avec un MKV sur la piste audio, sans charger de fichier. @returns {Project} Projet testé. */
function createProject(): Project {
	const asset = new Asset();
	asset.id = 1;
	asset.fileName = 'recording.MKV';
	asset.filePath = '/recording.MKV';
	asset.type = AssetType.Video;
	asset.duration = new Duration(2000);
	const track = new AssetTrack(TrackType.Audio);
	track.clips = [new AssetClip(0, 2000, asset.id)];
	const project = new Project(
		new ProjectDetail('Preview', 'Reciter'),
		new ProjectContent(
			new Timeline([new AssetTrack(TrackType.Video), track, new SubtitleTrack()]),
			[asset]
		)
	);
	project.content.videoStyle.styles.push(
		new StylesData('global', [
			new Category({
				id: 'video',
				styles: [new Style({ id: 'video-dimension', value: { width: 1080, height: 1920 } })]
			})
		])
	);
	globalState.currentProject = project;
	return project;
}

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	audio.options.length = 0;
	vi.mocked(toast.error).mockClear();
	vi.mocked(invoke).mockImplementation(async (_command, args) => {
		if ((args as { action?: string })?.action === 'load')
			throw new Error('Unsupported native container');
		return undefined;
	});
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
});

test('lets the browser try MKV and reports load errors once per project across remounts', async () => {
	const project = createProject();
	const component = render(VideoPreviewWorkspace, { showControls: false });
	await expect.poll(() => audio.options.length).toBe(1);
	expect(audio.options[0].format).toEqual(['webm']);
	expect(toast.error).not.toHaveBeenCalled();
	audio.options[0].onloaderror!(1, 'No codec support for selected audio sources.');
	audio.options[0].onloaderror!(1, 'Another load failure');
	expect(toast.error).toHaveBeenCalledTimes(1);
	expect(toast.error).toHaveBeenLastCalledWith(expect.any(String), {
		id: `audio-preview-error-${project.detail.id}`,
		position: 'bottom-left'
	});
	component.unmount();
	const staleCallback = audio.options[0].onloaderror!;
	staleCallback(1, 'Late failure after unmount');
	expect(toast.error).toHaveBeenCalledTimes(1);
	const reloadedProject = createProject();
	reloadedProject.detail.id = project.detail.id;
	render(VideoPreviewWorkspace, { showControls: false });
	await expect.poll(() => audio.options.length).toBe(2);
	audio.options[1].onloaderror!(1, 'No codec support for selected audio sources.');
	expect(toast.error).toHaveBeenCalledTimes(1);
});

test('allows one notification for another project and ignores a destroyed player', async () => {
	createProject();
	const component = render(VideoPreviewWorkspace, { showControls: false });
	await expect.poll(() => audio.options.length).toBe(1);
	component.unmount();
	const nextProject = createProject();
	render(VideoPreviewWorkspace, { showControls: false });
	await expect.poll(() => audio.options.length).toBe(2);
	audio.options[0].onloaderror!(1, 'Late failure');
	expect(toast.error).not.toHaveBeenCalled();
	audio.options[1].onloaderror!(1, 'No codec support for selected audio sources.');
	expect(toast.error).toHaveBeenCalledOnce();
	expect(toast.error).toHaveBeenLastCalledWith(
		expect.any(String),
		expect.objectContaining({
			id: `audio-preview-error-${nextProject.detail.id}`,
			position: 'bottom-left'
		})
	);
});
