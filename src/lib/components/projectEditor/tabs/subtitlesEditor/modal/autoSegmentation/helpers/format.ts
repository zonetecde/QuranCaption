import { Quran } from '$lib/classes/Quran';
import type {
	AutoSegmentationResult,
	LegacyWhisperModelSize,
	MultiAlignerModel,
	SegmentationDevice,
	SegmentationMode
} from '$lib/services/AutoSegmentation';
import type { AiVersion } from '../types';

/** Formats the token for compact display in UI. */
export function maskToken(token: string): string {
	if (!token) return 'Not configured';
	if (token.length <= 10) return token;
	return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/** Formats detected verse ranges for completion summary. */
export function formatVerseRange(resultData: AutoSegmentationResult | null): string {
	if (!resultData || resultData.status !== 'completed') return 'No verse range detected.';
	if (resultData.verseRange.parts.length === 0) return 'No verse range detected.';
	return resultData.verseRange.parts
		.map((part) => {
			const surah = Quran.getSurahsNames()[part.surah - 1]?.transliteration || `Surah ${part.surah}`;
			const range = part.verseStart === part.verseEnd ? `${part.verseStart}` : `${part.verseStart}-${part.verseEnd}`;
			return `${surah}: ${range}`;
		})
		.join(', ');
}

/** Builds a human-readable audio source label. */
export function buildAudioLabel(fileName: string | undefined, clipCount: number | undefined): string {
	if (!fileName) return 'No audio clip found in the timeline.';
	if (!clipCount || clipCount <= 1) return fileName;
	return `${fileName} (+${clipCount - 1} more clips)`;
}

/** Resolves the selected model label for review and analytics. */
export function getSelectedModelLabel(
	version: AiVersion,
	mode: SegmentationMode,
	legacyModel: LegacyWhisperModelSize,
	multiModel: MultiAlignerModel,
	cloudModel: MultiAlignerModel
): string {
	if (version === 'legacy_v1') return legacyModel;
	return mode === 'api' ? cloudModel : multiModel;
}

/** Resolves the effective device label for review and analytics. */
export function getDeviceLabel(
	version: AiVersion,
	mode: SegmentationMode,
	device: SegmentationDevice
): string {
	if (version === 'legacy_v1' && mode === 'local') return 'AUTO';
	return device;
}
