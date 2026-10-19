import { describe, expect, it } from 'vitest';

import {
	resolveIncludeWbwTimestamps,
	runAutoSegmentation
} from '$lib/services/autoSegmentation/run-segmentation';

/**
 * `shouldRetryCloudOnCpu` et `resolveContextModelName` sont des fonctions privées
 * dans run-segmentation.ts. Leurs comportements sont validés via le flow
 * d'intégration et les tests manuels.
 */
describe('runAutoSegmentation exports', () => {
	it('is a function', () => {
		expect(typeof runAutoSegmentation).toBe('function');
	});

	it('always keeps cloud word timestamps', () => {
		expect(resolveIncludeWbwTimestamps(false, 'align')).toBe(true);
		expect(resolveIncludeWbwTimestamps(false, 'replace')).toBe(true);
	});
});
