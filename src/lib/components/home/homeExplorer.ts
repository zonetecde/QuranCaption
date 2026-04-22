import type { ProjectDetail } from '$lib/classes';
import type { ProjectType } from '$lib/types/projectType';
import { DEFAULT_PROJECT_TYPE, PROJECT_TYPE_OPTIONS } from '$lib/types/projectType';

export type ExplorerSelection =
	| { kind: 'all' }
	| { kind: 'reciter'; reciter: string }
	| { kind: 'type'; reciter: string; projectType: ProjectType }
	| { kind: 'year'; reciter: string; projectType: ProjectType; year: string };

export type ProjectExplorerYearNode = {
	id: string;
	kind: 'year';
	label: string;
	year: string;
	projectType: ProjectType;
	reciter: string;
	count: number;
};

export type ProjectExplorerTypeNode = {
	id: string;
	kind: 'type';
	label: ProjectType;
	projectType: ProjectType;
	reciter: string;
	count: number;
	years: ProjectExplorerYearNode[];
};

export type ProjectExplorerReciterNode = {
	id: string;
	kind: 'reciter';
	label: string;
	reciter: string;
	count: number;
	types: ProjectExplorerTypeNode[];
};

export type ProjectExplorerTree = {
	totalCount: number;
	reciters: ProjectExplorerReciterNode[];
};

export const ALL_PROJECTS_SELECTION: ExplorerSelection = { kind: 'all' };

/**
 * Builds the left explorer tree from the currently status-filtered project set.
 */
export function buildProjectExplorerTree(projects: ProjectDetail[]): ProjectExplorerTree {
	const groupedByReciter = new Map<string, ProjectDetail[]>();

	for (const project of projects) {
		const reciter = project.reciter?.trim() || 'not set';
		const reciterProjects = groupedByReciter.get(reciter);
		if (reciterProjects) {
			reciterProjects.push(project);
		} else {
			groupedByReciter.set(reciter, [project]);
		}
	}

	const reciters = Array.from(groupedByReciter.entries())
		.sort(([leftReciter, leftProjects], [rightReciter, rightProjects]) => {
			if (rightProjects.length !== leftProjects.length) {
				return rightProjects.length - leftProjects.length;
			}

			return leftReciter.localeCompare(rightReciter, undefined, { sensitivity: 'base' });
		})
		.map(([reciter, reciterProjects]) => ({
			id: `reciter:${reciter}`,
			kind: 'reciter' as const,
			label: reciter,
			reciter,
			count: reciterProjects.length,
			types: PROJECT_TYPE_OPTIONS.map((projectType) => {
				const typeProjects = reciterProjects.filter(
					(project) => getProjectType(project) === projectType
				);
				const groupedByYear = new Map<string, number>();
				for (const project of typeProjects) {
					const year = extractProjectYear(project.name);
					if (!year) continue;
					groupedByYear.set(year, (groupedByYear.get(year) ?? 0) + 1);
				}

				const years = Array.from(groupedByYear.entries())
					.sort(([leftYear], [rightYear]) => Number(rightYear) - Number(leftYear))
					.map(([year, count]) => ({
						id: `year:${reciter}:${projectType}:${year}`,
						kind: 'year' as const,
						label: year,
						year,
						projectType,
						reciter,
						count
					}));

				return {
					id: `type:${reciter}:${projectType}`,
					kind: 'type' as const,
					label: projectType,
					projectType,
					reciter,
					count: typeProjects.length,
					years
				};
			})
		}));

	return {
		totalCount: projects.length,
		reciters
	};
}

export function filterProjectsForSelection(
	projects: ProjectDetail[],
	selection: ExplorerSelection
): ProjectDetail[] {
	switch (selection.kind) {
		case 'all':
			return projects;
		case 'reciter':
			return projects.filter((project) => project.reciter === selection.reciter);
		case 'type':
			return projects.filter(
				(project) =>
					project.reciter === selection.reciter && getProjectType(project) === selection.projectType
			);
		case 'year':
			return projects.filter(
				(project) =>
					project.reciter === selection.reciter &&
					getProjectType(project) === selection.projectType &&
					extractProjectYear(project.name) === selection.year
			);
	}
}

/**
 * Used by the sidebar to decide which folder row should render as active.
 */
export function isSelectionActive(
	selection: ExplorerSelection,
	target: ExplorerSelection
): boolean {
	if (selection.kind !== target.kind) {
		return false;
	}

	if (selection.kind === 'all') {
		return true;
	}

	if (selection.kind === 'reciter' && target.kind === 'reciter') {
		return selection.reciter === target.reciter;
	}

	if (selection.kind === 'type' && target.kind === 'type') {
		return selection.reciter === target.reciter && selection.projectType === target.projectType;
	}

	if (selection.kind === 'year' && target.kind === 'year') {
		return (
			selection.reciter === target.reciter &&
			selection.projectType === target.projectType &&
			selection.year === target.year
		);
	}

	return false;
}

/**
 * Dropping on a reciter resets the type to the default folder.
 */
export function resolveDropTargetUpdate(
	target: ExplorerSelection
): { reciter: string; projectType: ProjectType } | null {
	switch (target.kind) {
		case 'all':
			return null;
		case 'reciter':
			return {
				reciter: target.reciter,
				projectType: DEFAULT_PROJECT_TYPE
			};
		case 'type':
			return {
				reciter: target.reciter,
				projectType: target.projectType
			};
		case 'year':
			return {
				reciter: target.reciter,
				projectType: target.projectType
			};
	}
}

/**
 * Normalizes legacy or missing values when the explorer reads project metadata.
 */
export function getProjectType(project: Pick<ProjectDetail, 'projectType'>): ProjectType {
	return project.projectType ?? DEFAULT_PROJECT_TYPE;
}

/**
 * Extracts the first recognizable Gregorian or Hijri year from a project name.
 * Supported ranges:
 * - Gregorian: 1900..2100
 * - Hijri: 1300..1700
 */
export function extractProjectYear(projectName: string | null | undefined): string | null {
	if (!projectName) return null;

	for (const match of projectName.matchAll(/\b(\d{4})\b/g)) {
		const yearText = match[1];
		const year = Number(yearText);
		if ((year >= 1900 && year <= 2100) || (year >= 1300 && year <= 1700)) {
			return yearText;
		}
	}

	return null;
}
