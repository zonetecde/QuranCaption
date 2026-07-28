import { describe, expect, it } from 'vitest';
import ShortcutService from '$lib/services/ShortcutService';

describe('ShortcutService', () => {
	it('ignores keyup events without a key', () => {
		const service = ShortcutService as unknown as {
			handleKeyUp: (event: KeyboardEvent) => void;
		};

		expect(() => service.handleKeyUp({} as KeyboardEvent)).not.toThrow();
	});
});
