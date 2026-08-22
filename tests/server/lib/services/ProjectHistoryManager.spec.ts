import { beforeEach, describe, expect, it } from 'vitest';

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
