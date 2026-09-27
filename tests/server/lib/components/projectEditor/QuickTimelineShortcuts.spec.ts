import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import Settings from '$lib/classes/Settings.svelte';

const timeline = readFileSync(
	resolve('src/lib/components/projectEditor/timeline/Timeline.svelte'),
	'utf8'
);

describe('quick timeline editor shortcuts', () => {
	test('provides four disabled shortcuts by default', () => {
		const shortcuts = new Settings().shortcuts.SUBTITLES_EDITOR;

		expect(shortcuts.EDIT_SUBTITLE_AT_CURSOR.keys).toEqual([]);
		expect(shortcuts.EDIT_TRANSLATION_AT_CURSOR.keys).toEqual([]);
		expect(shortcuts.EDIT_WBW_TIMESTAMP_AT_CURSOR.keys).toEqual([]);
		expect(shortcuts.EDIT_WBW_STYLE_AT_CURSOR.keys).toEqual([]);
	});

	test('opens every quick editor mode only for the subtitle under the cursor', () => {
		expect(timeline).toContain("EDIT_SUBTITLE_AT_CURSOR: 'subtitle'");
		expect(timeline).toContain("EDIT_TRANSLATION_AT_CURSOR: 'translation'");
		expect(timeline).toContain("EDIT_WBW_TIMESTAMP_AT_CURSOR: 'wbwTimestamp'");
		expect(timeline).toContain("EDIT_WBW_STYLE_AT_CURSOR: 'wbw'");
		expect(timeline).toContain('getCurrentClip(cursorPosition)');
		expect(timeline).toContain('ProjectEditorTabs.SubtitlesEditor');
	});
});
