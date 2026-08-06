import { describe, expect, it } from 'vitest';
import {
	Category,
	PredefinedSubtitleClip,
	Project,
	ProjectContent,
	ProjectDetail,
	SilenceClip,
	Style,
	StylesData,
	SubtitleClip,
	Timeline,
	VideoStyle
} from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { alignExistingSubtitles } from '$lib/services/autoSegmentation/align-existing';
import type { SegmentationSegment } from '$lib/services/autoSegmentation/types';

/**
 * Construit un sous-titre Quran minimal avec une plage de mots explicite.
 * @param {number} startTime Début du clip.
 * @param {number} endTime Fin du clip.
 * @param {number} verse Numéro du verset.
 * @param {number} startWordIndex Premier mot.
 * @param {number} endWordIndex Dernier mot.
 * @returns {SubtitleClip} Clip de test.
 */
function makeSubtitle(
	startTime: number,
	endTime: number,
	verse: number,
	startWordIndex: number,
	endWordIndex: number
): SubtitleClip {
	return new SubtitleClip(
		startTime,
		endTime,
		1,
		verse,
		startWordIndex,
		endWordIndex,
		'text',
		[],
		startWordIndex === 0 && endWordIndex === 3,
		endWordIndex === 3
	);
}

/**
 * Construit un segment IA avec des timestamps relatifs à son début.
 * @param {number} segment Identifiant du segment.
 * @param {number} verse Numéro du verset.
 * @param {number} timeFrom Début du segment en secondes.
 * @param {number[]} wordNumbers Numéros des mots présents.
 * @returns {SegmentationSegment} Segment de test.
 */
function makeSegment(
	segment: number,
	verse: number,
	timeFrom: number,
	wordNumbers: number[]
): SegmentationSegment {
	return {
		segment,
		time_from: timeFrom,
		time_to: timeFrom + wordNumbers.length,
		ref_from: `1:${verse}:${wordNumbers[0]}`,
		ref_to: `1:${verse}:${wordNumbers[wordNumbers.length - 1]}`,
		confidence: 0.95,
		words: wordNumbers.map((word, index) => ({
			location: `1:${verse}:${word}`,
			start: index,
			end: index + 0.8
		}))
	};
}

/**
 * Construit un projet sérialisable pour vérifier l'undo/redo du réalignement.
 * @param {SubtitleTrack} track Piste à intégrer au projet.
 * @returns {Project} Projet de test sérialisable.
 */
function makeProject(track: SubtitleTrack): Project {
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [new Style({ id: 'font-size', value: 90, valueType: 'number' })]
			})
		])
	];
	return new Project(
		new ProjectDetail('Alignment history', 'reciter'),
		new ProjectContent(new Timeline([track]), [], undefined, videoStyle)
	);
}

describe('alignExistingSubtitles', () => {
	it('retimes partial clips from exact WBW bounds while preserving their data', () => {
		const track = new SubtitleTrack();
		const first = makeSubtitle(0, 1000, 1, 0, 1);
		const second = makeSubtitle(1001, 2000, 1, 2, 3);
		const firstId = first.id;
		const translations = first.translations;
		first.arabicInlineStyleRuns = [
			{ startWordIndex: 0, endWordIndex: 0, bold: true, italic: false, underline: false }
		];
		first.setVisualMerge('group', 'both');
		track.clips = [first, second];

		const result = alignExistingSubtitles({
			subtitleTrack: track,
			segments: [makeSegment(1, 1, 10, [1, 2, 3, 4])],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect(track.clips[0]).toBe(first);
		expect(first.id).toBe(firstId);
		expect(first.translations).toBe(translations);
		expect(first.arabicInlineStyleRuns).toEqual([
			{ startWordIndex: 0, endWordIndex: 0, bold: true, italic: false, underline: false }
		]);
		expect(first.visualMergeGroupId).toBe('group');
		expect([first.startTime, first.endTime]).toEqual([10000, 11800]);
		expect([second.startTime, second.endTime]).toEqual([12000, 13800]);
		expect(result.segmentsApplied).toBe(2);
	});

	it('aligns consecutive clips against overlapping AI chunks without collisions', () => {
		const track = new SubtitleTrack();
		const first = makeSubtitle(0, 1000, 3, 0, 4);
		const second = makeSubtitle(1001, 2000, 3, 5, 11);
		const third = makeSubtitle(2001, 3000, 3, 12, 17);
		track.clips = [first, second, third];

		const result = alignExistingSubtitles({
			subtitleTrack: track,
			segments: [
				makeSegment(1, 3, 10, [1, 2, 3, 4, 5, 6]),
				makeSegment(2, 3, 20, [5, 6, 7, 8, 9, 10, 11, 12, 13]),
				makeSegment(3, 3, 30, [12, 13, 14, 15, 16, 17, 18])
			],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect([first.startTime, first.endTime]).toEqual([10000, 14800]);
		expect([second.startTime, second.endTime]).toEqual([21000, 27800]);
		expect([third.startTime, third.endTime]).toEqual([31000, 36800]);
		expect(second.startTime).toBeGreaterThan(first.endTime);
		expect(third.startTime).toBeGreaterThan(second.endTime);
		expect(result.segmentsApplied).toBe(3);
		expect(result.lowConfidenceSegments).toBe(0);
	});

	it('uses the next AI chunk when existing WBW ranges overlap', () => {
		const track = new SubtitleTrack();
		const first = makeSubtitle(0, 1000, 15, 0, 11);
		const second = makeSubtitle(1001, 2000, 15, 9, 13);
		track.clips = [first, second];

		alignExistingSubtitles({
			subtitleTrack: track,
			segments: [
				makeSegment(1, 15, 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
				makeSegment(2, 15, 30, [10, 11, 12, 13, 14])
			],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect([first.startTime, first.endTime]).toEqual([10000, 21800]);
		expect([second.startTime, second.endTime]).toEqual([30000, 34800]);
		expect(second.startTime).toBeGreaterThan(first.endTime);
	});

	it('keeps timing and marks low confidence when a required WBW timestamp is missing', () => {
		const track = new SubtitleTrack();
		const clip = makeSubtitle(500, 1500, 1, 0, 3);
		track.clips = [clip];

		const result = alignExistingSubtitles({
			subtitleTrack: track,
			segments: [makeSegment(1, 1, 10, [1, 2, 3])],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect([clip.startTime, clip.endTime]).toEqual([500, 1500]);
		expect(clip.needsReview).toBe(true);
		expect(result.lowConfidenceSegments).toBe(1);
	});

	it('keeps a unique unmatched verse and marks it low confidence', () => {
		const track = new SubtitleTrack();
		const clip = makeSubtitle(500, 1500, 1, 0, 3);
		track.clips = [clip];

		alignExistingSubtitles({
			subtitleTrack: track,
			segments: [makeSegment(1, 2, 10, [1, 2, 3, 4])],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect(track.clips).toEqual([clip]);
		expect([clip.startTime, clip.endTime]).toEqual([500, 1500]);
		expect(clip.needsReview).toBe(true);
	});

	it('keeps a matched verse low confidence when its segment has no WBW words', () => {
		const track = new SubtitleTrack();
		const clip = makeSubtitle(500, 1500, 1, 0, 3);
		track.clips = [clip];

		alignExistingSubtitles({
			subtitleTrack: track,
			segments: [
				{
					segment: 1,
					time_from: 10,
					time_to: 14,
					ref_from: '1:1:1',
					ref_to: '1:1:4'
				}
			],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect(track.clips).toEqual([clip]);
		expect(clip.needsReview).toBe(true);
	});

	it('deletes only extra current Quran repetitions', () => {
		const track = new SubtitleTrack();
		const first = makeSubtitle(0, 1000, 1, 0, 3);
		const repeated = makeSubtitle(1001, 2000, 1, 0, 3);
		track.clips = [first, repeated];

		alignExistingSubtitles({
			subtitleTrack: track,
			segments: [makeSegment(1, 1, 5, [1, 2, 3, 4])],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect(track.clips).toEqual([first]);
	});

	it('ignores extra AI Quran repetitions', () => {
		const track = new SubtitleTrack();
		const clip = makeSubtitle(0, 1000, 1, 0, 3);
		track.clips = [clip];

		alignExistingSubtitles({
			subtitleTrack: track,
			segments: [makeSegment(1, 1, 5, [1, 2, 3, 4]), makeSegment(2, 1, 15, [1, 2, 3, 4])],
			segmentationSource: 'api',
			projectTranslation: null
		});

		expect(track.clips).toEqual([clip]);
		expect([clip.startTime, clip.endTime]).toEqual([5000, 8800]);
	});

	it('reconciles predefined clips and regenerates silence for the new timings', () => {
		const track = new SubtitleTrack();
		const silence = new SilenceClip(0, 499);
		const basmala = new PredefinedSubtitleClip(500, 1000, 'Basmala');
		const stale = new PredefinedSubtitleClip(1001, 1500, 'Amin');
		track.clips = [silence, basmala, stale];
		const istiAdha: SegmentationSegment = {
			segment: 2,
			time_from: 3,
			time_to: 4,
			ref_from: "Isti'adha",
			ref_to: "Isti'adha",
			special_type: "Isti'adha"
		};

		alignExistingSubtitles({
			subtitleTrack: track,
			segments: [
				{
					segment: 1,
					time_from: 1,
					time_to: 2,
					ref_from: 'Basmala',
					ref_to: 'Basmala',
					special_type: 'Basmala'
				},
				istiAdha
			],
			segmentationSource: 'api',
			projectTranslation: null,
			fillBySilence: true
		});

		expect(track.clips).not.toContain(silence);
		expect(
			track.clips.some(
				(clip) => clip instanceof SilenceClip && clip.startTime === 0 && clip.endTime === 999
			)
		).toBe(true);
		expect(
			track.clips.some(
				(clip) => clip instanceof SilenceClip && clip.startTime === 2001 && clip.endTime === 2999
			)
		).toBe(true);
		expect(track.clips).toContain(basmala);
		expect([basmala.startTime, basmala.endTime]).toEqual([1000, 2000]);
		expect(track.clips).not.toContain(stale);
		expect(
			track.clips.some(
				(clip) =>
					clip instanceof PredefinedSubtitleClip &&
					clip.predefinedSubtitleType === "Isti'adha" &&
					clip.startTime === 3000
			)
		).toBe(true);
	});

	it('restores the complete alignment through one undo and redo operation', () => {
		initializeClassRegistry();
		const track = new SubtitleTrack();
		track.clips = [makeSubtitle(0, 1000, 1, 0, 3), makeSubtitle(1001, 2000, 1, 0, 3)];
		globalState.currentProject = makeProject(track);
		ProjectHistoryManager.resetForCurrentProject();

		ProjectHistoryManager.track('align existing subtitles', () =>
			alignExistingSubtitles({
				subtitleTrack: globalState.getSubtitleTrack,
				segments: [makeSegment(1, 1, 5, [1, 2, 3, 4])],
				segmentationSource: 'api',
				projectTranslation: globalState.currentProject!.content.projectTranslation
			})
		);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(1);
		expect(globalState.getSubtitleTrack.clips[0].startTime).toBe(5000);

		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(2);
		expect(globalState.getSubtitleTrack.clips[0].startTime).toBe(0);

		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getSubtitleTrack.clips).toHaveLength(1);
		expect(globalState.getSubtitleTrack.clips[0].startTime).toBe(5000);
	});
});
