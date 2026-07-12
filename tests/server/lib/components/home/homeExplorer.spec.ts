import { describe, expect, it } from 'vitest';

import { ProjectDetail } from '$lib/classes';
import { PROJECT_TYPE_OPTIONS } from '$lib/types/projectType';
import {
	ALL_PROJECTS_SELECTION,
	buildProjectExplorerTree,
	filterProjectsForSelection,
	resolveDropTargetUpdate
} from '$lib/components/home/homeExplorer';

/**
 * Crée les métadonnées minimales d'un projet de test.
 * @param {string} name - Le nom du projet.
 * @param {string} speaker - Le nom de l'intervenant.
 * @param {ConstructorParameters<typeof ProjectDetail>[4]} projectType - Le type de contenu.
 * @returns {ProjectDetail} Le projet de test.
 */
function createProject(
	name: string,
	speaker: string,
	projectType: ConstructorParameters<typeof ProjectDetail>[4]
): ProjectDetail {
	return new ProjectDetail(name, speaker, undefined, undefined, projectType);
}

describe('homeExplorer helpers', () => {
	it('builds a distinct speaker tree sorted by project count', () => {
		const firstAhmad = createProject('A', 'Shaykh Ahmad', 'Khutbah');
		const fatima = createProject('B', 'Dr Fatima', 'Conference / Podcast');
		const secondAhmad = createProject('C', 'Shaykh Ahmad', 'Lecture / Course');
		const projects = [firstAhmad, fatima, secondAhmad];

		const tree = buildProjectExplorerTree(projects);

		expect(tree.totalCount).toBe(3);
		expect(tree.speakers.map((node) => node.speaker)).toEqual(['Shaykh Ahmad', 'Dr Fatima']);
	});

	it('keeps all fixed content type folders even when some counts are zero', () => {
		const projects = [createProject('A', 'Shaykh Ahmad', 'Khutbah')];

		const tree = buildProjectExplorerTree(projects);
		const speaker = tree.speakers[0];

		expect(speaker.types.map((node) => node.projectType)).toEqual([...PROJECT_TYPE_OPTIONS]);
		expect(speaker.types.find((node) => node.projectType === 'Khutbah')?.count).toBe(1);
		expect(speaker.types.find((node) => node.projectType === 'Reminder')?.count).toBe(0);
	});

	it('filters the visible project list from the active selection', () => {
		const khutbah = createProject('A', 'Shaykh Ahmad', 'Khutbah');
		const reminder = createProject('B', 'Shaykh Ahmad', 'Reminder');
		const course = createProject('C', 'Dr Fatima', 'Lecture / Course');
		const projects = [khutbah, reminder, course];

		expect(filterProjectsForSelection(projects, ALL_PROJECTS_SELECTION)).toHaveLength(3);
		expect(
			filterProjectsForSelection(projects, {
				kind: 'speaker',
				speaker: 'Shaykh Ahmad'
			})
		).toEqual([khutbah, reminder]);
		expect(
			filterProjectsForSelection(projects, {
				kind: 'type',
				speaker: 'Shaykh Ahmad',
				projectType: 'Khutbah'
			})
		).toEqual([khutbah]);
	});

	it('resolves drop targets with the expected metadata updates', () => {
		expect(resolveDropTargetUpdate(ALL_PROJECTS_SELECTION)).toBeNull();
		expect(
			resolveDropTargetUpdate({
				kind: 'speaker',
				speaker: 'Shaykh Ahmad'
			})
		).toEqual({
			speaker: 'Shaykh Ahmad',
			projectType: 'Lecture / Course'
		});
		expect(
			resolveDropTargetUpdate({
				kind: 'type',
				speaker: 'Shaykh Ahmad',
				projectType: 'Khutbah'
			})
		).toEqual({
			speaker: 'Shaykh Ahmad',
			projectType: 'Khutbah'
		});
	});
});
