import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import ExportService from './ExportService';
import { globalState } from '$lib/runes/main.svelte';

export default class ExportFileService {
	private static sanitizeFileName(value: string): string {
		return value.replace(/[/\\:*?"<>|]/g, '_').trim() || 'export';
	}

	static getProjectNameForFile(): string {
		const projectName = globalState.currentProject?.detail.name ?? 'project';
		return this.sanitizeFileName(projectName);
	}

	static async saveTextFile(fileName: string, content: string): Promise<string> {
		const exportFolder = await ExportService.getExportFolder();
		const filePath = await join(exportFolder, fileName);
		await invoke('save_file', { location: filePath, content });
		await invoke('open_explorer_with_file_selected', { filePath });
		return filePath;
	}
}
