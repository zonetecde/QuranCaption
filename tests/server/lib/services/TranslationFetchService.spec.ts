import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectMocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('$lib/services/ProjectService', () => ({ ProjectService: projectMocks }));
vi.mock('$lib/services/AdvancedAITrimming', () => ({
	markInvalidAdvancedTrimTranslations: vi.fn()
}));

import { Edition, SubtitleClip } from '$lib/classes';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import {
	fetchTranslationsFromOtherProjects,
	getProjectTranslationReviewCounts
} from '$lib/services/TranslationFetchService';
import type { Project, ProjectDetail } from '$lib/classes';

const edition = new Edition('key', 'edition', 'Author', 'English', 'ltr', '', '', '', '');

/**
 * Construit un clip Quran avec sa traduction de test.
 * @param {string} text Texte traduit.
 * @param {ConstructorParameters<typeof VerseTranslation>[1]} status Statut de traduction.
 * @returns {SubtitleClip} Clip couvrant la même plage Quran.
 */
function createClip(
	text: string,
	status: ConstructorParameters<typeof VerseTranslation>[1]
): SubtitleClip {
	const clip = new SubtitleClip(0, 1000, 1, 1, 0, 1, 'Arabic', [], false, true);
	clip.translations[edition.name] = new VerseTranslation(text, status);
	return clip;
}

/**
 * Construit un projet minimal compatible avec le service project-scoped.
 * @param {number} id Identifiant du projet.
 * @param {SubtitleClip[]} clips Clips de sous-titres.
 * @returns {Project} Projet de test.
 */
function createProject(id: number, clips: SubtitleClip[]): Project {
	return {
		detail: { id, translations: {} },
		content: {
			timeline: { getFirstTrack: () => ({ clips }) },
			projectTranslation: {
				getVerseTranslation: () => 'High priority full verse text',
				updateProjectPercentage: vi.fn()
			}
		}
	} as unknown as Project;
}

/**
 * Construit les détails légers utilisés pour sélectionner les sources.
 * @param {number} id Identifiant du projet.
 * @param {string} createdAt Date ISO de création.
 * @returns {ProjectDetail} Détails éligibles au Fetch.
 */
function createDetail(id: number, createdAt: string): ProjectDetail {
	return {
		id,
		createdAt: new Date(createdAt),
		translations: { [edition.author]: 100 }
	} as ProjectDetail;
}

describe('TranslationFetchService', () => {
	beforeEach(() => projectMocks.load.mockReset());

	it('uses status priority before recency and copies all fetch metadata', async () => {
		const targetClip = createClip('Pending', 'to review');
		const recentLow = createClip('Recent low', 'fetched');
		const olderHigh = createClip('High priority', 'reviewed');
		const target = createProject(1, [targetClip]);
		const targetTranslation = targetClip.translations[edition.name] as VerseTranslation;
		const recalculate = vi
			.spyOn(targetTranslation, 'tryRecalculateTranslationIndexes')
			.mockImplementation(() => undefined);
		projectMocks.load.mockImplementation(async (id: number) =>
			id === 2 ? createProject(2, [recentLow]) : createProject(3, [olderHigh])
		);
		const source = olderHigh.translations[edition.name] as VerseTranslation;
		source.startWordIndex = 0;
		source.endWordIndex = 1;
		source.isBruteForce = true;
		source.inlineStyleRuns = [
			{ startWordIndex: 0, endWordIndex: 0, bold: true, italic: false, underline: false }
		];

		const result = await fetchTranslationsFromOtherProjects({
			targetProject: target,
			edition,
			sourceProjectDetails: [createDetail(2, '2026-01-02'), createDetail(3, '2026-01-01')]
		});

		const fetched = targetClip.translations[edition.name] as VerseTranslation;
		expect(fetched.text).toBe('High priority');
		expect(fetched.status).toBe('fetched');
		expect(fetched.isBruteForce).toBe(true);
		expect(fetched.inlineStyleRuns).toEqual(source.inlineStyleRuns);
		expect(recalculate).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ fetched: 1, review: { complete: 1, pending: 0 } });
	});

	it('does not overwrite complete translations and classifies with isStatusComplete', async () => {
		const complete = createClip('Keep me', 'automatically trimmed');
		const pending = createClip('Pending', 'error');
		const project = createProject(1, [complete, pending]);

		const result = await fetchTranslationsFromOtherProjects({
			targetProject: project,
			edition,
			sourceProjectDetails: []
		});

		expect((complete.translations[edition.name] as VerseTranslation).text).toBe('Keep me');
		expect(result.fetched).toBe(0);
		expect(getProjectTranslationReviewCounts(project, edition.name)).toMatchObject({
			total: 2,
			complete: 1,
			pending: 1,
			errors: 1
		});
	});
});
