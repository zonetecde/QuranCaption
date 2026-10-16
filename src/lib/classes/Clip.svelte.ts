// Point d'entrée conservé pour le moteur partagé et les projets existants.
export { Clip, AssetClip, SilenceClip, type ClipType } from './clips/Clip.svelte';
export {
	ClipWithTranslation,
	hasClipReviewIssue,
	getClipPrimaryReviewIssueCategory,
	isClipPendingVerification,
	markClipAsVerified,
	type ArabicRenderParts,
	type ReviewIssueCategory
} from './clips/ClipWithTranslation.svelte';
export { SubtitleClip } from './clips/SubtitleClip.svelte';
export {
	PredefinedSubtitleClip,
	canonicalizePredefinedSubtitleType,
	getPredefinedArabicText,
	getForcedFontForPredefinedSubtitle,
	type PredefinedSubtitleType
} from './clips/PredefinedSubtitleClip.svelte';
export { CustomClip, CustomTextClip, CustomImageClip } from './clips/CustomClip.svelte';
export { normalizeTranscriptWordTimings } from '$lib/services/TranscriptTiming';
export type {
	TranscriptWordTiming,
	TranscriptAlignmentMetadata,
	VisualMergeMode
} from '$lib/types/transcription';
