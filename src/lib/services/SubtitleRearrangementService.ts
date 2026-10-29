import { invoke } from '@tauri-apps/api/core';
import { Clip, SilenceClip, SubtitleClip, TrackType } from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import { globalState } from '$lib/runes/main.svelte';
import { resolveAIReasoning } from './AIReasoning';
import type { ManualAiSession } from './ManualAiSession.svelte';
import {
	buildSpeechSubtitles,
	extendShortSubtitlesIntoSilence,
	getSpeechToTextCopy,
	validateSpeechBoundaries
} from './SpeechToTextService';
import {
	buildTranscriptBandWords,
	serializeTranscriptBandSelection,
	type TranscriptBandWord
} from './TranscriptBandService';
import {
	getTranscriptReferenceLogicalParts,
	loadReferencedVerse
} from './TranscriptReferenceService';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

export type RearrangementPreferences = {
	maxWords: number;
	maxDuration: number;
	additionalPreferences: string;
};
export type SubtitleRearrangementPlan = {
	before: SubtitleClip[];
	after: SubtitleClip[];
	skipped: number;
	apply: () => { count: number; skipped: number };
};
type SpeechBlock = { type: 'speech'; id: number; words: TranscriptBandWord[] };
type TimelineEntry =
	| SpeechBlock
	| { type: 'silence' | 'protected'; start: number; end: number; text?: string };

/**
 * Prépare une réorganisation des mots existants sans modifier les sous-titres du projet.
 * @param {Project} project Projet capturé à l'ouverture du modal.
 * @param {RearrangementPreferences} preferences Limites et indications sémantiques.
 * @param {AbortSignal} signal Annulation empêchant toute application tardive.
 * @param {(progress: number) => void} onProgress Progression entre les requêtes bornées.
 * @param {ManualAiSession} [manual] Parcours copier-coller optionnel, sans fournisseur API.
 * @returns {Promise<SubtitleRearrangementPlan>} Aperçu des changements et application différée.
 */
export async function rearrangeProjectSubtitles(
	project: Project,
	preferences: RearrangementPreferences,
	signal: AbortSignal,
	onProgress: (progress: number) => void,
	manual?: ManualAiSession
): Promise<SubtitleRearrangementPlan> {
	const copy = getSpeechToTextCopy();
	if (
		!Number.isInteger(preferences.maxWords) ||
		preferences.maxWords < 1 ||
		preferences.maxWords > 50 ||
		!Number.isFinite(preferences.maxDuration) ||
		preferences.maxDuration < 1 ||
		preferences.maxDuration > 30
	)
		throw new Error(copy.invalidLimits());
	const settings = { ...globalState.settings!.aiTranslationSettings };
	if (!manual && !settings.openAiApiKey.trim()) throw new Error(copy.rearrangeKeyRequired());
	const track = project.content.timeline.getFirstTrack(TrackType.Subtitle);
	const originals = [...track.clips].sort((a, b) => a.startTime - b.startTime);
	const snapshot = JSON.stringify([track.toJSON(), project.content.projectTranslation.toJSON()]);
	/**
	 * Refuse un résultat après annulation, changement de projet ou édition concurrente.
	 * @returns {void}
	 */
	function assertCurrent(): void {
		signal.throwIfAborted();
		if (
			globalState.currentProject !== project ||
			project.content.timeline.getFirstTrack(TrackType.Subtitle) !== track ||
			JSON.stringify([track.toJSON(), project.content.projectTranslation.toJSON()]) !== snapshot
		)
			throw new Error(copy.rearrangeSourceChanged());
	}
	assertCurrent();
	if (
		originals.some(
			(clip, i) =>
				!Number.isFinite(clip.startTime) ||
				!Number.isFinite(clip.endTime) ||
				clip.endTime <= clip.startTime ||
				clip.startTime < (originals[i - 1]?.endTime ?? 0)
		)
	)
		throw new Error(copy.rearrangeOverlap());
	const timeline: TimelineEntry[] = [];
	const retained: Clip[] = [];
	const eligible = new Map<number, SubtitleClip>();
	let wordCount = 0;
	let skipped = 0;
	for (const clip of originals) {
		assertCurrent();
		if (clip.type === 'Silence') {
			retained.push(clip);
			timeline.push({ type: 'silence', start: clip.startTime / 1000, end: clip.endTime / 1000 });
			continue;
		}
		let words: TranscriptBandWord[] = [];
		if (
			clip instanceof SubtitleClip &&
			Object.getPrototypeOf(clip) === SubtitleClip.prototype &&
			clip.alignmentMetadata?.words.length &&
			!clip.arabicInlineStyleRuns.length &&
			!clip.associatedImagePath &&
			!clip.visualMergeGroupId &&
			!clip.wbwTimestampsManuallyEdited
		) {
			const timings = clip.alignmentMetadata.words;
			let parts = getTranscriptReferenceLogicalParts(clip.text);
			for (const part of parts ?? []) {
				if (part.wordCount === null && part.quranReference)
					await loadReferencedVerse(part.quranReference.surah, part.quranReference.verse);
			}
			parts = getTranscriptReferenceLogicalParts(clip.text);
			let cursor = 0;
			const tokens = parts
				? parts.flatMap((part) => {
						const count = part.wordCount ?? 0;
						const values =
							part.referenceType === 'quran'
								? timings.slice(cursor, cursor + count).map((word) => word.word ?? '')
								: part.text.trim().split(/\s+/u).filter(Boolean);
						cursor += count;
						return values;
					})
				: clip.text.trim().split(/\s+/u).filter(Boolean);
			if (
				!parts?.some((part) => part.wordCount === null) &&
				tokens.length === timings.length &&
				Math.abs(clip.alignmentMetadata.timeFrom * 1000 - clip.startTime) <= 1 &&
				!tokens.some((token) => !token || token.includes('{{') || token.includes('}}')) &&
				timings.every(
					(word, i) =>
						Number.isFinite(word.start) &&
						Number.isFinite(word.end) &&
						word.end > word.start &&
						word.start >= 0 &&
						word.end <= (clip.endTime - clip.startTime) / 1000 + 0.001 &&
						word.start >= (timings[i - 1]?.end ?? 0) - 0.001 &&
						tokens[i].replace(/[\p{P}\p{S}\p{M}]/gu, '') ===
							word.word?.replace(/[\p{P}\p{S}\p{M}]/gu, '')
				)
			) {
				words = await buildTranscriptBandWords([clip]);
				if (words.length !== tokens.length) words = [];
				words = words.map((word, i) => ({
					...word,
					text: tokens[i],
					globalIndex: wordCount + i,
					endMs:
						Number.isFinite(timings[i].spokenDuration) && timings[i].spokenDuration! > 0
							? Math.min(
									word.endMs,
									word.startMs + Math.max(1, Math.round(timings[i].spokenDuration! * 1000))
								)
							: word.endMs
				}));
			}
		}
		if (!(clip instanceof SubtitleClip) || !words.length) {
			retained.push(clip);
			skipped++;
			timeline.push({
				type: 'protected',
				start: clip.startTime / 1000,
				end: clip.endTime / 1000,
				text: clip instanceof SubtitleClip ? clip.text : undefined
			});
			continue;
		}
		eligible.set(clip.id, clip);
		wordCount += words.length;
		for (const word of words) {
			let previous = timeline[timeline.length - 1];
			if (previous?.type === 'speech') {
				const last = previous.words[previous.words.length - 1];
				if (word.startMs - last.endMs >= 1000) {
					timeline.push({ type: 'silence', start: last.endMs / 1000, end: word.startMs / 1000 });
					previous = timeline[timeline.length - 1];
				}
			}
			if (previous?.type === 'speech') previous.words.push(word);
			else
				timeline.push({
					type: 'speech',
					id: timeline.filter((entry) => entry.type === 'speech').length,
					words: [word]
				});
		}
	}
	assertCurrent();
	if (!wordCount) throw new Error(copy.rearrangeNoTimings());
	const blocks = timeline.filter((entry): entry is SpeechBlock => entry.type === 'speech');
	const output: Clip[] = [...retained];
	const reasoning = resolveAIReasoning(
		settings.textAiApiEndpoint,
		settings.advancedTrimModel,
		settings.projectTranslationReasoningMode
	);
	let blockIndex = 0;
	let offset = 0;
	let processed = 0;
	while (blockIndex < blocks.length) {
		assertCurrent();
		onProgress(processed / wordCount);
		const selected: SpeechBlock[] = [];
		let size = 0;
		for (let i = blockIndex; i < blocks.length; i++) {
			const words = blocks[i].words.slice(i === blockIndex ? offset : 0);
			if (size && size + words.length > 400) break;
			selected.push({ ...blocks[i], words: words.slice(0, 400) });
			size += Math.min(400, words.length);
			if (size >= 400) break;
		}
		const from = selected[0].words[0].startMs / 1000;
		const last = selected[selected.length - 1].words;
		const to = last[last.length - 1].endMs / 1000;
		const batch = {
			preferences,
			contextBefore: blocks[blockIndex].words
				.slice(Math.max(0, offset - 25), offset)
				.map((word) => word.text)
				.join(' '),
			timeline: timeline.flatMap<unknown>((entry) => {
				if (entry.type !== 'speech') return entry.end >= from && entry.start <= to ? [entry] : [];
				const part = selected.find((item) => item.id === entry.id);
				return part
					? [
							{
								type: 'speech',
								id: part.id,
								words: part.words.map((word, i) => ({
									id: i + 1,
									text: word.text,
									start: word.startMs / 1000,
									end: word.endMs / 1000,
									kind: word.kind
								}))
							}
						]
					: [];
			})
		};
		/**
		 * Vérifie la couverture complète des mots avant de créer les clips.
		 * @param {unknown} response Réponse de l'IA.
		 * @returns {{id: number; ends: number[]}[]} Frontières vérifiées.
		 */
		function validate(response: unknown): { id: number; ends: number[] }[] {
			assertCurrent();
			const results = (response as { blocks?: { id: number; ends: number[] }[] } | null)?.blocks;
			if (
				!Array.isArray(results) ||
				results.length !== selected.length ||
				new Set(results.map((item) => item?.id)).size !== selected.length
			)
				throw new Error(copy.invalidBoundaries());
			for (const block of selected)
				validateSpeechBoundaries(
					results.find((result) => result?.id === block.id),
					block.words.length
				);
			return results;
		}
		let results: { id: number; ends: number[] }[];
		if (manual) {
			results = await manual.request('rearrange_subtitle_words', { batch }, validate);
		} else {
			let response: unknown;
			try {
				response = await invoke('rearrange_subtitle_words', {
					request: {
						apiKey: settings.openAiApiKey,
						endpoint: settings.textAiApiEndpoint,
						model: settings.advancedTrimModel,
						reasoningEffort: reasoning.effort,
						thinkingEnabled: reasoning.thinkingEnabled,
						batch
					}
				});
			} catch {
				signal.throwIfAborted();
				throw new Error(copy.rearrangeProviderError());
			}
			results = validate(response);
		}
		for (const block of selected) {
			const ends = validateSpeechBoundaries(
				results.find((result) => result?.id === block.id),
				block.words.length
			);
			const segments = buildSpeechSubtitles(
				block.words.map((word) => ({
					word: word.text,
					start: word.startMs / 1000,
					end: word.endMs / 1000
				})),
				ends,
				preferences.maxWords,
				preferences.maxDuration
			);
			// Une fenêtre partielle laisse sa dernière phrase comme contexte à la requête suivante.
			const partial = offset + block.words.length < blocks[blockIndex].words.length;
			let used = 0;
			for (const segment of segments) {
				if (partial && used > 0 && used + segment.words.length > 350) break;
				const words = block.words.slice(used, used + segment.words.length);
				used += words.length;
				const start = Math.round(segment.start * 1000);
				const source = eligible.get(words[0].clipId!)!;
				const lastWord = words[words.length - 1];
				const lastSource = eligible.get(lastWord.clipId!)!;
				// Conserve la marge de fin du clip source sans étendre les coupures internes.
				const end =
					lastWord.clipWordIndex === lastSource.alignmentMetadata!.words.length - 1
						? lastSource.endTime
						: Math.round(segment.end * 1000);
				const text = serializeTranscriptBandSelection(
					words,
					words[0].globalIndex,
					words[words.length - 1].globalIndex
				);
				if (
					words.every((word) => word.clipId === source.id) &&
					source.alignmentMetadata!.words.length === words.length &&
					start === source.startTime &&
					end === source.endTime &&
					text === source.text
				) {
					output.push(source);
					continue;
				}
				const clip = new SubtitleClip(
					start,
					end,
					text,
					project.content.projectTranslation.createTranslationsForSubtitleText(text),
					true,
					null,
					{
						source: source.alignmentMetadata!.source,
						timeFrom: start / 1000,
						timeTo: end / 1000,
						matchedText: text,
						words: words.map((word) => ({
							...eligible.get(word.clipId!)!.alignmentMetadata!.words[word.clipWordIndex],
							word: word.text,
							start: (word.startMs - start) / 1000,
							end: (word.endMs - start) / 1000
						}))
					}
				);
				clip.needsReview = words.some((word) => eligible.get(word.clipId!)!.needsReview);
				clip.needsCoverageReview = words.some(
					(word) => eligible.get(word.clipId!)!.needsCoverageReview
				);
				clip.needsWbwTimestampReview = words.some(
					(word) => eligible.get(word.clipId!)!.needsWbwTimestampReview
				);
				output.push(clip);
			}
			processed += used;
			offset += used;
			if (offset === blocks[blockIndex].words.length) {
				blockIndex++;
				offset = 0;
			}
		}
	}
	assertCurrent();
	output.sort((a, b) => a.startTime - b.startTime);
	const extendedOutput = extendShortSubtitlesIntoSilence(
		output,
		new Set(
			output.filter(
				(clip): clip is SubtitleClip => clip instanceof SubtitleClip && !retained.includes(clip)
			)
		),
		project.content.timeline.getLongestTrackDurationIgnoringLoopedVideo().ms
	);
	const withSilences: Clip[] = [];
	if (extendedOutput[0]?.startTime > 1)
		withSilences.push(new SilenceClip(0, extendedOutput[0].startTime - 1));
	for (const clip of extendedOutput) {
		const previous = withSilences[withSilences.length - 1];
		if (
			previous &&
			!(previous instanceof SilenceClip) &&
			!(clip instanceof SilenceClip) &&
			clip.startTime - previous.endTime > 2
		)
			withSilences.push(new SilenceClip(previous.endTime + 1, clip.startTime - 1));
		withSilences.push(clip);
	}
	let applied = false;
	/**
	 * Applique l'aperçu dans une seule action annulable si ses sources sont toujours valides.
	 * @returns {{count: number; skipped: number}} Nombre de segments et de clips protégés.
	 */
	function apply(): { count: number; skipped: number } {
		if (applied) throw new Error(copy.rearrangeSourceChanged());
		assertCurrent();
		ProjectHistoryManager.track(
			copy.rearrangeTitle(),
			() => {
				track.clips = withSilences;
				const editor = project.projectEditorState.subtitlesEditor;
				editor.completedAiSteps.rearrangement = true;
				if (
					editor.editSubtitle &&
					!withSilences.some((clip) => clip.id === editor.editSubtitle!.id)
				)
					editor.editSubtitle = null;
				if (!withSilences.some((clip) => clip.id === editor.pendingSplitEditNextId))
					editor.pendingSplitEditNextId = null;
				project.projectEditorState.stylesEditor.selectedSubtitles =
					project.projectEditorState.stylesEditor.selectedSubtitles.filter((selected) =>
						withSilences.some((clip) => clip.id === selected.id)
					);
				project.detail.updateVideoDetailAttributes();
			},
			project
		);
		applied = true;
		globalState.updateVideoPreviewUI();
		return { count: output.filter((clip) => clip instanceof SubtitleClip).length, skipped };
	}
	onProgress(1);
	return {
		before: originals.filter(
			(clip): clip is SubtitleClip => clip instanceof SubtitleClip && !withSilences.includes(clip)
		),
		after: withSilences.filter(
			(clip): clip is SubtitleClip => clip instanceof SubtitleClip && !originals.includes(clip)
		),
		skipped,
		apply
	};
}
