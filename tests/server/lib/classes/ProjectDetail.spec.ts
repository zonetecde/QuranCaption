import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectDetail, VerseRange } from '$lib/classes';
import Settings from '$lib/classes/Settings.svelte';
import { Quran } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';

describe('ProjectDetail project type', () => {
	const originalSettings = globalState.settings;

	afterEach(() => {
		globalState.settings = originalSettings;
		vi.restoreAllMocks();
	});

	it('allows project names up to 150 characters', () => {
		expect(ProjectDetail.NAME_MAX_LENGTH).toBe(150);
	});

	it('defaults new projects to Others', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');

		expect(detail.projectType).toBe('Others');
	});

	it('loads old serialized projects without projectType as Others', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');
		const serialized = detail.toJSON() as Record<string, unknown>;
		delete serialized.projectType;

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.projectType).toBe('Others');
	});

	it('normalizes legacy project type values from serialized data', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');
		const serialized = {
			...(detail.toJSON() as Record<string, unknown>),
			projectType: 'salat'
		};

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.projectType).toBe('Prayer');
	});

	it('preserves custom project categories from serialized data', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');
		const serialized = {
			...(detail.toJSON() as Record<string, unknown>),
			projectType: 'Personal favorites'
		};

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.projectType).toBe('Personal favorites');
	});

	it('matches search queries against the project type', () => {
		const detail = new ProjectDetail(
			'Taraweeh 27th night',
			'Muhammad Al Luhaidan',
			undefined,
			undefined,
			'Rare recitation'
		);

		expect(detail.matchSearchQuery('rare')).toBe(true);
		expect(detail.matchSearchQuery('recitation')).toBe(true);
	});

	it('loads old serialized projects without batch metadata', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');
		const serialized = detail.toJSON() as Record<string, unknown>;
		delete serialized.batchId;
		delete serialized.batchOrder;

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.batchId).toBeNull();
		expect(restored.batchOrder).toBeNull();
	});

	it('uses the surah covering the most verses as the prominent surah', () => {
		const detail = new ProjectDetail('Mixed surahs', 'Reciter');
		detail.verseRange = new VerseRange([
			{ surah: 1, verseStart: 1, verseEnd: 7 },
			{ surah: 41, verseStart: 19, verseEnd: 24 }
		]);

		expect(detail.getProminentSurah()).toBe(1);
	});

	it('uses the lowest surah number when prominence is tied', () => {
		const detail = new ProjectDetail('Mixed surahs', 'Reciter');
		detail.verseRange = new VerseRange([
			{ surah: 41, verseStart: 19, verseEnd: 24 },
			{ surah: 1, verseStart: 2, verseEnd: 7 }
		]);

		expect(detail.getProminentSurah()).toBe(1);
	});

	it('formats the default export file name with the configured placeholders', () => {
		globalState.settings = new Settings();
		globalState.settings.defaultValuesSettings.exportFileNameFormat =
			'{project_name} - {surah} ({surah_number}) - {reciter} - {verse_range}';
		vi.spyOn(globalState, 'getExportState', 'get').mockReturnValue({
			customFileName: '',
			videoStartTime: 0,
			videoEndTime: 1_000
		} as never);
		vi.spyOn(VerseRange, 'getVerseRange').mockReturnValue(
			new VerseRange([
				{ surah: 1, verseStart: 1, verseEnd: 7 },
				{ surah: 2, verseStart: 1, verseEnd: 5 }
			])
		);
		vi.spyOn(Quran, 'getSurahsNames').mockReturnValue([
			{ id: 1, transliteration: 'Al-Fatiha' },
			{ id: 2, transliteration: 'Al-Baqarah' }
		]);

		const detail = new ProjectDetail('My Project', 'Mishary Alafasy');

		expect(detail.generateExportFileName()).toBe(
			'My Project - Al-Fatiha, Al-Baqarah (1, 2) - Mishary Alafasy - Al-Fatiha 1-7, Al-Baqarah 1-5'
		);
	});
});
