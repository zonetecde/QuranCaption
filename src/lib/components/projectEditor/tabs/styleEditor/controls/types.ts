import type { Style } from '$lib/classes/VideoStyle.svelte';

export type StyleControlValue = Style['value'];
export type ApplyStyleControlValue = (value: StyleControlValue) => void;

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
