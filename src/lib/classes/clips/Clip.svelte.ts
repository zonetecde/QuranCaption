import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { SerializableBase } from '../misc/SerializableBase';
import { Utilities } from '../misc/Utilities';

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

	/**
	 * Met à jour le début du clip et recalcule sa durée.
	 * @param {number} newStartTime Nouvelle borne en millisecondes.
	 * @returns {boolean} Faux si la borne ne définit pas une durée valide.
	 */
	setStartTime(newStartTime: number): boolean {
		if (!Number.isFinite(newStartTime) || newStartTime < 0 || this.endTime < newStartTime)
			return false;
		return ProjectHistoryManager.track('set clip start', () => {
			this.startTime = newStartTime;
			this.duration = this.endTime - this.startTime;
			return true;
		});
	}

	/**
	 * Met à jour la fin du clip et recalcule sa durée.
	 * @param {number} newEndTime Nouvelle borne en millisecondes.
	 * @returns {boolean} Faux si la borne ne définit pas une durée valide.
	 */
	setEndTime(newEndTime: number): boolean {
		if (!Number.isFinite(newEndTime) || newEndTime < this.startTime) return false;
		return ProjectHistoryManager.track('set clip end', () => {
			this.endTime = newEndTime;
			this.duration = this.endTime - this.startTime;
			return true;
		});
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
