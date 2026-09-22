import { describe, expect, test } from 'vitest';

import { getLocaleDirection } from '$lib/i18n/direction';

describe('getLocaleDirection', () => {
	test('returns rtl for Arabic', () => {
		expect(getLocaleDirection('ar')).toBe('rtl');
	});

	test.each(['de', 'en', 'es', 'fr', 'id', 'zh'] as const)('returns ltr for %s', (locale) => {
		expect(getLocaleDirection(locale)).toBe('ltr');
	});
});
