import type { SubtitleApplicationMode } from '$lib/services/AutoSegmentation';

export type { SubtitleApplicationMode };

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
