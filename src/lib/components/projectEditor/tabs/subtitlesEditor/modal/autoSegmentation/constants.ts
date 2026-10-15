import type { LegacyWhisperModelSize, MultiAlignerModel } from '$lib/services/AutoSegmentation';
import type {
	AiVersion,
	ModelOption,
	SegmentationPreset,
	WizardRuntime,
	WizardStep
} from './types';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

/** Ordered steps for the landscape wizard navigation rail. */
export const WIZARD_STEPS_V2: WizardStep[] = [
	{ key: 'version', title: 'Method', subtitle: 'Choose your workflow', icon: 'auto_awesome' },
	{ key: 'setup', title: 'Setup', subtitle: 'Install and prepare', icon: 'storage' },
	{ key: 'models', title: 'Model', subtitle: 'Quality and performance', icon: 'memory' },
	{ key: 'settings', title: 'Settings', subtitle: 'Timing and behavior', icon: 'tune' },
	{ key: 'review', title: 'Review', subtitle: 'Check and launch', icon: 'play_arrow' }
];

/** Ordered steps for the cloud multi-aligner path. */
export const WIZARD_STEPS_CLOUD_V2: WizardStep[] = [
	{ key: 'version', title: 'Method', subtitle: 'Choose your workflow', icon: 'auto_awesome' },
	{ key: 'models', title: 'Alignment', subtitle: 'Recognition and boundaries', icon: 'memory' }
];

/** Public site of the Quranic Universal Aligner. */
export const ALIGNER_SITE_URL = 'https://aligner.qud.dev/';

/** Hugging Face Space of the Quranic Universal Aligner (QUD Technologies organization). */
export const ALIGNER_SPACE_URL =
	'https://huggingface.co/spaces/QUD-Technologies/quranic-universal-aligner';

/** Discussions board of the aligner Space, used for user feedback. */
export const ALIGNER_DISCUSSIONS_URL = `${ALIGNER_SPACE_URL}/discussions`;

/** Ordered steps for the offline word-timing path. */
export const WIZARD_STEPS_quran_word_timing: WizardStep[] = [
	{ key: 'version', title: 'Method', subtitle: 'Choose your workflow', icon: 'auto_awesome' },
	WIZARD_STEPS_V2[1],
	{ key: 'review', title: 'Review', subtitle: 'Check and launch', icon: 'play_arrow' }
];

/**
 * Returns the active step sequence for the selected AI version.
 *
 * @param {AiVersion} aiVersion Selected AI engine version.
 * @param {WizardRuntime} _runtime Active runtime mode.
 * @param {boolean} [showExistingSubtitlesStep=false] Whether existing subtitles step should be included.
 * @param {boolean} [isSetupReady=false] Whether local engine dependencies and models are already installed.
 * @returns {WizardStep[]} Ordered list of wizard steps.
 */
export function getWizardSteps(
	aiVersion: AiVersion,
	_runtime: WizardRuntime,
	showExistingSubtitlesStep: boolean = false,
	isSetupReady: boolean = false
): WizardStep[] {
	let baseSteps =
		aiVersion === 'quran_word_timing'
			? WIZARD_STEPS_quran_word_timing
			: aiVersion === 'multi_v2'
				? WIZARD_STEPS_CLOUD_V2
				: WIZARD_STEPS_V2;

	if (isSetupReady && aiVersion === 'quran_word_timing') {
		baseSteps = baseSteps.filter(({ key }) => key !== 'setup');
	}

	if (!showExistingSubtitlesStep) return baseSteps;

	// The cloud flow has no review step, so the question becomes its last step.
	const reviewIndex = baseSteps.findIndex(({ key }) => key === 'review');
	const insertIndex = reviewIndex === -1 ? baseSteps.length : reviewIndex;
	return [
		...baseSteps.slice(0, insertIndex),
		{
			key: 'existing-subtitles',
			title: get(LL).editor.existingSubtitlesStep(),
			subtitle: get(LL).editor.existingSubtitlesStepDescription(),
			icon: 'subtitles'
		},
		...baseSteps.slice(insertIndex)
	];
}

/** Timing presets shown in the segmentation settings step. */
export const SEGMENTATION_PRESETS: SegmentationPreset[] = [
	{ id: 'mujawwad', label: 'Mujawwad (Slow)', minSilenceMs: 600, minSpeechMs: 1500, padMs: 300 },
	{ id: 'murattal', label: 'Murattal (Normal)', minSilenceMs: 200, minSpeechMs: 1000, padMs: 100 },
	{ id: 'hadr', label: 'Hadr (Fast)', minSilenceMs: 75, minSpeechMs: 750, padMs: 40 }
];

/** Legacy whisper models available in local V1 mode. */
export const LEGACY_MODEL_OPTIONS: Array<ModelOption<LegacyWhisperModelSize>> = [
	{
		value: 'tiny',
		label: 'Tiny',
		description: 'Fastest, lower precision (~60 MB).',
		source: 'tarteel-ai/whisper-tiny-ar-quran'
	},
	{
		value: 'base',
		label: 'Base',
		description: 'Best balance for most recitations (~150 MB).',
		source: 'tarteel-ai/whisper-base-ar-quran'
	},
	{
		value: 'medium',
		label: 'Medium',
		description: 'Higher precision, slower startup (~800 MB).',
		source: 'openai/whisper-medium'
	},
	{
		value: 'large',
		label: 'Large',
		description: 'Highest precision, heavy model (~3 GB).',
		source: 'IJyad/whisper-large-v3-Tarteel'
	}
];

/** Multi-aligner models used by both cloud and local V2 paths. */
export const MULTI_MODEL_OPTIONS: Array<ModelOption<MultiAlignerModel>> = [
	{
		value: 'Base',
		label: 'Base',
		description: 'Balanced speed and alignment quality.',
		source: 'hetchyy/r15_95m'
	},
	{
		value: 'Large',
		label: 'Large',
		description: 'More robust to noisy/non-studio recitations',
		source: 'hetchyy/r7'
	}
];
