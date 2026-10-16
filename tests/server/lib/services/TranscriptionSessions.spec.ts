import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Project, ProjectContent, ProjectDetail, Timeline } from '$lib/classes';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { TrackType } from '$lib/classes/enums';
import Settings from '$lib/classes/Settings.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import {
	applyAITranscription,
	buildAITranscriptionFromSubtitleTrack
} from '$lib/services/AITranscription';
import {
	cleanupAITranscript,
	type TranscriptCleanupReport
} from '$lib/services/AITranscriptCleanup';
import { TranscriptCleanupSession } from '$lib/services/TranscriptCleanupSession.svelte';
import { TranscriptionRuntimeSession } from '$lib/services/TranscriptionRuntimeSession.svelte';
import Exporter from '$lib/classes/Exporter';
import ExportFileService from '$lib/services/ExportFileService';
import type { AITranscriptionResult } from '$lib/types/transcription';

const mocks = vi.hoisted(() => ({
	listen: vi.fn(),
	unlisten: vi.fn(),
	saveSettings: vi.fn(),
	transcribe: vi.fn()
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('$lib/services/AITranscriptCleanup', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/AITranscriptCleanup')>()),
	cleanupAITranscript: vi.fn()
}));
vi.mock('$lib/services/AITranscription', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/AITranscription')>()),
	saveAITranscriptionSettings: mocks.saveSettings,
	runAITranscription: mocks.transcribe
}));

/**
 * Crée un projet complet sans accès disque pour vérifier les mutations et l'historique.
 * @returns {Project} Projet possédant les pistes attendues par l'éditeur.
 */
function createProject(): Project {
	const project = new Project(
		new ProjectDetail('Lecture', 'Speaker'),
		new ProjectContent(new Timeline([new SubtitleTrack(), new AssetTrack(TrackType.Audio)]))
	);
	vi.spyOn(project, 'save').mockResolvedValue(undefined);
	return project;
}

/**
 * Fabrique un rapport de traitement sans faire appel à un fournisseur IA.
 * @param {AITranscriptionResult} result Transcription à renvoyer.
 * @returns {TranscriptCleanupReport} Rapport achevé.
 */
function reportFor(result: AITranscriptionResult): TranscriptCleanupReport {
	return {
		result,
		errors: [],
		processedSegments: result.segments.length,
		totalSegments: result.segments.length,
		quranPassages: 0,
		quotePassages: 0,
		correctionsApplied: 0,
		analyses: [],
		nextBatchIndex: 1,
		totalBatches: 1,
		paused: false
	};
}

describe('Project transcription application and sessions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		initializeClassRegistry();
		globalState.currentProject = createProject();
		globalState.settings = new Settings();
		globalState.settings.aiTranslationSettings.openAiApiKey = 'test-key';
		globalState.settings.aiTranslationSettings.textAiApiEndpoint = 'https://example.test/v1';
		globalState.settings.aiTranslationSettings.advancedTrimModel = 'test-model';
		mocks.listen.mockResolvedValue(mocks.unlisten);
		mocks.saveSettings.mockResolvedValue(undefined);
		vi.mocked(cleanupAITranscript).mockImplementation(async (result) => reportFor(result));
		ProjectHistoryManager.resetForCurrentProject();
	});

	it('preserves edited clip identity, translations, images and inline styles during cleanup', () => {
		const original = new SubtitleClip(500, 1500, 'Lecture', 'Speaker', {
			english: new VerseTranslation('My translation', 'reviewed')
		});
		original.associatedImagePath = 'image.png';
		original.hasBeenVerified = true;
		original.arabicInlineStyleRuns = [
			{
				startWordIndex: 0,
				endWordIndex: 0,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		];
		globalState.getSubtitleTrack.clips = [original];
		ProjectHistoryManager.resetForCurrentProject();
		const snapshot = buildAITranscriptionFromSubtitleTrack();
		applyAITranscription(snapshot.result, snapshot.speakerMap, false, snapshot.clipIds);
		const restored = globalState.getSubtitleClips[0];
		expect(restored.id).toBe(original.id);
		expect([restored.startTime, restored.endTime]).toEqual([500, 1500]);
		expect(restored.translations.english.text).toBe('My translation');
		expect(restored.translations.english.status).toBe('reviewed');
		expect(restored.translations.english).not.toBe(original.translations.english);
		expect(restored.associatedImagePath).toBe('image.png');
		expect(restored.arabicInlineStyleRuns).toEqual(original.arabicInlineStyleRuns);
		expect(restored.hasBeenVerified).toBe(true);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleClips[0].translations.english.text).toBe('My translation');
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitleClips[0].id).toBe(original.id);
	});

	it('keeps an existing translation available for review when cleanup corrects the source text', () => {
		const original = new SubtitleClip(500, 1500, 'Old text', 'Speaker', {
			english: new VerseTranslation('Authored translation', 'reviewed')
		});
		globalState.getSubtitleTrack.clips = [original];
		const snapshot = buildAITranscriptionFromSubtitleTrack();
		snapshot.result.segments[0].text = 'Corrected text';
		applyAITranscription(snapshot.result, snapshot.speakerMap, false, snapshot.clipIds);
		expect(globalState.getSubtitleClips[0].translations.english.text).toBe('Authored translation');
		expect(globalState.getSubtitleClips[0].translations.english.status).toBe('to review');
	});

	it('undoes and redoes subtitle bounds, word alignment and verification as one edit', () => {
		const original = new SubtitleClip(0, 2000, 'Two words', 'Speaker', {}, true, 0.9, {
			source: 'local',
			timeFrom: 0,
			timeTo: 2,
			words: [
				{ word: 'Two', start: 0, end: 1 },
				{ word: 'words', start: 1, end: 2 }
			]
		});
		original.hasBeenVerified = true;
		globalState.getSubtitleTrack.clips = [original];
		ProjectHistoryManager.resetForCurrentProject();
		original.setStartTime(500);
		expect(original.alignmentMetadata?.timeFrom).toBe(0.5);
		expect(original.hasBeenVerified).toBe(false);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleClips[0].startTime).toBe(0);
		expect(globalState.getSubtitleClips[0].hasBeenVerified).toBe(true);
		expect(ProjectHistoryManager.redo()).toBe(true);
		const redone = globalState.getSubtitleClips[0];
		expect(redone.startTime).toBe(500);
		expect(redone.alignmentMetadata?.timeFrom).toBe(0.5);
		expect(redone.alignmentMetadata?.words.at(-1)?.end).toBe(1.5);
		expect(redone.hasBeenVerified).toBe(false);
	});

	it('rejects a result that belongs to a different project', () => {
		const owner = globalState.currentProject!;
		const snapshot = buildAITranscriptionFromSubtitleTrack();
		globalState.currentProject = createProject();
		expect(() => applyAITranscription(snapshot.result, {}, true, [], owner)).toThrow();
		expect(globalState.getSubtitleClips).toHaveLength(0);
	});

	it('exports ordinary Minbar subtitles without invented Quran references', async () => {
		globalState.getSubtitleTrack.clips = [new SubtitleClip(0, 1000, 'Ordinary lecture', 'Speaker')];
		const save = vi.spyOn(ExportFileService, 'saveTextFile').mockResolvedValue('export.json');
		vi.spyOn(ExportFileService, 'getProjectNameForFile').mockReturnValue('lecture');
		await Exporter.exportSubtitlesJson();
		const exported = JSON.parse(save.mock.calls[0][1]);
		expect(exported.segments[0].speaker).toBe('Speaker');
		expect(exported.segments[0].wordCount).toBe(2);
		expect(exported.segments[0]).not.toHaveProperty('surah');
		expect(exported.segments[0]).not.toHaveProperty('verseKey');
		expect(exported.segments[0].words[0]).not.toHaveProperty('location');
		save.mockRestore();
	});

	it('applies a successful vocal result through its owning project session', async () => {
		globalState.getSubtitleTrack.clips = [new SubtitleClip(500, 1500, 'New transcript', 'voice-1')];
		const source = buildAITranscriptionFromSubtitleTrack().result;
		delete source.segments[0].clipId;
		globalState.getSubtitleTrack.clips = [];
		mocks.transcribe.mockResolvedValueOnce(source);
		const session = new TranscriptCleanupSession(
			globalState.currentProject!,
			globalState.settings!.aiTranscriptionSettings
		);
		const runtime = new TranscriptionRuntimeSession(
			globalState.settings!.aiTranscriptionSettings,
			session
		);
		expect(await runtime.startTranscription('key')).toBe(true);
		expect(runtime.running).toBe(false);
		expect(globalState.getSubtitleClips[0].text).toBe('New transcript');
		expect(globalState.getSubtitleClips[0]).not.toHaveProperty('surah');
		expect(session.appliedClipIds).toContain(globalState.getSubtitleClips[0].id);
		expect(globalState.currentProject!.save).toHaveBeenCalledOnce();
		expect(mocks.unlisten).toHaveBeenCalledOnce();
	});

	it('persists a pause checkpoint and resumes without changing authored clip identities', async () => {
		const original = new SubtitleClip(500, 1500, 'Authored transcript', 'Speaker');
		globalState.getSubtitleTrack.clips = [original];
		const session = new TranscriptCleanupSession(
			globalState.currentProject!,
			globalState.settings!.aiTranscriptionSettings
		);
		session.initializeCleanupOnly();
		const paused = {
			...reportFor(session.result!),
			paused: true,
			nextBatchIndex: 1,
			totalBatches: 2
		};
		vi.mocked(cleanupAITranscript).mockResolvedValueOnce(paused);
		await session.startTranscriptCleanup();
		expect(globalState.getSubtitlesEditorState.aiTranscriptCleanup?.nextBatchIndex).toBe(1);
		await session.startTranscriptCleanup();
		expect(vi.mocked(cleanupAITranscript).mock.calls[1][1].resume?.nextBatchIndex).toBe(1);
		expect(session.cleanupCompleted).toBe(true);
		expect(globalState.getSubtitlesEditorState.aiTranscriptCleanup).toBeNull();
		expect(globalState.getSubtitleClips[0].id).toBe(original.id);
	});

	it('clears the running state when saving settings fails before transcription starts', async () => {
		mocks.saveSettings.mockRejectedValueOnce(new Error('Settings unavailable'));
		const session = new TranscriptCleanupSession(
			globalState.currentProject!,
			globalState.settings!.aiTranscriptionSettings
		);
		const runtime = new TranscriptionRuntimeSession(
			globalState.settings!.aiTranscriptionSettings,
			session
		);
		expect(await runtime.startTranscription('key')).toBe(false);
		expect(runtime.running).toBe(false);
		expect(session.errorMessage).toBe('Settings unavailable');
		expect(mocks.transcribe).not.toHaveBeenCalled();
	});

	it('clears the installation state when subscribing to progress fails', async () => {
		mocks.listen.mockRejectedValueOnce(new Error('Events unavailable'));
		const session = new TranscriptCleanupSession(
			globalState.currentProject!,
			globalState.settings!.aiTranscriptionSettings
		);
		const runtime = new TranscriptionRuntimeSession(
			globalState.settings!.aiTranscriptionSettings,
			session
		);
		expect(await runtime.installRuntime()).toBe(false);
		expect(runtime.installing).toBe(false);
		expect(session.errorMessage).toBe('Events unavailable');
	});

	it('unsubscribes an event subscription that finishes opening after disposal', async () => {
		let open!: (unlisten: () => void) => void;
		mocks.listen.mockReturnValueOnce(
			new Promise<() => void>((resolve) => {
				open = resolve;
			})
		);
		const session = new TranscriptCleanupSession(
			globalState.currentProject!,
			globalState.settings!.aiTranscriptionSettings
		);
		const subscription = session.subscribe('progress', () => {});
		const rejected = expect(subscription).rejects.toThrow();
		session.dispose();
		open(mocks.unlisten);
		await rejected;
		expect(mocks.unlisten).toHaveBeenCalledOnce();
	});

	it('does not apply a cleanup response after its project session is disposed', async () => {
		globalState.getSubtitleTrack.clips = [new SubtitleClip(0, 1000, 'Original', 'Speaker')];
		let finish!: (report: TranscriptCleanupReport) => void;
		vi.mocked(cleanupAITranscript).mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		const session = new TranscriptCleanupSession(
			globalState.currentProject!,
			globalState.settings!.aiTranscriptionSettings
		);
		session.initializeCleanupOnly();
		const run = session.startTranscriptCleanup();
		await vi.waitFor(() => expect(cleanupAITranscript).toHaveBeenCalledOnce());
		const result = {
			...session.result!,
			segments: [{ ...session.result!.segments[0], text: 'Late correction' }]
		};
		session.dispose();
		finish(reportFor(result));
		await run;
		expect(globalState.getSubtitleClips[0].text).toBe('Original');
		expect(session.cleanupRunning).toBe(false);
		expect(mocks.unlisten).toHaveBeenCalledTimes(2);
	});
});
