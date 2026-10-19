import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	Category,
	Project,
	ProjectContent,
	ProjectDetail,
	Style,
	StylesData,
	SubtitleClip,
	SilenceClip,
	Timeline,
	TrackType,
	VideoStyle
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { Quran, Surah, Verse, Word } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { refreshSegmentationContextFromTrack } from '$lib/services/autoSegmentation/context';
import {
	runAutoSegmentationFromImportedJson,
	runAutoSegmentationFromImportedJsonForProject
} from '$lib/services/autoSegmentation/run-imported';

vi.mock('$lib/services/autoSegmentation/audio', () => ({
	getAutoSegmentationAudioInfo: () => ({
		filePath: 'audio.mp3',
		fileName: 'audio.mp3',
		clipCount: 2
	}),
	getAutoSegmentationAudioClips: () => [
		{ filePath: 'audio.mp3', startMs: 0, endMs: 10_000, sourceStartMs: 0 }
	]
}));
vi.mock('$lib/services/autoSegmentation/audio-normalize.svelte', () => ({
	beginAudioNormalizationIfNeeded: vi.fn(),
	awaitAudioNormalization: vi.fn(async () => undefined)
}));

const payload = {
	audio_id: 'second-audio',
	segments: [
		{
			segment: 0,
			time_from: 1,
			time_to: 3,
			ref_from: '1:2:1',
			ref_to: '1:2:2',
			confidence: 0.99,
			words: [
				{ location: '1:2:1', start: 0, end: 1 },
				{ location: '1:2:2', start: 1, end: 2 }
			]
		}
	]
};

/**
 * Construit un projet avec un premier sous-titre aligné et une police personnalisée.
 * @returns {Project} Projet prêt à recevoir un second JSON.
 */
function createProject(): Project {
	const track = new SubtitleTrack();
	const clip = new SubtitleClip(0, 4999, 1, 1, 0, 1, 'original', [], true, true);
	clip.alignmentMetadata = {
		source: 'import',
		segment: 0,
		refFrom: '1:1:1',
		refTo: '1:1:2',
		matchedText: 'original',
		timeFrom: 0,
		timeTo: 4.999,
		words: [
			{ location: '1:1:1', start: 0, end: 2 },
			{ location: '1:1:2', start: 2, end: 4.999 }
		]
	};
	track.clips = [clip];
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [new Style({ id: 'font-family', value: 'QPC2' })]
			})
		])
	];
	return new Project(
		new ProjectDetail('JSON import', 'reciter'),
		new ProjectContent(
			new Timeline([track, new AssetTrack(TrackType.Audio)]),
			[],
			undefined,
			videoStyle
		)
	);
}

describe('importing consecutive aligner JSON files', () => {
	const originalProject = globalState.currentProject;

	beforeEach(() => {
		initializeClassRegistry();
		const verses = [1, 2].map(
			(id) => new Verse(id, [new Word('a', 'a', 'a'), new Word('b', 'b', 'b')])
		);
		vi.spyOn(Quran, 'load').mockResolvedValue(undefined);
		vi.spyOn(Quran, 'getVerse').mockImplementation(async (_surah, verse) => verses[verse - 1]);
		vi.spyOn(Quran, 'getVerseCount').mockReturnValue(2);
		vi.spyOn(Quran, 'getSurahs').mockReturnValue([new Surah(1, '', '', '', 2, '', '', verses)]);
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		globalState.currentProject = createProject();
		refreshSegmentationContextFromTrack(false);
		ProjectHistoryManager.resetForCurrentProject();
	});

	afterEach(() => {
		ProjectHistoryManager.clear();
		globalState.currentProject = originalProject;
		vi.restoreAllMocks();
	});

	it('keeps existing clips and shifts new clips, initial silence and WBW metadata together', async () => {
		const project = globalState.currentProject!;
		const original = globalState.getSubtitleTrack.clips[0];
		const before = original.toJSON();
		const result = await runAutoSegmentationFromImportedJsonForProject(project, payload, {
			subtitleApplicationMode: 'append',
			fillBySilence: true
		});
		expect(result?.status).toBe('completed');
		const [kept, silence, imported] = globalState.getSubtitleTrack.clips;
		expect(kept).toBe(original);
		expect(kept.toJSON()).toEqual(before);
		expect(silence).toBeInstanceOf(SilenceClip);
		expect(silence).toMatchObject({ startTime: 5000, endTime: 5999 });
		expect(imported).toMatchObject({
			startTime: 6000,
			endTime: 8000,
			alignmentMetadata: { timeFrom: 6, timeTo: 8, words: payload.segments[0].words }
		});
		expect(project.projectEditorState.subtitlesEditor.segmentationContext).toMatchObject({
			audioId: null,
			alignedSegments: [
				expect.objectContaining({ clipId: original.id, startMs: 0, endMs: 4999 }),
				expect.objectContaining({ clipId: imported.id, startMs: 6000, endMs: 8000 })
			]
		});
		expect(
			project.content.videoStyle.getStylesOfTarget('arabic').findStyle('font-family')?.value
		).toBe('QPC2');
	});

	it('supports undo and redo of an append as one import operation', async () => {
		const before = globalState.getSubtitleTrack.clips[0].toJSON();
		await runAutoSegmentationFromImportedJson(payload, { subtitleApplicationMode: 'append' });
		expect(globalState.getSubtitleTrack.clips).toHaveLength(3);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips.map((clip) => clip.toJSON())).toEqual([before]);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(3);
		expect(globalState.getSubtitleTrack.clips[2]).toMatchObject({ startTime: 6000, endTime: 8000 });
	});

	it('continues to replace existing subtitles by default', async () => {
		await runAutoSegmentationFromImportedJsonForProject(globalState.currentProject!, payload);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(2);
		expect(globalState.getSubtitleTrack.clips[1]).toMatchObject({ startTime: 1000, endTime: 3000 });
	});

	it('imports onto an empty track without adding an offset', async () => {
		globalState.getSubtitleTrack.clips = [];
		await runAutoSegmentationFromImportedJsonForProject(globalState.currentProject!, payload, {
			subtitleApplicationMode: 'append'
		});
		expect(globalState.getSubtitleTrack.clips[1]).toMatchObject({ startTime: 1000, endTime: 3000 });
	});

	it('keeps existing subtitles when the appended JSON contains no usable segments', async () => {
		const original = globalState.getSubtitleTrack.clips[0];
		const result = await runAutoSegmentationFromImportedJsonForProject(
			globalState.currentProject!,
			{
				segments: [{ ...payload.segments[0], error: 'Invalid alignment' }]
			},
			{ subtitleApplicationMode: 'append' }
		);
		expect(result?.status).toBe('failed');
		expect(globalState.getSubtitleTrack.clips).toEqual([original]);
	});
});
