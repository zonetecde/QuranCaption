import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Reads a source file used by the structural regression contracts.
 * @param {string} path Repository-relative source path.
 * @returns {string} UTF-8 source contents.
 */
const readSource = (path: string) => readFileSync(resolve(path), 'utf8');
const projectCard = readSource('src/lib/components/home/ProjectDetailCard.svelte');
const editableText = readSource('src/lib/components/misc/EditableText.svelte');
const subtitlesWorkspace = readSource(
	'src/lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesWorkspace.svelte'
);
const dimensionControl = readSource(
	'src/lib/components/projectEditor/tabs/styleEditor/controls/DimensionControl.svelte'
);

describe('RTL interface regressions', () => {
	test('mirrors project card editing and status interactions', () => {
		expect(editableText).not.toMatch(/<button[^>]*dir="auto"/);
		expect(editableText).toMatch(/<h4 dir="auto"/);
		expect(projectCard).toContain('rtl:hover:translate-x-3');
		expect(projectCard).toContain('rtl:order-1');
		expect(projectCard).toContain('rtl:group-hover:translate-x-2');
	});

	test('keeps the existing word selector ordering from being reversed twice', () => {
		expect(subtitlesWorkspace).toMatch(/dir="ltr"\s+class="min-h-0"/);
	});

	test('localizes every textual dimension control label', () => {
		expect(dimensionControl).toContain('dimensionCopy.orientation()');
		expect(dimensionControl).toContain('$LL.style.orientationLandscape()');
		expect(dimensionControl).toContain('$LL.style.orientationPortrait()');
		expect(dimensionControl).toContain('dimensionCopy.quality()');
		expect(dimensionControl).toContain('$LL.common.apply()');
		expect(dimensionControl).toContain('dimensionCopy.customDimensions()');
		expect(dimensionControl).not.toMatch(/>\s*(Orientation|Quality|Apply|Custom dimensions):?/);
	});
});
