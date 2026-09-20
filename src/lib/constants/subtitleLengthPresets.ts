export type SubtitleLengthPreset = 'compact' | 'balanced' | 'relaxed' | 'custom';
export type BuiltInSubtitleLengthPreset = Exclude<SubtitleLengthPreset, 'custom'>;

export type SubtitleLengthValues = {
	maxWords: number;
	maxChars: number;
};

export type SubtitleLengthPresetDefinition = SubtitleLengthValues;

export const SUBTITLE_LENGTH_PRESETS = {
	compact: {
		maxWords: 8,
		maxChars: 55
	},
	balanced: {
		maxWords: 12,
		maxChars: 80
	},
	relaxed: {
		maxWords: 16,
		maxChars: 84
	}
} as const satisfies Record<BuiltInSubtitleLengthPreset, SubtitleLengthPresetDefinition>;

export const DEFAULT_SUBTITLE_LENGTH_PRESET: BuiltInSubtitleLengthPreset = 'balanced';

/**
 * Vérifie qu'une valeur sauvegardée correspond à un profil de longueur connu.
 * @param {unknown} value Valeur lue depuis les paramètres.
 * @returns {value is SubtitleLengthPreset} Vrai pour un profil valide.
 */
export function isSubtitleLengthPreset(value: unknown): value is SubtitleLengthPreset {
	return value === 'compact' || value === 'balanced' || value === 'relaxed' || value === 'custom';
}

/**
 * Retrouve le profil correspondant exactement aux valeurs courantes.
 * @param {SubtitleLengthValues} values Valeurs de segmentation actives.
 * @returns {SubtitleLengthPreset} Profil correspondant ou custom.
 */
export function getMatchingSubtitleLengthPreset(
	values: SubtitleLengthValues
): SubtitleLengthPreset {
	for (const [preset, definition] of Object.entries(SUBTITLE_LENGTH_PRESETS) as Array<
		[BuiltInSubtitleLengthPreset, SubtitleLengthPresetDefinition]
	>) {
		if (values.maxWords === definition.maxWords && values.maxChars === definition.maxChars) {
			return preset;
		}
	}
	return 'custom';
}
