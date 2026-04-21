import type { CustomClip, CustomImageClip } from '$lib/classes/Clip.svelte';
import { CustomTextClip } from '$lib/classes';
import type { StyleName } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Configuration minimale pour représenter un bloc global temporisé
 * comme un "clip" dans la timeline.
 */
type GlobalTimedOverlayConfig = {
	id: string;
	label: string;
	alwaysShowStyleId: StyleName;
	startStyleId: StyleName;
	endStyleId: StyleName;
};

/**
 * Adaptateur timeline pour les overlays globaux (Surah/Reciter).
 * Cette classe expose la même surface utile que les custom clips:
 * start/end, width, always-show, setStartTime, setEndTime...
 */
export class GlobalTimedOverlayTimelineClip {
	readonly id: string;
	readonly label: string;
	readonly type = 'Global Timed Overlay';
	readonly canRemove = false;
	readonly category = undefined;

	private readonly alwaysShowStyleId: StyleName;
	private readonly startStyleId: StyleName;
	private readonly endStyleId: StyleName;

	constructor(config: GlobalTimedOverlayConfig) {
		this.id = config.id;
		this.label = config.label;
		this.alwaysShowStyleId = config.alwaysShowStyleId;
		this.startStyleId = config.startStyleId;
		this.endStyleId = config.endStyleId;
	}

	get startTime(): number {
		return Number(globalState.getStyle('global', this.startStyleId).value ?? 0);
	}

	get endTime(): number {
		return Number(globalState.getStyle('global', this.endStyleId).value ?? 0);
	}

	get duration(): number {
		return this.endTime - this.startTime;
	}

	getAlwaysShow(): boolean {
		return Boolean(globalState.getStyle('global', this.alwaysShowStyleId).value);
	}

	setStartTime(newStartTime: number) {
		if (this.endTime < newStartTime) return;
		globalState.getStyle('global', this.startStyleId).value = newStartTime;
		globalState.updateVideoPreviewUI();
	}

	setEndTime(newEndTime: number) {
		if (newEndTime < this.startTime) return;
		globalState.getStyle('global', this.endStyleId).value = newEndTime;
		globalState.updateVideoPreviewUI();
	}

	setStyle(styleId: StyleName, value: string | number | boolean) {
		// Pour cet adaptateur, seul le toggle always-show est gerable ici.
		if (styleId === 'always-show') {
			globalState.getStyle('global', this.alwaysShowStyleId).value = value as boolean;
			globalState.updateVideoPreviewUI();
		}
	}

	getWidth(): number {
		const timelineZoom = globalState.currentProject?.projectEditorState.timeline.zoom ?? 0;
		if (this.getAlwaysShow()) {
			// Meme comportement que les custom clips: occupe toute la duree projet.
			const longestTrackDuration =
				globalState.currentProject?.content.timeline.getLongestTrackDuration().toSeconds() ?? 0;
			return longestTrackDuration * timelineZoom;
		}
		return (this.duration / 1000) * timelineZoom;
	}

	getDisplayLabel(): string {
		return this.label;
	}
}

export type TimelineCustomClipLike = CustomClip | GlobalTimedOverlayTimelineClip;

/**
 * Retourne la liste de clips à afficher dans la lane "custom clips":
 * - clips custom reels
 * - overlays globaux temporisés (Surah/Reciter uniquement, et seulement si always-show=false)
 */
export function getTimelineCustomClips(): TimelineCustomClipLike[] {
	// Base: les clips custom reels existants (text/image).
	const clips: TimelineCustomClipLike[] = [
		...((globalState.getCustomClipTrack?.clips || []) as CustomClip[])
	];

	// Surah Name: présent dans la timeline seulement s'il est visible
	// et qu'il n'est pas en always-show.
	if (
		globalState.getStyle('global', 'show-surah-name')?.value === true &&
		globalState.getStyle('global', 'surah-name-always-show')?.value !== true
	) {
		clips.push(
			new GlobalTimedOverlayTimelineClip({
				id: 'global-surah-name',
				label: 'Surah Name',
				alwaysShowStyleId: 'surah-name-always-show',
				startStyleId: 'surah-name-time-appearance',
				endStyleId: 'surah-name-time-disappearance'
			})
		);
	}

	// Reciter Name: même règle, avec garde-fou si reciter non défini.
	if (
		globalState.getStyle('global', 'show-reciter-name')?.value === true &&
		globalState.currentProject?.detail.reciter !== 'not set' &&
		globalState.getStyle('global', 'reciter-name-always-show')?.value !== true
	) {
		clips.push(
			new GlobalTimedOverlayTimelineClip({
				id: 'global-reciter-name',
				label: 'Reciter Name',
				alwaysShowStyleId: 'reciter-name-always-show',
				startStyleId: 'reciter-name-time-appearance',
				endStyleId: 'reciter-name-time-disappearance'
			})
		);
	}

	return clips;
}

/**
 * Retourne le libellé à afficher dans la barre de clip timeline.
 */
export function getTimelineCustomClipLabel(clip: TimelineCustomClipLike): string {
	if (clip instanceof GlobalTimedOverlayTimelineClip) {
		return clip.getDisplayLabel();
	}

	if (clip.type === 'Custom Text') {
		return (clip as CustomTextClip).getText();
	}

	return (clip as CustomImageClip).getFilePath().split('\\').pop() || 'No Image';
}
