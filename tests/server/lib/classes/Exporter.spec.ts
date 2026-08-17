import { afterEach, describe, expect, it, vi } from 'vitest';

import Exporter, {
	DEFAULT_YTB_CHAPTERS_FORMAT,
	formatYouTubeChapterLine,
	getRandomBackgroundCandidates,
	prepareRandomBackgroundProject,
	resolveProjectVideoExportRange,
	selectRandomBackgroundCandidate,
	type YouTubeChapterFormatValues
} from '$lib/classes/Exporter';
import { AssetClip, AssetType, Batch, SubtitleClip, TrackType, type Project } from '$lib/classes';
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
	hizbNumber: 32,
	juzNumber: 16,
	rubNumber: 127,
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

	it('replaces Quran division placeholders', () => {
		const line = formatYouTubeChapterLine(
			'<timestamp> Hizb <hizb-number> Juz <juz-number> Rub <rub-number>',
			baseValues
		);

		expect(line).toBe('0:03 Hizb 32 Juz 16 Rub 127');
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

/**
 * Construit un projet minimal pour tester la préparation d'un export vidéo.
 * @param {{ addRandomBackground?: boolean; exportWithoutBackground?: boolean; videoClips?: AssetClip[] }} options Options de l'état d'export et de la piste vidéo.
 * @returns {{ project: Project; videoTrack: { clips: AssetClip[] }; addAssetHeadless: ReturnType<typeof vi.fn> }} Projet et dépendances observables.
 */
function createRandomBackgroundProjectFixture(
	options: {
		addRandomBackground?: boolean;
		exportWithoutBackground?: boolean;
		videoClips?: AssetClip[];
	} = {}
) {
	const videoTrack = { clips: options.videoClips ?? [] };
	const audioTrack = { getDuration: () => ({ ms: 5000 }) };
	const addAssetHeadless = vi.fn();
	const project = {
		projectEditorState: {
			export: {
				addRandomBackground: options.addRandomBackground ?? true,
				exportWithoutBackground: options.exportWithoutBackground ?? false
			}
		},
		content: {
			timeline: {
				getFirstTrack: vi.fn((trackType: TrackType) =>
					trackType === TrackType.Video ? videoTrack : audioTrack
				)
			},
			addAssetHeadless
		}
	} as unknown as Project;

	return { project, videoTrack, addAssetHeadless };
}

describe('Random export backgrounds', () => {
	it('filters compatible files without entering subdirectories', () => {
		const entries = [
			{ name: 'image.PNG', isFile: true, isDirectory: false },
			{ name: 'clip.webm', isFile: true, isDirectory: false },
			{ name: 'audio.mp3', isFile: true, isDirectory: false },
			{ name: 'notes.txt', isFile: true, isDirectory: false },
			{ name: 'nested', isFile: false, isDirectory: true }
		];

		expect(getRandomBackgroundCandidates(entries)).toEqual(['image.PNG', 'clip.webm']);
	});

	it('selects candidates independently from the random value', () => {
		const entries = [
			{ name: 'first.jpg', isFile: true, isDirectory: false },
			{ name: 'second.mp4', isFile: true, isDirectory: false }
		];

		expect(selectRandomBackgroundCandidate(entries, 0)).toBe('first.jpg');
		expect(selectRandomBackgroundCandidate(entries, 0.99)).toBe('second.mp4');
	});

	it('does nothing when the option is disabled or the video track is not empty', async () => {
		const disabled = createRandomBackgroundProjectFixture({ addRandomBackground: false });
		const disabledReader = vi.fn(async () => []);
		await prepareRandomBackgroundProject(disabled.project, 'pool', {
			readDirectory: disabledReader
		});
		expect(disabled.videoTrack.clips).toHaveLength(0);
		expect(disabledReader).not.toHaveBeenCalled();

		const existing = createRandomBackgroundProjectFixture({
			videoClips: [new AssetClip(0, 100, 4)]
		});
		const existingReader = vi.fn(async () => []);
		await prepareRandomBackgroundProject(existing.project, 'pool', {
			readDirectory: existingReader
		});
		expect(existing.videoTrack.clips).toHaveLength(1);
		expect(existingReader).not.toHaveBeenCalled();
	});

	it('falls back silently for an empty, inaccessible, or invalid pool', async () => {
		const empty = createRandomBackgroundProjectFixture();
		await prepareRandomBackgroundProject(empty.project, 'pool', {
			readDirectory: async () => [{ name: 'sound.mp3', isFile: true, isDirectory: false }]
		});
		expect(empty.videoTrack.clips).toHaveLength(0);

		const inaccessible = createRandomBackgroundProjectFixture();
		await prepareRandomBackgroundProject(inaccessible.project, 'pool', {
			readDirectory: async () => {
				throw new Error('access denied');
			}
		});
		expect(inaccessible.videoTrack.clips).toHaveLength(0);

		const invalid = createRandomBackgroundProjectFixture();
		await prepareRandomBackgroundProject(invalid.project, 'pool', {
			readDirectory: async () => [{ name: 'broken.jpg', isFile: true, isDirectory: false }]
		});
		expect(invalid.videoTrack.clips).toHaveLength(0);
	});

	it('creates a non-looping image clip', async () => {
		const fixture = createRandomBackgroundProjectFixture();
		const asset = {
			id: 7,
			type: AssetType.Image,
			exists: true,
			checkExistence: vi.fn(async () => undefined),
			ensureDurationLoaded: vi.fn(async () => undefined),
			hasDurationLoadError: vi.fn(() => false)
		};
		fixture.addAssetHeadless.mockReturnValue(asset);

		await prepareRandomBackgroundProject(fixture.project, 'pool', {
			readDirectory: async () => [{ name: 'background.jpg', isFile: true, isDirectory: false }],
			joinPath: async (folder, fileName) => `${folder}/${fileName}`
		});

		expect(fixture.videoTrack.clips[0]).toMatchObject({
			assetId: 7,
			startTime: 0,
			endTime: 0,
			loopUntilAudioEnd: false
		});
	});

	it('creates a looping video clip covering the audio duration', async () => {
		const fixture = createRandomBackgroundProjectFixture();
		const asset = {
			id: 8,
			type: AssetType.Video,
			exists: true,
			checkExistence: vi.fn(async () => undefined),
			ensureDurationLoaded: vi.fn(async () => undefined),
			hasDurationLoadError: vi.fn(() => false)
		};
		fixture.addAssetHeadless.mockReturnValue(asset);

		await prepareRandomBackgroundProject(fixture.project, 'pool', {
			readDirectory: async () => [{ name: 'background.mp4', isFile: true, isDirectory: false }],
			joinPath: async (folder, fileName) => `${folder}/${fileName}`
		});

		expect(asset.ensureDurationLoaded).toHaveBeenCalledOnce();
		expect(fixture.videoTrack.clips[0]).toMatchObject({
			assetId: 8,
			startTime: 0,
			endTime: 5000,
			loopUntilAudioEnd: true
		});
	});

	it('does not add a background when transparent export is enabled', async () => {
		const fixture = createRandomBackgroundProjectFixture({ exportWithoutBackground: true });
		const reader = vi.fn(async () => [
			{ name: 'background.jpg', isFile: true, isDirectory: false }
		]);

		await prepareRandomBackgroundProject(fixture.project, 'pool', { readDirectory: reader });

		expect(reader).not.toHaveBeenCalled();
		expect(fixture.videoTrack.clips).toHaveLength(0);
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
