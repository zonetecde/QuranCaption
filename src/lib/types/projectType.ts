export const PROJECT_TYPE_OPTIONS = [
	'Taraweeh',
	'Prayer',
	'Studio',
	'Old recordings',
	'Rare recitation',
	'Others'
] as const;

export type ProjectType = (typeof PROJECT_TYPE_OPTIONS)[number];

export const DEFAULT_PROJECT_TYPE: ProjectType = 'Others';

const LEGACY_PROJECT_TYPE_ALIASES: Record<string, ProjectType> = {
	taraweeh: 'Taraweeh',
	prayer: 'Prayer',
	salat: 'Prayer',
	studio: 'Studio',
	other: 'Others',
	others: 'Others',
	'old recordings': 'Old recordings',
	'old recording': 'Old recordings',
	'rare recitation': 'Rare recitation',
	'rare recitations': 'Rare recitation'
};

export function normalizeProjectType(value: unknown): ProjectType {
	if (typeof value !== 'string') {
		return DEFAULT_PROJECT_TYPE;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) {
		return DEFAULT_PROJECT_TYPE;
	}

	return LEGACY_PROJECT_TYPE_ALIASES[normalized] ?? DEFAULT_PROJECT_TYPE;
}
