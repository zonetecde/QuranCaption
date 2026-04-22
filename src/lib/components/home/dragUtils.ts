import { normalizeProjectType } from '$lib/types/projectType';
import { ALL_PROJECTS_SELECTION, type ExplorerSelection } from './homeExplorer';

export type DragPointer = {
	x: number;
	y: number;
};

/**
 * Keeps drag-preview coordinates serializable and independent from the full event object.
 */
export function getDragPointerPosition(event: Pick<PointerEvent, 'clientX' | 'clientY'>): DragPointer {
	return {
		x: event.clientX,
		y: event.clientY
	};
}

/**
 * Reads the logical explorer node id from the hovered DOM node, if any.
 */
export function getExplorerNodeIdFromElement(element: Element | null): string | null {
	const node = element?.closest('[data-explorer-node]');
	return node instanceof HTMLElement ? (node.dataset.explorerNode ?? null) : null;
}

/**
 * Converts serialized node ids back to the selection model used by the homepage.
 */
export function getExplorerSelectionFromNodeId(nodeId: string | null | undefined): ExplorerSelection | null {
	if (!nodeId || nodeId === 'all') {
		return ALL_PROJECTS_SELECTION;
	}

	if (nodeId.startsWith('reciter:')) {
		return { kind: 'reciter', reciter: nodeId.slice('reciter:'.length) };
	}

	if (nodeId.startsWith('type:')) {
		const [, reciter, projectType] = nodeId.split(':');
		if (reciter && projectType) {
			return { kind: 'type', reciter, projectType: normalizeProjectType(projectType) };
		}
	}

	if (nodeId.startsWith('year:')) {
		const [, reciter, projectType, year] = nodeId.split(':');
		if (reciter && projectType && year) {
			return { kind: 'year', reciter, projectType: normalizeProjectType(projectType), year };
		}
	}

	return null;
}

/**
 * Convenience helper for pointer-up handling on the homepage.
 */
export function getExplorerSelectionFromElement(element: Element | null): ExplorerSelection | null {
	return getExplorerSelectionFromNodeId(getExplorerNodeIdFromElement(element));
}
