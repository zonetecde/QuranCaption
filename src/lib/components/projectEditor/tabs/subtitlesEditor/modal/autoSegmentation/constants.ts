import type { LegacyWhisperModelSize, MultiAlignerModel } from '$lib/services/AutoSegmentation';
import type { AiVersion, ModelOption, SegmentationPreset, WizardRuntime, WizardStep } from './types';

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
	{ key: 'models', title: 'Model', subtitle: 'Quality and performance', icon: 'memory' },
	{ key: 'settings', title: 'Settings', subtitle: 'Timing and behavior', icon: 'tune' },
	{ key: 'review', title: 'Review', subtitle: 'Check and launch', icon: 'play_arrow' }
];

/** Returns the active step sequence for the selected AI version. */
export function getWizardSteps(aiVersion: AiVersion, _runtime: WizardRuntime): WizardStep[] {
	return aiVersion === 'multi_v2' ? WIZARD_STEPS_CLOUD_V2 : WIZARD_STEPS_V2;
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

/** Recommended Quran-focused open models used by the 100% local alternative. */
export const OPEN_MULTI_RECOMMENDED_MODEL_OPTIONS: Array<ModelOption<MultiAlignerModel>> = [
	{
		value: 'Open-Tadabur-Small',
		label: 'Tadabur Small',
		description: 'Most balanced open local option for Quran recitation in our ranking.',
		source: 'FaisaI/tadabur-Whisper-Small'
	},
	{
		value: 'Open-Naazim-Large-V3-Turbo',
		label: 'Naazim Large V3 Turbo',
		description: 'Strong large model, heavier and usually slower than small/medium options.',
		source: 'naazimsnh02/whisper-large-v3-turbo-ar-quran'
	},
	{
		value: 'Open-DeepDML-Medium-Mix',
		label: 'DeepDML Medium Mix',
		description: 'Good quality but can be slower and less consistent depending on reciter.',
		source: 'deepdml/whisper-medium-ar-quran-mix-norm'
	}
];

/** Other Quran-focused open models kept in the local open workflow. */
export const OPEN_MULTI_QURAN_MODEL_OPTIONS: Array<ModelOption<MultiAlignerModel>> = [
	{
		value: 'Open-DeepDML-Small-Mix',
		label: 'DeepDML Small Mix',
		description: 'Fast fallback, but usually less accurate than the options above.',
		source: 'deepdml/whisper-small-ar-quran-mix'
	},
	{
		value: 'Open-IJyad-Large-V3',
		label: 'IJyad Large V3',
		description: 'Large open model, robust but not always the best fit for every recitation.',
		source: 'IJyad/whisper-large-v3-Tarteel'
	},
	{
		value: 'Open-Legacy-Tiny',
		label: 'Tiny',
		description: 'Fastest, lower precision (~60 MB).',
		source: 'tarteel-ai/whisper-tiny-ar-quran'
	},
	{
		value: 'Open-Legacy-Base',
		label: 'Base',
		description: 'Best balance for most recitations (~150 MB).',
		source: 'tarteel-ai/whisper-base-ar-quran'
	}
];

/** General-purpose open models exposed in the local open workflow. */
export const OPEN_MULTI_GENERAL_MODEL_OPTIONS: Array<ModelOption<MultiAlignerModel>> = [
	{
		value: 'Open-Legacy-Medium',
		label: 'Medium',
		description: 'Higher precision, slower startup (~800 MB).',
		source: 'openai/whisper-medium'
	}
];
