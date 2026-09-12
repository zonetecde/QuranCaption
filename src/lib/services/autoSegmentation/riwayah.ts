import type { Project } from '$lib/classes/Project';
import { globalState } from '$lib/runes/main.svelte';
import RiwayahProvider, { isNonHafsRiwayah, type Riwayah } from '$lib/services/RiwayahProvider';
import { applyStyleMutation } from '$lib/services/StyleMutationService';
import type { SegmentationRiwayah } from './types';

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

/** Applies the aligner's riwayah to Quran text rendering and its matching font. */
export async function applySegmentationRiwayahToProject(
	project: Project,
	riwayah: SegmentationRiwayah
): Promise<void> {
	const projectRiwayah = PROJECT_RIWAYAH[riwayah];
	if (isNonHafsRiwayah(projectRiwayah)) await RiwayahProvider.prefetch(projectRiwayah);

	const arabicStyles = project.content.videoStyle.getStylesOfTarget('arabic');
	const style = arabicStyles.findStyle('riwayah');
	if (!style) return;
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
