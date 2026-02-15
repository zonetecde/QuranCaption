import type { LegacyWhisperModelSize, MultiAlignerModel } from '$lib/services/AutoSegmentation';
import type { ModelOption, SegmentationPreset, WizardStep } from './types';

/** Ordered steps for the landscape wizard navigation rail. */
export const WIZARD_STEPS: WizardStep[] = [
	{ id: 0, title: 'AI Version', subtitle: 'Pick V1 or V2', icon: 'auto_awesome' },
	{ id: 1, title: 'Runtime', subtitle: 'Cloud or local', icon: 'storage' },
	{ id: 2, title: 'Models', subtitle: 'Engine and device', icon: 'memory' },
	{ id: 3, title: 'Segmentation', subtitle: 'Presets and timing', icon: 'tune' },
	{ id: 4, title: 'Run', subtitle: 'Review and launch', icon: 'play_arrow' }
];

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
