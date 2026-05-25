import { globalState } from '$lib/runes/main.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import Settings, { type SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
import ExportFileService from '$lib/services/ExportFileService';
import { buildLocalPreset, buildStyleData, getExportFileName } from './presetUtils';
import toast from 'svelte-5-french-toast';

/**
 * Insère ou remplace un preset local dans les paramètres.
 *
 * @param {SavedVideoStylePreset} preset Preset à stocker.
 * @returns {Promise<boolean>} True si le preset a bien été sauvegardé.
 */
export async function storeLocalPreset(preset: SavedVideoStylePreset): Promise<boolean> {
	const settings = globalState.settings ?? new Settings();
	if (!globalState.settings) globalState.settings = settings;

	// Cherche un preset existant avec le même nom ou le même communityPresetId
	const existingIndex = settings.savedVideoStylePresets.findIndex(
		(item) =>
			(preset.communityPresetId && item.communityPresetId === preset.communityPresetId) ||
			item.name.trim().toLowerCase() === preset.name.trim().toLowerCase()
	);
	const nextPresets = [...settings.savedVideoStylePresets];

	if (existingIndex !== -1) {
		const confirmed = await ModalManager.confirmModal(
			`A preset named "${preset.name}" already exists. Replace it?`,
			false
		);
		if (!confirmed) return false;

		// Conserve l'id et la date de création du preset existant
		const existing = nextPresets[existingIndex];
		nextPresets.splice(existingIndex, 1, {
			...preset,
			id: existing.id,
			createdAt: existing.createdAt
		});
	} else {
		nextPresets.unshift(preset);
	}

	settings.savedVideoStylePresets = nextPresets;
	await Settings.save();
	return true;
}

/**
 * Sauvegarde les styles du projet courant en tant que preset local.
 *
 * @param {string} name Nom du preset.
 * @param {Set<number>} includedClipIds IDs des clips customs à inclure.
 * @returns {Promise<void>}
 */
export async function savePreset(name: string, includedClipIds: Set<number>): Promise<void> {
	const stored = await storeLocalPreset(buildLocalPreset(name.trim(), includedClipIds));
	if (!stored) return;

	globalState.presetLibrary.modalMode = null;
	toast.success('Style preset saved.');
}

/**
 * Exporte les styles du projet courant en fichier JSON.
 *
 * @param {string} name Nom du preset.
 * @param {Set<number>} includedClipIds IDs des clips customs à inclure.
 * @returns {Promise<void>}
 */
export async function exportJson(name: string, includedClipIds: Set<number>): Promise<void> {
	const json = JSON.stringify(buildStyleData(includedClipIds), null, 2);
	await ExportFileService.saveTextFile(getExportFileName(name), json, 'Styles');

	globalState.presetLibrary.modalMode = null;
	toast.success('Style JSON exported.');
}

/**
 * Applique un preset local sauvegardé au projet courant.
 *
 * @param {SavedVideoStylePreset} preset Preset local à appliquer.
 * @returns {Promise<void>}
 */
export async function applyPreset(preset: SavedVideoStylePreset): Promise<void> {
	const confirmed = await ModalManager.confirmModal(
		`Your current styles will be overwritten by "${preset.name}".`,
		false
	);
	if (!confirmed) return;

	await globalState.getVideoStyle.importStyles(preset.data);
	toast.success('Style preset applied.');
}

/**
 * Supprime un preset local sauvegardé.
 *
 * @param {SavedVideoStylePreset} preset Preset local à supprimer.
 * @returns {Promise<void>}
 */
export async function deletePreset(preset: SavedVideoStylePreset): Promise<void> {
	const confirmed = await ModalManager.confirmModal(`Delete "${preset.name}"?`, false);
	if (!confirmed || !globalState.settings) return;

	globalState.settings.savedVideoStylePresets = globalState.settings.savedVideoStylePresets.filter(
		(item) => item.id !== preset.id
	);
	await Settings.save();
	toast.success('Style preset deleted.');
}
