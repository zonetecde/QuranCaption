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
		expect(getExplorerSelectionFromNodeId('speaker:Shaykh Ahmad')).toEqual({
			kind: 'speaker',
			speaker: 'Shaykh Ahmad'
		});
		expect(getExplorerSelectionFromNodeId('type:Shaykh Ahmad:Khutbah')).toEqual({
			kind: 'type',
			speaker: 'Shaykh Ahmad',
			projectType: 'Khutbah'
		});
		expect(getExplorerSelectionFromNodeId('unknown')).toBeNull();
	});
});
