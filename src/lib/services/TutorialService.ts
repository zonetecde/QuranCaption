import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { ProjectService } from './ProjectService';
import { Mp3QuranService } from './Mp3QuranService';
import { globalState } from '$lib/runes/main.svelte';

const TUTORIAL_PROJECT_NAME = 'Tutorial Project';
const TUTORIAL_AUDIO_FILENAME = 'Yasser Al-Dosari - 1. Al-Fatihah.mp3';
const YASSER_AL_DOSARI_ID = 92;

async function downloadTutorialAudio(): Promise<string> {
	const reciters = await Mp3QuranService.getReciters();
	const yasser = reciters.find((r) => r.id === YASSER_AL_DOSARI_ID);
	if (!yasser || yasser.moshaf.length === 0) {
		throw new Error('Yasser Al-Dosari (ID 92) not found on mp3quran');
	}
	const url = `${yasser.moshaf[0].server}001.mp3`;
	const destPath = await join(await appDataDir(), 'assets', 'tutorial', TUTORIAL_AUDIO_FILENAME);
	await invoke('download_file', { url, path: destPath });
	return destPath;
}

/**
 * Imports the tutorial project, downloading Al-Fatiha by Yasser Al-Dosari from mp3quran.
 * @param force - When true, deletes any existing tutorial project first (used for reset).
 */
export async function setupTutorialProject(force = false): Promise<void> {
	if (force) {
		const existing = globalState.userProjectsDetails.find((p) => p.name === TUTORIAL_PROJECT_NAME);
		if (existing) await ProjectService.delete(existing.id);
	} else {
		if (globalState.userProjectsDetails.some((p) => p.name === TUTORIAL_PROJECT_NAME)) return;
	}

	const audioPath = await downloadTutorialAudio();
	const jsonText = await (await fetch('/tutorial/1774428451900961.json')).text();
	const processedText = jsonText.replace(
		'"{{tutorial_audio}}"',
		JSON.stringify(audioPath.replace(/\\/g, '/'))
	);

	await ProjectService.importProject(JSON.parse(processedText));
	await ProjectService.loadUserProjectsDetails();
}
