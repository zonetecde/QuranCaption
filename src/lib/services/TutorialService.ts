import { invoke } from '@tauri-apps/api/core';
import { ProjectService } from './ProjectService';
import { globalState } from '$lib/runes/main.svelte';

const TUTORIAL_PROJECT_NAME = 'Tutorial Project';
const TUTORIAL_AUDIO_FILENAME = 'Yasser Al-Dosari - 1. Al-Fatihah.mp3';

/**
 * Imports the tutorial project, replacing the {{tutorial_audio}} placeholder with
 * the resolved filesystem path of the bundled audio file.
 *
 * @param force - When true, deletes any existing tutorial project first (used for reset).
 */
export async function setupTutorialProject(force = false): Promise<void> {
	// Delete existing tutorial project if force-resetting
	if (force) {
		const existing = globalState.userProjectsDetails.find(
			(p) => p.name === TUTORIAL_PROJECT_NAME
		);
		if (existing) {
			await ProjectService.delete(existing.id);
		}
	} else {
		// Skip if tutorial project already exists
		if (globalState.userProjectsDetails.some((p) => p.name === TUTORIAL_PROJECT_NAME)) return;
	}

	const audioPath = await invoke<string>('get_tutorial_asset_path', {
		filename: TUTORIAL_AUDIO_FILENAME
	});

	const response = await fetch('/tutorial/1774428451900961.json');
	const jsonText = await response.text();
	const processedText = jsonText.replace(
		'"{{tutorial_audio}}"',
		JSON.stringify(audioPath.replace(/\\/g, '/'))
	);
	const json = JSON.parse(processedText);

	await ProjectService.importProject(json);
	await ProjectService.loadUserProjectsDetails();
}
