import { convertFileSrc } from '@tauri-apps/api/core';
import type { ActionReturn } from 'svelte/action';

export type PlayableLocalVideoSource = {
	filePath: string;
	reloadToken: number;
};

/**
 * Charge une vidéo locale dans une URL Blob lisible par Android WebView.
 *
 * @param {HTMLVideoElement} node Élément vidéo à alimenter.
 * @param {PlayableLocalVideoSource} source Chemin local et jeton de rechargement.
 * @returns {ActionReturn<PlayableLocalVideoSource>} Cycle de vie de l'action Svelte.
 */
export function playableLocalVideo(
	node: HTMLVideoElement,
	source: PlayableLocalVideoSource
): ActionReturn<PlayableLocalVideoSource> {
	let sourceKey = '';

	/**
	 * Confie la source locale au flux média natif de la WebView.
	 *
	 * @param {PlayableLocalVideoSource} nextSource Nouvelle source à charger.
	 * @returns {void}
	 */
	function load(nextSource: PlayableLocalVideoSource): void {
		const nextKey = `${nextSource.filePath}:${nextSource.reloadToken}`;
		if (nextKey === sourceKey) return;
		sourceKey = nextKey;

		node.pause();
		node.src = `${convertFileSrc(nextSource.filePath)}?v=${nextSource.reloadToken}`;
		node.load();
	}

	/**
	 * Recharge l'élément quand le chemin ou le contenu du média change.
	 *
	 * @param {PlayableLocalVideoSource} nextSource Source mise à jour.
	 * @returns {void}
	 */
	function update(nextSource: PlayableLocalVideoSource): void {
		load(nextSource);
	}

	/** Détruit la source active et invalide tout chargement asynchrone en cours. */
	function destroy(): void {
		node.pause();
		node.removeAttribute('src');
		node.load();
	}

	load(source);
	return { update, destroy };
}
