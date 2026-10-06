import { afterEach, describe, expect, it, vi } from 'vitest';

import { Clip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { Category } from '$lib/classes/videoStyles/Category.svelte';
import { Style } from '$lib/classes/videoStyles/Style.svelte';
import { StylesData } from '$lib/classes/videoStyles/StylesData.svelte';
import { SubtitleSplitService } from '$lib/classes/tracks/subtitles/SubtitleSplitService';
import { SubtitleVisualMergeService } from '$lib/classes/tracks/subtitles/SubtitleVisualMergeService';
import { TrackClipQueries } from '$lib/classes/tracks/TrackClipQueries';
import { VideoTrackTiming } from '$lib/classes/tracks/VideoTrackTiming';
import { VideoStyleSchemaService } from '$lib/classes/videoStyles/VideoStyleSchemaService';
import subtitleDefaults from '../../../../static/styles/styles.json';
import type { RawCategoryDefinition } from '$lib/services/StyleDefinitionCatalog';

describe('refactored architecture services', () => {
	afterEach(() => vi.restoreAllMocks());
	it.each(['arabic', 'english'])(
		'adds line background roundness to old %s styles and preserves its value',
		(target) => {
			vi.spyOn(Style.prototype, 'getCategory').mockReturnValue('line-background');
			const defaults = subtitleDefaults.filter(
				(category) => category.id === 'line-background'
			) as RawCategoryDefinition[];
			const styles = [
				new StylesData(target, [
					new Category({
						id: 'line-background',
						styles: [
							new Style({
								...defaults[0].styles!.find((style) => style.id === 'line-background-enable'),
								value: true
							}),
							new Style({
								...defaults[0].styles!.find((style) => style.id === 'line-background-height'),
								value: 73
							})
						]
					})
				])
			];
			expect(VideoStyleSchemaService.mergeMissingStylesForTarget(styles, target, defaults)).toBe(
				true
			);
			expect(styles[0].findStyle('line-background-roundness')?.value).toBe(100);
			expect(styles[0].findStyle('line-background-height')?.value).toBe(73);
			expect(styles[0].generateCSS()).toContain('--line-background-roundness: 100;');
			styles[0].setStyle('line-background-roundness', 0);
			expect(VideoStyleSchemaService.mergeMissingStylesForTarget(styles, target, defaults)).toBe(
				false
			);
			expect(styles[0].generateCSS()).toContain('--line-background-roundness: 0;');
			styles[0].setStyle('line-background-enable', false);
			expect(styles[0].generateCSS()).not.toContain('--line-background-roundness');
		}
	);

	it('chooses the closest valid word boundary for a subtitle split', () => {
		const clip = new SubtitleClip(1_000, 3_000, 1, 1, 0, 2, 'text', [], true, true);
		clip.alignmentMetadata = {
			source: 'api',
			segment: 0,
			refFrom: '1:1:1',
			refTo: '1:1:3',
			matchedText: 'text',
			timeFrom: 1,
			timeTo: 3,
			words: [
				{ location: '1:1:1', start: 0, end: 0.5 },
				{ location: '1:1:2', start: 0.5, end: 1.2 },
				{ location: '1:1:3', start: 1.2, end: 2 }
			]
		};

		expect(SubtitleSplitService.getNearestWordBoundarySplitCandidate(clip, 2_150)).toEqual({
			leftEndWordIndex: 1,
			splitTimeMs: 2_200
		});
	});

	it('normalizes a visual merge selection to the subtitle timeline order', () => {
		const first = new SubtitleClip(0, 999, 1, 1, 0, 1, 'first', [], true, false);
		const second = new SubtitleClip(1_000, 1_999, 1, 1, 2, 3, 'second', [], false, true);

		expect(SubtitleVisualMergeService.getSelection([first, second], [second, first])).toEqual({
			clips: [first, second],
			startIndex: 0,
			endIndex: 1
		});
	});

	it('finds active clips without assuming their input order', () => {
		const late = new Clip(2_000, 3_000, 'Asset');
		const early = new Clip(0, 1_000, 'Asset');

		expect(TrackClipQueries.findClipIndexAtTime([late, early], 500)).toBe(1);
	});

	it('caps a configured crossfade to both adjacent clip durations', () => {
		const first = new Clip(0, 299, 'Asset');
		const second = new Clip(300, 499, 'Asset');

		expect(VideoTrackTiming.getCrossfadeDurationBeforeClip([first, second], 1, false, 500)).toBe(
			199
		);
	});

	it('merges missing style definitions without overwriting existing values', () => {
		const styles = [
			new StylesData('arabic', [
				new Category({ id: 'text', styles: [new Style({ id: 'font-size', value: 77 })] })
			])
		];

		const changed = VideoStyleSchemaService.mergeMissingStylesForTarget(styles, 'arabic', [
			{
				id: 'text',
				styles: [
					{ id: 'font-size', value: 90 },
					{ id: 'text-color', value: '#ffffff' }
				]
			}
		]);

		expect(changed).toBe(true);
		expect(styles[0].findStyle('font-size')?.value).toBe(77);
		expect(styles[0].findStyle('text-color')?.value).toBe('#ffffff');
	});
});
