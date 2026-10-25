import { globalState } from '$lib/runes/main.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import Settings, { type SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
import ExportFileService from '$lib/services/ExportFileService';
import {
	buildLocalPreset,
	buildStyleData,
	getCurrentResolution,
	getExportFileName
} from './presetUtils';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import toast from 'svelte-5-french-toast';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

/**
 * Insère ou remplace un preset local dans les paramètres.
 *
 * @param {SavedVideoStylePreset} preset Preset à stocker.
 * @returns {Promise<SavedVideoStylePreset | null>} Preset sauvegardé, ou null après annulation.
 */
export async function storeLocalPreset(
	preset: SavedVideoStylePreset
): Promise<SavedVideoStylePreset | null> {
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
			get(LL).editor.overwriteConfirm({ name: preset.name }),
			false
		);
		if (!confirmed) return null;

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
	return nextPresets[existingIndex === -1 ? 0 : existingIndex];
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
	ProjectHistoryManager.track('select style preset', () => {
		globalState.getStylesState.activeLocalPresetId = stored.id;
	});

	globalState.presetLibrary.modalMode = null;
	AnalyticsService.trackStylePresetSaved(includedClipIds.size);
	toast.success(get(LL).style.stylePresetSaved());
}

/**
 * Met à jour le preset local sélectionné avec les styles et clips personnalisés actuels.
 * @returns {Promise<void>} Résolution après la sauvegarde du preset existant.
 */
export async function updatePreset(): Promise<void> {
	const settings = globalState.settings;
	const preset = settings?.savedVideoStylePresets.find(
		(item) => item.id === globalState.getStylesState.activeLocalPresetId
	);
	if (!settings || !preset) return;

	const includedClipIds = new Set(globalState.getCustomClipTrack.clips.map((clip) => clip.id));
	const data = buildStyleData(includedClipIds);
	const resolution = getCurrentResolution();
	settings.savedVideoStylePresets = settings.savedVideoStylePresets.map((item) =>
		item.id === preset.id
			? { ...item, data, resolution, updatedAt: new Date().toISOString() }
			: item
	);
	await Settings.save();
	toast.success(get(LL).style.stylePresetSaved());
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
	toast.success(get(LL).style.styleJsonExported());
}

/**
 * Applique un preset local sauvegardé au projet courant.
 *
 * @param {SavedVideoStylePreset} preset Preset local à appliquer.
 * @returns {Promise<void>}
 */
export async function applyPreset(preset: SavedVideoStylePreset): Promise<void> {
	const confirmed = await ModalManager.confirmModal(
		get(LL).editor.overwriteStylesConfirm({ name: preset.name }),
		false
	);
	if (!confirmed) return;

	await ProjectHistoryManager.trackAsync('apply style preset', async () => {
		await globalState.getVideoStyle.importStyles(preset.data);
		globalState.getStylesState.activeLocalPresetId = preset.id;
	});
	AnalyticsService.trackStylePresetApplied('local');
	toast.success(get(LL).style.stylePresetApplied());
}

/**
 * Supprime un preset local sauvegardé.
 *
 * @param {SavedVideoStylePreset} preset Preset local à supprimer.
 * @returns {Promise<void>}
 */
export async function deletePreset(preset: SavedVideoStylePreset): Promise<void> {
	const confirmed = await ModalManager.confirmModal(
		get(LL).modals.deleteItem({ name: preset.name }),
		false
	);
	if (!confirmed || !globalState.settings) return;

	globalState.settings.savedVideoStylePresets = globalState.settings.savedVideoStylePresets.filter(
		(item) => item.id !== preset.id
	);
	await Settings.save();
	toast.success(get(LL).style.stylePresetDeleted());
}
