import type { Style } from '$lib/classes/VideoStyle.svelte';

export type StylePanel = {
	id: string;
	icon: string;
	label: string;
	categoryIds: string[];
	order?: number;
	customContent?: boolean;
};

export type StyleGroupCopyKey =
	| 'groupBasics'
	| 'groupTypography'
	| 'groupColors'
	| 'groupSpacing'
	| 'groupLayout'
	| 'groupTiming'
	| 'groupEffects'
	| 'groupAdvanced'
	| 'groupVerseNumber'
	| 'groupDecorations'
	| 'groupTransitions';

export type StyleControlGroup = {
	label?: StyleGroupCopyKey;
	styles: Style[];
};

export type StyleUiCopyKey =
	| 'onScreenElements'
	| 'customElements'
	| 'noCustomElements'
	| 'noMatchingStyles'
	| 'fontControlledByMushaf'
	| StyleGroupCopyKey;
