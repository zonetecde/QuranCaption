import { afterEach, describe, expect, it, vi } from 'vitest';

import Exporter, {
	DEFAULT_YTB_CHAPTERS_FORMAT,
	formatYouTubeChapterLine,
	resolveProjectVideoExportRange,
	type YouTubeChapterFormatValues
} from '$lib/classes/Exporter';
import { Batch, SubtitleClip, type Project } from '$lib/classes';
import { BatchService } from '$lib/services/BatchService';
import { ProjectService } from '$lib/services/ProjectService';
import ExportFileService from '$lib/services/ExportFileService';

afterEach(() => vi.restoreAllMocks());

const baseValues: YouTubeChapterFormatValues = {
	timestamp: '0:03',
	surahNumber: 20,
	surahTranslation: 'Ta-Ha',
	surahTransliteration: 'Taha',
	verseArabic: 'طه',
	verseNumber: 2,
	verseTranslation: 'We have not sent down to you the Quran that you be distressed'
};

describe('YouTube chapter formatting', () => {
	it('keeps the default chapter output shape', () => {
		expect(formatYouTubeChapterLine(DEFAULT_YTB_CHAPTERS_FORMAT, baseValues)).toBe(
			'0:03 Surah 20, Verse 2'
		);
	});

	it('replaces verse placeholders in a custom format', () => {
		const line = formatYouTubeChapterLine(
			'<timestamp> <surah-number>:<verse-number> <verse-arabic> - <verse-translation>',
			baseValues
		);

		expect(line).toBe(
			'0:03 20:2 طه - We have not sent down to you the Quran that you be distressed'
		);
	});

	it('replaces surah name placeholders', () => {
		const line = formatYouTubeChapterLine(
			'<timestamp> <surah-transliteration> / <surah-translation>',
			baseValues
		);

		expect(line).toBe('0:03 Taha / Ta-Ha');
	});

	it('keeps unknown placeholders and supports blank verse translations', () => {
		const line = formatYouTubeChapterLine('<timestamp> <verse-translation> <unknown>', {
			...baseValues,
			verseTranslation: ''
		});

		expect(line).toBe('0:03  <unknown>');
	});
});

describe('Project video export range', () => {
	it('keeps a project-specific range lasting at least one second', () => {
		expect(resolveProjectVideoExportRange(1_250, 5_250, 10_000)).toEqual([1_250, 5_250]);
	});

	it('uses the full audio duration when the project range is shorter than one second', () => {
		expect(resolveProjectVideoExportRange(500, 1_400, 10_000)).toEqual([0, 10_000]);
		expect(resolveProjectVideoExportRange(0, 0, 10_000)).toEqual([0, 10_000]);
	});
});

describe('Subtitle JSON export', () => {
	it('generates the same project-scoped JSON payload used by individual exports', () => {
		const clip = new SubtitleClip(250, 1250, 1, 2, 0, 1, 'verse', [], true, true);
		const project = {
			detail: { id: 42, name: 'Al-Fatiha', reciter: 'Reciter' },
			content: { timeline: { getFirstTrack: () => ({ clips: [clip] }) } }
		} as unknown as Project;

		const generated = Exporter.generateSubtitlesJson(project);
		const payload = JSON.parse(generated.content);

		expect(generated.segmentCount).toBe(1);
		expect(payload.project).toEqual({ id: 42, name: 'Al-Fatiha', reciter: 'Reciter' });
		expect(payload.segmentCount).toBe(1);
		expect(payload.segments[0]).toMatchObject({ startTimeMs: 250, endTimeMs: 1250 });
	});
});

describe('Batch backup', () => {
	it('exports one batch and its projects in the version 2 backup format', async () => {
		const batch = Batch.fromJSON({
			version: 1,
			id: 123,
			name: 'Complete Quran',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			projects: [{ order: 1, projectId: 456 }]
		}) as Batch;
		vi.spyOn(BatchService, 'load').mockResolvedValue(batch);
		vi.spyOn(ProjectService, 'load').mockResolvedValue({ detail: { id: 456 } } as Project);
		const saveBackup = vi
			.spyOn(ExportFileService, 'saveTextFile')
			.mockResolvedValue('/backup.json');

		await Exporter.backupBatch(batch.id);

		const backup = JSON.parse(saveBackup.mock.calls[0][1]);
		expect(backup.version).toBe(2);
		expect(backup.projects.map((project: Project) => project.detail.id)).toEqual([456]);
		expect(backup.batches.map((savedBatch: Batch) => savedBatch.id)).toEqual([123]);
	});
});
