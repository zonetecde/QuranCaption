import type { LegacyWhisperModelSize, MultiAlignerModel } from '$lib/services/AutoSegmentation';
import type {
	AiVersion,
	ModelOption,
	SegmentationPreset,
	WizardRuntime,
	WizardStep
} from './types';

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

/** Speech recognition models exposed by the Muaalem local pipeline. */
export const MUAALEM_MODEL_OPTIONS: Array<ModelOption<MultiAlignerModel>> = [
	{
		value: 'Muaalem-v3.2',
		label: 'Offline Tarteel q8',
		description: 'Quantized ONNX FastConformer model for local Quran alignment.',
		source: 'yazinsai/offline-tarteel'
	}
];

/** WhisperX models exposed by the Surah Splitter local pipeline. */
export const SURAH_SPLITTER_MODEL_OPTIONS: Array<ModelOption<MultiAlignerModel>> = [
	{
		value: 'SurahSplitter-Base-Quran',
		label: 'Base Quran',
		description: 'Default Surah Splitter model with ayah auto-detection support.',
		source: 'OdyAsh/faster-whisper-base-ar-quran'
	}
];

/** Experimental alternative speech recognition models available in advanced Muaalem settings. */
export const MUAALEM_ADVANCED_MODEL_OPTIONS: Array<ModelOption<MultiAlignerModel>> = [];
