import type { SubtitleApplicationMode } from '$lib/services/AutoSegmentation';

export type { SubtitleApplicationMode };

/** Represents one segmentation timing preset. */
export type SegmentationPreset = {
	id: string;
	label: string;
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
};

export type DimensionValue = {
	width: number;
	height: number;
};

export type FadeValue = {
	fadeDurationMs: number;
	videoFadeInEnabled: boolean;
	videoFadeOutEnabled: boolean;
	audioFadeInEnabled: boolean;
	audioFadeOutEnabled: boolean;
};

export type ExportFadeSettings = FadeValue;
