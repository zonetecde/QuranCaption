import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import {
	Asset,
	AssetClip,
	AssetType,
	Category,
	Duration,
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
import { AssetTrack, CustomTextTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { CustomImageClip, SilenceClip } from '$lib/classes/Clip.svelte';
import { Quran, Verse, Word } from '$lib/classes/Quran';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import * as segmentationAudio from '$lib/services/autoSegmentation/audio';
import * as segmentationReview from '$lib/services/autoSegmentation/review';
import {
	getAutoRealignStatus,
	scheduleWbwRealign
} from '$lib/services/autoSegmentation/auto-realign.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { applyStyleMutation } from '$lib/services/StyleMutationService';
import { invoke } from '@tauri-apps/api/core';
import ModalManager from '$lib/components/modals/ModalManager';
import { loadAllLocales } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import {
	getOverlayLayerOrder,
	ensureOverlayLayerOrder,
	getOverlayLayerZIndex,
	moveOverlayLayer,
	setOverlayLayerPosition
} from '$lib/services/OverlayLayerService';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn()
}));

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
	return new Project(new ProjectDetail('Undo test', 'reciter'), content);
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
		new ProjectDetail('Asset split test', 'reciter'),
		new ProjectContent(new Timeline([assetTrack, new SubtitleTrack()]), [], undefined, videoStyle)
	);
}

describe('Quran subtitle word boundary resizing', () => {
	let left: SubtitleClip;
	let right: SubtitleClip;
	let track: SubtitleTrack;

	beforeEach(() => {
		initializeClassRegistry();
		globalState.currentProject = createHistoryTestProject();
		globalState.currentProject.content.timeline.tracks.push(new AssetTrack(TrackType.Audio));
		const verse = new Verse(
			1,
			['one', 'two', 'three', 'four', 'five'].map(
				(word) => new Word(word, word, `translation-${word}`)
			)
		);
		vi.spyOn(Quran, 'getVerse').mockResolvedValue(verse);
		left = new SubtitleClip(
			1000,
			2999,
			1,
			1,
			0,
			1,
			'one two',
			['translation-one', 'translation-two'],
			false,
			false
		);
		right = new SubtitleClip(
			3000,
			5999,
			1,
			1,
			2,
			4,
			'three four five',
			['translation-three', 'translation-four', 'translation-five'],
			false,
			true
		);
		for (const clip of [left, right]) {
			clip.alignmentMetadata = {
				source: 'local',
				segment: 1,
				refFrom: `1:1:${clip.startWordIndex + 1}`,
				refTo: `1:1:${clip.endWordIndex + 1}`,
				matchedText: clip.text,
				timeFrom: clip.startTime / 1000,
				timeTo: clip.endTime / 1000,
				words: clip.text.split(' ').map((word, index) => ({
					word,
					location: `1:1:${clip.startWordIndex + index + 1}`,
					start: index,
					end: index === clip.endWordIndex - clip.startWordIndex ? clip.duration / 1000 : index + 1
				}))
			};
		}
		track = globalState.getSubtitleTrack;
		track.clips = [left, right];
		ProjectHistoryManager.resetForCurrentProject();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		ProjectHistoryManager.clear();
	});

	it.each([false, true])(
		'cancels an older automatic realignment before word transfer (already running: %s)',
		async (running) => {
			vi.useFakeTimers();
			vi.spyOn(segmentationAudio, 'getAutoSegmentationAudioClips').mockReturnValue([
				{
					filePath: 'test.wav',
					fileName: 'test.wav',
					startMs: 0,
					endMs: 6000,
					sourceStartMs: 0
				}
			]);
			let resolve!: (value: { enriched: number; total: number }) => void;
			const calculation = new Promise<{ enriched: number; total: number }>((done) => {
				resolve = done;
			});
			const compute = vi
				.spyOn(segmentationReview, 'computeWbwTimestampsForClipsSliced')
				.mockReturnValue(calculation);
			scheduleWbwRealign([left, right], { reason: 'drag' });
			expect(getAutoRealignStatus(left.id)).toBe('computing');
			if (running) await vi.advanceTimersByTimeAsync(300);
			expect(track.createWordBoundaryResize(left.id, 'end')).not.toBeNull();
			expect(getAutoRealignStatus(left.id)).toBe('idle');
			expect(getAutoRealignStatus(right.id)).toBe('idle');
			if (running) {
				expect(compute.mock.calls[0][1].shouldCommit!(left)).toBe(false);
				expect(compute.mock.calls[0][1].shouldCommit!(right)).toBe(false);
			} else expect(vi.getTimerCount()).toBe(0);
			resolve({ enriched: 0, total: 2 });
			await vi.advanceTimersByTimeAsync(0);
		}
	);

	it.each(['start', 'end'] as const)(
		'transfers whole words from the %s edge and supports one-step undo/redo',
		async (edge) => {
			const resize = track.createWordBoundaryResize(edge === 'start' ? right.id : left.id, edge)!;
			ProjectHistoryManager.begin('resize subtitle');
			expect(await resize(3200)).toBe(false);
			expect(await resize(4000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one two three', 'four five']);
			expect([left.endTime, right.startTime]).toEqual([3999, 4000]);
			expect([left.endWordIndex, right.startWordIndex]).toEqual([2, 3]);
			expect(left.wbwTranslation).toEqual([
				'translation-one',
				'translation-two',
				'translation-three'
			]);
			expect(right.alignmentMetadata?.words[0]).toMatchObject({
				location: '1:1:4',
				start: 0,
				end: 1
			});
			expect(right.alignmentMetadata!.timeFrom + right.alignmentMetadata!.words[1].start).toBe(5);
			expect([left.isFullVerse, left.isLastWordsOfVerse, right.isLastWordsOfVerse]).toEqual([
				false,
				false,
				true
			]);
			expect(await resize(2000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one', 'two three four five']);
			expect([left.endTime, right.startTime]).toEqual([1999, 2000]);
			expect(await resize(3000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one two', 'three four five']);
			expect([left.endTime, right.startTime]).toEqual([2999, 3000]);
			expect(await resize(100000)).toBe(true);
			expect([left.text, right.text]).toEqual(['one two three four', 'five']);
			expect(
				globalState.getSubtitlesEditorState.segmentationContext.alignedSegments[1]
			).toMatchObject({
				clipId: right.id,
				refFrom: '1:1:5',
				startMs: 5000
			});
			ProjectHistoryManager.commit();
			expect(ProjectHistoryManager.undo()).toBe(true);
			expect(globalState.getSubtitleTrack.clips[0]).toMatchObject({
				text: 'one two',
				endWordIndex: 1,
				endTime: 2999
			});
			expect(ProjectHistoryManager.undo()).toBe(false);
			expect(ProjectHistoryManager.redo()).toBe(true);
			expect(globalState.getSubtitleTrack.clips[1]).toMatchObject({
				text: 'five',
				startWordIndex: 4,
				startTime: 5000
			});
		}
	);

	it('tracks a single shortcut transfer without an outer drag transaction', async () => {
		expect(await track.createWordBoundaryResize(left.id, 'end')!(2000)).toBe(true);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips[0]).toMatchObject({
			text: 'one two',
			endWordIndex: 1
		});
		expect(ProjectHistoryManager.undo()).toBe(false);
	});

	it('requires consecutive ranges of the same verse, a right WBW alignment and direct neighbors', () => {
		expect(track.createWordBoundaryResize(left.id, 'start')).toBeNull();
		expect(track.createWordBoundaryResize(right.id, 'end')).toBeNull();
		right.verse = 2;
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
		right.verse = 1;
		right.startWordIndex = 3;
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
		right.startWordIndex = 2;
		const metadata = right.alignmentMetadata;
		right.alignmentMetadata = null;
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
		right.alignmentMetadata = metadata;
		track.clips.splice(1, 0, new SilenceClip(3000, 3100));
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
	});

	it('rejects incomplete or non-finite word timestamps', () => {
		right.alignmentMetadata!.words[1].start = NaN;
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
		right.alignmentMetadata!.words.shift();
		expect(track.createWordBoundaryResize(left.id, 'end')).toBeNull();
	});

	it('can absorb timed words into an untimed left clip without inventing its alignment', async () => {
		left.alignmentMetadata = null;
		const resize = track.createWordBoundaryResize(left.id, 'end')!;
		expect(await resize(4000)).toBe(true);
		expect(left.text).toBe('one two three');
		expect(left.alignmentMetadata).toBeNull();
		expect(await resize(1000)).toBe(true);
		expect(left.text).toBe('one two');
	});

	it('refreshes translations and restores the original manual translation on returning to the original boundary', async () => {
		left.translations.english = new VerseTranslation('manually trimmed', 'to review');
		vi.spyOn(globalState.getProjectTranslation, 'getTranslations').mockResolvedValue({
			english: new VerseTranslation('full verse', 'to review')
		});
		const resize = track.createWordBoundaryResize(left.id, 'end')!;
		expect(await resize(4000)).toBe(true);
		expect(left.translations.english.text).toBe('full verse');
		expect(await resize(3000)).toBe(true);
		expect(left.translations.english.text).toBe('manually trimmed');
	});

	it('cancels pending transfers and applies only the latest mouse position', async () => {
		const resize = track.createWordBoundaryResize(left.id, 'end')!;
		const pending = resize(4000);
		await resize(null);
		expect(await pending).toBe(false);
		expect(left.text).toBe('one two');
		const outdated = resize(4000);
		expect(await resize(5000)).toBe(true);
		expect(await outdated).toBe(false);
		expect([left.text, right.text]).toEqual(['one two three four', 'five']);
	});

	it('does not apply a pending transfer after switching projects', async () => {
		const pending = track.createWordBoundaryResize(left.id, 'end')!(4000);
		globalState.currentProject = createHistoryTestProject();
		expect(await pending).toBe(false);
		expect(left.text).toBe('one two');
	});
});

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
		await asset.addToTimeline(true, true, false, startTime);
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
		await asset.addToTimeline(true, false, false, 4000);
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
			await asset.addToTimeline(true, true, false, startTime);
			expect(globalState.getVideoTrack.clips).toHaveLength(0);
			expect(globalState.getAudioTrack.clips).toHaveLength(1);
			expect(ModalManager.errorModal).toHaveBeenCalled();
		}
	);

	it('rejects insertion after a looped clip', async () => {
		const clip = new AssetClip(0, 1000, 1);
		clip.loopUntilAudioEnd = true;
		globalState.getVideoTrack.clips = [clip];
		await asset.addToTimeline(true, false, false, 4000);
		expect(globalState.getVideoTrack.clips).toHaveLength(1);
		expect(ModalManager.errorModal).toHaveBeenCalled();
	});

	it('keeps normal additions at the end of the track', async () => {
		globalState.getVideoTrack.clips = [new AssetClip(0, 1000, 1)];
		await asset.addToTimeline(true, false);
		expect(globalState.getVideoTrack.clips[1]).toMatchObject({ startTime: 1001, endTime: 3001 });
	});
});

describe('ProjectHistoryManager', () => {
	beforeEach(() => {
		initializeClassRegistry();
		globalState.currentProject = createHistoryTestProject();
		ProjectHistoryManager.resetForCurrentProject();
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

	it('undoes and redoes a composite text rotation through the shared style mutation', () => {
		const rotation = new Style({
			id: 'rotation',
			value: 0,
			valueType: 'number',
			css: 'rotate: {value}deg;'
		});
		const composite = new Style({
			id: 'surah-latin-text-style',
			valueType: 'composite',
			value: [rotation]
		});
		globalState.getVideoStyle.styles.push(
			new StylesData('global', [new Category({ id: 'surah-name', styles: [composite] })])
		);
		applyStyleMutation({
			videoStyle: globalState.getVideoStyle,
			style: rotation,
			target: composite.id,
			clipIds: [],
			value: -45,
			applyBaseValue: (value) => {
				rotation.value = value;
			}
		});
		expect(composite.generateCSSForComposite()).toContain('rotate: -45deg;');
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(
			globalState.getStyle('global', 'surah-latin-text-style').generateCSSForComposite()
		).toContain('rotate: 0deg;');
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(
			globalState.getStyle('global', 'surah-latin-text-style').generateCSSForComposite()
		).toContain('rotate: -45deg;');
	});

	it('places Surah names behind Arabic and translations in both new and legacy projects', () => {
		const content = globalState.currentProject!.content;
		content.projectTranslation.addedTranslationEditions.push({ name: 'english' } as never);
		expect(content.overlayLayerOrder).toEqual([]);
		expect(getOverlayLayerZIndex('surah-name')).toBeLessThan(getOverlayLayerZIndex('arabic'));
		expect(getOverlayLayerZIndex('arabic')).toBeGreaterThan(getOverlayLayerZIndex('surah-name'));
		expect(getOverlayLayerZIndex('video-frame')).toBeGreaterThan(
			getOverlayLayerZIndex('verse-number')
		);
		expect(getOverlayLayerZIndex('surah-name')).toBeLessThan(getOverlayLayerZIndex('english'));
		const legacy = globalState.currentProject!.toJSON();
		delete (legacy.content as Record<string, unknown>).overlayLayerOrder;
		globalState.currentProject = Project.fromJSON(legacy) as Project;
		expect(globalState.currentProject.content.overlayLayerOrder).toEqual([]);
		expect(ensureOverlayLayerOrder(globalState.currentProject.content)).toBe(true);
		expect(globalState.currentProject.content.overlayLayerOrder).toContain('surah-name');
		expect(getOverlayLayerZIndex('surah-name')).toBeLessThan(getOverlayLayerZIndex('arabic'));
		expect(getOverlayLayerZIndex('arabic')).toBeGreaterThan(getOverlayLayerZIndex('surah-name'));
	});

	it('preserves explicit layer changes and restores the default order with undo and redo', () => {
		for (let attempt = 0; attempt < 5; attempt++) {
			moveOverlayLayer('surah-name', -1, ['surah-name', 'arabic']);
		}
		expect(globalState.currentProject!.content.overlayLayerOrder).toEqual([]);
		expect(ProjectHistoryManager.undo()).toBe(false);
		moveOverlayLayer('surah-name', 1, ['surah-name', 'arabic']);
		expect(getOverlayLayerZIndex('surah-name')).toBeGreaterThan(getOverlayLayerZIndex('arabic'));
		expect(
			(Project.fromJSON(globalState.currentProject!.toJSON()) as Project).content.overlayLayerOrder
		).toEqual(globalState.currentProject!.content.overlayLayerOrder);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.currentProject!.content.overlayLayerOrder).toEqual([]);
		expect(getOverlayLayerZIndex('surah-name')).toBeLessThan(getOverlayLayerZIndex('arabic'));
		expect(getOverlayLayerZIndex('arabic')).toBeGreaterThan(getOverlayLayerZIndex('surah-name'));
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(getOverlayLayerZIndex('surah-name')).toBeGreaterThan(getOverlayLayerZIndex('arabic'));
	});

	it('moves past hidden layers, ignores bounds, and adds new layers without retaining deleted IDs', () => {
		const content = globalState.currentProject!.content;
		const original = getOverlayLayerOrder(content);
		moveOverlayLayer('arabic', -1, ['arabic', 'verse-number']);
		expect(content.overlayLayerOrder).toEqual([]);
		moveOverlayLayer('arabic', 1, ['arabic', 'verse-number']);
		expect(getOverlayLayerZIndex('arabic')).toBeGreaterThan(getOverlayLayerZIndex('verse-number'));
		content.overlayLayerOrder = ['deleted', 'arabic', 'arabic'];
		expect(getOverlayLayerOrder(content)).toEqual([
			'arabic',
			...original.filter((id) => id !== 'arabic')
		]);
	});

	it('undoes and redoes the default Z initialization when importing a legacy preset', async () => {
		const videoStyle = globalState.getVideoStyle;
		globalState.currentProject!.content.overlayLayerOrder = ['arabic', 'surah-name'];
		const schema = vi.spyOn(videoStyle, 'ensureStylesSchemaUpToDate').mockResolvedValue(false);
		try {
			await videoStyle.importStyles({ videoStyle: videoStyle.toJSON(), customClips: [] });
		} finally {
			schema.mockRestore();
		}
		expect(globalState.currentProject!.content.overlayLayerOrder[0]).toBe('surah-name');
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.currentProject!.content.overlayLayerOrder).toEqual(['arabic', 'surah-name']);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.currentProject!.content.overlayLayerOrder[0]).toBe('surah-name');
	});

	it('initializes missing project Z data above custom images without changing a saved order', () => {
		const content = globalState.currentProject!.content;
		const track = new CustomTextTrack();
		const image = new CustomImageClip(
			new Category({ id: 'image', styles: [new Style({ id: 'above-overlay', value: true })] })
		);
		track.clips.push(image);
		content.timeline.tracks.push(track);
		expect(ensureOverlayLayerOrder(content)).toBe(true);
		expect(content.overlayLayerOrder.indexOf(`custom:${image.id}`)).toBeLessThan(
			content.overlayLayerOrder.indexOf('surah-name')
		);
		expect(content.overlayLayerOrder.indexOf('surah-name')).toBeLessThan(
			content.overlayLayerOrder.indexOf('arabic')
		);
		moveOverlayLayer('surah-name', 1, ['surah-name', 'arabic']);
		const saved = [...content.overlayLayerOrder];
		expect(ensureOverlayLayerOrder(content)).toBe(false);
		expect(content.overlayLayerOrder).toEqual(saved);
	});

	it('keeps background images behind text until a layer move explicitly brings them above it', () => {
		const track = new CustomTextTrack();
		const image = new CustomImageClip(
			new Category({
				id: 'image',
				styles: [new Style({ id: 'above-overlay', value: false, valueType: 'boolean' })]
			})
		);
		track.clips.push(image);
		globalState.currentProject!.content.timeline.tracks.push(track);
		const imageId = `custom:${image.id}`;
		expect(getOverlayLayerOrder(globalState.currentProject!.content)[0]).toBe(imageId);
		moveOverlayLayer(imageId, -1, [imageId, 'arabic']);
		expect(image.category!.getStyle('above-overlay')!.value).toBe(false);
		moveOverlayLayer(imageId, 1, [imageId, 'arabic']);
		expect(image.category!.getStyle('above-overlay')!.value).toBe(true);
		expect(getOverlayLayerZIndex(imageId)).toBeGreaterThan(getOverlayLayerZIndex('arabic'));
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(getOverlayLayerOrder(globalState.currentProject!.content)[0]).toBe(imageId);
	});

	it('sets a bounded layer position and undoes a multi-layer slider change in one step', () => {
		setOverlayLayerPosition('surah-name', 999);
		const content = globalState.currentProject!.content;
		expect(getOverlayLayerOrder(content).at(-1)).toBe('surah-name');
		const savedOrder = [...content.overlayLayerOrder];
		for (let attempt = 0; attempt < 5; attempt++) {
			moveOverlayLayer('surah-name', 1, ['reciter-name', 'surah-name']);
			setOverlayLayerPosition('surah-name', 999);
		}
		expect(content.overlayLayerOrder).toEqual(savedOrder);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(getOverlayLayerOrder(globalState.currentProject!.content)[0]).toBe('surah-name');
		expect(ProjectHistoryManager.undo()).toBe(false);
		for (let attempt = 0; attempt < 5; attempt++) {
			moveOverlayLayer('surah-name', -1, ['reciter-name', 'surah-name']);
			setOverlayLayerPosition('surah-name', -999);
		}
		expect(ProjectHistoryManager.undo()).toBe(false);
	});

	it('undoes and redoes a subtitle insertion and removal', () => {
		const subtitleTrack = globalState.getSubtitleTrack;
		subtitleTrack.clips.push(new SubtitleClip(0, 1000, 1, 1, 0, 0, 'text', [], true, true, {}));

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
			subtitleTrack.clips.push(new SubtitleClip(0, 1000, 1, 1, 0, 0, 'text', [], true, true, {}));
		});

		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.currentProject).toBeInstanceOf(Project);
		expect(globalState.currentProject?.content.videoStyle).toBeInstanceOf(VideoStyle);
		expect(
			globalState.currentProject?.content.timeline.getFirstTrack(TrackType.Subtitle)
		).toBeInstanceOf(SubtitleTrack);
	});
});
