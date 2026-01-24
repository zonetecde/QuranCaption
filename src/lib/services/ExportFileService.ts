import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import ExportService from './ExportService';
import { globalState } from '$lib/runes/main.svelte';
import Exportation, { ExportKind, ExportState } from '$lib/classes/Exportation.svelte';
import { Utilities } from '$lib/classes/misc/Utilities';

export default class ExportFileService {
	private static sanitizeFileName(value: string): string {
		return value.replace(/[/\\:*?"<>|]/g, '_').trim() || 'export';
	}

	static getProjectNameForFile(): string {
		const projectName = globalState.currentProject?.detail.name ?? 'project';
		return this.sanitizeFileName(projectName);
	}

	static async saveTextFile(
		fileName: string,
		content: string,
		exportLabel: string = ''
	): Promise<string> {
		const exportFolder = await ExportService.getExportFolder();
		const filePath = await join(exportFolder, fileName);
		await invoke('save_file', { location: filePath, content });
		const exportId = Utilities.randomId();
		globalState.exportations.unshift(
			new Exportation(
				exportId,
				fileName,
				filePath,
				{ width: 0, height: 0 },
				0,
				0,
				'',
				ExportState.Exported,
				0,
				100,
				0,
				'',
				ExportKind.Text,
				exportLabel
			)
		);
		globalState.uiState.showExportMonitor = true;
		await ExportService.saveExports();
		return filePath;
	}
}
