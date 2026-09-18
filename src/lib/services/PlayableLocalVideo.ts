import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { ActionReturn } from 'svelte/action';

export type PlayableLocalVideoSource = {
	filePath: string;
	reloadToken: number;
};

/**
 * Charge une vidéo locale depuis le serveur HTTP interne lisible par Android WebView.
 *
 * @param {HTMLVideoElement} node Élément vidéo à alimenter.
 * @param {PlayableLocalVideoSource} source Chemin local et jeton de rechargement.
 * @returns {ActionReturn<PlayableLocalVideoSource>} Cycle de vie de l'action Svelte.
 */
export function playableLocalVideo(
	node: HTMLVideoElement,
	source: PlayableLocalVideoSource
): ActionReturn<PlayableLocalVideoSource> {
	let generation = 0;
	let sourceKey = '';

	/**
	 * Confie la source locale au serveur HTTP interne compatible avec les seeks WebView.
	 *
	 * @param {PlayableLocalVideoSource} nextSource Nouvelle source à charger.
	 * @returns {Promise<void>} Promesse résolue après attribution de la source.
	 */
	async function load(nextSource: PlayableLocalVideoSource): Promise<void> {
		const nextKey = `${nextSource.filePath}:${nextSource.reloadToken}`;
		if (nextKey === sourceKey) return;
		sourceKey = nextKey;
		const currentGeneration = ++generation;

		node.pause();
		node.removeAttribute('src');
		node.load();

		try {
			const mediaUrl = await invoke<string>('get_local_media_url', {
				filePath: nextSource.filePath,
				reloadToken: nextSource.reloadToken
			});
			if (currentGeneration !== generation) return;
			node.src = mediaUrl;
		} catch (error) {
			if (currentGeneration !== generation) return;
			console.error('Unable to prepare local video streaming:', error);
			node.src = `${convertFileSrc(nextSource.filePath)}?v=${nextSource.reloadToken}`;
		}

		node.load();
	}

	/**
	 * Recharge l'élément quand le chemin ou le contenu du média change.
	 *
	 * @param {PlayableLocalVideoSource} nextSource Source mise à jour.
	 * @returns {void}
	 */
	function update(nextSource: PlayableLocalVideoSource): void {
		void load(nextSource);
	}

	/** Détruit la source active et invalide tout chargement asynchrone en cours. */
	function destroy(): void {
		generation++;
		node.pause();
		node.removeAttribute('src');
		node.load();
	}

	void load(source);
	return { update, destroy };
}
