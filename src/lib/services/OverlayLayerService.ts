import type { ProjectContent } from '$lib/classes/ProjectContent.svelte';
import { CustomClip } from '$lib/classes/Clip.svelte';
import type { CustomTextTrack } from '$lib/classes/Track.svelte';
import { TrackType } from '$lib/classes/enums';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

/**
 * Résout les calques du projet du fond vers le premier plan, y compris les nouveaux éléments.
 * @param {ProjectContent} content Contenu du projet.
 * @returns {string[]} Identifiants ordonnés sans doublons ni éléments supprimés.
 */
export function getOverlayLayerOrder(content: ProjectContent): string[] {
	const customTrack = content.timeline.tracks.find(
		(track) => track.type === TrackType.CustomClip
	) as CustomTextTrack | undefined;
	const customClips = customTrack?.clips ?? [];
	const backgroundIds = customClips
		.filter(
			(clip) =>
				clip instanceof CustomClip && clip.category?.getStyle('above-overlay')?.value === false
		)
		.map((clip) => `custom:${clip.id}`);
	const defaults = [
		'arabic',
		...content.projectTranslation.addedTranslationEditions.map((edition) => edition.name),
		...customClips
			.filter((clip) => clip.type === 'Custom Image')
			.map((clip) => `custom:${clip.id}`),
		'surah-name',
		'reciter-name',
		'verse-number',
		...customClips.filter((clip) => clip.type !== 'Custom Image').map((clip) => `custom:${clip.id}`)
	];
	const order = [...new Set([...(content.overlayLayerOrder ?? []), ...defaults])].filter((id) =>
		defaults.includes(id)
	);
	return [...backgroundIds, ...order.filter((id) => !backgroundIds.includes(id))];
}

/**
 * Calcule une profondeur au-dessus des fonds et sous le cadre vidéo.
 * @param {string} id Identifiant du calque.
 * @returns {number} Profondeur CSS du calque.
 */
export function getOverlayLayerZIndex(id: string): number {
	const content = globalState.currentProject?.content;
	// La hiérarchie historique reste active jusqu'au premier déplacement explicite.
	if (!content?.overlayLayerOrder?.length) {
		if (id === 'video-frame') return 20;
		const customTrack = content?.timeline.tracks.find(
			(track) => track.type === TrackType.CustomClip
		);
		return customTrack?.clips.some(
			(clip) => `custom:${clip.id}` === id && clip.type === 'Custom Image'
		)
			? 5
			: 10;
	}
	const order = getOverlayLayerOrder(content);
	const index = order.indexOf(id);
	return 2 + (index < 0 ? order.length : index);
}

/**
 * Échange un élément avec le calque voisin en conservant l'historique du projet.
 * @param {string} id Identifiant du calque à déplacer.
 * @param {-1 | 1} direction Déplacement vers le fond ou le premier plan.
 * @param {string[]} [visibleIds] Calques actuellement affichés dans l'aperçu.
 * @returns {void}
 */
export function moveOverlayLayer(id: string, direction: -1 | 1, visibleIds?: string[]): void {
	const content = globalState.currentProject?.content;
	if (!content) return;
	const order = getOverlayLayerOrder(content);
	const visibleOrder = visibleIds ? order.filter((layer) => visibleIds.includes(layer)) : order;
	const index = visibleOrder.indexOf(id);
	const neighbor = visibleOrder[index + direction];
	if (index < 0 || !neighbor) return;
	ProjectHistoryManager.track('move overlay layer', () => {
		const from = order.indexOf(id);
		const to = order.indexOf(neighbor);
		[order[from], order[to]] = [order[to], order[from]];
		content.overlayLayerOrder = order;
		for (const layerId of [id, neighbor].filter((layer) => layer.startsWith('custom:'))) {
			const track = content.timeline.tracks.find((track) => track.type === TrackType.CustomClip) as
				| CustomTextTrack
				| undefined;
			const clip = track?.clips.find((clip) => `custom:${clip.id}` === layerId);
			const aboveOverlay =
				clip instanceof CustomClip ? clip.category?.getStyle('above-overlay') : undefined;
			if (aboveOverlay) aboveOverlay.value = true;
		}
	});
}

/**
 * Place un calque à une position bornée en réutilisant les déplacements du menu contextuel.
 * @param {string} id Identifiant du calque.
 * @param {number} position Position souhaitée, de 1 (fond) au nombre de calques.
 * @returns {void}
 */
export function setOverlayLayerPosition(id: string, position: number): void {
	const content = globalState.currentProject?.content;
	if (!content || !Number.isFinite(position)) return;
	const order = getOverlayLayerOrder(content);
	const from = order.indexOf(id);
	const to = Math.max(0, Math.min(order.length - 1, Math.round(position) - 1));
	if (from < 0 || from === to) return;
	ProjectHistoryManager.track('set overlay layer position', () => {
		for (let index = from; index !== to; index += to > from ? 1 : -1) {
			moveOverlayLayer(id, to > from ? 1 : -1);
		}
	});
}
