import type { LegacyWhisperModelSize, MultiAlignerModel } from '$lib/services/AutoSegmentation';
import type { AiVersion, ModelOption, SegmentationPreset, WizardStep } from './types';

/** Ordered steps for the landscape wizard navigation rail. */
export const WIZARD_STEPS_V2: WizardStep[] = [
	{ key: 'version', title: 'AI Version', subtitle: 'Pick V1 or V2', icon: 'auto_awesome' },
	{ key: 'runtime', title: 'Runtime', subtitle: 'Cloud or local', icon: 'storage' },
	{ key: 'models', title: 'Models', subtitle: 'Engine and device', icon: 'memory' },
	{ key: 'settings', title: 'Segmentation', subtitle: 'Presets and timing', icon: 'tune' },
	{ key: 'review', title: 'Run', subtitle: 'Review and launch', icon: 'play_arrow' }
];

/** Legacy V1 flow omits runtime because V1 is always local. */
export const WIZARD_STEPS_V1: WizardStep[] = [
	{ key: 'version', title: 'AI Version', subtitle: 'Pick V1 or V2', icon: 'auto_awesome' },
	{ key: 'models', title: 'Models', subtitle: 'Legacy model selection', icon: 'memory' },
	{ key: 'settings', title: 'Segmentation', subtitle: 'Presets and timing', icon: 'tune' },
	{ key: 'review', title: 'Run', subtitle: 'Review and launch', icon: 'play_arrow' }
];

/** Returns the active step sequence for the selected AI version. */
export function getWizardSteps(aiVersion: AiVersion): WizardStep[] {
	return aiVersion === 'legacy_v1' ? WIZARD_STEPS_V1 : WIZARD_STEPS_V2;
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
	{ value: 'Base', label: 'Base', description: 'Balanced speed and alignment quality.' },
	{ value: 'Large', label: 'Large', description: 'More robust to noisy/non-studio recitations' }
];
