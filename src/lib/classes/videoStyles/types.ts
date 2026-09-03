import type { TimedOverlayRange } from '$lib/services/TimedOverlayRanges';
import type { Style } from './Style.svelte.js';
import type { StyleCategoryName, StyleName } from './styleNames.js';

export type * from './styleNames.js';

export type StyleValueType =
	| 'color'
	| 'number'
	| 'select'
	| 'brackets-font'
	| 'boolean'
	| 'text'
	| 'time'
	| 'dimension'
	| 'fade'
	| 'composite'
	| 'reciter'
	| 'file'
	| 'ayah-image'
	| 'time-ranges';

export type StyleOverrideValue = string | number | boolean | TimedOverlayRange[];

export type StyleKeyframe = {
	time: number;
	value: Style['value'];
};

export type StyleEditorPanelMetadata = {
	id: string;
	icon: string;
	label: string;
	order: number;
	categoryOrder: number;
	categoryNavigation?: boolean;
};

export type StyleEditorGroupMetadata = {
	id: string;
	styleIds: string[];
	shared?: boolean;
};

export type StyleCategoryUiMetadata = {
	panel: StyleEditorPanelMetadata;
	groups?: StyleEditorGroupMetadata[];
	headerStyle?: string;
};

export type ClipStyleOverrides = {
	[clipId: number]: {
		[target: string]: {
			[categoryId in StyleCategoryName]?: {
				[styleId in StyleName]?: StyleOverrideValue;
			};
		};
	};
};

export interface VideoStyleFileData {
	videoStyle: Record<string, unknown>;
	customClips: Array<Record<string, unknown>>;
	customTextClips?: Array<Record<string, unknown>>;
}
