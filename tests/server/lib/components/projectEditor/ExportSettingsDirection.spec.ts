import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const exportSettings = readFileSync(
	resolve('src/lib/components/projectEditor/tabs/export/ExportSettings.svelte'),
	'utf8'
);

describe('export choice direction', () => {
	test('moves the selected choice badge to the left in RTL', () => {
		expect(exportSettings).toContain('right-2 rtl:right-auto rtl:left-2');
	});
});
