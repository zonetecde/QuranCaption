export type SubtitleLengthPreset = 'compact' | 'balanced' | 'relaxed' | 'custom';
export type BuiltInSubtitleLengthPreset = Exclude<SubtitleLengthPreset, 'custom'>;

export type SubtitleLengthValues = {
	maxWords: number;
	maxChars: number;
	silenceSeconds: number;
};

export type SubtitleLengthPresetDefinition = SubtitleLengthValues & {
	label: string;
	description: string;
};

export const SUBTITLE_LENGTH_PRESETS = {
	compact: {
		label: 'Compact',
		description: 'Short subtitles with more frequent changes.',
		maxWords: 8,
		maxChars: 55,
		silenceSeconds: 0.8
	},
	balanced: {
		label: 'Balanced',
		description: 'Natural, readable subtitles for most lectures.',
		maxWords: 12,
		maxChars: 80,
		silenceSeconds: 1.2
	},
	relaxed: {
		label: 'Relaxed',
		description: 'Longer subtitles with fewer visual changes.',
		maxWords: 16,
		maxChars: 110,
		silenceSeconds: 1.6
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
		if (
			values.maxWords === definition.maxWords &&
			values.maxChars === definition.maxChars &&
			Math.abs(values.silenceSeconds - definition.silenceSeconds) < 0.001
		) {
			return preset;
		}
	}
	return 'custom';
}
