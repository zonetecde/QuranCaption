import { invoke } from '@tauri-apps/api/core';
import { SilenceClip, SubtitleClip } from '$lib/classes';
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

export type AppliedAITranscription = {
	count: number;
	clipIds: number[];
};

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
		language: 'ar',
		device: settings.device,
		hfToken: settings.hfToken,
		minSpeakers: settings.minSpeakers ?? undefined,
		maxSpeakers: settings.maxSpeakers ?? undefined,
		batchSize: settings.batchSize,
		minSilenceDuration: settings.minSilenceDuration,
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
	replaceExisting: boolean,
	replaceClipIds: number[] = []
): AppliedAITranscription {
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
	for (const [index, clip] of generated.slice(0, -1).entries()) {
		const next = generated[index + 1];
		const silenceDurationMs = next.startTime - clip.endTime - 1;
		if (silenceDurationMs > 0 && silenceDurationMs < 1000) {
			clip.endTime = next.startTime - 1;
			clip.duration = clip.endTime - clip.startTime;
		}
	}
	const generatedWithSilences = generated.flatMap((clip, index) => {
		const previous = generated[index - 1];
		if (!previous) {
			return clip.startTime > 0 ? [new SilenceClip(0, clip.startTime - 1), clip] : [clip];
		}
		if (clip.startTime <= previous.endTime + 1) return [clip];
		return [new SilenceClip(previous.endTime + 1, clip.startTime - 1), clip];
	});

	ProjectHistoryManager.begin('apply AI transcription');
	try {
		const replacedIds = new Set(replaceClipIds);
		const preservedClips =
			replacedIds.size > 0
				? track.clips.filter((clip) => !replacedIds.has(clip.id))
				: replaceExisting
					? track.clips.filter(
							(clip) => !(clip instanceof SubtitleClip) && !(clip instanceof SilenceClip)
						)
					: track.clips;
		track.clips = [...preservedClips, ...generatedWithSilences].sort(
			(a, b) => a.startTime - b.startTime
		);

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
		return {
			count: generated.length,
			clipIds: generatedWithSilences.map((clip) => clip.id)
		};
	} finally {
		ProjectHistoryManager.commit();
	}
}

/**
 * Convertit les sous-titres du projet en résultat compatible avec le nettoyage IA.
 * @returns {{ result: AITranscriptionResult; speakerMap: SpeakerNameMap; clipIds: number[] }} Transcription et clips à remplacer progressivement.
 */
export function buildAITranscriptionFromSubtitleTrack(): {
	result: AITranscriptionResult;
	speakerMap: SpeakerNameMap;
	clipIds: number[];
} {
	const clips = globalState.getSubtitleTrack.clips;
	const subtitles = clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip);
	const speakers = Array.from(new Set(subtitles.map((clip) => clip.speaker)));
	return {
		result: {
			language: 'unknown',
			device: 'project',
			model: 'project',
			segments: subtitles.map((clip) => ({
				start: clip.startTime / 1000,
				end: clip.endTime / 1000,
				text: clip.text,
				speaker: clip.speaker,
				confidence: clip.confidence,
				words: (clip.alignmentMetadata?.words ?? []).map((word) => ({
					word: word.word,
					start: clip.startTime / 1000 + word.start,
					end: clip.startTime / 1000 + word.end,
					confidence: word.confidence,
					speaker: clip.speaker
				}))
			})),
			speakers,
			wordTimestampsAvailable: subtitles.some(
				(clip) => (clip.alignmentMetadata?.words.length ?? 0) > 0
			)
		},
		speakerMap: Object.fromEntries(speakers.map((speaker) => [speaker, speaker])),
		clipIds: clips
			.filter((clip) => clip instanceof SubtitleClip || clip instanceof SilenceClip)
			.map((clip) => clip.id)
	};
}

export async function saveAITranscriptionSettings(): Promise<void> {
	await Settings.save();
}
