import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { SerializableBase } from '../misc/SerializableBase';
import { Clip } from './Clip.svelte';
import type { Category, Style, StyleName } from '../VideoStyle.svelte';
import { Translation } from '../Translation.svelte';
import {
	getTimedOverlayRangesFromStyles,
	syncTimedOverlayLegacyRange,
	updateTimedOverlayRange,
	getTimedOverlayRanges,
	type TimedOverlayRange
} from '$lib/services/TimedOverlayRanges';

export class CustomClip extends Clip {
	category: Category | undefined = $state(undefined);

	constructor(startTime: number, endTime: number, type: 'text' | 'image', category?: Category) {
		super(startTime, endTime, 'Custom Text');
		this.type = type === 'text' ? 'Custom Text' : 'Custom Image';
		this.category = category;
	}

	/**
	 * Retourne les apparitions temporelles du contenu personnalisé.
	 * @param {boolean} [sort=true] Trie les plages par apparition.
	 * @returns {TimedOverlayRange[]} Plages temporelles normalisées.
	 */
	getTimedOverlayRanges(sort = true): TimedOverlayRange[] {
		return getTimedOverlayRangesFromStyles(this.category?.styles ?? [], sort);
	}

	/**
	 * Met à jour le début du clip et sa première plage d'apparition.
	 * @param {number} newStartTime Nouveau début en millisecondes.
	 * @returns {boolean} Vrai si les bornes et la plage ont été modifiées.
	 */
	override setStartTime(newStartTime: number): boolean {
		ProjectHistoryManager.begin('set custom clip start');
		try {
			const rangesStyle = this.category?.getStyle('time-ranges');
			const ranges = rangesStyle ? this.getTimedOverlayRanges() : [];
			const nextRanges = rangesStyle
				? updateTimedOverlayRange(ranges, 0, 'startTime', newStartTime)
				: [];
			if (!super.setStartTime(nextRanges[0]?.startTime ?? newStartTime)) return false;
			if (rangesStyle) {
				rangesStyle.value = nextRanges;
				syncTimedOverlayLegacyRange(this.category?.styles ?? [], nextRanges[0]);
			}
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Met à jour la fin du clip et sa première plage d'apparition.
	 * @param {number} newEndTime Nouvelle fin en millisecondes.
	 * @returns {boolean} Vrai si les bornes et la plage ont été modifiées.
	 */
	override setEndTime(newEndTime: number): boolean {
		ProjectHistoryManager.begin('set custom clip end');
		try {
			const rangesStyle = this.category?.getStyle('time-ranges');
			const ranges = rangesStyle ? this.getTimedOverlayRanges() : [];
			const nextRanges = rangesStyle
				? updateTimedOverlayRange(ranges, 0, 'endTime', newEndTime)
				: [];
			if (!super.setEndTime(nextRanges[0]?.endTime ?? newEndTime)) return false;
			if (rangesStyle) {
				rangesStyle.value = nextRanges;
				syncTimedOverlayLegacyRange(this.category?.styles ?? [], nextRanges[0]);
			}
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	setStyle(styleId: StyleName, value: Style['value']) {
		ProjectHistoryManager.begin('set custom clip style');
		try {
			if (styleId === 'time-ranges') {
				const ranges = getTimedOverlayRanges(value);
				const firstRange = ranges[0];
				if (firstRange) {
					this.startTime = firstRange.startTime;
					this.endTime = firstRange.endTime;
					this.duration = firstRange.endTime - firstRange.startTime;
					syncTimedOverlayLegacyRange(this.category!.styles, firstRange);
				}
				this.category!.styles.find((style) => style.id === styleId)!.value = ranges;
			} else if (styleId === 'time-appearance') {
				if (typeof value === 'number') this.setStartTime(value);
			} else if (styleId === 'time-disappearance') {
				if (typeof value === 'number') this.setEndTime(value);
			}

			if (styleId !== 'time-ranges') {
				this.category!.styles.find((style) => style.id === styleId)!.value = value;
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	getAlwaysShow(): boolean {
		return this.category?.getStyle('always-show')!.value as boolean;
	}
}

export class CustomTextClip extends CustomClip {
	constructor(category?: Category) {
		const firstRange = getTimedOverlayRangesFromStyles(category?.styles ?? [])[0];
		const startTime = firstRange?.startTime ?? 0;
		const endTime = firstRange?.endTime ?? 0;

		super(startTime, endTime, 'text', category);
		this.category = category;
	}

	getText() {
		return this.category?.getStyle('text')!.value as string;
	}
}

export class CustomImageClip extends CustomClip {
	constructor(category?: Category) {
		const firstRange = getTimedOverlayRangesFromStyles(category?.styles ?? [])[0];
		const startTime = firstRange?.startTime ?? 0;
		const endTime = firstRange?.endTime ?? 0;

		super(startTime, endTime, 'image', category);
		this.category = category;
	}

	getFilePath() {
		return this.category?.getStyle('filepath')!.value as string;
	}
}

SerializableBase.registerChildClass(CustomTextClip, 'translations', Translation);
