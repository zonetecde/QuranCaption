import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { exists } from '@tauri-apps/plugin-fs';
import {
	Asset,
	AssetClip,
	Category,
	Duration,
	Edition,
	PredefinedSubtitleClip,
	SilenceClip,
	Project,
	ProjectContent,
	ProjectDetail,
	Style,
	StylesData,
	SubtitleClip,
	Timeline,
	TrackType,
	VideoStyle
} from '$lib/classes';
import { CustomClip } from '$lib/classes/Clip.svelte';
import { AssetTrack, CustomTextTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { globalState } from '$lib/runes/main.svelte';
import { loadAllLocales } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { downloadFileWithProgress } from '$lib/services/DownloadWithProgress';
import { ProjectService } from '$lib/services/ProjectService';
import {
	getIntroAudioUrl,
	prependRecitationIntro,
	type IntroFormula
} from '$lib/services/RecitationIntroService';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { getTimelineClipLayout } from '$lib/components/projectEditor/timeline/track/timelineClipLayout';

vi.mock('@tauri-apps/api/core', async (original) => ({
	...(await original<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn()
}));
vi.mock('@tauri-apps/api/path', () => ({
	join: vi.fn(async (...parts: string[]) => parts.join('/'))
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn() }));
vi.mock('$lib/services/DownloadWithProgress', () => ({ downloadFileWithProgress: vi.fn() }));

const options = {
	reciterId: 'husary' as const,
	formulas: ["Isti'adha", 'Basmala'] as IntroFormula[],
	paddingStartMs: 500,
	paddingEndMs: 750
};

/**
 * Crée un projet réel minimal pour vérifier la sérialisation et le décalage.
 * @returns {Project} Projet contenant audio, vidéo et sous-titres alignés.
 */
function createProject(): Project {
	const audio = new AssetTrack(TrackType.Audio);
	audio.clips = [new AssetClip(0, 10000, 42)];
	(audio.clips[0] as AssetClip).sourceStartTime = 250;
	const video = new AssetTrack(TrackType.Video);
	video.clips = [new AssetClip(200, 8000, 43)];
	const subtitles = new SubtitleTrack();
	const clip = new SubtitleClip(1000, 3000, 1, 1, 0, 0, 'text', [], true, true, {});
	clip.alignmentMetadata = {
		source: 'local',
		segment: 1,
		refFrom: '1:1:1',
		refTo: '1:1:1',
		matchedText: 'text',
		timeFrom: 1,
		timeTo: 3,
		words: [{ location: '1:1:1', word: 'text', start: 0.1, end: 1.8 }]
	};
	subtitles.clips = [clip];
	return new Project(
		new ProjectDetail('Intro test', 'reciter'),
		new ProjectContent(
			new Timeline([new CustomTextTrack(), subtitles, video, audio]),
			[],
			undefined,
			new VideoStyle()
		)
	);
}

describe('recitation introduction', () => {
	beforeEach(() => {
		initializeClassRegistry();
		loadAllLocales();
		setLocale('en');
		globalState.currentProject = createProject();
		ProjectHistoryManager.resetForCurrentProject();
		vi.spyOn(ProjectService, 'getAssetFolderForProject').mockResolvedValue('C:/assets');
		vi.mocked(exists).mockResolvedValue(true);
		vi.mocked(downloadFileWithProgress).mockResolvedValue(100);
		vi.mocked(invoke).mockImplementation(async (command, args) =>
			command === 'get_duration'
				? String((args as { filePath: string }).filePath).includes('istiadha')
					? 2000
					: 3000
				: 0
		);
	});

	afterEach(() => {
		ProjectHistoryManager.clear();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it('inserts both audios and translated subtitles, preserving source trims and relative word timings with one undo/redo', async () => {
		const project = globalState.currentProject!;
		project.content.projectTranslation.addedTranslationEditions.push(
			new Edition('key', 'en', 'Author', 'English', 'ltr', '', '', '', '')
		);
		await prependRecitationIntro(options);
		expect(project.content.assets).toHaveLength(2);
		expect(globalState.getAudioTrack.clips.map((c) => [c.startTime, c.endTime])).toEqual([
			[500, 2500],
			[2501, 5501],
			[6252, 16252]
		]);
		expect(globalState.getAudioTrack.clips[2]).toMatchObject({
			sourceStartTime: 250,
			duration: 10000
		});
		expect(globalState.getVideoTrack.clips[0]).toMatchObject({
			startTime: 6452,
			endTime: 14252,
			duration: 7800
		});
		const subtitles = globalState.getSubtitleTrack.clips;
		expect(subtitles[0]).toBeInstanceOf(SilenceClip);
		expect(subtitles[0]).toMatchObject({ startTime: 0, endTime: 499 });
		expect(subtitles[1]).toBeInstanceOf(PredefinedSubtitleClip);
		expect(subtitles[1]).toMatchObject({
			predefinedSubtitleType: "Isti'adha",
			startTime: 500,
			endTime: 2500
		});
		expect(Object.keys((subtitles[1] as PredefinedSubtitleClip).translations)).toEqual(['en']);
		expect(subtitles[2]).toMatchObject({
			predefinedSubtitleType: 'Basmala',
			startTime: 2501,
			endTime: 5501
		});
		expect(subtitles[3]).toBeInstanceOf(SilenceClip);
		expect(subtitles[3]).toMatchObject({ startTime: 5502, endTime: 6251 });
		expect(subtitles[4]).toMatchObject({
			startTime: 7252,
			endTime: 9252,
			alignmentMetadata: { words: [{ start: 0.1, end: 1.8 }] }
		});
		expect((subtitles[4] as SubtitleClip).alignmentMetadata!.timeFrom).toBeCloseTo(7.252, 9);
		expect((subtitles[4] as SubtitleClip).alignmentMetadata!.timeTo).toBeCloseTo(9.252, 9);
		expect(project.detail.duration.ms).toBe(16252);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.currentProject!.content.assets).toHaveLength(0);
		expect(globalState.getAudioTrack.clips[0].startTime).toBe(0);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(1);
		expect(ProjectHistoryManager.undo()).toBe(false);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.currentProject!.content.assets).toHaveLength(2);
		expect(globalState.getAudioTrack.clips).toHaveLength(3);
		expect(
			globalState.getSubtitleTrack.clips.filter((clip) => clip instanceof SilenceClip)
		).toHaveLength(2);
		expect(globalState.currentProject!.detail.duration.ms).toBe(16252);
	});

	it.each<IntroFormula[]>([["Isti'adha"], ['Basmala'], ["Isti'adha", 'Basmala']])(
		'keeps the introduction and main audio on one displayed lane with zero padding: %j',
		async (...formulas) => {
			const timeline = globalState.currentProject!.content.timeline;
			const audioTrack = globalState.getAudioTrack;
			const trackCount = timeline.tracks.length;
			await prependRecitationIntro({ ...options, formulas, paddingStartMs: 0, paddingEndMs: 0 });
			expect(timeline.tracks).toHaveLength(trackCount);
			expect(globalState.getAudioTrack).toBe(audioTrack);
			expect(globalState.getSubtitleTrack.clips.some((clip) => clip instanceof SilenceClip)).toBe(
				false
			);
			const layout = getTimelineClipLayout(
				audioTrack.clips,
				(clip) => clip.startTime,
				(clip) => clip.endTime
			);
			expect(layout.laneCount).toBe(1);
			expect(layout.clips.every((entry) => entry.laneIndex === 0)).toBe(true);
			for (let index = 0; index < formulas.length; index++) {
				expect(globalState.getSubtitleTrack.clips[index]).toMatchObject({
					startTime: audioTrack.clips[index].startTime,
					endTime: audioTrack.clips[index].endTime
				});
			}
		}
	);

	it.each(["Isti'adha", 'Basmala'] as const)(
		'reuses an existing %s asset with zero padding',
		async (formula) => {
			const asset = new Asset();
			asset.id = 99;
			asset.filePath = 'C:/existing.mp3';
			asset.sourceUrl = getIntroAudioUrl('husary', formula);
			asset.duration = new Duration(1200);
			globalState.currentProject!.content.assets.push(asset);
			await prependRecitationIntro({
				...options,
				formulas: [formula],
				paddingStartMs: 0,
				paddingEndMs: 0
			});
			expect(downloadFileWithProgress).not.toHaveBeenCalled();
			expect(globalState.currentProject!.content.assets).toHaveLength(1);
			expect(globalState.getAudioTrack.clips[0]).toMatchObject({
				assetId: 99,
				startTime: 0,
				endTime: 1200
			});
			expect(globalState.getAudioTrack.clips[1].startTime).toBe(1201);
		}
	);

	it('shifts overlay ranges and nested/global/override keyframes once while preserving the full-video background sentinel', async () => {
		const range = new Style({
			id: 'time-ranges',
			valueType: 'time-ranges',
			value: [{ startTime: 100, endTime: 300 }]
		});
		const appearance = new Style({ id: 'time-appearance', valueType: 'number', value: 100 });
		const animated = new Style({
			id: 'opacity',
			valueType: 'number',
			value: 1,
			keyframes: [{ time: 200, value: 0 }]
		});
		const category = new Category({
			id: 'custom-text',
			styles: [
				range,
				appearance,
				new Style({ id: 'text', valueType: 'composite', value: [animated] })
			]
		});
		const overlay = new CustomClip(100, 300, 'text', category);
		globalState.currentProject!.content.timeline.tracks[0].clips.push(overlay);
		const styles = new StylesData('global', [category]);
		styles.overrideKeyframes = { 42: { opacity: [{ time: 400, value: 0.5 }] } };
		globalState.currentProject!.content.videoStyle.styles = [styles];
		globalState.getVideoTrack.clips = [new AssetClip(0, 0, 43)];
		await prependRecitationIntro(options);
		expect(overlay).toMatchObject({ startTime: 6352, endTime: 6552, duration: 200 });
		expect(range.value).toEqual([{ startTime: 6352, endTime: 6552 }]);
		expect(appearance.value).toBe(6352);
		expect(animated.keyframes[0].time).toBe(6452);
		expect(styles.overrideKeyframes[42].opacity![0].time).toBe(6652);
		expect(globalState.getVideoTrack.clips[0]).toMatchObject({ startTime: 0, endTime: 0 });
	});

	it.each(['download', 'duration', 'project-switch'] as const)(
		'leaves the original timeline and assets untouched after %s failure',
		async (failure) => {
			const project = globalState.currentProject!;
			const before = JSON.stringify(project.toJSON());
			if (failure === 'download')
				vi.mocked(downloadFileWithProgress)
					.mockResolvedValueOnce(100)
					.mockRejectedValueOnce(new Error('offline'));
			if (failure === 'duration') vi.mocked(invoke).mockResolvedValue(0);
			if (failure === 'project-switch')
				vi.mocked(downloadFileWithProgress).mockImplementationOnce(async () => {
					globalState.currentProject = createProject();
					return 100;
				});
			await expect(prependRecitationIntro(options)).rejects.toThrow();
			expect(JSON.stringify(project.toJSON())).toBe(before);
			expect(ProjectHistoryManager.undo()).toBe(false);
		}
	);
});
