import { tick } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { globalState } from '$lib/runes/main.svelte';
import { publishCommunityPreset } from '$lib/services/StylePresetLibraryService';
import { loadPopularTags } from './communityActions';
import {
	buildStyleData,
	getCurrentResolution,
	getDefaultPresetName,
	getPublishTags,
	setsEqual,
	wait
} from './presetUtils';
import toast from 'svelte-5-french-toast';

/**
 * Ouvre le formulaire de publication et génère automatiquement une preview.
 *
 * @returns {void}
 */
export function openPublishForm(): void {
	const state = globalState.presetLibrary;
	state.publishMode = true;
	state.publishName = getDefaultPresetName();
	state.publishError = null;
	state.includedCustomClipIds = new Set();
	state.lastCapturedInclusion = null;

	// Génère une preview automatiquement si aucune n'existe déjà
	if (!state.publishPreviewBlob) void generatePublishPreview();
}

/**
 * Ferme le formulaire de publication et réinitialise son état.
 *
 * @returns {void}
 */
export function closePublishForm(): void {
	const state = globalState.presetLibrary;
	state.publishMode = false;
	state.publishError = null;
	state.lastPreviewClipId = null;
	state.includedCustomClipIds = new Set();
	state.lastCapturedInclusion = null;
}

/**
 * Sélectionne un timing aléatoire au milieu d'un clip de sous-titre existant.
 *
 * Évite de réutiliser le même clip que la preview précédente
 * quand plusieurs sous-titres sont disponibles.
 *
 * @returns {number | null} Timing en millisecondes, ou null si aucun sous-titre n'existe.
 */
export function getRandomSubtitlePreviewTime(): number | null {
	const state = globalState.presetLibrary;

	const clips = globalState.getSubtitleTrack.clips.filter(
		(clip) =>
			(clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle') &&
			clip.endTime > clip.startTime
	);
	if (clips.length === 0) return null;

	// Évite le clip utilisé pour la preview précédente s'il y a d'autres candidats
	const candidates =
		clips.length > 1 && state.lastPreviewClipId !== null
			? clips.filter((clip) => clip.id !== state.lastPreviewClipId)
			: clips;

	const clip = candidates[Math.floor(Math.random() * candidates.length)];
	state.lastPreviewClipId = clip.id;
	const midTime = clip.startTime + (clip.endTime - clip.startTime) / 2;
	return Math.round(midTime);
}

/**
 * Remplace l'image de preview actuelle par un nouveau blob.
 *
 * Révoque l'URL objet précédente pour éviter les fuites mémoire.
 *
 * @param {Blob} blob Nouvelle image de preview.
 * @returns {void}
 */
export function setPublishPreviewBlob(blob: Blob): void {
	const state = globalState.presetLibrary;
	if (state.publishPreviewUrl) URL.revokeObjectURL(state.publishPreviewUrl);
	state.publishPreviewBlob = blob;
	state.publishPreviewUrl = URL.createObjectURL(blob);
}

/**
 * Génère une capture d'écran de la preview vidéo pour la publication communautaire.
 *
 * Process:
 * 1. Sélectionne un sous-titre aléatoire
 * 2. Cache les overlays customs non inclus dans le preset
 * 3. Passe en plein écran si nécessaire
 * 4. Capture l'écran via l'API native
 * 5. Restaure l'état initial
 *
 * @returns {Promise<void>}
 */
export async function generatePublishPreview(): Promise<void> {
	const state = globalState.presetLibrary;
	if (state.isGeneratingPreview) return;

	state.isGeneratingPreview = true;
	state.publishError = null;

	try {
		const timing = getRandomSubtitlePreviewTime();
		if (timing === null) {
			state.publishError = 'Add at least one subtitle before generating a preview image.';
			toast.error(state.publishError);
			return;
		}

		const wasFullscreen = globalState.getVideoPreviewState.isFullscreen;

		// Seeks vers le timing choisi
		globalState.getTimelineState.cursorPosition = timing;
		globalState.getTimelineState.movePreviewTo = timing;
		globalState.updateVideoPreviewUI();

		// Cache les overlays customs exclus pour qu'ils n'apparaissent pas dans la capture
		const overlays = document.querySelectorAll<HTMLElement>('#preview .customtext');
		const saved = new Map<HTMLElement, string>();
		overlays.forEach((el) => {
			const clipId = Number(el.dataset.clipId);
			if (!state.includedCustomClipIds.has(clipId)) {
				saved.set(el, el.style.opacity);
				el.style.opacity = '0';
			}
		});

		await tick();
		await wait(350); // Laisser le temps au rendu après le seek

		if (!wasFullscreen) {
			await globalState.getVideoPreviewState.toggleFullScreen();
			await wait(500); // Laisser le temps au plein écran de s'activer
		}

		try {
			const bytes = new Uint8Array(await invoke<number[]>('capture_window_screenshot'));
			const blob = new Blob([bytes], { type: 'image/jpeg' });
			setPublishPreviewBlob(blob);

			// Enregistre la sélection courante pour détecter les changements ultérieurs
			state.lastCapturedInclusion = new Set(state.includedCustomClipIds);
		} finally {
			// Restaure l'opacité des overlays masqués
			saved.forEach((opacity, element) => {
				element.style.opacity = opacity;
			});
		}

		if (!wasFullscreen) {
			await globalState.getVideoPreviewState.toggleFullScreen();
		}
	} catch (error) {
		state.publishError = error instanceof Error ? error.message : String(error);
		toast.error(state.publishError);
	} finally {
		state.isGeneratingPreview = false;
	}
}

/**
 * Publie le preset courant sur la librairie communautaire.
 *
 * @returns {Promise<void>}
 */
export async function publishPreset(): Promise<void> {
	const state = globalState.presetLibrary;
	if (!state.publishPreviewBlob) return;

	state.isPublishing = true;
	state.publishError = null;
	try {
		const preset = await publishCommunityPreset({
			name: state.publishName.trim(),
			authorName: state.publishAuthorName.trim(),
			description: state.publishDescription.trim(),
			tags: getPublishTags(state.publishTags),
			resolution: getCurrentResolution(),
			style: buildStyleData(state.includedCustomClipIds),
			preview: state.publishPreviewBlob
		});

		// Insère le preset publié en tête de liste et retire les doublons
		state.communityPresets = [
			preset,
			...state.communityPresets.filter((item) => item.id !== preset.id)
		];
		void loadPopularTags();
		closePublishForm();
		toast.success('Community preset published.');
	} catch (error) {
		state.publishError = error instanceof Error ? error.message : String(error);
		toast.error(state.publishError);
	} finally {
		state.isPublishing = false;
	}
}
