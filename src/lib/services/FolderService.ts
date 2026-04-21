import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import { Utilities } from '$lib/classes';
import type { FolderDetail } from '$lib/types/folder';
import { ProjectService } from './ProjectService';

export class FolderService {
	private static readonly fileName = 'folders.json';

	private static async getFilePath(): Promise<string> {
		return join(await appDataDir(), this.fileName);
	}

	/**
	 * Charge tous les dossiers depuis le disque.
	 */
	static async load(): Promise<FolderDetail[]> {
		const filePath = await this.getFilePath();
		if (!(await exists(filePath))) return [];
		try {
			const content = await readTextFile(filePath);
			return JSON.parse(content) as FolderDetail[];
		} catch {
			return [];
		}
	}

	/**
	 * Sauvegarde la liste des dossiers sur le disque.
	 */
	static async save(folders: FolderDetail[]): Promise<void> {
		const filePath = await this.getFilePath();
		await writeTextFile(filePath, JSON.stringify(folders, null, 2));
	}

	/**
	 * Crée un nouveau dossier.
	 */
	static async createFolder(name: string, color: string): Promise<FolderDetail> {
		const folder: FolderDetail = {
			id: Utilities.randomId(),
			name,
			color,
			createdAt: new Date().toISOString()
		};
		const folders = [...globalState.userFolders, folder];
		await this.save(folders);
		globalState.userFolders = folders;
		return folder;
	}

	/**
	 * Supprime un dossier et retire le folderId des projets associés.
	 */
	static async deleteFolder(id: number): Promise<void> {
		// Retire le folderId de tous les projets appartenant à ce dossier
		const affectedProjects = globalState.userProjectsDetails.filter((p) => p.folderId === id);
		for (const project of affectedProjects) {
			project.folderId = undefined;
			await ProjectService.saveDetail(project);
		}

		const folders = globalState.userFolders.filter((f) => f.id !== id);
		await this.save(folders);
		globalState.userFolders = folders;
	}

	/**
	 * Renomme un dossier.
	 */
	static async renameFolder(id: number, name: string): Promise<void> {
		const folders = globalState.userFolders.map((f) => (f.id === id ? { ...f, name } : f));
		await this.save(folders);
		globalState.userFolders = folders;
	}
}
