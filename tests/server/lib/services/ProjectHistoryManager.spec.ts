import { beforeEach, describe, expect, it } from 'vitest';

import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import {
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
import { SubtitleTrack } from '$lib/classes/Track.svelte';
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
