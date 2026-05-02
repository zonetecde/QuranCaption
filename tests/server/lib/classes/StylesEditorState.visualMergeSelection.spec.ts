import { afterEach, describe, expect, it } from 'vitest';

import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { Timeline } from '$lib/classes/Timeline.svelte';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Cree un sous-titre Quran minimal pour les tests de selection.
 *
 * @param {number} startTime Debut du clip.
 * @param {number} endTime Fin du clip.
 * @param {number} verse Numero de verset.
 * @returns {SubtitleClip} Clip de test.
 */
function createSubtitle(startTime: number, endTime: number, verse: number): SubtitleClip {
	return new SubtitleClip(startTime, endTime, 1, verse, 0, 0, `Verse ${verse}`, [], true, true);
}

/**
 * Construit un projet minimal avec une piste de sous-titres pour les tests d'etat.
 *
 * @param {SubtitleTrack} subtitleTrack Piste a exposer via le global state.
 * @returns {ProjectEditorState} Etat styles utilisable pendant le test.
 */
function mountProject(subtitleTrack: SubtitleTrack): ProjectEditorState {
	const projectEditorState = new ProjectEditorState();

	globalState.currentProject = {
		projectEditorState,
		content: {
			timeline: new Timeline([subtitleTrack])
		}
	} as never;

	return projectEditorState;
}

describe('styles editor merge selection', () => {
	afterEach(() => {
		globalState.currentProject = null;
	});

	it('selects the full merge group when selecting a single merged subtitle', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		first.setVisualMerge('group-a', 'arabic');
		second.setVisualMerge('group-a', 'arabic');

		const subtitleTrack = new SubtitleTrack();
		subtitleTrack.clips = [first, second];

		const projectEditorState = mountProject(subtitleTrack);

		projectEditorState.stylesEditor.selectOnly(second);

		expect(projectEditorState.stylesEditor.selectedSubtitles).toEqual([first, second]);
	});

	it('toggles a merged group as a single selection unit', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const third = createSubtitle(2000, 2999, 3);
		first.setVisualMerge('group-b', 'translation');
		second.setVisualMerge('group-b', 'translation');

		const subtitleTrack = new SubtitleTrack();
		subtitleTrack.clips = [first, second, third];

		const projectEditorState = mountProject(subtitleTrack);

		projectEditorState.stylesEditor.toggleSelection(third);
		projectEditorState.stylesEditor.toggleSelection(second);
		expect(projectEditorState.stylesEditor.selectedSubtitles).toEqual([first, second, third]);

		projectEditorState.stylesEditor.toggleSelection(first);
		expect(projectEditorState.stylesEditor.selectedSubtitles).toEqual([third]);
	});

	it('removes the full merge group when one merged subtitle is unselected', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		first.setVisualMerge('group-c', 'both');
		second.setVisualMerge('group-c', 'both');

		const subtitleTrack = new SubtitleTrack();
		subtitleTrack.clips = [first, second];

		const projectEditorState = mountProject(subtitleTrack);
		projectEditorState.stylesEditor.selectedSubtitles = [first, second];

		projectEditorState.stylesEditor.removeSelection(first.id);

		expect(projectEditorState.stylesEditor.selectedSubtitles).toEqual([]);
	});
});
