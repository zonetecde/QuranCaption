import { describe, expect, it, vi } from 'vitest';

import { Edition, ProjectTranslation, SubtitleClip, type Project } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';

const edition = new Edition('key', 'edition', 'Author', 'English', 'ltr', '', '', '', '');

/**
 * Construit un projet explicite avec une piste Quran et un VideoStyle observable.
 * @param {ProjectTranslation} projectTranslation Gestionnaire de traduction sous test.
 * @returns {Project} Projet minimal indépendant du projet ouvert.
 */
function createProject(projectTranslation: ProjectTranslation): Project {
	const clips = [
		new SubtitleClip(0, 1000, 1, 1, 0, 4, 'Full', [], true, true),
		new SubtitleClip(1000, 2000, 1, 2, 0, 1, 'Partial', [], false, true)
	];
	return {
		detail: { translations: {} },
		content: {
			timeline: { getFirstTrack: () => ({ clips }) },
			projectTranslation,
			videoStyle: { addStylesForEdition: vi.fn(async () => undefined) }
		}
	} as unknown as Project;
}

describe('ProjectTranslation project-scoped operations', () => {
	it('downloads, creates translations and styles in the explicitly supplied project', async () => {
		const projectTranslation = new ProjectTranslation();
		const project = createProject(projectTranslation);
		const currentProject = { detail: { id: 999 } } as Project;
		globalState.currentProject = currentProject;
		vi.spyOn(projectTranslation, 'downloadVerseTranslation').mockImplementation(
			async (_edition, surah, verse) => `${surah}:${verse} text`
		);

		const downloaded = await projectTranslation.getAllProjectSubtitlesTranslationsForProject(
			project,
			edition
		);
		const changed = await projectTranslation.addTranslationToProject(project, edition, downloaded);

		expect(changed).toBe(true);
		expect(downloaded).toEqual({ '1:1': '1:1 text', '1:2': '1:2 text' });
		expect(projectTranslation.addedTranslationEditions.map((item) => item.name)).toEqual([
			'edition'
		]);
		const clips = project.content.timeline.getFirstTrack('Subtitle' as never)
			.clips as SubtitleClip[];
		expect(clips[0].translations.edition.status).toBe('completed by default');
		expect(clips[1].translations.edition.status).toBe('to review');
		expect(project.content.videoStyle.addStylesForEdition).toHaveBeenCalledWith('edition');
		expect(globalState.currentProject).toBe(currentProject);
	});

	it('skips an existing edition unless replacement is explicitly requested', async () => {
		const projectTranslation = new ProjectTranslation();
		projectTranslation.addedTranslationEditions.push(edition);
		const project = createProject(projectTranslation);

		expect(
			await projectTranslation.addTranslationToProject(
				project,
				edition,
				{},
				{ replaceExisting: false }
			)
		).toBe(false);
		expect(project.content.videoStyle.addStylesForEdition).not.toHaveBeenCalled();
	});
});
