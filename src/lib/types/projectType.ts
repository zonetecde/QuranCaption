export const PROJECT_TYPE_OPTIONS = [
	'Lecture / Course',
	'Khutbah',
	'Reminder',
	'Conference / Podcast',
	'Poem / Nasheed',
	'Other'
] as const;

export type ProjectType = string;

export const DEFAULT_PROJECT_TYPE: ProjectType = 'Lecture / Course';

/**
 * Normalise un type de projet vers les catégories prises en charge par Minbar Studio.
 * @param {unknown} value - Le type de projet à normaliser.
 * @returns {ProjectType} Le type de projet normalisé.
 */
export function normalizeProjectType(value: unknown): ProjectType {
	if (typeof value !== 'string') return DEFAULT_PROJECT_TYPE;
	const normalized = value.trim();
	return normalized || DEFAULT_PROJECT_TYPE;
}
