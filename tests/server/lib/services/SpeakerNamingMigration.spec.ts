import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	Asset,
	Project,
	ProjectContent,
	ProjectDetail,
	SubtitleClip,
	Timeline
} from '$lib/classes';
import { VideoStyle } from '$lib/classes/VideoStyle.svelte';
import { StylesEditorState, SubtitlesEditorState } from '$lib/classes/ProjectEditorState.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import MigrationService from '$lib/services/MigrationService';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Construit un ancien preset contenant des valeurs, animations et réglages locaux.
 * @returns {Record<string, unknown>} Styles au format historique.
 */
function legacyStyles(): Record<string, unknown> {
	return {
		__className: 'VideoStyle',
		styles: [
			{
				__className: 'StylesData',
				target: 'global',
				categories: [
					{
						__className: 'Category',
						id: 'reciter-name',
						styles: [
							{ __className: 'Style', id: 'show-reciter-name', value: false },
							{ __className: 'Style', id: 'reciter-name', valueType: 'reciter', value: '' },
							{
								__className: 'Style',
								id: 'reciter-size',
								value: 11,
								keyframes: [{ time: 1200, value: 15 }]
							},
							{
								__className: 'Style',
								id: 'reciter-name-format',
								value: 'Reciter <transliteration>'
							},
							{ __className: 'Style', id: 'font-family', value: 'Reciters' }
						]
					}
				],
				overrides: { 42: { 'reciter-size': 20, 'font-family': 'Reciters' } },
				overrideKeyframes: { 42: { 'reciter-size': [{ time: 1400, value: 25 }] } }
			}
		]
	};
}

beforeEach(() => initializeClassRegistry());
afterEach(() => {
	ProjectHistoryManager.clear();
	globalState.currentProject = null;
});

describe('speaker naming compatibility', () => {
	test('drops legacy segment speakers without changing subtitle text, timings or translations', () => {
		const stored = { ...new SubtitleClip(100, 900, 'Lecture').toJSON(), speaker: 'Guest' };
		const clip = SubtitleClip.fromJSON<SubtitleClip>(stored);
		expect(clip.text).toBe('Lecture');
		expect(clip.startTime).toBe(100);
		expect(clip.endTime).toBe(900);
		expect(clip.toJSON()).not.toHaveProperty('speaker');
		expect(clip.cloneWithTimes(200, 800).toJSON()).not.toHaveProperty('speaker');
		expect(stored.speaker).toBe('Guest');
	});

	test('cleans legacy speaker selections and raw transcription labels without mutating saved data', () => {
		const stored = {
			selectedSpeaker: 'Guest',
			additionalSpeakers: ['Guest'],
			rawTranscription: {
				language: 'en',
				device: 'cpu',
				model: 'test',
				wordTimestampsAvailable: true,
				speakers: ['Guest'],
				segments: [
					{
						start: 0,
						end: 1,
						text: 'Hello',
						speaker: 'Guest',
						words: [{ word: 'Hello', start: 0, end: 1, speaker: 'Guest' }]
					}
				]
			}
		};
		const before = JSON.stringify(stored);
		const state = SubtitlesEditorState.fromJSON<SubtitlesEditorState>(stored);
		expect(state.toJSON()).not.toHaveProperty('selectedSpeaker');
		expect(state.toJSON()).not.toHaveProperty('additionalSpeakers');
		expect(state.rawTranscription).not.toHaveProperty('speakers');
		expect(state.rawTranscription?.segments[0]).toEqual({
			start: 0,
			end: 1,
			text: 'Hello',
			words: [{ word: 'Hello', start: 0, end: 1 }]
		});
		expect(JSON.stringify(stored)).toBe(before);
	});

	test('migrates saved style identifiers while preserving values, animations and free text', () => {
		const original = legacyStyles();
		const before = JSON.stringify(original);
		const style = VideoStyle.fromJSON(original) as VideoStyle;
		const global = style.getStylesOfTarget('global');
		expect(global.categories[0].id).toBe('speaker-name');
		expect(global.findStyle('speaker-name')?.valueType).toBe('speaker');
		expect(global.findStyle('show-speaker-name')?.value).toBe(false);
		expect(global.findStyle('speaker-size')?.value).toBe(11);
		expect(global.findStyle('speaker-size')?.keyframes).toEqual([{ time: 1200, value: 15 }]);
		expect(global.overrides[42]).toEqual({ 'speaker-size': 20, 'font-family': 'Speakers' });
		expect(global.overrideKeyframes[42]).toEqual({ 'speaker-size': [{ time: 1400, value: 25 }] });
		expect(global.findStyle('font-family')?.value).toBe('Speakers');
		expect(global.findStyle('speaker-name-format')?.value).toBe('Reciter <transliteration>');
		expect(JSON.stringify(original)).toBe(before);
		expect(MigrationService.migrateSpeakerData(style.toJSON())).toEqual(style.toJSON());
	});

	test('migrates saved presets and remembered editor categories before displaying them', () => {
		const settings = Settings.fromJSON({
			savedVideoStylePresets: [
				{ name: 'Saved preset', data: { videoStyle: legacyStyles(), customClips: [] } }
			]
		}) as Settings;
		const preset = VideoStyle.fromJSON(
			settings.savedVideoStylePresets[0].data.videoStyle
		) as VideoStyle;
		expect(preset.getStylesOfTarget('global').findStyle('speaker-size')?.value).toBe(11);
		const editor = StylesEditorState.fromJSON({
			scrollAndHighlight: 'reciter-name',
			activePanelCategoryIds: { screenElements: 'reciter-name' }
		}) as StylesEditorState;
		expect(editor.scrollAndHighlight).toBe('speaker-name');
		expect(editor.activePanelCategoryIds.screenElements).toBe('speaker-name');
	});

	test('migrates legacy project speakers and native timing metadata without changing file paths', () => {
		const detail = ProjectDetail.fromJSON({
			name: 'Reciter lecture',
			reciter: 'Known speaker'
		}) as ProjectDetail;
		expect(detail.speaker).toBe('Known speaker');
		expect(detail.name).toBe('Reciter lecture');
		expect(
			(ProjectDetail.fromJSON({ reciter: 'Old', speaker: 'New' }) as ProjectDetail).speaker
		).toBe('New');
		const asset = Asset.fromJSON({
			filePath: 'C:/reciters/audio.wav',
			metadata: { nativeTiming: { provider: 'mp3quran', reciterId: 92, surahId: 1 } }
		}) as Asset;
		expect(asset.filePath).toBe('C:/reciters/audio.wav');
		expect(asset.metadata.nativeTiming).toEqual({
			provider: 'mp3quran',
			speakerId: 92,
			surahId: 1
		});
	});

	test('keeps migrated speaker styles working through undo and redo', () => {
		const videoStyle = VideoStyle.fromJSON(legacyStyles()) as VideoStyle;
		globalState.currentProject = new Project(
			new ProjectDetail('Lecture', 'Speaker'),
			new ProjectContent(new Timeline(), [], undefined, videoStyle)
		);
		ProjectHistoryManager.resetForCurrentProject();
		ProjectHistoryManager.track('change speaker size', () => {
			videoStyle.getStylesOfTarget('global').setStyle('speaker-size', 18);
		});
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(
			globalState.getVideoStyle.getStylesOfTarget('global').findStyle('speaker-size')?.value
		).toBe(11);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(
			globalState.getVideoStyle.getStylesOfTarget('global').findStyle('speaker-size')?.value
		).toBe(18);
	});
});
