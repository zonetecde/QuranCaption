export interface ShortcutActionDefinition {
	keys: string[];
	name: string;
	description: string;
}

export interface ShortcutCategoryMetadata {
	name: string;
	icon: string;
	description: string;
}

export type ShortcutCategoryMap = Record<string, ShortcutCategoryMetadata>;
export type ShortcutActionsMap = Record<string, Record<string, ShortcutActionDefinition>>;
