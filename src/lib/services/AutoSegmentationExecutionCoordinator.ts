export type AutoSegmentationExecutionSource = 'manual' | 'batch';

export class AutoSegmentationExecutionCoordinator {
	private static source: AutoSegmentationExecutionSource | null = null;

	/**
	 * Retourne la source de la segmentation active.
	 * @returns {AutoSegmentationExecutionSource | null} Propriétaire courant du verrou.
	 */
	static get activeSource(): AutoSegmentationExecutionSource | null {
		return this.source;
	}

	/**
	 * Tente de réserver l'unique pipeline de segmentation.
	 * @param {AutoSegmentationExecutionSource} source Source de l'exécution demandée.
	 * @returns {(() => void) | null} Fonction de libération, ou `null` si le verrou est pris.
	 */
	static tryAcquire(source: AutoSegmentationExecutionSource): (() => void) | null {
		if (this.source !== null) return null;
		this.source = source;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (this.source === source) this.source = null;
		};
	}
}

/**
 * Résout le message localisé correspondant au verrou actuellement détenu.
 * @returns {string} Message clair pour le flow manuel.
 */
export function getAutoSegmentationBusyMessage(): string {
	const messages = (
		get(LL) as unknown as {
			batch?: {
				segmentationManualBlocked?: () => string;
				segmentationAlreadyRunning?: () => string;
			};
		}
	).batch;
	return AutoSegmentationExecutionCoordinator.activeSource === 'batch'
		? (messages?.segmentationManualBlocked?.() ?? get(LL).editor.aiSegmentationFailed())
		: (messages?.segmentationAlreadyRunning?.() ?? get(LL).editor.aiSegmentationFailed());
}
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
