import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { SerializableBase } from '../misc/SerializableBase';
import { Utilities } from '../misc/Utilities';
import type { Track } from '../Track.svelte';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import toast from 'svelte-5-french-toast';

export type ClipType =
	| 'Silence'
	| 'Pre-defined Subtitle'
	| 'Subtitle'
	| 'Custom Text'
	| 'Custom Image'
	| 'Asset';

export class Clip extends SerializableBase {
	id: number;
	startTime: number = $state(0);
	endTime: number = $state(0);
	duration: number = $state(0);

	type: ClipType;
	showWaveform: boolean = $state(false);

	constructor(startTime: number, endTime: number, type: ClipType) {
		super();

		this.id = Utilities.randomId();
		this.startTime = startTime;
		this.endTime = endTime;
		this.duration = endTime - startTime;
		this.type = type;
	}

	getWidth(): number {
		const timelineZoom = globalState.currentProject?.projectEditorState.timeline.zoom ?? 0;
		if (this.duration === 0 && this.type === 'Asset') {
			// C'est dans le cas où l'asset est une image. C'est alors l'image de fond de la vidéo.
			// Elle prend la taille de la timeline.
			const longestTrackDuration =
				globalState.currentProject?.content.timeline.getLongestTrackDuration().toSeconds() ?? 0;
			return longestTrackDuration * timelineZoom;
		}

		return (this.duration / 1000) * timelineZoom;
	}

	/**
	 * Met à jour l'heure de début du clip tout en modifiant l'heure de fin du clip précédent pour éviter les chevauchements.
	 * @param newStartTime La nouvelle heure de début.
	 */
	updateStartTime(newStartTime: number) {
		// Vérification 1: Le clip actuel doit avoir au minimum 100ms de durée
		const newCurrentClipDuration = this.endTime - newStartTime;
		if (newCurrentClipDuration < 100) {
			return;
		}

		// Met à jour la endTime du clip à sa gauche pour éviter les chevauchements
		const track: Track = globalState.getSubtitleTrack;

		const previousClip = track.getClipBefore(this.id);

		if (previousClip && previousClip.id !== this.id) {
			// Vérification 2: Le clip précédent doit avoir au minimum 100ms de durée
			const newPreviousClipDuration = newStartTime - 1 - previousClip.startTime;

			if (newPreviousClipDuration < 100) {
				return;
			}

			previousClip.endTime = newStartTime - 1;
			previousClip.duration = previousClip.endTime - previousClip.startTime;
		}

		this.setStartTime(newStartTime);
	}

	/**
	 * Met à jour l'heure de fin du clip tout en modifiant l'heure de début du clip suivant pour éviter les chevauchements.
	 * @param newEndTime La nouvelle heure de fin.
	 */
	updateEndTime(newEndTime: number) {
		// Vérification 1: Le clip actuel doit avoir au minimum 100ms de durée
		const newCurrentClipDuration = newEndTime - this.startTime;
		if (newCurrentClipDuration < 100) {
			return;
		}

		// Met à jour la startTime du clip à sa droite pour éviter les chevauchements
		const track: Track = globalState.getSubtitleTrack;

		const nextClip = track.getClipAfter(this.id);

		if (nextClip && nextClip.id !== this.id) {
			// Vérification 2: Le clip suivant doit avoir au minimum 100ms de durée
			const newNextClipDuration = nextClip.endTime - (newEndTime + 1);

			if (newNextClipDuration < 100) {
				return;
			}

			// Met à jour le startTime du clip suivant
			nextClip.setStartTime(newEndTime + 1);
		}

		this.setEndTime(newEndTime);
	}

	/**
	 * Met à jour l'heure de début du clip et recalcule la durée.
	 * @param newStartTime La nouvelle heure de début.
	 */
	setStartTime(newStartTime: number) {
		ProjectHistoryManager.begin('set clip start');
		try {
			// Prévention pour pas que le clip est une durée négative
			if (this.endTime < newStartTime) {
				toast.error(get(LL).editor.clipLengthNegative());
				return;
			}

			this.startTime = newStartTime;
			this.duration = this.endTime - this.startTime;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Met à jour l'heure de fin du clip et recalcule la durée.
	 * @param newEndTime La nouvelle heure de fin.
	 */
	setEndTime(newEndTime: number) {
		ProjectHistoryManager.begin('set clip end');
		try {
			// Prévention pour pas que le clip est une durée négative
			if (newEndTime < this.startTime) {
				toast.error(get(LL).editor.clipLengthNegative());
				return;
			}

			this.endTime = newEndTime;
			this.duration = this.endTime - this.startTime;
		} finally {
			ProjectHistoryManager.commit();
		}
	}
}

export class AssetClip extends Clip {
	assetId: number;
	loopUntilAudioEnd: boolean = $state(false);
	sourceStartTime: number = $state(0);
	volumePercent: number = $state(100);

	constructor(startTime: number, endTime: number, assetId: number) {
		super(startTime, endTime, 'Asset');
		this.assetId = assetId;
	}
}

export class SilenceClip extends Clip {
	constructor(startTime: number, endTime: number) {
		super(startTime, endTime, 'Silence');
	}
}
