import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import {
	Asset,
	AssetClip,
	Project,
	ProjectContent,
	ProjectDetail,
	SubtitleClip,
	SilenceClip,
	Timeline,
	TrackType
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import {
	buildSpeechSubtitles,
	normalizeSpeechWords,
	validateSpeechBoundaries,
	transcribeProjectAudio
} from '$lib/services/SpeechToTextService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('speech subtitle segmentation', () => {
	test('accepts only increasing boundaries covering every original word', () => {
		expect(validateSpeechBoundaries({ ends: [2, 5] }, 5)).toEqual([2, 5]);
		for (const ends of [[2, 2, 5], [3, 2, 5], [2, 4], [0, 5], ['2', 5], [6]]) {
			expect(() => validateSpeechBoundaries({ ends }, 5)).toThrow();
		}
	});

	test('preserves Arabic words and timings while enforcing word and duration limits', () => {
		const words = ['إن', 'مع', 'العسر', 'يسرا', 'إن', 'مع', 'العسر', 'يسرا'].map((word, i) => ({
			word,
			start: i,
			end: i + 0.8
		}));
		const segments = buildSpeechSubtitles(words, [4, 8], 3, 2);
		expect(segments.flatMap((segment) => segment.words)).toEqual(words);
		expect(
			segments.every((segment) => segment.words.length <= 3 && segment.end - segment.start <= 2)
		).toBe(true);
	});

	test('prefers punctuation and never cuts a prolonged sung word', () => {
		const words = [
			{ word: 'Un', start: 0, end: 0.2 },
			{ word: 'jour,', start: 0.2, end: 0.5 },
			{ word: 'tout', start: 0.5, end: 0.8 },
			{ word: 'ira', start: 0.8, end: 1 },
			{ word: 'bien', start: 1, end: 9 }
		];
		const segments = buildSpeechSubtitles(words, [5], 3, 6);
		expect(segments.map((segment) => segment.text)).toEqual(['Un jour,', 'tout ira', 'bien']);
		expect(segments[2].end).toBe(9);
	});

	test('uses word timestamps, ignores ElevenLabs spaces and retains punctuation', () => {
		expect(
			normalizeSpeechWords(
				{
					words: [
						{ text: 'Bonjour,', start: 0, end: 0.4, type: 'word' },
						{ text: ' ', start: 0.4, end: 0.5, type: 'spacing' },
						{ text: 'toi !', start: 0.5, end: 1, type: 'word' }
					]
				},
				10,
				2
			)
		).toEqual([
			{ word: 'Bonjour,', start: 10, end: 10.4 },
			{ word: 'toi !', start: 10.5, end: 11 }
		]);
	});

	test('rejects missing or invalid timings instead of silently discarding words', () => {
		expect(() => normalizeSpeechWords({ text: 'hello' }, 0, 2)).toThrow();
		expect(() =>
			normalizeSpeechWords({ words: [{ word: 'hello', start: -1, end: 1 }] }, 0, 2)
		).toThrow();
	});
});

describe('transcribing timeline audio', () => {
	let project: Project;
	let clip: AssetClip;
	let track: SubtitleTrack;
	const originalSettings = globalState.settings;

	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		initializeClassRegistry();
		const asset = new Asset();
		asset.id = 123;
		asset.filePath = '/audio.wav';
		const audio = new AssetTrack(TrackType.Audio);
		clip = new AssetClip(10_000, 14_000, asset.id);
		clip.sourceStartTime = 5000;
		audio.clips.push(clip);
		track = new SubtitleTrack();
		project = new Project(
			new ProjectDetail('Transcription test', 'speaker'),
			new ProjectContent(new Timeline([audio, track]), [asset])
		);
		globalState.currentProject = project;
		globalState.settings = new Settings();
		globalState.settings.speechToTextSettings.groqApiKey = 'test-groq-key';
		globalState.settings.speechToTextSettings.maxWords = 2;
		globalState.settings.speechToTextSettings.paddingBeforeMs = 0;
		globalState.settings.speechToTextSettings.paddingAfterMs = 0;
		vi.spyOn(project.detail, 'updateVideoDetailAttributes').mockImplementation(() => {});
		vi.spyOn(globalState, 'updateVideoPreviewUI').mockImplementation(() => {});
		ProjectHistoryManager.resetForCurrentProject();
		vi.mocked(invoke).mockResolvedValue({
			words: ['a', 'b', 'c', 'd'].map((word, i) => ({ word, start: i, end: i + 0.8 }))
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.mocked(invoke).mockReset();
		ProjectHistoryManager.clear();
		globalState.currentProject = null;
		globalState.settings = originalSettings;
	});

	test('imports subtitles and gap silences together without using text AI', async () => {
		project.projectEditorState.subtitlesEditor.completedAiSteps = {
			correction: true,
			rearrangement: true,
			references: true
		};
		const result = await transcribeProjectAudio(
			project,
			clip.id,
			{ ...globalState.settings!.speechToTextSettings },
			new AbortController().signal,
			vi.fn()
		);
		expect(result).toEqual({ count: 2 });
		expect(project.projectEditorState.subtitlesEditor.completedAiSteps).toEqual({
			correction: false,
			rearrangement: false,
			references: false
		});
		expect(vi.mocked(invoke).mock.calls[0]).toEqual([
			'transcribe_audio_chunk',
			{
				request: {
					sourcePath: '/audio.wav',
					startSeconds: 5,
					durationSeconds: 4,
					provider: 'groq',
					apiKey: 'test-groq-key',
					language: '',
					model: 'whisper-large-v3'
				}
			}
		]);
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(
			track.clips
				.filter((item) => item instanceof SubtitleClip)
				.map((item) => [item.startTime, item.endTime, (item as SubtitleClip).text])
		).toEqual([
			[10000, 11800, 'a b'],
			[12000, 13800, 'c d']
		]);
		expect(track.clips[0]).toBeInstanceOf(SilenceClip);
		expect([track.clips[0].startTime, track.clips[0].endTime]).toEqual([0, 9999]);
		expect(track.clips[2]).toBeInstanceOf(SilenceClip);
		expect([track.clips[2].startTime, track.clips[2].endTime]).toEqual([11801, 11999]);
		expect((track.clips[3] as SubtitleClip).alignmentMetadata!.words[0].start).toBe(0);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitlesEditorState.completedAiSteps.correction).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(0);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitlesEditorState.completedAiSteps.correction).toBe(false);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(4);
	});

	test('uses the ElevenLabs key and model independently of the Groq key', async () => {
		const options = {
			...globalState.settings!.speechToTextSettings,
			provider: 'elevenlabs' as const,
			elevenLabsApiKey: 'test-eleven-key'
		};
		await transcribeProjectAudio(project, clip.id, options, new AbortController().signal, vi.fn());
		expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
			request: {
				provider: 'elevenlabs',
				apiKey: 'test-eleven-key',
				model: 'scribe_v2'
			}
		});
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	test('adds 500 ms on each silent side and keeps padding in the transcription undo action', async () => {
		clip.endTime = 18000;
		vi.mocked(invoke).mockResolvedValue({
			words: [
				{ word: 'one', start: 1, end: 1.5 },
				{ word: 'two', start: 1.5, end: 2 },
				{ word: 'three', start: 4, end: 4.5 },
				{ word: 'four', start: 4.5, end: 5 }
			]
		});
		await transcribeProjectAudio(
			project,
			clip.id,
			{ ...globalState.settings!.speechToTextSettings, paddingBeforeMs: 500, paddingAfterMs: 500 },
			new AbortController().signal,
			vi.fn()
		);
		const subtitles = globalState.getSubtitleClips;
		expect(subtitles.map((subtitle) => [subtitle.startTime, subtitle.endTime])).toEqual([
			[10500, 12500],
			[13500, 15500]
		]);
		expect(subtitles[0].duration).toBe(2000);
		expect(subtitles[0].alignmentMetadata).toMatchObject({ timeFrom: 10.5, timeTo: 12.5 });
		expect(subtitles[0].alignmentMetadata!.words[1]).toMatchObject({
			start: 1,
			spokenDuration: 0.5
		});
		expect(
			track.clips
				.filter((item) => item instanceof SilenceClip)
				.map((item) => [item.startTime, item.endTime])
		).toEqual([
			[0, 10499],
			[12501, 13499]
		]);
		ProjectHistoryManager.undo();
		expect(globalState.getSubtitleTrack.clips).toEqual([]);
		ProjectHistoryManager.redo();
		expect(
			globalState.getSubtitleClips.map((subtitle) => [subtitle.startTime, subtitle.endTime])
		).toEqual([
			[10500, 12500],
			[13500, 15500]
		]);
	});

	test('keeps consecutive subtitle boundaries unchanged and stays inside the timeline and audio end', async () => {
		clip.startTime = 0;
		clip.endTime = 2000;
		vi.mocked(invoke).mockResolvedValue({
			words: [
				{ word: 'one', start: 0, end: 1 },
				{ word: 'two', start: 1, end: 2 }
			]
		});
		await transcribeProjectAudio(
			project,
			clip.id,
			{
				...globalState.settings!.speechToTextSettings,
				maxWords: 1,
				paddingBeforeMs: 500,
				paddingAfterMs: 500
			},
			new AbortController().signal,
			vi.fn()
		);
		expect(
			globalState.getSubtitleClips.map((subtitle) => [subtitle.startTime, subtitle.endTime])
		).toEqual([
			[0, 1000],
			[1000, 2000]
		]);
		expect(track.clips).toHaveLength(2);
	});

	test.each([
		{
			before: 500,
			after: 500,
			expected: [
				[0, 1300],
				[1300, 2500]
			]
		},
		{
			before: 0,
			after: 300,
			expected: [
				[0, 1300],
				[1600, 2300]
			]
		}
	])(
		'uses only the available silence and supports disabling one padding side: $before/$after',
		async ({ before, after, expected }) => {
			clip.startTime = 0;
			clip.endTime = 3000;
			vi.mocked(invoke).mockResolvedValue({
				words: [
					{ word: 'one', start: 0, end: 1 },
					{ word: 'two', start: 1.6, end: 2 }
				]
			});
			await transcribeProjectAudio(
				project,
				clip.id,
				{
					...globalState.settings!.speechToTextSettings,
					maxWords: 1,
					paddingBeforeMs: before,
					paddingAfterMs: after
				},
				new AbortController().signal,
				vi.fn()
			);
			expect(
				globalState.getSubtitleClips.map((subtitle) => [subtitle.startTime, subtitle.endTime])
			).toEqual(expected);
		}
	);

	test.each([-1, 1.5, Infinity])(
		'rejects invalid padding before contacting the provider: %s',
		async (paddingBeforeMs) => {
			await expect(
				transcribeProjectAudio(
					project,
					clip.id,
					{ ...globalState.settings!.speechToTextSettings, paddingBeforeMs },
					new AbortController().signal,
					vi.fn()
				)
			).rejects.toThrow();
			expect(invoke).not.toHaveBeenCalled();
			expect(track.clips).toEqual([]);
		}
	);

	test('replaces all existing subtitles only after success and restores them with undo', async () => {
		const outside = new SubtitleClip(0, 3000, 'Earlier subtitle');
		const overlapping = new SubtitleClip(10000, 12000, 'Existing subtitle');
		overlapping.translations.french = new VerseTranslation('Traduction existante', 'reviewed');
		track.clips = [outside, overlapping];
		project.projectEditorState.subtitlesEditor.editSubtitle = overlapping;
		project.projectEditorState.subtitlesEditor.pendingSplitEditNextId = outside.id;
		project.projectEditorState.stylesEditor.selectedSubtitles = [overlapping];
		vi.mocked(invoke).mockImplementationOnce(async () => {
			expect(track.clips).toEqual([outside, overlapping]);
			return { words: ['a', 'b', 'c', 'd'].map((word, i) => ({ word, start: i, end: i + 0.8 })) };
		});
		await transcribeProjectAudio(
			project,
			clip.id,
			{ ...globalState.settings!.speechToTextSettings },
			new AbortController().signal,
			vi.fn(),
			true
		);
		expect(
			track.clips
				.filter((item) => item instanceof SubtitleClip)
				.map((item) => (item as SubtitleClip).text)
		).toEqual(['a b', 'c d']);
		expect(project.projectEditorState.subtitlesEditor.editSubtitle).toBeNull();
		expect(project.projectEditorState.subtitlesEditor.pendingSplitEditNextId).toBeNull();
		expect(project.projectEditorState.stylesEditor.selectedSubtitles).toEqual([]);
		ProjectHistoryManager.undo();
		expect(globalState.getSubtitleClips.map((subtitle) => subtitle.text)).toEqual([
			'Earlier subtitle',
			'Existing subtitle'
		]);
		expect(globalState.getSubtitleClips[1].translations.french.text).toBe('Traduction existante');
		ProjectHistoryManager.redo();
		expect(globalState.getSubtitleClips.map((subtitle) => subtitle.text)).toEqual(['a b', 'c d']);
	});

	test.each(['network', 'cancel', 'edit', 'switch', 'noSpeech'])(
		'keeps the existing subtitles after an overwrite fails: %s',
		async (action) => {
			const existing = new SubtitleClip(10000, 12000, 'Existing subtitle');
			track.clips = [existing];
			const controller = new AbortController();
			vi.mocked(invoke).mockImplementationOnce(async () => {
				if (action === 'network') throw new Error('Provider error');
				if (action === 'cancel') controller.abort();
				if (action === 'edit') existing.text = 'Manual edit during transcription';
				if (action === 'switch') globalState.currentProject = null;
				return { words: action === 'noSpeech' ? [] : [{ word: 'hello', start: 0, end: 1 }] };
			});
			await expect(
				transcribeProjectAudio(
					project,
					clip.id,
					{ ...globalState.settings!.speechToTextSettings },
					controller.signal,
					vi.fn(),
					true
				)
			).rejects.toThrow();
			expect(track.clips).toEqual([existing]);
			expect(existing.text).toBe(
				action === 'edit' ? 'Manual edit during transcription' : 'Existing subtitle'
			);
		}
	);

	test('does not send paid requests when the selected range already has subtitles', async () => {
		track.clips.push(new SubtitleClip(11000, 12000, 'existing'));
		await expect(
			transcribeProjectAudio(
				project,
				clip.id,
				{ ...globalState.settings!.speechToTextSettings },
				new AbortController().signal,
				vi.fn()
			)
		).rejects.toThrow(/already contains subtitles/);
		expect(invoke).not.toHaveBeenCalled();
		expect(track.clips).toHaveLength(1);
	});

	test('does not add anything or make another request after cancellation', async () => {
		const controller = new AbortController();
		vi.mocked(invoke).mockImplementationOnce(async () => {
			controller.abort();
			return { words: [{ word: 'hello', start: 0, end: 1 }] };
		});
		await expect(
			transcribeProjectAudio(
				project,
				clip.id,
				{ ...globalState.settings!.speechToTextSettings },
				controller.signal,
				vi.fn()
			)
		).rejects.toThrow();
		expect(track.clips).toHaveLength(0);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	test('assigns every imported subtitle to the main project speaker', async () => {
		project.detail.speaker = 'Main speaker';
		project.projectEditorState.subtitlesEditor.selectedSpeaker = 'Another speaker';
		await transcribeProjectAudio(
			project,
			clip.id,
			{ ...globalState.settings!.speechToTextSettings },
			new AbortController().signal,
			vi.fn()
		);
		expect(
			track.clips
				.filter((item) => item instanceof SubtitleClip)
				.map((item) => (item as SubtitleClip).speaker)
		).toEqual(['Main speaker', 'Main speaker']);
	});

	test('does not create empty silence clips between touching subtitles', async () => {
		clip.startTime = 0;
		vi.mocked(invoke).mockResolvedValue({
			words: [
				{ word: 'a', start: 0, end: 1 },
				{ word: 'b', start: 1, end: 2 }
			]
		});
		await transcribeProjectAudio(
			project,
			clip.id,
			{ ...globalState.settings!.speechToTextSettings, maxWords: 1 },
			new AbortController().signal,
			vi.fn()
		);
		expect(track.clips).toHaveLength(2);
		expect(track.clips.every((item) => item instanceof SubtitleClip)).toBe(true);
	});

	test('preserves the existing initial silence without duplicating it', async () => {
		const initial = new SilenceClip(0, 9999);
		track.clips = [initial];
		await transcribeProjectAudio(
			project,
			clip.id,
			{ ...globalState.settings!.speechToTextSettings },
			new AbortController().signal,
			vi.fn()
		);
		expect(track.clips[0]).toBe(initial);
		expect(track.clips.filter((item) => item instanceof SilenceClip)).toHaveLength(2);
	});

	test('does not apply results after the source clip has been edited', async () => {
		vi.mocked(invoke).mockImplementationOnce(async () => {
			clip.sourceStartTime = 7000;
			return { words: [{ word: 'hello', start: 0, end: 1 }] };
		});
		await expect(
			transcribeProjectAudio(
				project,
				clip.id,
				{ ...globalState.settings!.speechToTextSettings },
				new AbortController().signal,
				vi.fn()
			)
		).rejects.toThrow(/changed during processing/);
		expect(track.clips).toHaveLength(0);
	});

	test('owns each overlap word only once across long audio chunks', async () => {
		clip.endTime = 614000;
		const options = { ...globalState.settings!.speechToTextSettings };
		vi.mocked(invoke).mockImplementation(async (_command, args) => {
			const request = (args as { request: { startSeconds: number; durationSeconds: number } })
				.request;
			const from = request.startSeconds - 5;
			return {
				words: [0, 299.8, 300.5, 599.9, 603]
					.filter((start) => start >= from && start < from + request.durationSeconds)
					.map((start) => ({ word: String(start), start: start - from, end: start + 0.1 - from }))
			};
		});
		await transcribeProjectAudio(project, clip.id, options, new AbortController().signal, vi.fn());
		expect(
			track.clips
				.filter((item) => item instanceof SubtitleClip)
				.map((item) => (item as SubtitleClip).text)
				.join(' ')
		).toBe('0 299.8 300.5 599.9 603');
		expect(invoke).toHaveBeenCalledTimes(3);
	});
});
