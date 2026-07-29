export const PROJECT_EDITOR_PANEL_WIDTHS = {
	video: { default: 360, min: 240, max: 720, expandedMin: 500 },
	style: { default: 438, min: 280, max: 720, expandedMin: 600 },
	subtitlesLeft: { default: 300, min: 180, max: 520 },
	subtitlesRight: { default: 300, min: 180, max: 520 },
	translationsLeft: { default: 310, min: 200, max: 560 },
	translationsRight: { default: 330, min: 260, max: 600 },
	export: { default: 450, min: 280, max: 640 }
} as const;

export const PROJECT_EDITOR_TIMELINE_HEIGHT = { default: 68, min: 10, max: 90 } as const;

export const DEFAULT_STYLE_PANEL_WIDTH = PROJECT_EDITOR_PANEL_WIDTHS.style.default;

export const DEFAULT_PROJECT_EDITOR_LAYOUT = {
	upperSectionHeight: PROJECT_EDITOR_TIMELINE_HEIGHT.default,
	videoEditorPanelWidth: PROJECT_EDITOR_PANEL_WIDTHS.video.default,
	stylePanelWidth: DEFAULT_STYLE_PANEL_WIDTH,
	subtitlesEditorLeftPanelWidth: PROJECT_EDITOR_PANEL_WIDTHS.subtitlesLeft.default,
	subtitlesEditorRightPanelWidth: PROJECT_EDITOR_PANEL_WIDTHS.subtitlesRight.default,
	translationsEditorLeftPanelWidth: PROJECT_EDITOR_PANEL_WIDTHS.translationsLeft.default,
	translationsEditorRightPanelWidth: PROJECT_EDITOR_PANEL_WIDTHS.translationsRight.default,
	exportPanelWidth: PROJECT_EDITOR_PANEL_WIDTHS.export.default
} as const;

export type ProjectEditorLayout = {
	-readonly [Key in keyof typeof DEFAULT_PROJECT_EDITOR_LAYOUT]: number;
};
