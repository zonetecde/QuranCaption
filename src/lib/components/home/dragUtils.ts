import { normalizeProjectType } from '$lib/types/projectType';
import { ALL_PROJECTS_SELECTION, type ExplorerSelection } from './homeExplorer';

export type DragPointer = {
	x: number;
	y: number;
};

/**
 * Conserve les coordonnées de l'aperçu de déplacement sans garder l'événement complet.
 * @param {Pick<PointerEvent, 'clientX' | 'clientY'>} event - L'événement de pointeur.
 * @returns {DragPointer} Les coordonnées du pointeur.
 */
export function getDragPointerPosition(
	event: Pick<PointerEvent, 'clientX' | 'clientY'>
): DragPointer {
	return {
		x: event.clientX,
		y: event.clientY
	};
}

/**
 * Lit l'identifiant logique du dossier survolé dans l'explorateur.
 * @param {Element | null} element - L'élément actuellement survolé.
 * @returns {string | null} L'identifiant du dossier, ou null.
 */
export function getExplorerNodeIdFromElement(element: Element | null): string | null {
	const node = element?.closest('[data-explorer-node]');
	return node instanceof HTMLElement ? (node.dataset.explorerNode ?? null) : null;
}

/**
 * Convertit un identifiant de dossier en sélection d'explorateur.
 * @param {string | null | undefined} nodeId - L'identifiant sérialisé du dossier.
 * @returns {ExplorerSelection | null} La sélection correspondante.
 */
export function getExplorerSelectionFromNodeId(
	nodeId: string | null | undefined
): ExplorerSelection | null {
	if (!nodeId || nodeId === 'all') {
		return ALL_PROJECTS_SELECTION;
	}

	if (nodeId.startsWith('speaker:')) {
		return { kind: 'speaker', speaker: nodeId.slice('speaker:'.length) };
	}

	if (nodeId.startsWith('type:')) {
		const [, speaker, projectType] = nodeId.split(':');
		if (speaker && projectType) {
			return { kind: 'type', speaker, projectType: normalizeProjectType(projectType) };
		}
	}

	if (nodeId.startsWith('year:')) {
		const [, speaker, projectType, year] = nodeId.split(':');
		if (speaker && projectType && year) {
			return { kind: 'year', speaker, projectType: normalizeProjectType(projectType), year };
		}
	}

	return null;
}

/**
 * Lit directement la sélection d'explorateur depuis l'élément survolé.
 * @param {Element | null} element - L'élément actuellement survolé.
 * @returns {ExplorerSelection | null} La sélection correspondante.
 */
export function getExplorerSelectionFromElement(element: Element | null): ExplorerSelection | null {
	return getExplorerSelectionFromNodeId(getExplorerNodeIdFromElement(element));
}
