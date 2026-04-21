import { describe, expect, it } from 'vitest';

import { ProjectDetail } from '$lib/classes';
import { PROJECT_TYPE_OPTIONS } from '$lib/types/projectType';
import {
	ALL_PROJECTS_SELECTION,
	buildProjectExplorerTree,
	filterProjectsForSelection,
	resolveDropTargetUpdate
} from '$lib/components/home/homeExplorer';

function createProject(
	name: string,
	reciter: string,
	projectType: ConstructorParameters<typeof ProjectDetail>[4]
) {
	return new ProjectDetail(name, reciter, undefined, undefined, projectType);
}

describe('homeExplorer helpers', () => {
	it('builds a distinct reciter tree sorted by most recently updated project', () => {
		const olderYasser = createProject('A', 'Yasser Al Dosari', 'Prayer');
		const muhammad = createProject('B', 'Muhammad Al Luhaidan', 'Studio');
		const recentYasser = createProject('C', 'Yasser Al Dosari', 'Taraweeh');
		olderYasser.updatedAt = new Date('2026-04-20T10:00:00.000Z');
		muhammad.updatedAt = new Date('2026-04-20T11:00:00.000Z');
		recentYasser.updatedAt = new Date('2026-04-20T12:00:00.000Z');
		const projects = [olderYasser, muhammad, recentYasser];

		const tree = buildProjectExplorerTree(projects);

		expect(tree.totalCount).toBe(3);
		expect(tree.reciters.map((node) => node.reciter)).toEqual([
			'Yasser Al Dosari',
			'Muhammad Al Luhaidan'
		]);
	});

	it('keeps all fixed type folders even when some counts are zero', () => {
		const projects = [createProject('A', 'Yasser Al Dosari', 'Prayer')];

		const tree = buildProjectExplorerTree(projects);
		const yasser = tree.reciters[0];

		expect(yasser.types.map((node) => node.projectType)).toEqual([...PROJECT_TYPE_OPTIONS]);
		expect(yasser.types.find((node) => node.projectType === 'Prayer')?.count).toBe(1);
		expect(yasser.types.find((node) => node.projectType === 'Studio')?.count).toBe(0);
	});

	it('filters the visible project list from the active selection', () => {
		const prayer = createProject('A', 'Yasser Al Dosari', 'Prayer');
		const studio = createProject('B', 'Yasser Al Dosari', 'Studio');
		const taraweeh = createProject('C', 'Muhammad Al Luhaidan', 'Taraweeh');
		const projects = [prayer, studio, taraweeh];

		expect(filterProjectsForSelection(projects, ALL_PROJECTS_SELECTION)).toHaveLength(3);
		expect(
			filterProjectsForSelection(projects, {
				kind: 'reciter',
				reciter: 'Yasser Al Dosari'
			})
		).toEqual([prayer, studio]);
		expect(
			filterProjectsForSelection(projects, {
				kind: 'type',
				reciter: 'Yasser Al Dosari',
				projectType: 'Prayer'
			})
		).toEqual([prayer]);
	});

	it('resolves drop targets with the expected metadata updates', () => {
		expect(resolveDropTargetUpdate(ALL_PROJECTS_SELECTION)).toBeNull();
		expect(
			resolveDropTargetUpdate({
				kind: 'reciter',
				reciter: 'Yasser Al Dosari'
			})
		).toEqual({
			reciter: 'Yasser Al Dosari',
			projectType: 'Others'
		});
		expect(
			resolveDropTargetUpdate({
				kind: 'type',
				reciter: 'Yasser Al Dosari',
				projectType: 'Prayer'
			})
		).toEqual({
			reciter: 'Yasser Al Dosari',
			projectType: 'Prayer'
		});
	});
});
