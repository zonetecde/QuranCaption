import { open } from '@tauri-apps/plugin-dialog';
import type { FadeValue } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
export { asDimensionValue, asFadeValue } from '$lib/services/StyleMutationService';

/**
 * Indique si au moins un fondu est actif.
 * @param {FadeValue} value Configuration de fondu.
 * @returns {boolean} `true` lorsqu'une durée de fondu est utile.
 */
export function hasFadeEnabled(value: FadeValue): boolean {
	return (
		value.audioFadeInEnabled ||
		value.audioFadeOutEnabled ||
		value.videoFadeInEnabled ||
		value.videoFadeOutEnabled
	);
}

/**
 * Convertit des millisecondes au format d'un input temporel.
 * @param {number} value Temps en millisecondes.
 * @returns {string} Temps au format HH:mm:ss.
 */
export function msToTimeValue(value: number): string {
	const totalSeconds = Math.floor(value / 1000);
	const hh = Math.floor(totalSeconds / 3600);
	const mm = Math.floor((totalSeconds % 3600) / 60);
	const ss = totalSeconds % 60;
	return [hh, mm, ss].map((part) => String(part).padStart(2, '0')).join(':');
}

/**
 * Ouvre le sélecteur d'image partagé par les contrôles média.
 * @returns {Promise<string | null>} Chemin sélectionné ou `null` après annulation.
 */
export async function pickImageFile(): Promise<string | null> {
	const result = await open({
		multiple: false,
		directory: false,
		filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif'] }]
	});
	return result ? String(result) : null;
}
