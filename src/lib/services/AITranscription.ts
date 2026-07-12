import { invoke } from '@tauri-apps/api/core';
import { SubtitleClip } from '$lib/classes';
import {
	normalizeTranscriptWordTimings,
	type TranscriptAlignmentMetadata
} from '$lib/classes/Clip.svelte';
import Settings, { type AITranscriptionSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { getAutoSegmentationAudioClips } from '$lib/services/autoSegmentation/audio';
import {
	addProjectSpeaker,
	getVisibleProjectSpeakers,
	UNASSIGNED_SPEAKER
} from '$lib/services/SpeakerLibrary';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

export type AITranscriptionRuntimeStatus = {
	ready: boolean;
	venvExists: boolean;
	packagesInstalled: boolean;
	missingModules?: string[];
	message: string;
};

export type AITranscriptionWord = {
	word: string;
	start: number;
	end: number;
	confidence?: number | null;
	speaker?: string;
};

export type AITranscriptionSegment = {
	start: number;
	end: number;
	text: string;
	speaker: string;
	confidence?: number | null;
	words: AITranscriptionWord[];
};

export type AITranscriptionResult = {
	language: string;
	device: string;
	model: string;
	segments: AITranscriptionSegment[];
	speakers: string[];
	wordTimestampsAvailable: boolean;
	alignmentWarning?: string | null;
	gpuFallbackReason?: string;
};

export type SpeakerNameMap = Record<string, string>;

export async function checkAITranscriptionStatus(): Promise<AITranscriptionRuntimeStatus> {
	return (await invoke('check_ai_transcription_ready')) as AITranscriptionRuntimeStatus;
}

export async function installAITranscriptionRuntime(hfToken: string): Promise<void> {
	await invoke('install_local_segmentation_deps', {
		engine: 'transcription',
		hfToken: hfToken.trim() || undefined
	});
}

export async function runAITranscription(
	settings: AITranscriptionSettings
): Promise<AITranscriptionResult> {
	const clips = getAutoSegmentationAudioClips();
	if (clips.length === 0) throw new Error('No audio clip is available on the project timeline.');
	if (!settings.hfToken.trim()) {
		throw new Error('A Hugging Face read token is required for speaker detection.');
	}

	const response = (await invoke('transcribe_audio_local_whisperx', {
		audioPath: clips.length === 1 ? clips[0].filePath : undefined,
		audioClips: clips.map((clip) => ({
			path: clip.filePath,
			startMs: clip.startMs,
			endMs: clip.endMs
		})),
		model: settings.model,
		language: settings.language,
		device: settings.device,
		hfToken: settings.hfToken,
		minSpeakers: settings.minSpeakers ?? undefined,
		maxSpeakers: settings.maxSpeakers ?? undefined,
		batchSize: settings.batchSize,
		maxWords: settings.maxWordsPerSegment,
		maxChars: settings.maxCharsPerSegment
	})) as AITranscriptionResult;

	if (!Array.isArray(response.segments)) {
		throw new Error('WhisperX returned an invalid transcription result.');
	}
	if (response.segments.length === 0) {
		throw new Error('WhisperX did not detect any transcribable speech in the project audio.');
	}
	return response;
}

function buildAlignmentMetadata(
	segment: AITranscriptionSegment
): TranscriptAlignmentMetadata | null {
	const startS = Number(segment.start);
	const endS = Number(segment.end);
	if (!Number.isFinite(startS) || !Number.isFinite(endS) || endS <= startS) return null;

	const durationS = endS - startS;
	const words = (segment.words ?? [])
		.map((word) => {
			const absoluteStart = Number(word.start);
			const absoluteEnd = Number(word.end);
			if (!word.word?.trim() || !Number.isFinite(absoluteStart) || !Number.isFinite(absoluteEnd)) {
				return null;
			}
			const relativeStart = Math.max(0, Math.min(durationS, absoluteStart - startS));
			const relativeEnd = Math.max(relativeStart, Math.min(durationS, absoluteEnd - startS));
			return {
				word: word.word.trim(),
				start: relativeStart,
				end: relativeEnd,
				...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {})
			};
		})
		.filter((word): word is NonNullable<typeof word> => word !== null);

	if (words.length === 0) return null;
	return {
		source: 'local',
		timeFrom: startS,
		timeTo: endS,
		words: normalizeTranscriptWordTimings(words, durationS)
	};
}

export function buildDefaultSpeakerMap(result: AITranscriptionResult): SpeakerNameMap {
	const knownSpeakers = getVisibleProjectSpeakers().filter(
		(speaker) => speaker.toLocaleLowerCase() !== UNASSIGNED_SPEAKER.toLocaleLowerCase()
	);
	return Object.fromEntries(
		result.speakers.map((speakerId, index) => [
			speakerId,
			knownSpeakers[index] ?? (index === 0 ? 'Main speaker' : `Speaker ${index + 1}`)
		])
	);
}

export function applyAITranscription(
	result: AITranscriptionResult,
	speakerMap: SpeakerNameMap,
	replaceExisting: boolean
): number {
	const track = globalState.getSubtitleTrack;
	const generated = result.segments
		.map((segment) => {
			const startMs = Math.max(0, Math.round(Number(segment.start) * 1000));
			const endMs = Math.max(startMs + 1, Math.round(Number(segment.end) * 1000));
			const text = segment.text?.trim();
			if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
			const mappedSpeaker =
				speakerMap[segment.speaker]?.trim() || segment.speaker || 'Unknown speaker';
			return new SubtitleClip(
				startMs,
				endMs,
				text,
				mappedSpeaker,
				{},
				true,
				typeof segment.confidence === 'number' ? segment.confidence : null,
				buildAlignmentMetadata(segment)
			);
		})
		.filter((clip): clip is SubtitleClip => clip !== null)
		.sort((a, b) => a.startTime - b.startTime);

	if (generated.length === 0) {
		throw new Error('The AI transcription result does not contain any valid subtitle segment.');
	}

	ProjectHistoryManager.begin('apply AI transcription');
	try {
		const preservedClips = replaceExisting
			? track.clips.filter((clip) => !(clip instanceof SubtitleClip))
			: track.clips;
		track.clips = [...preservedClips, ...generated].sort((a, b) => a.startTime - b.startTime);

		const names = Array.from(
			new Set(
				Object.values(speakerMap)
					.map((name) => name.trim())
					.filter(Boolean)
			)
		);
		for (const name of names) addProjectSpeaker(name);
		const firstSpeaker = Object.values(speakerMap)
			.find((name) => name.trim())
			?.trim();
		if (firstSpeaker) globalState.getSubtitlesEditorState.selectedSpeaker = firstSpeaker;
		globalState.currentProject!.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		return generated.length;
	} finally {
		ProjectHistoryManager.commit();
	}
}

export async function saveAITranscriptionSettings(): Promise<void> {
	await Settings.save();
}
