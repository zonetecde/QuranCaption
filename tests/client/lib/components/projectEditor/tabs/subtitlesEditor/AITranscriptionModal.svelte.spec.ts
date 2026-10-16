import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, expect, test, vi } from 'vitest';
import AITranscriptionModal from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/AITranscriptionModal.svelte';
import { Project, ProjectContent, ProjectDetail, Timeline } from '$lib/classes';
import { SubtitleClip, AssetClip } from '$lib/classes/Clip.svelte';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { TrackType } from '$lib/classes/enums';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import type { AITranscriptionResult } from '$lib/types/transcription';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('$lib/services/autoSegmentation/audio', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/autoSegmentation/audio')>()),
	getAutoSegmentationAudioClips: () => [{ filePath: 'audio.wav', startMs: 0, endMs: 2000 }]
}));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn(async (command: string) =>
		command === 'quran_auth_secure_get'
			? 'test-key'
			: {
					language: 'ar',
					device: 'groq',
					model: 'test',
					speakers: ['voice-1'],
					wordTimestampsAvailable: true,
					segments: [
						{
							start: 0.5,
							end: 1.5,
							text: 'Lecture text',
							speaker: 'voice-1',
							words: [
								{ word: 'Lecture', start: 0.5, end: 1 },
								{ word: 'text', start: 1, end: 1.5 }
							]
						}
					]
				}
	),
	convertFileSrc: (path: string) => path
}));
vi.mock('$lib/services/AITranscriptCleanup', () => ({
	estimateTranscriptCleanupBatchCount: () => 0,
	cleanupAITranscript: vi.fn(async (result: AITranscriptionResult) => ({
		result,
		errors: [],
		processedSegments: 1,
		totalSegments: 1,
		quranPassages: 0,
		quotePassages: 0,
		correctionsApplied: 0,
		analyses: [],
		nextBatchIndex: 0,
		totalBatches: 0,
		paused: false
	}))
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	globalState.currentProject = null;
});

test('runs the vocal session and keeps Minbar clip identity while confirming speaker names', async () => {
	loadLocale('en');
	setLocale('en');
	initializeClassRegistry();
	const audio = new AssetTrack(TrackType.Audio);
	audio.clips = [new AssetClip(0, 2000, 1)];
	const project = new Project(
		new ProjectDetail('Lecture', 'Main speaker'),
		new ProjectContent(new Timeline([new SubtitleTrack(), audio]))
	);
	vi.spyOn(project, 'save').mockResolvedValue(undefined);
	globalState.currentProject = project;
	globalState.settings = new Settings();
	vi.spyOn(Settings, 'save').mockResolvedValue(undefined);
	globalState.settings.aiTranscriptionSettings.provider = 'groq';
	const component = render(AITranscriptionModal, { close: vi.fn() });
	await expect.element(component.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
	await component.getByRole('button', { name: 'Next', exact: true }).click();
	await component.getByRole('button', { name: 'Next', exact: true }).click();
	await component.getByRole('button', { name: 'Start transcription' }).click();
	await expect.element(component.getByText('Lecture text', { exact: true })).toBeVisible();
	const clip = globalState.getSubtitleClips[0];
	expect(clip).toBeInstanceOf(SubtitleClip);
	expect(clip).not.toHaveProperty('surah');
	const identity = { id: clip.id, start: clip.startTime, end: clip.endTime };
	await component.getByRole('button', { name: /Next$/ }).click();
	await expect.element(component.getByRole('button', { name: /Clean transcript$/ })).toBeVisible();
	expect(globalState.getSubtitleClips[0].id).toBe(identity.id);
	expect(globalState.getSubtitleClips[0].startTime).toBe(identity.start);
	expect(globalState.getSubtitleClips[0].endTime).toBe(identity.end);
});
