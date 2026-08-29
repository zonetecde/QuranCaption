import type { CustomClip, CustomImageClip } from '$lib/classes/Clip.svelte';
import { CustomTextClip, PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
import type { Category, StyleName } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';
import {
	getTimedOverlayRanges,
	syncTimedOverlayLegacyRange,
	updateTimedOverlayRange,
	type TimedOverlayRange
} from '$lib/services/TimedOverlayRanges';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

const CUSTOM_CLIP_SNAP_DISTANCE_PX = 8;

/**
 * Configuration minimale pour représenter un bloc global temporisé
 * comme un "clip" dans la timeline.
 */
type GlobalTimedOverlayConfig = {
	id: string;
	label: string;
	target?: string;
	alwaysShowStyleId: StyleName;
	startStyleId: StyleName;
	endStyleId: StyleName;
	rangesStyleId?: StyleName;
	rangeIndex?: number;
	source?: CustomClip;
};

/**
 * Adaptateur timeline pour les overlays globaux (Surah/Reciter).
 * Cette classe expose la même surface utile que les custom clips:
 * start/end, width, always-show, setStartTime, setEndTime...
 */
export class GlobalTimedOverlayTimelineClip {
	readonly id: string;
	readonly label: string;
	readonly type: string;
	readonly canRemove: boolean;

	private readonly target: string;
	private readonly alwaysShowStyleId: StyleName;
	private readonly startStyleId: StyleName;
	private readonly endStyleId: StyleName;
	private readonly rangesStyleId?: StyleName;
	private readonly rangeIndex: number;
	private readonly source?: CustomClip;

	constructor(config: GlobalTimedOverlayConfig) {
		const rangeSuffix = (config.rangeIndex ?? 0) > 0 ? `-${config.rangeIndex}` : '';
		this.id = config.source
			? `custom-${config.source.id}-${config.rangeIndex ?? 0}`
			: `${config.id}${rangeSuffix}`;
		this.label = config.label;
		this.type = config.source?.type ?? 'Global Timed Overlay';
		this.canRemove = Boolean(config.source);
		this.target = config.target ?? 'global';
		this.alwaysShowStyleId = config.alwaysShowStyleId;
		this.startStyleId = config.startStyleId;
		this.endStyleId = config.endStyleId;
		this.rangesStyleId = config.rangesStyleId;
		this.rangeIndex = config.rangeIndex ?? 0;
		this.source = config.source;
	}

	/**
	 * Retourne la catégorie personnalisée portée par cet adaptateur.
	 * @returns {Category | undefined} Catégorie de l'élément, si elle existe.
	 */
	get category(): Category | undefined {
		return this.source?.category;
	}

	/**
	 * Retourne l'identifiant du clip source pour les actions de suppression.
	 * @returns {number | null} Identifiant du clip source ou `null` pour un overlay global.
	 */
	getSourceClipId(): number | null {
		return this.source?.id ?? null;
	}

	/**
	 * Résout les plages de l'overlay représenté.
	 * @returns {TimedOverlayRange[]} Plages temporelles normalisées.
	 */
	private getRanges(): TimedOverlayRange[] {
		if (this.source) return this.source.getTimedOverlayRanges();

		const styles = globalState.getVideoStyle.getStylesOfTarget(this.target);
		return getTimedOverlayRanges(
			this.rangesStyleId ? styles.findStyle(this.rangesStyleId)?.value : undefined,
			styles.findStyle(this.startStyleId)?.value,
			styles.findStyle(this.endStyleId)?.value
		);
	}

	/**
	 * Enregistre les plages et maintient le premier intervalle legacy pour les anciens usages.
	 * @param {TimedOverlayRange[]} ranges Plages à enregistrer.
	 * @returns {void}
	 */
	private setRanges(ranges: TimedOverlayRange[]): void {
		ProjectHistoryManager.begin('set timed overlay range');
		try {
			const firstRange = ranges[0];
			if (this.source) {
				const rangeStyle = this.source.category?.getStyle('time-ranges');
				if (rangeStyle) rangeStyle.value = ranges;
				syncTimedOverlayLegacyRange(this.source.category?.styles ?? [], firstRange);
				if (this.rangeIndex === 0 && firstRange) {
					this.source.startTime = firstRange.startTime;
					this.source.endTime = firstRange.endTime;
					this.source.duration = firstRange.endTime - firstRange.startTime;
				}
				globalState.updateVideoPreviewUI();
				return;
			}

			const styles = globalState.getVideoStyle.getStylesOfTarget(this.target);
			const rangeStyle = this.rangesStyleId ? styles.findStyle(this.rangesStyleId) : undefined;
			if (rangeStyle) rangeStyle.value = ranges;
			const timingStyles = styles.categories.find((category) =>
				category.styles.some(
					(style) => style.id === this.startStyleId || style.id === this.rangesStyleId
				)
			)?.styles;
			syncTimedOverlayLegacyRange(timingStyles ?? [], firstRange);
			globalState.updateVideoPreviewUI();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	get startTime(): number {
		return this.getRanges()[this.rangeIndex]?.startTime ?? 0;
	}

	get endTime(): number {
		return this.getRanges()[this.rangeIndex]?.endTime ?? 0;
	}

	get duration(): number {
		return this.endTime - this.startTime;
	}

	getAlwaysShow(): boolean {
		if (this.source) return this.source.getAlwaysShow();
		return Boolean(
			globalState.getVideoStyle.getStylesOfTarget(this.target).findStyle(this.alwaysShowStyleId)
				?.value
		);
	}

	setStartTime(newStartTime: number) {
		this.setRanges(
			updateTimedOverlayRange(this.getRanges(), this.rangeIndex, 'startTime', newStartTime)
		);
	}

	setEndTime(newEndTime: number) {
		this.setRanges(
			updateTimedOverlayRange(this.getRanges(), this.rangeIndex, 'endTime', newEndTime)
		);
	}

	setStyle(styleId: StyleName, value: string | number | boolean) {
		if (styleId === 'always-show') {
			ProjectHistoryManager.track('set timed overlay visibility', () => {
				if (this.source) {
					this.source.setStyle(styleId, value);
					return;
				}
				const style = globalState.getVideoStyle
					.getStylesOfTarget(this.target)
					.findStyle(this.alwaysShowStyleId);
				if (style) style.value = value as boolean;
				globalState.updateVideoPreviewUI();
			});
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
		if (this.source) return getTimelineCustomClipLabel(this.source);
		return this.label;
	}
}

export type TimelineCustomClipLike = CustomClip | GlobalTimedOverlayTimelineClip;

const GLOBAL_SURAH_NAME_TIMELINE_CONFIG: GlobalTimedOverlayConfig = {
	id: 'global-surah-name',
	label: 'Surah Name',
	alwaysShowStyleId: 'surah-name-always-show',
	startStyleId: 'surah-name-time-appearance',
	endStyleId: 'surah-name-time-disappearance',
	rangesStyleId: 'surah-name-time-ranges'
};

const GLOBAL_RECITER_NAME_TIMELINE_CONFIG: GlobalTimedOverlayConfig = {
	id: 'global-reciter-name',
	label: 'Reciter Name',
	alwaysShowStyleId: 'reciter-name-always-show',
	startStyleId: 'reciter-name-time-appearance',
	endStyleId: 'reciter-name-time-disappearance',
	rangesStyleId: 'reciter-name-time-ranges'
};

const GLOBAL_AYAH_CONTAINER_TIMELINE_CONFIG: GlobalTimedOverlayConfig = {
	id: 'global-ayah-container',
	label: 'Ayah Container',
	alwaysShowStyleId: 'always-show',
	startStyleId: 'time-appearance',
	endStyleId: 'time-disappearance',
	rangesStyleId: 'ayah-container-time-ranges'
};

/**
 * Crée les adaptateurs timeline correspondant à toutes les plages d'un overlay.
 * @param {GlobalTimedOverlayConfig} config Configuration de l'overlay.
 * @returns {GlobalTimedOverlayTimelineClip[]} Adaptateurs ordonnés.
 */
function createTimedOverlayTimelineClips(
	config: GlobalTimedOverlayConfig
): GlobalTimedOverlayTimelineClip[] {
	const styles = globalState.getVideoStyle.getStylesOfTarget(config.target ?? 'global');
	const ranges = config.source
		? config.source.getTimedOverlayRanges()
		: getTimedOverlayRanges(
				config.rangesStyleId ? styles.findStyle(config.rangesStyleId)?.value : undefined,
				styles.findStyle(config.startStyleId)?.value,
				styles.findStyle(config.endStyleId)?.value
			);

	return ranges.map(
		(_range, rangeIndex) => new GlobalTimedOverlayTimelineClip({ ...config, rangeIndex })
	);
}

/**
 * Crée les adaptateurs timeline des apparitions multiples d'un clip personnalisé.
 * @param {CustomClip} clip Clip personnalisé source.
 * @returns {TimelineCustomClipLike[]} Clips à afficher dans la timeline.
 */
function createCustomTimelineClips(clip: CustomClip): TimelineCustomClipLike[] {
	const ranges = clip.getTimedOverlayRanges();
	if (clip.getAlwaysShow() || ranges.length <= 1) return [clip];

	return ranges.map(
		(_range, rangeIndex) =>
			new GlobalTimedOverlayTimelineClip({
				id: `custom-${clip.id}`,
				label: '',
				target: 'global',
				alwaysShowStyleId: 'always-show',
				startStyleId: 'time-appearance',
				endStyleId: 'time-disappearance',
				rangesStyleId: 'time-ranges',
				rangeIndex,
				source: clip
			})
	);
}

/**
 * Retourne la liste de clips à afficher dans la lane "custom clips":
 * - clips custom reels
 * - overlays globaux temporisés (seulement si always-show=false)
 */
export function getTimelineCustomClips(): TimelineCustomClipLike[] {
	// Base: les clips custom reels existants (text/image).
	const clips: TimelineCustomClipLike[] = (
		(globalState.getCustomClipTrack?.clips || []) as CustomClip[]
	).flatMap(createCustomTimelineClips);

	// Surah Name: présent dans la timeline seulement s'il est visible
	// et qu'il n'est pas en always-show.
	if (
		globalState.getStyle('global', 'show-surah-name')?.value === true &&
		globalState.getStyle('global', 'surah-name-always-show')?.value !== true
	) {
		clips.push(...createTimedOverlayTimelineClips(GLOBAL_SURAH_NAME_TIMELINE_CONFIG));
	}

	// Reciter Name: même règle, avec garde-fou si reciter non défini.
	if (
		globalState.getStyle('global', 'show-reciter-name')?.value === true &&
		globalState.currentProject?.detail.reciter !== 'not set' &&
		globalState.getStyle('global', 'reciter-name-always-show')?.value !== true
	) {
		clips.push(...createTimedOverlayTimelineClips(GLOBAL_RECITER_NAME_TIMELINE_CONFIG));
	}

	if (
		Boolean(globalState.getStyle('global', 'ayah-container-image')?.value) &&
		globalState.getStyle('global', 'always-show')?.value !== true
	) {
		clips.push(...createTimedOverlayTimelineClips(GLOBAL_AYAH_CONTAINER_TIMELINE_CONFIG));
	}

	for (const stylesData of globalState.getVideoStyle.styles) {
		if (stylesData.target === 'global') continue;
		if (stylesData.findStyle('background-enable')?.value !== true) continue;
		if (stylesData.findStyle('always-show')?.value === true) continue;

		clips.push(
			...createTimedOverlayTimelineClips({
				id: `${stylesData.target}-background-container`,
				label:
					stylesData.target === 'arabic' ? 'Arabic Background' : `${stylesData.target} Background`,
				target: stylesData.target,
				alwaysShowStyleId: 'always-show',
				startStyleId: 'time-appearance',
				endStyleId: 'time-disappearance',
				rangesStyleId: 'time-ranges'
			})
		);
	}

	return clips;
}

function getCustomClipSnapThresholdMs(): number {
	const zoom = Math.max(globalState.currentProject?.projectEditorState.timeline.zoom ?? 0, 0.0001);
	// Convertit une tolérance visuelle fixe (en px) en durée selon le zoom courant.
	return (CUSTOM_CLIP_SNAP_DISTANCE_PX / zoom) * 1000;
}

/**
 * Construit la liste des temps d'accroche disponibles pour un custom clip.
 * On snap sur:
 * - le début et la fin des autres custom clips
 * - le début des sous-titres
 */
function getTimelineCustomClipSnapPoints(currentClipId: string): number[] {
	const points: number[] = [];

	for (const clip of getTimelineCustomClips()) {
		if (String(clip.id) === currentClipId || clip.getAlwaysShow()) continue;

		// On prend les deux bords des autres clips pour pouvoir aligner début ou fin.
		points.push(clip.startTime, clip.endTime);
	}

	for (const clip of globalState.getSubtitleTrack?.clips ?? []) {
		if (clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) {
			// Le besoin métier ici est d'aligner les custom clips sur le début des sous-titres.
			points.push(clip.startTime);
		}
	}

	return points;
}

/**
 * Retourne le temps le plus proche si un point d'accroche est suffisamment proche,
 * sinon retourne le temps d'origine sans modification.
 */
export function getSnappedTimelineCustomClipTime(time: number, currentClipId: string): number {
	const thresholdMs = getCustomClipSnapThresholdMs();
	let snappedTime = time;
	let closestDistance = thresholdMs + 1;

	for (const snapPoint of getTimelineCustomClipSnapPoints(currentClipId)) {
		const distance = Math.abs(snapPoint - time);
		// On garde uniquement le point le plus proche à l'intérieur de la zone de snap.
		if (distance <= thresholdMs && distance < closestDistance) {
			snappedTime = snapPoint;
			closestDistance = distance;
		}
	}

	return snappedTime;
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

	if (clip.type === 'Custom Image') {
		return (clip as CustomImageClip).getFilePath().split('\\').pop() || 'No Image';
	}

	return 'No Image';
}
