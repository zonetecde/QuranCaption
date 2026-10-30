import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

import ExportFileService from '$lib/services/ExportFileService';
import ExportService from '$lib/services/ExportService';
import { ExportState } from '$lib/classes/Exportation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import Exporter from '$lib/classes/Exporter';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import type { Project } from '$lib/classes/Project';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({
	appDataDir: vi.fn().mockResolvedValue('/private'),
	join: vi.fn(async (...parts: string[]) => parts.join('/'))
}));
vi.mock('@tauri-apps/plugin-notification', () => ({
	isPermissionGranted: vi.fn().mockResolvedValue(true),
	requestPermission: vi.fn()
}));

describe('public Downloads exports', () => {
	beforeEach(() => {
		globalState.exportations = [];
		globalState.uiState.showExportMonitor = false;
		globalState.currentProject = null;
		globalState.uiState.activeExportId = null;
		vi.spyOn(ExportService, 'saveExports').mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.mocked(invoke).mockReset();
		globalState.exportations = [];
		globalState.uiState.showExportMonitor = false;
	});

	it.each(['style.json', 'subtitles.srt', 'subtitles.vtt', 'chapters.txt', 'backup.json'])(
		'publishes %s to Downloads and keeps its public URI in the monitor',
		async (fileName) => {
			const publicUri = 'content://media/external/downloads/123';
			vi.mocked(invoke).mockResolvedValue(publicUri);
			const privateFolder = vi.spyOn(ExportService, 'getExportFolder');

			await expect(
				ExportFileService.saveTextFile(fileName, 'contenu UTF-8', 'Export')
			).resolves.toBe(publicUri);

			expect(invoke).toHaveBeenCalledExactlyOnceWith('save_android_download_file', {
				fileName,
				content: 'contenu UTF-8'
			});
			expect(privateFolder).not.toHaveBeenCalled();
			expect(globalState.exportations).toHaveLength(1);
			expect(globalState.exportations[0]).toMatchObject({
				finalFileName: fileName,
				finalFilePath: publicUri,
				currentState: ExportState.Exported
			});
		}
	);

	it('does not report success when publication fails', async () => {
		vi.mocked(invoke).mockRejectedValue(new Error('Downloads unavailable'));

		await expect(ExportFileService.saveTextFile('style.json', '{}')).rejects.toThrow(
			'Downloads unavailable'
		);

		expect(globalState.exportations).toHaveLength(0);
		expect(globalState.uiState.showExportMonitor).toBe(false);
		expect(ExportService.saveExports).not.toHaveBeenCalled();
	});

	it('waits for publication before marking the file as exported', async () => {
		let finishPublication!: (uri: string) => void;
		vi.mocked(invoke).mockReturnValue(
			new Promise<string>((resolve) => {
				finishPublication = resolve;
			})
		);

		const saving = ExportFileService.saveTextFile('style.json', '{}');
		expect(globalState.exportations).toHaveLength(0);

		finishPublication('content://media/external/downloads/456');
		await saving;
		expect(globalState.exportations[0].currentState).toBe(ExportState.Exported);
	});

	it.each(['mp4', 'webm', 'mov'])(
		'queues a %s video for Downloads without opening a destination dialog',
		async (extension) => {
			const editorState = new ProjectEditorState();
			editorState.export.exportWithoutBackground = extension !== 'mp4';
			editorState.export.transparentExportFormat =
				extension === 'webm' ? 'webm_vp9_alpha' : 'mov_prores_4444';
			const queuedProject = { projectEditorState: editorState, detail: { id: 42 } } as Project;
			globalState.currentProject = {
				projectEditorState: editorState,
				detail: { id: 42, generateExportFileName: () => 'my-video' },
				clone: () => queuedProject
			} as unknown as Project;
			vi.spyOn(ExportService, 'saveProject').mockResolvedValue(undefined);
			const enqueue = vi.spyOn(ExportService, 'addExport').mockResolvedValue(undefined);
			vi.spyOn(
				Exporter as unknown as { ensureBackgroundWorkersStarted: () => void },
				'ensureBackgroundWorkersStarted'
			).mockImplementation(() => undefined);

			await Exporter.exportVideo();

			expect(save).not.toHaveBeenCalled();
			expect(enqueue).toHaveBeenCalledWith(queuedProject, 'stable', {
				finalFileName: `my-video.${extension}`,
				finalFilePath: expect.stringMatching(new RegExp(`/\\d+/output\\.${extension}$`)),
				destinationUri: `my-video.${extension}`,
				sourceProjectId: 42
			});
		}
	);
});
