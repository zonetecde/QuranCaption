import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Asset, Duration, Project, ProjectContent, ProjectDetail, Timeline } from '$lib/classes';
import { AssetClip, SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { AssetType, TrackType } from '$lib/classes/enums';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { Category, Style, StylesData, VideoStyle } from '$lib/classes/VideoStyle.svelte';
import subtitleDefaults from '../../../../static/styles/styles.json';
import globalDefaults from '../../../../static/styles/globalStyles.json';
import { getTimelineClipWidth } from '$lib/components/projectEditor/timeline/track/timelineClipLayout';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import {
	applyProjectAudioEffect,
	prepareAudioEffectPreview
} from '$lib/services/AudioEffectsService';
import { applyStylePreset } from '$lib/services/StylePresetApplicationService';
import { addAssetToTimeline } from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/assetTimelineActions';
import {
	applyProjectStylePreset,
	resetProjectStyles
} from '$lib/components/projectEditor/tabs/styleEditor/presets/actions/styleActions';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn(), exists: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: mocks.exists }));
vi.mock('$lib/components/modals/ModalManager', () => ({
	default: { confirmModal: mocks.confirm, errorModal: vi.fn() }
}));

/**
 * Crée un projet indépendant contenant les pistes utilisées par les opérations.
 * @param {string} speaker Intervenant principal.
 * @returns {Project} Projet sans accès disque.
 */
function createProject(speaker = 'Owner'): Project {
	return new Project(
		new ProjectDetail('Lecture', speaker),
		new ProjectContent(
			new Timeline([
				new SubtitleTrack(),
				new AssetTrack(TrackType.Audio),
				new AssetTrack(TrackType.Video)
			])
		)
	);
}

/**
 * Ajoute une source audio de durée connue sans lancer d'analyse native.
 * @param {Project} project Projet propriétaire.
 * @returns {{ asset: Asset; clip: AssetClip }} Source et clip avec un décalage média.
 */
function addAudio(project: Project): { asset: Asset; clip: AssetClip } {
	const asset = new Asset('C:/lecture/source.png');
	asset.filePath = 'C:/lecture/source.wav';
	asset.type = AssetType.Audio;
	asset.duration = new Duration(30_000);
	project.content.assets.push(asset);
	const clip = new AssetClip(500, 20_500, asset.id);
	clip.sourceStartTime = 2000;
	project.content.timeline.getFirstTrack(TrackType.Audio).clips.push(clip);
	return { asset, clip };
}

beforeEach(() => {
	vi.resetAllMocks();
	initializeClassRegistry();
	globalState.currentProject = createProject();
	ProjectHistoryManager.resetForCurrentProject();
	mocks.exists.mockResolvedValue(false);
	mocks.invoke.mockImplementation(async (command) =>
		command === 'get_duration' ? 30_000 : undefined
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	ProjectHistoryManager.clear();
	globalState.currentProject = null;
});

describe('clip timing invariants', () => {
	it('unwraps converted citations in every translation and restores their structure on undo', () => {
		const track = globalState.getSubtitleTrack;
		const translations = {
			english: new VerseTranslation('{{Praise}} {{1:1}}', 'reviewed'),
			french: new VerseTranslation('{{Louange}} {{1:1}}', 'reviewed')
		};
		for (const translation of Object.values(translations)) {
			translation.isStructuredTranslation = true;
			translation.quranSegments['quran-1'] = {
				reference: '1:1',
				startUnitIndex: 0,
				endUnitIndex: 1,
				isBruteForce: true,
				manualText: 'Manual verse translation'
			};
		}
		const clip = new SubtitleClip(0, 1000, '{{الحمد}} {{1:1}}', translations);
		track.clips = [clip];
		expect(track.editTranscript(clip, 'الحمد {{1:1}}')).toBe(true);
		expect(clip.translations.english.text).toBe('Praise {{1:1}}');
		expect(clip.translations.french.text).toBe('Louange {{1:1}}');
		for (const translation of Object.values(clip.translations) as VerseTranslation[]) {
			expect(translation.quranSegments['quran-0'].manualText).toBe('Manual verse translation');
			expect(translation.quranSegments['quran-1']).toBeUndefined();
			expect(translation.status).toBe('reviewed');
		}
		expect(ProjectHistoryManager.undo()).toBe(true);
		const restored = globalState.getSubtitleClips[0];
		expect(restored.text).toBe('{{الحمد}} {{1:1}}');
		expect(restored.translations.english.text).toBe('{{Praise}} {{1:1}}');
		expect(
			(restored.translations.english as VerseTranslation).quranSegments['quran-1'].manualText
		).toBe('Manual verse translation');
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitleClips[0].translations.english.text).toBe('Praise {{1:1}}');
	});

	it('adds and edits subtitles without a speaker selection while preserving undo and redo', () => {
		const project = globalState.currentProject!;
		project.detail.speaker = '';
		project.projectEditorState.timeline.cursorPosition = 1000;
		expect(globalState.getSubtitleTrack.addTranscript('First passage')).toBe(true);
		const clip = globalState.getSubtitleClips[0];
		expect(clip.toJSON()).not.toHaveProperty('speaker');
		expect(globalState.getSubtitleTrack.editTranscript(clip, 'Edited passage')).toBe(true);
		expect(project.detail.speaker).toBe('');
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleClips[0].text).toBe('First passage');
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitleClips[0].text).toBe('Edited passage');
		expect(globalState.getSubtitleClips[0].toJSON()).not.toHaveProperty('speaker');
	});

	it('computes display widths from the supplied project without consulting the active one', () => {
		const project = globalState.currentProject!;
		addAudio(project);
		project.projectEditorState.timeline.zoom = 40;
		globalState.currentProject = createProject('Other');
		globalState.currentProject.projectEditorState.timeline.zoom = 100;
		expect(getTimelineClipWidth(new SubtitleClip(0, 1000, 'Text'), project)).toBe(40);
		expect(getTimelineClipWidth(new AssetClip(0, 0, 1), project)).toBe(800);
		expect(getTimelineClipWidth({ duration: 1000, getAlwaysShow: () => true }, project)).toBe(800);
		expect(getTimelineClipWidth({ duration: 1000 }, null)).toBe(0);
	});

	it.each(['start', 'end'] as const)(
		'retimes both neighbours and their alignment atomically when resizing the %s',
		(boundary) => {
			const track = globalState.getSubtitleTrack;
			const first = new SubtitleClip(0, 1000, 'First', {}, true, 0.9, {
				source: 'local',
				timeFrom: 0,
				timeTo: 1,
				words: [{ word: 'First', start: 0, end: 1 }]
			});
			const second = new SubtitleClip(1001, 2001, 'Second', {}, true, 0.9, {
				source: 'local',
				timeFrom: 1.001,
				timeTo: 2.001,
				words: [{ word: 'Second', start: 0, end: 1 }]
			});
			first.hasBeenVerified = second.hasBeenVerified = true;
			track.clips = [first, second];
			if (boundary === 'start') expect(track.updateClipStartTime(second.id, 1200)).toBe(true);
			else expect(track.updateClipEndTime(first.id, 1199)).toBe(true);
			expect([first.endTime, second.startTime]).toEqual([1199, 1200]);
			expect(first.alignmentMetadata?.timeTo).toBe(1.199);
			expect(second.alignmentMetadata?.timeFrom).toBe(1.2);
			expect(first.hasBeenVerified).toBe(false);
			expect(second.hasBeenVerified).toBe(false);
			expect(ProjectHistoryManager.undo()).toBe(true);
			expect(
				globalState.getSubtitleClips.map((clip) => [
					clip.startTime,
					clip.endTime,
					clip.hasBeenVerified
				])
			).toEqual([
				[0, 1000, true],
				[1001, 2001, true]
			]);
			expect(ProjectHistoryManager.undo()).toBe(false);
			expect(ProjectHistoryManager.redo()).toBe(true);
			expect(globalState.getSubtitleClips.map((clip) => clip.alignmentMetadata?.timeFrom)).toEqual([
				0, 1.2
			]);
		}
	);

	it('rejects invalid boundaries without mutating a neighbour or creating history', () => {
		const track = globalState.getSubtitleTrack;
		const first = new SilenceClip(0, 1000);
		const second = new SubtitleClip(1001, 2001, 'Text');
		track.clips = [first, second];
		for (const time of [NaN, Infinity, -1, 1902, 50])
			expect(track.updateClipStartTime(second.id, time)).toBe(false);
		expect(second.setEndTime(0)).toBe(false);
		expect([first.endTime, second.startTime, second.endTime]).toEqual([1000, 1001, 2001]);
		expect(ProjectHistoryManager.undo()).toBe(false);
	});
});

describe('audio effect preparation and application', () => {
	it('previews the middle of the used source range, including its media offset', async () => {
		const project = globalState.currentProject!;
		const { clip } = addAudio(project);
		mocks.invoke.mockResolvedValue('preview.wav');
		await expect(
			prepareAudioEffectPreview(project, clip.id, 'clarity', { primary: 80, secondary: 2 })
		).resolves.toBe('preview.wav');
		expect(mocks.invoke).toHaveBeenCalledWith(
			'preview_audio_effect',
			expect.objectContaining({ startMs: 7000, durationMs: 10_000 })
		);
		expect(ProjectHistoryManager.undo()).toBe(false);
	});

	it.each(['project', 'source', 'closed'] as const)(
		'discards an effect when its %s changed while FFmpeg ran',
		async (change) => {
			const project = globalState.currentProject!;
			const { clip } = addAudio(project);
			const originalId = clip.assetId;
			let finish!: () => void;
			mocks.invoke.mockImplementation((command) =>
				command === 'apply_audio_effect'
					? new Promise<void>((resolve) => {
							finish = resolve;
						})
					: Promise.resolve(30_000)
			);
			const abort = new AbortController();
			const pending = applyProjectAudioEffect(
				project,
				clip.id,
				'clarity',
				{ primary: 80, secondary: 2 },
				abort.signal
			);
			await vi.waitFor(() => expect(finish).toBeDefined());
			if (change === 'project') globalState.currentProject = createProject('Other');
			if (change === 'source') clip.assetId = 999;
			if (change === 'closed') abort.abort();
			finish();
			await expect(pending).resolves.toBeNull();
			expect(clip.assetId).toBe(change === 'source' ? 999 : originalId);
			expect(project.content.assets).toHaveLength(1);
			expect(ProjectHistoryManager.undo()).toBe(false);
		}
	);
});

describe('style and media UI boundaries', () => {
	it('discards an image confirmation after switching projects', async () => {
		const project = globalState.currentProject!;
		const asset = new Asset('C:/lecture/background.png');
		let answer!: (value: boolean) => void;
		mocks.confirm.mockReturnValue(
			new Promise<boolean>((resolve) => {
				answer = resolve;
			})
		);
		const pending = addAssetToTimeline(project, asset, true, false);
		globalState.currentProject = createProject('Other');
		answer(true);
		await pending;
		expect(project.content.timeline.getFirstTrack(TrackType.Video).clips).toEqual([]);
		expect(globalState.getVideoTrack.clips).toEqual([]);
		expect(ProjectHistoryManager.undo()).toBe(false);
	});

	it('keeps all three Minbar text targets and does not modify the imported preset', async () => {
		vi.spyOn(VideoStyle.prototype, 'ensureStylesSchemaUpToDate').mockResolvedValue(false);
		const project = globalState.currentProject!;
		const data = {
			videoStyle: {
				styles: ['arabic', 'arabic-quran', 'arabic-citation'].map((target) =>
					new StylesData(target).toJSON()
				)
			},
			customClips: [{ type: 'Custom Text', id: 12, startTime: 0, endTime: 1000 }]
		};
		await applyProjectStylePreset(project, data);
		expect(project.content.videoStyle.styles.map((styles) => styles.target)).toEqual([
			'arabic',
			'arabic-quran',
			'arabic-citation'
		]);
		expect(data.customClips[0].id).toBe(12);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.currentProject!.content.timeline.doesTrackExist(TrackType.CustomClip)).toBe(
			false
		);
	});

	it('leaves the project untouched if style migration fails', async () => {
		vi.spyOn(VideoStyle.prototype, 'ensureStylesSchemaUpToDate').mockRejectedValue(
			new Error('migration failed')
		);
		const project = globalState.currentProject!;
		const before = JSON.stringify(project.toJSON());
		await expect(
			applyStylePreset(project, {
				videoStyle: { styles: [new StylesData('arabic').toJSON()] },
				customClips: []
			})
		).rejects.toThrow('migration failed');
		expect(JSON.stringify(project.toJSON())).toBe(before);
		expect(ProjectHistoryManager.undo()).toBe(false);
	});

	it('rejects a prepared preset after switching projects without mutating either project', async () => {
		let finish!: (value: boolean) => void;
		vi.spyOn(VideoStyle.prototype, 'ensureStylesSchemaUpToDate').mockReturnValue(
			new Promise<boolean>((resolve) => {
				finish = resolve;
			})
		);
		const project = globalState.currentProject!;
		const before = JSON.stringify(project.toJSON());
		const pending = applyStylePreset(project, {
			videoStyle: { styles: [new StylesData('arabic').toJSON()] },
			customClips: []
		});
		globalState.currentProject = createProject('Other');
		finish(true);
		await expect(pending).rejects.toThrow();
		expect(JSON.stringify(project.toJSON())).toBe(before);
		expect(globalState.currentProject.content.videoStyle.styles).toEqual([]);
	});

	it('resets to the creation theme while preserving dimensions and supporting undo and redo', async () => {
		const project = globalState.currentProject!;
		project.content.videoStyle.styles = [
			new StylesData('global', [
				new Category({
					id: 'general',
					styles: [new Style({ id: 'video-dimension', value: { width: 1080, height: 1920 } })]
				})
			])
		];
		const defaults = new VideoStyle();
		defaults.styles = [
			new StylesData(
				'global',
				globalDefaults.map((category) => new Category(category as Partial<Category>))
			),
			new StylesData(
				'arabic',
				subtitleDefaults.map((category) => new Category(category as Partial<Category>))
			),
			new StylesData(
				'english',
				subtitleDefaults.map((category) => new Category(category as Partial<Category>))
			)
		];
		vi.spyOn(VideoStyle, 'getDefaultVideoStyle').mockResolvedValue(defaults);
		mocks.confirm.mockResolvedValue(true);
		const before = project.content.videoStyle.toJSON();
		await resetProjectStyles(project);
		const global = globalState.getVideoStyle.getStylesOfTarget('global');
		expect(global.findStyle('video-dimension')?.value).toEqual({ width: 1080, height: 1920 });
		expect(global.findStyle('background-overlay-mode')?.value).toBe('fade-up');
		expect(global.findStyle('overlay-opacity')?.value).toBe(0.86);
		for (const [target, size, position] of [
			['arabic', 90, 231],
			['english', 60, 413]
		] as const) {
			const styles = globalState.getVideoStyle.getStylesOfTarget(target);
			expect(styles.findStyle('font-size')?.value).toBe(size);
			expect(styles.findStyle('vertical-position')?.value).toBe(position);
			expect(styles.findStyle('outline-enable')?.value).toBe(true);
			expect(styles.findStyle('text-outline')?.value).toBe(5);
		}
		const after = globalState.getVideoStyle.toJSON();
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getVideoStyle.toJSON()).toEqual(before);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getVideoStyle.toJSON()).toEqual(after);
	});

	it('does not reset the next project when a reset confirmation resolves late', async () => {
		let answer!: (value: boolean) => void;
		mocks.confirm.mockReturnValue(
			new Promise<boolean>((resolve) => {
				answer = resolve;
			})
		);
		const defaults = vi.spyOn(VideoStyle, 'getDefaultVideoStyle');
		const pending = resetProjectStyles(globalState.currentProject!);
		globalState.currentProject = createProject('Other');
		answer(true);
		await pending;
		expect(defaults).not.toHaveBeenCalled();
		expect(ProjectHistoryManager.undo()).toBe(false);
	});
});
