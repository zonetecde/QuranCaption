import { afterEach, describe, expect, it, vi } from 'vitest';
import { exists } from '@tauri-apps/plugin-fs';
import ExportService from '$lib/services/ExportService';
import { globalState } from '$lib/runes/main.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import Exportation, { ExportState } from '$lib/classes/Exportation.svelte';
import { AssetType, Project, ProjectContent, ProjectDetail, Timeline } from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';

import Exporter, {
	getRandomBackgroundCandidates,
	selectRandomBackgroundCandidate,
	createRandomBackgroundClip
} from '$lib/classes/Exporter';

vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/plugin-fs')>()),
	exists: vi.fn()
}));
vi.mock('@tauri-apps/api/path', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/path')>()),
	/** Joint les chemins du test sans IPC. @param {string[]} parts Composants du chemin. @returns {Promise<string>} Chemin complet. */
	join: async (...parts: string[]) => parts.join('/')
}));

describe('Random export backgrounds', () => {
	it('filters compatible files without entering subdirectories', () => {
		const entries = [
			{ name: 'image.PNG', isFile: true, isDirectory: false },
			{ name: 'clip.webm', isFile: true, isDirectory: false },
			{ name: 'audio.mp3', isFile: true, isDirectory: false },
			{ name: 'nested', isFile: false, isDirectory: true }
		];

		expect(getRandomBackgroundCandidates(entries)).toEqual(['image.PNG', 'clip.webm']);
	});

	it('selects a candidate from a normalized random value', () => {
		const entries = [
			{ name: 'first.jpg', isFile: true, isDirectory: false },
			{ name: 'second.mp4', isFile: true, isDirectory: false }
		];

		expect(selectRandomBackgroundCandidate(entries, 0)).toBe('first.jpg');
		expect(selectRandomBackgroundCandidate(entries, 0.99)).toBe('second.mp4');
	});

	it('creates a static image clip and a looping video clip', () => {
		expect(createRandomBackgroundClip(7, AssetType.Image, 5000)).toMatchObject({
			assetId: 7,
			startTime: 0,
			endTime: 0,
			loopUntilAudioEnd: false
		});
		expect(createRandomBackgroundClip(8, AssetType.Video, 5000)).toMatchObject({
			assetId: 8,
			startTime: 0,
			endTime: 5000,
			loopUntilAudioEnd: true
		});
	});
});

describe('meaning excerpt video queue', () => {
	const originalProject = globalState.currentProject;
	const originalExports = globalState.exportations;

	afterEach(() => {
		vi.restoreAllMocks();
		vi.mocked(exists).mockReset();
		globalState.currentProject = originalProject;
		globalState.exportations = originalExports;
	});

	it('queues independent snapshots with unique names while preserving the current project', async () => {
		initializeClassRegistry();
		const project = new Project(
			new ProjectDetail('Talk', 'Speaker'),
			new ProjectContent(new Timeline([new SubtitleTrack()]))
		);
		globalState.currentProject = project;
		project.projectEditorState.export.customFileName = 'lecture';
		project.projectEditorState.export.videoStartTime = 500;
		project.projectEditorState.export.videoEndTime = 1500;
		globalState.exportations = [
			new Exportation(
				1,
				'lecture-2.mp4',
				'/exports/lecture-2.mp4',
				{ width: 1080, height: 1920 },
				0,
				1000,
				'',
				ExportState.WaitingForRecord,
				30
			)
		];
		vi.mocked(exists).mockImplementation(async (path) => path === '/exports/lecture-1.mp4');
		vi.spyOn(ExportService, 'getExportFolder').mockResolvedValue('/exports');
		vi.spyOn(ExportService, 'constrainFilePathLength').mockImplementation(async (path) => path);
		const saveProject = vi.spyOn(ExportService, 'saveProject').mockResolvedValue(undefined);
		const addExport = vi.spyOn(ExportService, 'addExport').mockResolvedValue(undefined);
		vi.spyOn(
			Exporter as unknown as { ensureBackgroundWorkersStarted: () => void },
			'ensureBackgroundWorkersStarted'
		).mockImplementation(() => undefined);
		const snapshot = JSON.stringify(project.toJSON());
		await Exporter.exportVideo([
			{ startTime: 1000, endTime: 21000 },
			{ startTime: 30000, endTime: 60000 }
		]);
		expect(saveProject).toHaveBeenCalledTimes(2);
		expect(
			saveProject.mock.calls.map(([copy]) => [
				copy.projectEditorState.export.videoStartTime,
				copy.projectEditorState.export.videoEndTime
			])
		).toEqual([
			[1000, 21000],
			[30000, 60000]
		]);
		expect(addExport.mock.calls.map(([, mode, output]) => [mode, output?.filePath])).toEqual([
			['recording', '/exports/lecture-1-1.mp4'],
			['recording', '/exports/lecture-2-1.mp4']
		]);
		expect(saveProject.mock.calls[0][0]).not.toBe(saveProject.mock.calls[1][0]);
		expect(JSON.stringify(project.toJSON())).toBe(snapshot);
	});
});
