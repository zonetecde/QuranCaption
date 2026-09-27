import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const previewWorkspace = readFileSync(
	resolve('src/lib/components/projectEditor/videoPreview/VideoPreviewWorkspace.svelte'),
	'utf8'
);
const previewControls = readFileSync(
	resolve('src/lib/components/projectEditor/videoPreview/VideoPreviewControlsBar.svelte'),
	'utf8'
);
const timeline = readFileSync(
	resolve('src/lib/components/projectEditor/timeline/Timeline.svelte'),
	'utf8'
);
const subtitleClip = readFileSync(
	resolve('src/lib/components/projectEditor/timeline/track/SubtitleClip.svelte'),
	'utf8'
);

describe('media editor direction boundaries', () => {
	test('keeps the video preview and its controls independent from the application locale', () => {
		expect(previewWorkspace).toMatch(/<section\s+dir="ltr"[\s\S]*?id="video-preview-section"/);
		expect(previewWorkspace).toMatch(/<div\s+dir="ltr"[\s\S]*?id="preview-container"/);
		expect(previewControls).toMatch(/<div\s+dir="ltr"\s+class="bg-primary/);
	});

	test('keeps timeline geometry independent from the application locale', () => {
		expect(timeline).toMatch(/<section\s+dir="ltr"\s+class="[^"]*timeline-section/);
		expect(subtitleClip).toMatch(/<p\s+dir="auto"\s+class="text-\[11px\]/);
	});
});
