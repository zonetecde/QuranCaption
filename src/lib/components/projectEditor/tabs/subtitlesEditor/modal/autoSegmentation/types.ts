import type {
	LegacyWhisperModelSize,
	LocalAsrMode,
	MultiAlignerModel,
	SegmentationDevice,
	SegmentationMode
} from '$lib/services/AutoSegmentation';

/** Defines the high-level AI family shown in the wizard. */
export type AiVersion = 'legacy_v1' | 'multi_v2';

/** Represents a wizard navigation item. */
export type WizardStep = {
	key: WizardStepKey;
	title: string;
	subtitle: string;
	icon: MaterialIconName;
};

/** Stable keys for wizard step routing. */
export type WizardStepKey = 'version' | 'runtime' | 'models' | 'settings' | 'review';

/** Represents one segmentation timing preset. */
export type SegmentationPreset = {
	id: string;
	label: string;
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
};

/** Generic model card option for radio-like sections. */
export type ModelOption<T extends string> = {
	value: T;
	label: string;
	description: string;
	source?: string;
};

/** Names supported by Material Icons in this wizard scope. */
export type MaterialIconName =
	| 'auto_awesome'
	| 'memory'
	| 'cloud'
	| 'storage'
	| 'tune'
	| 'play_arrow'
	| 'check_circle'
	| 'warning';

/** Shared UI state passed between wizard step components. */
export type WizardSelectionState = {
	aiVersion: AiVersion;
	mode: SegmentationMode;
	localAsrMode: LocalAsrMode;
	legacyModel: LegacyWhisperModelSize;
	multiModel: MultiAlignerModel;
	cloudModel: MultiAlignerModel;
	device: SegmentationDevice;
	hfToken: string;
};
