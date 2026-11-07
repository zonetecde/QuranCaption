import { addAssetToTimeline } from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/assetTimelineActions';
import { invoke } from '@tauri-apps/api/core';
import ModalManager from '$lib/components/modals/ModalManager';
import { loadAllLocales } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn()
}));
import { QuranSubtitleClip } from '$lib/compatibility/QuranSubtitleClip.svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import {
	Asset,
	AssetType,
	Duration,
	AssetClip,
	Category,
	Project,
	ProjectContent,
	ProjectDetail,
	SilenceClip,
	Style,
	StylesData,
	SubtitleClip,
	Timeline,
	TrackType,
	VideoStyle
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Crée un projet minimal pour tester l'historique sans charger les JSON de styles.
 *
 * @returns {Project} Projet prêt à être modifié.
 */
function createHistoryTestProject(): Project {
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [new Style({ id: 'font-size', value: 90, valueType: 'number' })]
			})
		])
	];

	const content = new ProjectContent(
		new Timeline([new SubtitleTrack()]),
		[],
		undefined,
		videoStyle
	);
	return new Project(new ProjectDetail('Undo test', 'speaker'), content);
}

/**
 * Creates a minimal project containing an asset track for split history tests.
 *
 * @param {AssetTrack} assetTrack Track containing the asset clip.
 * @returns {Project} Project ready for asset clip mutations.
 */
function createAssetSplitTestProject(assetTrack: AssetTrack): Project {
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [new Style({ id: 'font-size', value: 90, valueType: 'number' })]
			})
		])
	];

	return new Project(
		new ProjectDetail('Asset split test', 'speaker'),
		new ProjectContent(new Timeline([assetTrack, new SubtitleTrack()]), [], undefined, videoStyle)
	);
}

/**
 * Crée deux sous-titres voisins avec des mots horodatés pour tester leur frontière.
 * @returns {[SubtitleClip, SubtitleClip]} Sous-titres gauche et droit ajoutés au projet.
 */
function createWordResizeClips(): [SubtitleClip, SubtitleClip] {
	const clips = [
		new SubtitleClip(1000, 2999, 'one two'),
		new SubtitleClip(3000, 5999, 'three four five')
	] as [SubtitleClip, SubtitleClip];
	for (const clip of clips) {
		clip.alignmentMetadata = {
			source: 'manual',
			timeFrom: clip.startTime / 1000,
			timeTo: clip.endTime / 1000,
			words: clip.text.split(' ').map((word, index) => ({
				word,
				start: index,
				end: index + 1
			}))
		};
	}
	globalState.getSubtitleTrack.clips = clips;
	return clips;
}

describe('asset insertion at the cursor', () => {
	let asset: Asset;
	const originalProject = globalState.currentProject;

	beforeEach(() => {
		initializeClassRegistry();
		loadAllLocales();
		setLocale('en');
		globalState.currentProject = createAssetSplitTestProject(new AssetTrack(TrackType.Video));
		globalState.currentProject.content.timeline.tracks.push(new AssetTrack(TrackType.Audio));
		asset = new Asset();
		asset.id = 42;
		asset.type = AssetType.Video;
		asset.duration = new Duration(2000);
		globalState.currentProject.content.assets.push(asset);
		ProjectHistoryManager.resetForCurrentProject();
		vi.mocked(invoke).mockResolvedValue({ width: 0, height: 0 });
		vi.spyOn(ModalManager, 'errorModal').mockResolvedValue(undefined);
	});

	afterEach(() => {
		ProjectHistoryManager.clear();
		globalState.currentProject = originalProject;
		vi.restoreAllMocks();
	});

	it.each([0, 12000])('adds video and audio at %i with a single undo/redo', async (startTime) => {
		await addAssetToTimeline(globalState.currentProject!, asset, true, true, false, startTime);
		for (const track of [globalState.getVideoTrack, globalState.getAudioTrack]) {
			expect(track.clips).toHaveLength(1);
			expect(track.clips[0]).toMatchObject({ startTime, endTime: startTime + 2000, assetId: 42 });
		}
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getVideoTrack.clips).toHaveLength(0);
		expect(globalState.getAudioTrack.clips).toHaveLength(0);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getVideoTrack.clips[0].startTime).toBe(startTime);
		expect(globalState.getAudioTrack.clips[0].startTime).toBe(startTime);
	});

	it('inserts into a gap without moving existing clips and keeps chronological order', async () => {
		globalState.getVideoTrack.clips = [new AssetClip(0, 1000, 1), new AssetClip(9000, 11000, 2)];
		await addAssetToTimeline(globalState.currentProject!, asset, true, false, false, 4000);
		expect(globalState.getVideoTrack.clips.map((clip) => [clip.startTime, clip.endTime])).toEqual([
			[0, 1000],
			[4000, 6000],
			[9000, 11000]
		]);
	});

	it.each([1000, 2000, 3500, 4000])(
		'rejects an overlapping insertion at %i without adding either stream',
		async (startTime) => {
			globalState.getAudioTrack.clips = [new AssetClip(3000, 4000, 1)];
			await addAssetToTimeline(globalState.currentProject!, asset, true, true, false, startTime);
			expect(globalState.getVideoTrack.clips).toHaveLength(0);
			expect(globalState.getAudioTrack.clips).toHaveLength(1);
			expect(ModalManager.errorModal).toHaveBeenCalled();
		}
	);

	it('rejects insertion after a looped clip', async () => {
		const clip = new AssetClip(0, 1000, 1);
		clip.loopUntilAudioEnd = true;
		globalState.getVideoTrack.clips = [clip];
		await addAssetToTimeline(globalState.currentProject!, asset, true, false, false, 4000);
		expect(globalState.getVideoTrack.clips).toHaveLength(1);
		expect(ModalManager.errorModal).toHaveBeenCalled();
	});

	it('keeps normal additions at the end of the track', async () => {
		globalState.getVideoTrack.clips = [new AssetClip(0, 1000, 1)];
		await addAssetToTimeline(globalState.currentProject!, asset, true, false);
		expect(globalState.getVideoTrack.clips[1]).toMatchObject({ startTime: 1001, endTime: 3001 });
	});
});

describe('ProjectHistoryManager', () => {
	beforeEach(() => {
		initializeClassRegistry();
		globalState.currentProject = createHistoryTestProject();
		ProjectHistoryManager.resetForCurrentProject();
	});

	it.each(['start', 'end'] as const)(
		'transfers whole words in both directions from the %s handle and restores the original boundary',
		async (edge) => {
			const [left, right] = createWordResizeClips();
			const resize = globalState.getSubtitleTrack.createWordBoundaryResize(
				edge === 'start' ? right.id : left.id,
				edge
			)!;
			ProjectHistoryManager.begin('resize subtitle');
			expect(await resize(3200)).toBe(false);
			expect(await resize(4000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one two three', 'four five']);
			expect([left.endTime, right.startTime]).toEqual([3999, 4000]);
			expect(right.alignmentMetadata?.words[0]).toMatchObject({ word: 'four', start: 0, end: 1 });
			expect(right.alignmentMetadata!.timeFrom + right.alignmentMetadata!.words[1].start).toBe(5);
			expect(await resize(2000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one', 'two three four five']);
			expect([left.endTime, right.startTime]).toEqual([1999, 2000]);
			expect(await resize(3000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one two', 'three four five']);
			expect([left.endTime, right.startTime]).toEqual([2999, 3000]);
			expect(await resize(100000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one two three four', 'five']);
			ProjectHistoryManager.commit();

			expect(ProjectHistoryManager.undo()).toBe(true);
			expect(globalState.getSubtitleTrack.clips.map((clip) => (clip as SubtitleClip).text)).toEqual(
				['one two', 'three four five']
			);
			expect(ProjectHistoryManager.undo()).toBe(false);
			expect(ProjectHistoryManager.redo()).toBe(true);
			expect(globalState.getSubtitleTrack.clips[1]).toMatchObject({
				text: 'five',
				startTime: 5000
			});
		}
	);

	it('requires a timed right neighbor and never crosses silence or the track edges', () => {
		const [left, right] = createWordResizeClips();
		const track = globalState.getSubtitleTrack;
		expect(track.createWordBoundaryResize(left.id, 'start')).toBeNull();
		expect(track.createWordBoundaryResize(right.id, 'end')).toBeNull();
		right.alignmentMetadata = null;
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
		track.clips.splice(1, 0, new SilenceClip(3000, 3100));
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
	});

	it('absorbs timed words into an untimed left subtitle without inventing its alignment', async () => {
		const [left, right] = createWordResizeClips();
		left.alignmentMetadata = null;
		const resize = globalState.getSubtitleTrack.createWordBoundaryResize(left.id, 'end')!;
		expect(await resize(4000)).toBe(true);
		expect(left.text).toBe('one two three');
		expect(left.alignmentMetadata).toBeNull();
		expect(right.text).toBe('four five');
	});

	it('preserves reference and quotation markers while transferring words', async () => {
		const [left, right] = createWordResizeClips();
		right.text = '{{2:153:2-3}} {{five}}';
		const resize = globalState.getSubtitleTrack.createWordBoundaryResize(left.id, 'end')!;
		expect(await resize(4000)).toBe(true);
		expect(left.text).toBe('one two {{2:153:2-2}}');
		expect(right.text).toBe('{{2:153:3-3}} {{five}}');
	});

	it('cancels pending transfers and applies only the latest mouse position', async () => {
		const [left, right] = createWordResizeClips();
		const resize = globalState.getSubtitleTrack.createWordBoundaryResize(left.id, 'end')!;
		const pending = resize(4000);
		await resize(null);
		expect(await pending).toBe(false);
		expect([left.text, right.text]).toEqual(['one two', 'three four five']);
		const outdated = resize(4000);
		expect(await resize(5000)).toBe(true);
		expect(await outdated).toBe(false);
		expect([left.text, right.text]).toEqual(['one two three four', 'five']);
	});

	it('undoes and redoes a simple style change', () => {
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');

		styles.setStyle('font-size', 120);
		expect(styles.findStyle('font-size')?.value).toBe(120);

		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(
			globalState.getVideoStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value
		).toBe(90);

		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(
			globalState.getVideoStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value
		).toBe(120);
	});

	it('undoes and redoes a subtitle insertion and removal', () => {
		const subtitleTrack = globalState.getSubtitleTrack;
		subtitleTrack.clips.push(
			new QuranSubtitleClip(0, 1000, 1, 1, 0, 0, 'text', [], true, true, {})
		);

		ProjectHistoryManager.track('remove test subtitle', () => {
			subtitleTrack.removeClip(subtitleTrack.clips[0].id, true);
		});
		expect(globalState.getSubtitleTrack.clips).toHaveLength(0);

		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(1);
		expect(globalState.getSubtitleTrack.clips[0]).toBeInstanceOf(SubtitleClip);

		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(0);
	});

	it('clears redo after a new action', () => {
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');

		styles.setStyle('font-size', 100);
		expect(ProjectHistoryManager.undo()).toBe(true);

		globalState.getVideoStyle.getStylesOfTarget('arabic').setStyle('font-size', 110);

		expect(ProjectHistoryManager.redo()).toBe(false);
		expect(
			globalState.getVideoStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value
		).toBe(110);
	});

	it('undoes and redoes a permanent subtitle merge in one step', () => {
		const track = globalState.getSubtitleTrack;
		const first = new SubtitleClip(0, 1000, 'First');
		const second = new SubtitleClip(1000, 2000, 'Second');
		track.clips = [first, second];
		globalState.getSubtitlesEditorState.editSubtitle = second;
		globalState.getStylesState.selectedSubtitles = [first, second];

		expect(track.mergeSubtitlesPermanently([first, second])).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(1);
		expect(globalState.getStylesState.selectedSubtitles).toEqual([track.clips[0]]);
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips.map((clip) => (clip as SubtitleClip).text)).toEqual([
			'First',
			'Second'
		]);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(1);
		expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe('First Second');
	});

	it('groups several mutations in one transaction', () => {
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');

		ProjectHistoryManager.begin('batch style edit');
		styles.setStyle('font-size', 100);
		styles.setStyle('font-size', 130);
		ProjectHistoryManager.commit();

		expect(styles.findStyle('font-size')?.value).toBe(130);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(
			globalState.getVideoStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value
		).toBe(90);
	});

	it('splits asset clips with source offsets and supports undo/redo', () => {
		const assetTrack = new AssetTrack(TrackType.Audio);
		const originalClip = new AssetClip(500, 2500, 42);
		originalClip.sourceStartTime = 750;
		originalClip.showWaveform = true;
		assetTrack.clips = [originalClip];
		globalState.currentProject = createAssetSplitTestProject(assetTrack);
		ProjectHistoryManager.resetForCurrentProject();
		globalState.getTimelineState.cursorPosition = 1500;

		expect(assetTrack.splitAssetClip(originalClip.id)).toBe(true);
		expect(assetTrack.clips).toHaveLength(2);
		expect(assetTrack.clips[0]).toMatchObject({
			startTime: 500,
			endTime: 1500,
			duration: 1000
		});
		expect(assetTrack.clips[1]).toMatchObject({
			startTime: 1500,
			endTime: 2500,
			duration: 1000,
			sourceStartTime: 1750,
			showWaveform: true,
			assetId: 42
		});

		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getAudioTrack.clips).toHaveLength(1);
		expect(globalState.getAudioTrack.clips[0]).toMatchObject({
			startTime: 500,
			endTime: 2500,
			sourceStartTime: 750
		});

		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getAudioTrack.clips).toHaveLength(2);
		expect(globalState.getAudioTrack.clips[1]).toMatchObject({
			startTime: 1500,
			sourceStartTime: 1750
		});
	});

	it('restores serialized classes after undo', () => {
		const subtitleTrack = globalState.getSubtitleTrack;

		ProjectHistoryManager.track('add test subtitle', () => {
			subtitleTrack.clips.push(
				new QuranSubtitleClip(0, 1000, 1, 1, 0, 0, 'text', [], true, true, {})
			);
		});

		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.currentProject).toBeInstanceOf(Project);
		expect(globalState.currentProject?.content.videoStyle).toBeInstanceOf(VideoStyle);
		expect(
			globalState.currentProject?.content.timeline.getFirstTrack(TrackType.Subtitle)
		).toBeInstanceOf(SubtitleTrack);
	});
});
