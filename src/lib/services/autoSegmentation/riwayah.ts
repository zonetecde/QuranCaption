import type { Project } from '$lib/classes/Project';
import { globalState } from '$lib/runes/main.svelte';
import RiwayahProvider, { isNonHafsRiwayah, type Riwayah } from '$lib/services/RiwayahProvider';
import { applyStyleMutation } from '$lib/services/StyleMutationService';
import type { SegmentationResponse, SegmentationRiwayah, SegmentationWordTimestamp } from './types';
import { compareVerseRefs, parseVerseRef } from './verse-ref';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

const PROJECT_RIWAYAH: Record<SegmentationRiwayah, Riwayah> = {
	hafs: 'Hafs',
	warsh: 'Warsh',
	qalun: 'Qaloon',
	shuba: 'Shouba'
};

/** Normalizes QUA catalogue and API spellings to the aligner's supported values. */
export function normalizeSegmentationRiwayah(value: unknown): SegmentationRiwayah | null {
	if (typeof value !== 'string') return null;
	const normalized = value
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z]/g, '');
	if (normalized.includes('warsh')) return 'warsh';
	if (normalized.includes('qalon') || normalized.includes('qalun')) return 'qalun';
	if (
		normalized.includes('shobah') ||
		normalized.includes('shubah') ||
		normalized.includes('shuba') ||
		normalized.includes('shouba')
	)
		return 'shuba';
	if (normalized.includes('hafs')) return 'hafs';
	return null;
}

/**
 * Converts native aligner references to internal Hafs coordinates without shifting audio timings.
 * @param {SegmentationResponse} response Native segmentation and word timings.
 * @param {SegmentationRiwayah | null | undefined} riwayah Reading used by the aligner.
 * @returns {Promise<SegmentationResponse>} Segmentation indexed by internal Hafs references.
 */
export async function normalizeRiwayahSegmentationResponse(
	response: SegmentationResponse,
	riwayah?: SegmentationRiwayah | null
): Promise<SegmentationResponse> {
	const reading = riwayah ? PROJECT_RIWAYAH[riwayah] : 'Hafs';
	if (!isNonHafsRiwayah(reading) || !response.segments?.length) return response;
	await RiwayahProvider.prefetch(reading);

	/**
	 * Resolves a native word while preserving non-Quran subtitle references.
	 * @param {string | undefined} reference Native word reference or special subtitle type.
	 * @returns {{ locations: string[]; text?: string }} Internal word references and reading text.
	 */
	const resolveWord = (reference?: string): { locations: string[]; text?: string } => {
		const ref = parseVerseRef(reference);
		if (!ref) return { locations: reference ? [reference] : [] };
		const mapping = RiwayahProvider.getHafsWordMapping(reading, ref.surah, ref.verse, ref.word);
		if (!mapping)
			throw new Error(`${get(LL).editor.segmentationFailed()} (${riwayah}: ${reference})`);
		return mapping;
	};

	return {
		...response,
		segments: response.segments.map((segment) => {
			if (segment.error) return segment;
			const start = resolveWord(segment.ref_from);
			const end = resolveWord(segment.ref_to);
			const words: SegmentationWordTimestamp[] = [];
			let previousRef: ReturnType<typeof parseVerseRef> = null;
			for (const word of segment.words ?? []) {
				const ref = parseVerseRef(word.location);
				const mapping = resolveWord(word.location);
				for (const location of mapping.locations) {
					const previous = words.at(-1);
					// A split reading word shares one Hafs position; actual repetitions stay separate.
					if (
						previous?.location === location &&
						ref &&
						previousRef &&
						compareVerseRefs(previousRef, ref) < 0
					) {
						previous.start = Math.min(previous.start, word.start);
						previous.end = Math.max(previous.end, word.end);
						previous.word = `${previous.word ?? ''} ${mapping.text ?? word.word ?? ''}`.trim();
					} else {
						words.push({ ...word, location, word: mapping.text ?? word.word });
					}
				}
				previousRef = ref;
			}
			return {
				...segment,
				ref_from: start.locations[0],
				ref_to: end.locations.at(-1),
				...(segment.words ? { words } : {})
			};
		})
	};
}

/** Applies the aligner's riwayah to Quran text rendering and its matching font. */
export async function applySegmentationRiwayahToProject(
	project: Project,
	riwayah: SegmentationRiwayah
): Promise<void> {
	const projectRiwayah = PROJECT_RIWAYAH[riwayah];
	if (isNonHafsRiwayah(projectRiwayah)) await RiwayahProvider.prefetch(projectRiwayah);

	const arabicStyles = project.content.videoStyle.getStylesOfTarget('arabic');
	const style = arabicStyles.findStyle('riwayah');
	if (!style || style.value === projectRiwayah) return;
	const result = applyStyleMutation({
		videoStyle: project.content.videoStyle,
		style,
		target: 'arabic',
		clipIds: [],
		value: projectRiwayah,
		applyBaseValue: (value) => {
			style.value = value;
		}
	});
	if (result.refreshPreview && globalState.currentProject?.detail.id === project.detail.id) {
		globalState.updateVideoPreviewUI();
	}
}
