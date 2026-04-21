import { describe, expect, it } from 'vitest';

import {
	getDragPointerPosition,
	getExplorerSelectionFromNodeId
} from '$lib/components/home/dragUtils';
import { ALL_PROJECTS_SELECTION } from '$lib/components/home/homeExplorer';

describe('dragUtils', () => {
	it('returns the pointer coordinates used by the drag preview', () => {
		expect(
			getDragPointerPosition({
				clientX: 120,
				clientY: 48
			})
		).toEqual({
			x: 120,
			y: 48
		});
	});

	it('maps explorer node ids back to explorer selections', () => {
		expect(getExplorerSelectionFromNodeId('all')).toEqual(ALL_PROJECTS_SELECTION);
		expect(getExplorerSelectionFromNodeId('reciter:Yasser Al Dosari')).toEqual({
			kind: 'reciter',
			reciter: 'Yasser Al Dosari'
		});
		expect(
			getExplorerSelectionFromNodeId('type:Yasser Al Dosari:salat')
		).toEqual({
			kind: 'type',
			reciter: 'Yasser Al Dosari',
			projectType: 'Prayer'
		});
		expect(getExplorerSelectionFromNodeId('unknown')).toBeNull();
	});
});
