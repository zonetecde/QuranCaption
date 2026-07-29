import { globalState } from '$lib/runes/main.svelte';
import type { Project } from '$lib/classes/Project';
import { writable } from 'svelte/store';

type ProjectSnapshot = string;

type HistoryEntry = {
	label: string;
	snapshot: ProjectSnapshot;
};

type RuntimeVideoPreviewCallbacks = {
	togglePlayPause: () => void;
	scrollTimelineToCursor: () => void;
};

type ActiveTransaction = {
	label: string;
	before: ProjectSnapshot;
	depth: number;
};

type ProjectConstructor = {
	fromJSON(data: Record<string, unknown>): Project;
};

const MAX_HISTORY_ENTRIES = 100;

export const projectHistoryAvailability = writable({
	canUndo: false,
	canRedo: false
});

export class ProjectHistoryManager {
	private static undoStack: HistoryEntry[] = [];
	private static redoStack: HistoryEntry[] = [];
	private static transaction: ActiveTransaction | null = null;
	private static operationDepth = 0;
	private static ignoreDepth = 0;
	private static isRestoring = false;
	private static projectId: number | null = null;

	/**
	 * Publie l'état actuel des boutons undo/redo.
	 * @returns {void}
	 */
	private static updateAvailability(): void {
		projectHistoryAvailability.set({
			canUndo: this.undoStack.length > 0 && !this.isRestoring,
			canRedo: this.redoStack.length > 0 && !this.isRestoring
		});
	}

	/**
	 * Capture l'état courant du projet sous forme JSON stable.
	 * @returns {ProjectSnapshot | null} Snapshot du projet courant, ou `null` sans projet ouvert.
	 */
	private static capture(): ProjectSnapshot | null {
		if (!globalState.currentProject) return null;
		return JSON.stringify(globalState.currentProject.toJSON());
	}

	/**
	 * Indique si une mutation doit être ignorée par l'historique.
	 * @returns {boolean} `true` si l'historique ne doit pas capturer.
	 */
	private static shouldSkipTracking(): boolean {
		return (
			!globalState.currentProject ||
			this.isRestoring ||
			this.ignoreDepth > 0 ||
			this.operationDepth > 0
		);
	}

	/**
	 * Ajoute une entrée undo si le snapshot a vraiment changé.
	 * @param {string} label Nom court de l'action.
	 * @param {ProjectSnapshot | null} before Snapshot avant mutation.
	 * @param {ProjectSnapshot | null} after Snapshot après mutation.
	 * @returns {void}
	 */
	private static pushUndoEntry(
		label: string,
		before: ProjectSnapshot | null,
		after: ProjectSnapshot | null
	): void {
		if (!before || !after || before === after) return;

		this.undoStack.push({ label, snapshot: before });
		if (this.undoStack.length > MAX_HISTORY_ENTRIES) {
			this.undoStack.shift();
		}
		this.redoStack = [];
		this.updateAvailability();
	}

	/**
	 * Restaure les callbacks runtime non sérialisés après un fromJSON.
	 * @param {Project} restored Projet restauré.
	 * @param {RuntimeVideoPreviewCallbacks | null} callbacks Callbacks à réinjecter.
	 * @returns {void}
	 */
	private static restoreRuntimeCallbacks(
		restored: Project,
		callbacks: RuntimeVideoPreviewCallbacks | null
	): void {
		if (!callbacks) return;

		restored.projectEditorState.videoPreview.togglePlayPause = callbacks.togglePlayPause;
		restored.projectEditorState.videoPreview.scrollTimelineToCursor =
			callbacks.scrollTimelineToCursor;
	}

	/**
	 * Met à jour la référence du détail dans la liste des projets.
	 * @returns {void}
	 */
	private static syncProjectDetailList(): void {
		const project = globalState.currentProject;
		if (!project) return;

		const detailIndex = globalState.userProjectsDetails.findIndex(
			(detail) => detail.id === project.detail.id
		);
		if (detailIndex !== -1) {
			globalState.userProjectsDetails[detailIndex] = project.detail;
		}
	}

	/**
	 * Restaure un snapshot de projet et rafraîchit l'UI dépendante.
	 * @param {ProjectSnapshot} snapshot Snapshot JSON du projet.
	 * @returns {void}
	 */
	private static restoreSnapshot(snapshot: ProjectSnapshot): void {
		const previousEditorState = globalState.currentProject?.projectEditorState;
		const previousVideoStyle = globalState.currentProject?.content.videoStyle;
		const previousPreviewState = previousEditorState?.videoPreview;
		const currentTab = previousEditorState?.currentTab;
		const callbacks: RuntimeVideoPreviewCallbacks | null = previousPreviewState
			? {
					togglePlayPause: previousPreviewState.togglePlayPause,
					scrollTimelineToCursor: previousPreviewState.scrollTimelineToCursor
				}
			: null;

		const projectConstructor = globalState.currentProject?.constructor as
			| ProjectConstructor
			| undefined;
		if (!projectConstructor) return;

		const restored = projectConstructor.fromJSON(JSON.parse(snapshot));
		if (currentTab) restored.projectEditorState.currentTab = currentTab;
		if (previousVideoStyle) {
			restored.content.videoStyle.copyStyleEditorUiMetadataFrom(previousVideoStyle);
		}
		this.restoreRuntimeCallbacks(restored, callbacks);

		this.isRestoring = true;
		try {
			globalState.currentProject = restored;
			this.projectId = restored.detail.id;
			this.syncProjectDetailList();
			globalState.closeAllMenus();
			globalState.getTimelineState.movePreviewTo = globalState.getTimelineState.cursorPosition;
		} finally {
			this.isRestoring = false;
		}
	}

	/**
	 * Réinitialise l'historique pour le projet ouvert.
	 * @returns {void}
	 */
	static resetForCurrentProject(): void {
		this.clear();
		this.projectId = globalState.currentProject?.detail.id ?? null;
	}

	/**
	 * Vide les piles undo/redo et la transaction en cours.
	 * @returns {void}
	 */
	static clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.transaction = null;
		this.updateAvailability();
	}

	/**
	 * Exécute une mutation synchrone en capturant son avant/après.
	 * @template T
	 * @param {string} label Nom court de l'action.
	 * @param {() => T} mutate Mutation à exécuter.
	 * @returns {T} Résultat de la mutation.
	 */
	static track<T>(label: string, mutate: () => T): T {
		if (this.shouldSkipTracking() || this.transaction) {
			return mutate();
		}

		const before = this.capture();
		this.operationDepth += 1;
		try {
			return mutate();
		} finally {
			this.operationDepth -= 1;
			this.pushUndoEntry(label, before, this.capture());
		}
	}

	/**
	 * Exécute une mutation asynchrone en capturant son avant/après.
	 * @template T
	 * @param {string} label Nom court de l'action.
	 * @param {() => Promise<T>} mutate Mutation asynchrone à exécuter.
	 * @returns {Promise<T>} Résultat de la mutation.
	 */
	static async trackAsync<T>(label: string, mutate: () => Promise<T>): Promise<T> {
		if (this.shouldSkipTracking() || this.transaction) {
			return await mutate();
		}

		const before = this.capture();
		this.operationDepth += 1;
		try {
			return await mutate();
		} finally {
			this.operationDepth -= 1;
			this.pushUndoEntry(label, before, this.capture());
		}
	}

	/**
	 * Démarre une transaction qui regroupe plusieurs mutations en une entrée.
	 * @param {string} label Nom court de l'action groupée.
	 * @returns {void}
	 */
	static begin(label: string): void {
		if (this.shouldSkipTracking()) return;

		if (this.transaction) {
			this.transaction.depth += 1;
			return;
		}

		const before = this.capture();
		if (!before) return;
		this.transaction = { label, before, depth: 1 };
	}

	/**
	 * Valide la transaction courante si son contenu a changé.
	 * @returns {void}
	 */
	static commit(): void {
		if (!this.transaction) return;

		if (this.transaction.depth > 1) {
			this.transaction.depth -= 1;
			return;
		}

		const transaction = this.transaction;
		this.transaction = null;
		this.pushUndoEntry(transaction.label, transaction.before, this.capture());
		this.updateAvailability();
	}

	/**
	 * Annule la transaction courante sans modifier le projet.
	 * @returns {void}
	 */
	static cancel(): void {
		if (!this.transaction) return;

		if (this.transaction.depth > 1) {
			this.transaction.depth -= 1;
			return;
		}

		this.transaction = null;
		this.updateAvailability();
	}

	/**
	 * Exécute une opération sans l'ajouter à l'historique.
	 * @template T
	 * @param {() => T} callback Opération à ignorer.
	 * @returns {T} Résultat de l'opération.
	 */
	static ignore<T>(callback: () => T): T {
		this.ignoreDepth += 1;
		try {
			return callback();
		} finally {
			this.ignoreDepth -= 1;
		}
	}

	/**
	 * Exécute une opération asynchrone sans l'ajouter à l'historique.
	 * @template T
	 * @param {() => Promise<T>} callback Opération asynchrone à ignorer.
	 * @returns {Promise<T>} Résultat de l'opération.
	 */
	static async ignoreAsync<T>(callback: () => Promise<T>): Promise<T> {
		this.ignoreDepth += 1;
		try {
			return await callback();
		} finally {
			this.ignoreDepth -= 1;
		}
	}

	/**
	 * Restaure l'état précédent du projet.
	 * @returns {boolean} `true` si un undo a été appliqué.
	 */
	static undo(): boolean {
		if (!globalState.currentProject || this.undoStack.length === 0 || this.isRestoring) {
			return false;
		}

		const current = this.capture();
		const entry = this.undoStack.pop();
		if (!entry || !current) return false;

		this.redoStack.push({ label: entry.label, snapshot: current });
		this.restoreSnapshot(entry.snapshot);
		this.updateAvailability();
		return true;
	}

	/**
	 * Réapplique l'état annulé le plus récent.
	 * @returns {boolean} `true` si un redo a été appliqué.
	 */
	static redo(): boolean {
		if (!globalState.currentProject || this.redoStack.length === 0 || this.isRestoring) {
			return false;
		}

		const current = this.capture();
		const entry = this.redoStack.pop();
		if (!entry || !current) return false;

		this.undoStack.push({ label: entry.label, snapshot: current });
		this.restoreSnapshot(entry.snapshot);
		this.updateAvailability();
		return true;
	}
}
