import { globalState } from '$lib/runes/main.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import {
	getCommunityPresetStyle,
	getPopularTags,
	getStyleLibraryDeviceId,
	likeCommunityPreset,
	listCommunityPresets,
	type CommunityStylePreset
} from '$lib/services/StylePresetLibraryService';
import { storeLocalPreset } from './localActions';
import { buildCommunityPresetData, checkMissingFonts } from './presetUtils';
import toast from 'svelte-5-french-toast';

/**
 * Charge la liste des presets communauté depuis l'API publique.
 *
 * @returns {Promise<void>}
 */
export async function loadCommunity(): Promise<void> {
	const state = globalState.presetLibrary;
	state.isLoadingCommunity = true;
	state.communityError = null;
	try {
		state.communityPresets = await listCommunityPresets({
			search: state.communitySearchQuery,
			tag: state.selectedTag,
			orientation: state.selectedOrientation,
			sort: state.selectedSort,
			limit: 100
		});
	} catch (error) {
		state.communityError = error instanceof Error ? error.message : String(error);
		state.communityPresets = [];
	} finally {
		state.isLoadingCommunity = false;
	}
}

/**
 * Charge les tags populaires de la communauté.
 *
 * @returns {Promise<void>}
 */
export async function loadPopularTags(): Promise<void> {
	try {
		globalState.presetLibrary.popularTags = await getPopularTags();
	} catch {
		globalState.presetLibrary.popularTags = [];
	}
}

/**
 * Télécharge, sauvegarde et applique un preset communauté.
 *
 * Vérifie également les polices manquantes après l'application
 * et avertit l'utilisateur si nécessaire.
 *
 * @param {CommunityStylePreset} preset Métadonnées du preset communauté.
 * @returns {Promise<void>}
 */
export async function downloadAndApply(preset: CommunityStylePreset): Promise<void> {
	const state = globalState.presetLibrary;

	// Empêche les téléchargements simultanés
	if (state.downloadingPresetId) return;

	const confirmed = await ModalManager.confirmModal(
		`Your current styles will be overwritten by "${preset.name}".`,
		false
	);
	if (!confirmed) return;

	state.downloadingPresetId = preset.id;
	try {
		const styleData = await getCommunityPresetStyle(preset.id);
		const stored = await storeLocalPreset(buildCommunityPresetData(preset, styleData));
		if (!stored) return;

		await globalState.getVideoStyle.importStyles(styleData);

		// Incrémente le compteur de téléchargements localement
		state.communityPresets = state.communityPresets.map((item) =>
			item.id === preset.id ? { ...item, downloadCount: item.downloadCount + 1 } : item
		);
		toast.success('Community preset saved and applied.');

		// Vérifie les polices externes manquantes
		const missing = await checkMissingFonts(styleData);
		if (missing.length > 0) {
			await ModalManager.confirmModal(
				`This preset uses fonts that are not installed on your system:\n\n${missing.map((f) => `• ${f}`).join('\n')}\n\nPlease download and install the missing ${missing.length === 1 ? 'font' : 'fonts'}, then restart QuranCaption for them to take effect.`,
				false
			);
		}
	} catch (error) {
		toast.error(error instanceof Error ? error.message : String(error));
	} finally {
		state.downloadingPresetId = null;
	}
}

/**
 * Like un preset communauté pour l'appareil courant.
 *
 * @param {CommunityStylePreset} preset Métadonnées du preset communauté.
 * @returns {Promise<void>}
 */
export async function likePreset(preset: CommunityStylePreset): Promise<void> {
	const state = globalState.presetLibrary;

	// Évite les likes simultanés ou les doublons
	if (state.likingPresetId || state.likedPresetIds.has(preset.id)) return;

	state.likingPresetId = preset.id;
	try {
		const deviceId = await getStyleLibraryDeviceId();
		const result = await likeCommunityPreset(preset.id, deviceId);

		state.likedPresetIds = new Set(state.likedPresetIds).add(preset.id);
		state.communityPresets = state.communityPresets.map((item) =>
			item.id === preset.id ? { ...item, likeCount: result.likeCount } : item
		);
	} catch (error) {
		toast.error(error instanceof Error ? error.message : String(error));
	} finally {
		state.likingPresetId = null;
	}
}
