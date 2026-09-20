import type { ProjectDetail } from '$lib/classes';
import type { ProjectType } from '$lib/types/projectType';
import { DEFAULT_PROJECT_TYPE, PROJECT_TYPE_OPTIONS } from '$lib/types/projectType';

export type ExplorerSelection =
	| { kind: 'all' }
	| { kind: 'speaker'; speaker: string }
	| { kind: 'type'; speaker: string; projectType: ProjectType }
	| { kind: 'year'; speaker: string; projectType: ProjectType; year: string };

export type ProjectExplorerYearNode = {
	id: string;
	kind: 'year';
	label: string;
	year: string;
	projectType: ProjectType;
	speaker: string;
	count: number;
};

export type ProjectExplorerTypeNode = {
	id: string;
	kind: 'type';
	label: ProjectType;
	projectType: ProjectType;
	speaker: string;
	count: number;
	years: ProjectExplorerYearNode[];
};

export type ProjectExplorerSpeakerNode = {
	id: string;
	kind: 'speaker';
	label: string;
	speaker: string;
	count: number;
	types: ProjectExplorerTypeNode[];
};

export type ProjectExplorerTree = {
	totalCount: number;
	speakers: ProjectExplorerSpeakerNode[];
};

export const ALL_PROJECTS_SELECTION: ExplorerSelection = { kind: 'all' };

/**
 * Construit l'arborescence de l'accueil à partir des projets filtrés par statut.
 * @param {ProjectDetail[]} projects - Les projets visibles dans l'explorateur.
 * @returns {ProjectExplorerTree} L'arborescence regroupée par intervenant et type de contenu.
 */
export function buildProjectExplorerTree(
	projects: ProjectDetail[],
	projectTypes: readonly ProjectType[] = PROJECT_TYPE_OPTIONS
): ProjectExplorerTree {
	const groupedBySpeaker = new Map<string, ProjectDetail[]>();
	const availableProjectTypes = Array.from(
		new Set([...projectTypes, ...projects.map((project) => getProjectType(project))])
	).sort(
		(left, right) => Number(right === DEFAULT_PROJECT_TYPE) - Number(left === DEFAULT_PROJECT_TYPE)
	);

	for (const project of projects) {
		const speaker = project.speaker?.trim() || 'Unknown speaker';
		const speakerProjects = groupedBySpeaker.get(speaker);
		if (speakerProjects) {
			speakerProjects.push(project);
		} else {
			groupedBySpeaker.set(speaker, [project]);
		}
	}

	const speakers = Array.from(groupedBySpeaker.entries())
		.sort(([leftSpeaker, leftProjects], [rightSpeaker, rightProjects]) => {
			if (rightProjects.length !== leftProjects.length) {
				return rightProjects.length - leftProjects.length;
			}

			return leftSpeaker.localeCompare(rightSpeaker, undefined, { sensitivity: 'base' });
		})
		.map(([speaker, speakerProjects]) => ({
			id: `speaker:${speaker}`,
			kind: 'speaker' as const,
			label: speaker,
			speaker,
			count: speakerProjects.length,
			types: availableProjectTypes.map((projectType) => {
				const typeProjects = speakerProjects.filter(
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
						id: `year:${speaker}:${projectType}:${year}`,
						kind: 'year' as const,
						label: year,
						year,
						projectType,
						speaker,
						count
					}));

				return {
					id: `type:${speaker}:${projectType}`,
					kind: 'type' as const,
					label: projectType,
					projectType,
					speaker,
					count: typeProjects.length,
					years
				};
			})
		}));

	return {
		totalCount: projects.length,
		speakers
	};
}

/**
 * Filtre les projets selon le dossier actif de l'explorateur.
 * @param {ProjectDetail[]} projects - Les projets à filtrer.
 * @param {ExplorerSelection} selection - Le dossier sélectionné.
 * @returns {ProjectDetail[]} Les projets présents dans le dossier.
 */
export function filterProjectsForSelection(
	projects: ProjectDetail[],
	selection: ExplorerSelection
): ProjectDetail[] {
	switch (selection.kind) {
		case 'all':
			return projects;
		case 'speaker':
			return projects.filter((project) => project.speaker === selection.speaker);
		case 'type':
			return projects.filter(
				(project) =>
					project.speaker === selection.speaker && getProjectType(project) === selection.projectType
			);
		case 'year':
			return projects.filter(
				(project) =>
					project.speaker === selection.speaker &&
					getProjectType(project) === selection.projectType &&
					extractProjectYear(project.name) === selection.year
			);
	}
}

/**
 * Indique si un dossier de l'explorateur correspond à la sélection active.
 * @param {ExplorerSelection} selection - La sélection active.
 * @param {ExplorerSelection} target - Le dossier à comparer.
 * @returns {boolean} Vrai lorsque les deux sélections correspondent.
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

	if (selection.kind === 'speaker' && target.kind === 'speaker') {
		return selection.speaker === target.speaker;
	}

	if (selection.kind === 'type' && target.kind === 'type') {
		return selection.speaker === target.speaker && selection.projectType === target.projectType;
	}

	if (selection.kind === 'year' && target.kind === 'year') {
		return (
			selection.speaker === target.speaker &&
			selection.projectType === target.projectType &&
			selection.year === target.year
		);
	}

	return false;
}

/**
 * Résout les métadonnées à appliquer lors du déplacement d'un projet dans l'explorateur.
 * @param {ExplorerSelection} target - Le dossier de destination.
 * @returns {{ speaker: string; projectType: ProjectType } | null} Les métadonnées à appliquer.
 */
export function resolveDropTargetUpdate(
	target: ExplorerSelection
): { speaker: string; projectType: ProjectType } | null {
	switch (target.kind) {
		case 'all':
			return null;
		case 'speaker':
			return {
				speaker: target.speaker,
				projectType: DEFAULT_PROJECT_TYPE
			};
		case 'type':
			return {
				speaker: target.speaker,
				projectType: target.projectType
			};
		case 'year':
			return {
				speaker: target.speaker,
				projectType: target.projectType
			};
	}
}

/**
 * Retourne le type de contenu d'un projet.
 * @param {Pick<ProjectDetail, 'projectType'>} project - Les métadonnées du projet.
 * @returns {ProjectType} Le type de contenu du projet.
 */
export function getProjectType(project: Pick<ProjectDetail, 'projectType'>): ProjectType {
	return project.projectType ?? DEFAULT_PROJECT_TYPE;
}

/**
 * Extrait la première année grégorienne ou hégirienne reconnaissable du nom d'un projet.
 * @param {string | null | undefined} projectName - Le nom du projet.
 * @returns {string | null} L'année trouvée, ou null.
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
