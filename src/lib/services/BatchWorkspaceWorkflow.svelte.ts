import type { BatchProjectItem } from '$lib/classes';

export type BatchWorkspaceOperation =
	| 'media'
	| 'segmentation'
	| 'cbr'
	| 'translation'
	| 'background'
	| 'style'
	| 'export'
	| 'delete';

const GLOBAL_OPERATIONS: ReadonlySet<BatchWorkspaceOperation> = new Set([
	'background',
	'style',
	'export'
]);

export class BatchWorkspaceWorkflow {
	activeOperation: BatchWorkspaceOperation | null = $state(null);
	selectedProjectIds: Set<number> = $state(new Set());

	/**
	 * Démarre une opération lorsqu'aucune autre opération Batch n'est active.
	 * @param {BatchWorkspaceOperation} operation Opération à verrouiller.
	 * @returns {boolean} `true` lorsque le verrou a été acquis.
	 */
	begin(operation: BatchWorkspaceOperation): boolean {
		if (this.activeOperation !== null) return false;
		this.activeOperation = operation;
		return true;
	}

	/**
	 * Libère le verrou uniquement pour l'opération qui le détient.
	 * @param {BatchWorkspaceOperation} operation Opération terminée.
	 * @returns {void}
	 */
	finish(operation: BatchWorkspaceOperation): void {
		if (this.activeOperation === operation) this.activeOperation = null;
	}

	/**
	 * Indique si une opération précise détient le verrou du workspace.
	 * @param {BatchWorkspaceOperation} operation Opération recherchée.
	 * @returns {boolean} `true` lorsque l'opération est active.
	 */
	isActive(operation: BatchWorkspaceOperation): boolean {
		return this.activeOperation === operation;
	}

	/**
	 * Indique si l'opération active bloque toute la table des projets.
	 * @returns {boolean} `true` pour les opérations globales.
	 */
	isGlobalOperationActive(): boolean {
		return this.activeOperation !== null && GLOBAL_OPERATIONS.has(this.activeOperation);
	}

	/**
	 * Remplace la sélection courante par les identifiants fournis.
	 * @param {Iterable<number>} projectIds Identifiants à sélectionner.
	 * @returns {void}
	 */
	replaceSelection(projectIds: Iterable<number>): void {
		this.selectedProjectIds = new Set(projectIds);
	}

	/**
	 * Inverse la sélection d'un projet.
	 * @param {number} projectId Identifiant du projet concerné.
	 * @returns {void}
	 */
	toggleProject(projectId: number): void {
		const next = new Set(this.selectedProjectIds);
		if (next.has(projectId)) next.delete(projectId);
		else next.add(projectId);
		this.selectedProjectIds = next;
	}

	/**
	 * Sélectionne les projets consultables ou vide une sélection déjà complète.
	 * @param {BatchProjectItem[]} projects Projets affichés dans le workspace.
	 * @returns {void}
	 */
	toggleAllProjects(projects: BatchProjectItem[]): void {
		this.replaceSelection(
			this.areAllProjectsSelected(projects)
				? []
				: projects
						.filter((project) => project.media.status !== 'processing')
						.map((project) => project.projectId)
		);
	}

	/**
	 * Retourne les projets sélectionnés dans leur ordre d'affichage.
	 * @param {BatchProjectItem[]} projects Projets affichés dans le workspace.
	 * @returns {BatchProjectItem[]} Projets dont l'identifiant est sélectionné.
	 */
	getSelectedProjects(projects: BatchProjectItem[]): BatchProjectItem[] {
		return projects.filter((project) => this.selectedProjectIds.has(project.projectId));
	}

	/**
	 * Indique si tous les projets affichés sont sélectionnés.
	 * @param {BatchProjectItem[]} projects Projets affichés dans le workspace.
	 * @returns {boolean} `true` lorsque la sélection couvre une liste non vide.
	 */
	areAllProjectsSelected(projects: BatchProjectItem[]): boolean {
		return (
			projects.length > 0 &&
			projects.every((project) => this.selectedProjectIds.has(project.projectId))
		);
	}

	/**
	 * Détermine le stage principal à présenter pour les projets du Batch.
	 * @param {BatchProjectItem[]} projects Projets affichés dans le workspace.
	 * @returns {'media' | 'segmentation' | 'translation'} Stage actif.
	 */
	getActiveProjectStage(projects: BatchProjectItem[]): 'media' | 'segmentation' | 'translation' {
		if (!projects.every((project) => project.media.status === 'completed')) return 'media';
		if (projects.some((project) => Object.keys(project.translations).length > 0))
			return 'translation';
		return this.isActive('segmentation') ||
			projects.some((project) => project.segmentation.status !== 'not_started')
			? 'segmentation'
			: 'media';
	}
}
