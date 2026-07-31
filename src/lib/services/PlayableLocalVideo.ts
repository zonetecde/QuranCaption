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
	let generation = 0;
	let objectUrl: string | null = null;
	let sourceKey = '';

	/** Libère l'URL Blob utilisée par la source précédente. */
	function releaseObjectUrl(): void {
		if (!objectUrl) return;
		URL.revokeObjectURL(objectUrl);
		objectUrl = null;
	}

	/**
	 * Charge la source locale complète avant de la confier au décodeur WebView.
	 *
	 * @param {PlayableLocalVideoSource} nextSource Nouvelle source à charger.
	 * @returns {Promise<void>} Promesse résolue après attribution de la source.
	 */
	async function load(nextSource: PlayableLocalVideoSource): Promise<void> {
		const nextKey = `${nextSource.filePath}:${nextSource.reloadToken}`;
		if (nextKey === sourceKey) return;
		sourceKey = nextKey;
		const currentGeneration = ++generation;
		const assetUrl = `${convertFileSrc(nextSource.filePath)}?v=${nextSource.reloadToken}`;

		node.pause();
		node.removeAttribute('src');
		node.load();
		releaseObjectUrl();

		try {
			const response = await fetch(assetUrl, { cache: 'no-store' });
			if (!response.ok) throw new Error(`Unable to load local video (${response.status})`);
			const blob = await response.blob();
			if (currentGeneration !== generation) return;

			objectUrl = URL.createObjectURL(blob);
			node.src = objectUrl;
		} catch (error) {
			if (currentGeneration !== generation) return;
			console.error('Unable to prepare local video for playback:', error);
			node.src = assetUrl;
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
		releaseObjectUrl();
	}

	void load(source);
	return { update, destroy };
}
