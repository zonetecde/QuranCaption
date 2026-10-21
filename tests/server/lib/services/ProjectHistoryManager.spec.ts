import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import {
	AssetClip,
	Category,
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
import { CustomImageClip } from '$lib/classes/Clip.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { applyStyleMutation } from '$lib/services/StyleMutationService';
import {
	getOverlayLayerOrder,
	ensureOverlayLayerOrder,
	getOverlayLayerZIndex,
	moveOverlayLayer,
	setOverlayLayerPosition
} from '$lib/services/OverlayLayerService';

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
