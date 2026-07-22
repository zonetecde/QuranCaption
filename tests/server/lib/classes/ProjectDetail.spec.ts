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
