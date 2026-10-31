import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { AssetClip, SilenceClip, SubtitleClip, TrackType, type Clip } from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import type { SpeechToTextSettings } from '$lib/classes/Settings.svelte';
import type editor from '$lib/i18n/en/editor';
import LL from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

export type SpeechToTextCopy = {
	[K in keyof typeof editor.speechToText]: () => string;
};
export type SpeechWord = { word: string; start: number; end: number };
export type SpeechSubtitle = { text: string; start: number; end: number; words: SpeechWord[] };

/**
 * Résout les textes de transcription depuis la langue active.
 * @returns {SpeechToTextCopy} Textes de transcription dans la langue active.
 */
export function getSpeechToTextCopy(): SpeechToTextCopy {
	return (get(LL).editor as unknown as { speechToText: SpeechToTextCopy }).speechToText;
}

/**
 * Normalise les réponses Groq et ElevenLabs en conservant les mots et leurs temps réels.
 * @param {unknown} response Réponse du fournisseur.
 * @param {number} offset Début de la portion dans la timeline, en secondes.
 * @param {number} duration Durée de la portion envoyée, en secondes.
 * @returns {SpeechWord[]} Mots horodatés dans la timeline.
 */
export function normalizeSpeechWords(
	response: unknown,
	offset: number,
	duration: number
): SpeechWord[] {
	const raw = (response as { words?: unknown } | null)?.words;
	if (!Array.isArray(raw)) throw new Error(getSpeechToTextCopy().invalidTimings());
	return raw
		.filter((value) => {
			if (!value || typeof value !== 'object')
				throw new Error(getSpeechToTextCopy().invalidTimings());
			return !value.type || value.type === 'word';
		})
		.map((value) => {
			const word = value.word ?? value.text;
			const { start, end } = value;
			if (
				typeof word !== 'string' ||
				!word.trim() ||
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				start < 0 ||
				end < start ||
				start >= duration ||
				end > duration + 1
			) {
				throw new Error(getSpeechToTextCopy().invalidTimings());
			}
			return {
				word: word.trim(),
				start: offset + start,
				end: offset + Math.min(duration, Math.max(start + 0.001, end))
			};
		});
}

/**
 * Valide une couverture complète et ordonnée sans permettre à l'IA de modifier le texte.
 * @param {unknown} response Réponse contenant uniquement des indices de fin exclusifs.
 * @param {number} wordCount Nombre de mots fournis.
 * @returns {number[]} Frontières validées.
 */
export function validateSpeechBoundaries(response: unknown, wordCount: number): number[] {
	const ends = (response as { ends?: unknown } | null)?.ends;
	if (
		!Array.isArray(ends) ||
		!ends.length ||
		ends[ends.length - 1] !== wordCount ||
		ends.some((end, i) => !Number.isInteger(end) || end <= (ends[i - 1] ?? 0) || end > wordCount)
	) {
		throw new Error(getSpeechToTextCopy().invalidBoundaries());
	}
	return ends;
}

/**
 * Remplace les points d'interrogation latins des sous-titres entièrement en écriture arabe.
 * @param {string} text Texte final du sous-titre.
 * @returns {string} Texte avec la ponctuation arabe, ou texte original pour les autres langues.
 */
export function normalizeArabicSubtitlePunctuation(text: string): string {
	if (!text.includes('?')) return text;
	const letters = text.match(/\p{L}/gu);
	return letters?.length && letters.every((letter) => /\p{Script_Extensions=Arabic}/u.test(letter))
		? text.replace(/\?/gu, '؟')
		: text;
}

/**
 * Applique les frontières sémantiques et les limites sans couper un mot prolongé.
 * @param {SpeechWord[]} words Mots originaux horodatés.
 * @param {number[]} ends Frontières sémantiques exclusives.
 * @param {number} maxWords Nombre maximal de mots.
 * @param {number} maxDuration Durée maximale en secondes.
 * @returns {SpeechSubtitle[]} Sous-titres conservant tous les mots dans leur ordre.
 */
export function buildSpeechSubtitles(
	words: SpeechWord[],
	ends: number[],
	maxWords: number,
	maxDuration: number
): SpeechSubtitle[] {
	validateSpeechBoundaries({ ends }, words.length);
	if (
		!Number.isInteger(maxWords) ||
		maxWords < 1 ||
		!Number.isFinite(maxDuration) ||
		maxDuration <= 0
	) {
		throw new Error(getSpeechToTextCopy().invalidLimits());
	}
	const subtitles: SpeechSubtitle[] = [];
	let start = 0;
	for (const end of ends) {
		while (start < end) {
			let cut = start + 1;
			while (
				cut < end &&
				cut - start < maxWords &&
				words[cut].end - words[start].start <= maxDuration &&
				words[cut].start - words[cut - 1].end < 1.2
			)
				cut++;
			if (cut < end) {
				let bestScore = 0;
				const limit = cut;
				for (let i = start + 1; i <= limit; i++) {
					const gap = Math.max(0, (words[i]?.start ?? words[i - 1].end) - words[i - 1].end);
					const punctuation = /[.!?؟،,;؛:…]$/u.test(words[i - 1].word) ? 2 : 0;
					const score = punctuation + (gap >= 0.25 ? Math.min(1.5, gap) : 0);
					if (score > bestScore) {
						bestScore = score;
						cut = i;
					}
				}
			}
			const part = words.slice(start, cut);
			const originalText = part.map((word) => word.word).join(' ');
			const text = normalizeArabicSubtitlePunctuation(originalText);
			subtitles.push({
				text,
				start: part[0].start,
				end: part[part.length - 1].end,
				words:
					text === originalText
						? part
						: part.map((word) => ({ ...word, word: word.word.replace(/\?/gu, '؟') }))
			});
			start = cut;
		}
	}
	return subtitles;
}

/**
 * Étend les sous-titres courts dans le silence sans modifier les clips sources.
 * Répartit la durée manquante des deux côtés et reporte le manque sur le côté disponible.
 * @param {Clip[]} clips Clips de la piste, silences et voisins protégés compris.
 * @param {ReadonlySet<SubtitleClip>} editable Sous-titres issus du traitement automatique.
 * @param {number} rangeEnd Fin disponible en millisecondes.
 * @returns {Clip[]} Clips étendus et silences raccourcis, dans l'ordre chronologique.
 */
export function extendShortSubtitlesIntoSilence(
	clips: Clip[],
	editable: ReadonlySet<SubtitleClip>,
	rangeEnd: number
): Clip[] {
	const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);
	const speech = ordered.filter((clip) => !(clip instanceof SilenceClip));
	const needs = speech.map((clip) =>
		clip instanceof SubtitleClip && editable.has(clip)
			? Math.max(0, 1500 - (clip.endTime - clip.startTime))
			: 0
	);
	const requiredBefore = [...needs];
	// Réserve le silence nécessaire aux voisins suivants pour ne pas avantager le premier clip.
	for (let index = speech.length - 1; index >= 0; index--) {
		const after = Math.max(
			0,
			Math.min(speech[index + 1]?.startTime ?? rangeEnd, rangeEnd) - speech[index].endTime
		);
		requiredBefore[index] = Math.max(
			0,
			needs[index] - Math.max(0, after - (requiredBefore[index + 1] ?? 0))
		);
	}
	for (let index = 0; index < speech.length; index++) {
		const clip = speech[index];
		if (!(clip instanceof SubtitleClip) || !editable.has(clip)) continue;
		const missing = needs[index];
		if (missing <= 0) continue;
		const availableBefore = Math.max(0, clip.startTime - (speech[index - 1]?.endTime ?? 0));
		let availableAfter = Math.max(
			0,
			Math.min(speech[index + 1]?.startTime ?? rangeEnd, rangeEnd) - clip.endTime
		);
		const neededAfter = Math.max(0, missing - availableBefore);
		const nextNeeds = requiredBefore[index + 1] ?? 0;
		if (nextNeeds > 0) {
			availableAfter =
				neededAfter + nextNeeds > availableAfter
					? Math.floor((availableAfter * neededAfter) / (neededAfter + nextNeeds))
					: availableAfter - nextNeeds;
		}
		const extension = Math.min(missing, availableBefore + availableAfter);
		let before = Math.min(availableBefore, Math.ceil(extension / 2));
		const after = Math.min(availableAfter, extension - before);
		before = Math.min(availableBefore, extension - after);
		if (!extension) continue;
		const extended = clip.cloneWithTimes(clip.startTime, clip.endTime);
		// L'aperçu reste détaché du projet ; son application conserve l'action undo/redo du traitement.
		ProjectHistoryManager.ignore(() => {
			extended.setStartTimeSilently(clip.startTime - before);
			extended.setEndTimeSilently(clip.endTime + after);
		});
		speech[index] = extended;
	}
	let index = 0;
	return ordered.flatMap((clip) => {
		if (!(clip instanceof SilenceClip)) return [speech[index++]];
		const start = Math.max(clip.startTime, speech[index - 1] ? speech[index - 1].endTime + 1 : 0);
		const end = Math.min(clip.endTime, speech[index] ? speech[index].startTime - 1 : clip.endTime);
		if (end <= start) return [];
		return start === clip.startTime && end === clip.endTime
			? [clip]
			: [new SilenceClip(start, end)];
	});
}

/**
 * Traduit les erreurs réseau de transcription sans afficher de données d'authentification.
 * @param {unknown} error Erreur IPC du fournisseur.
 * @returns {Error} Message destiné à l'utilisateur.
 */
function speechRequestError(error: unknown): Error {
	const copy = getSpeechToTextCopy();
	const code = String(error);
	if (code.includes('STT_HTTP_429')) return new Error(copy.rateLimit());
	if (/STT_HTTP_40[13]/u.test(code)) return new Error(copy.invalidKey());
	if (code.includes('STT_AUDIO')) return new Error(copy.audioError());
	if (code.includes('STT_RESPONSE')) return new Error(copy.invalidTimings());
	return new Error(copy.providerError());
}

/**
 * Transcrit un clip audio puis ajoute tous ses sous-titres dans une seule opération annulable.
 * @param {Project} project Projet propriétaire du traitement.
 * @param {number} clipId Clip audio sélectionné.
 * @param {SpeechToTextSettings} options Réglages et clés personnels copiés au lancement.
 * @param {AbortSignal} signal Annulation empêchant toute requête suivante et tout ajout tardif.
 * @param {(phase: 'transcribing' | 'segmenting', progress: number) => void} onProgress Progression locale.
 * @param {boolean} overwriteExisting Autorise le remplacement de la piste après confirmation utilisateur.
 * @returns {Promise<{ count: number }>} Nombre de sous-titres ajoutés.
 */
export async function transcribeProjectAudio(
	project: Project,
	clipId: number,
	options: SpeechToTextSettings,
	signal: AbortSignal,
	onProgress: (phase: 'transcribing' | 'segmenting', progress: number) => void,
	overwriteExisting = false
): Promise<{ count: number }> {
	const copy = getSpeechToTextCopy();
	const audioTrack = project.content.timeline.getFirstTrack(TrackType.Audio);
	const clip = audioTrack.clips.find((item) => item.id === clipId);
	const asset = clip instanceof AssetClip ? project.content.getAssetById(clip.assetId) : undefined;
	if (!(clip instanceof AssetClip) || !asset || clip.endTime <= clip.startTime)
		throw new Error(copy.noAudio());
	const source = {
		assetId: clip.assetId,
		path: asset.filePath,
		start: clip.startTime,
		end: clip.endTime,
		offset: clip.sourceStartTime
	};
	const track = project.content.timeline.getFirstTrack(TrackType.Subtitle);
	const originalSubtitles = overwriteExisting ? JSON.stringify(track.toJSON()) : null;
	const apiKey = options.provider === 'groq' ? options.groqApiKey : options.elevenLabsApiKey;
	if (!apiKey.trim()) throw new Error(copy.invalidKey());
	const beforePadding = options.paddingBeforeMs ?? 500;
	const afterPadding = options.paddingAfterMs ?? 500;
	if (![beforePadding, afterPadding].every((value) => Number.isSafeInteger(value) && value >= 0))
		throw new Error(copy.invalidPadding());
	if (
		!Number.isInteger(options.maxWords) ||
		options.maxWords < 1 ||
		options.maxWords > 50 ||
		!Number.isFinite(options.maxDuration) ||
		options.maxDuration < 1 ||
		options.maxDuration > 30
	)
		throw new Error(copy.invalidLimits());

	/**
	 * Empêche d'appliquer un résultat à un clip modifié, un autre projet ou une plage déjà sous-titrée.
	 * @returns {void}
	 */
	function assertCurrentSource(): void {
		signal.throwIfAborted();
		if (
			globalState.currentProject !== project ||
			!audioTrack.clips.includes(clip as AssetClip) ||
			clip!.startTime !== source.start ||
			clip!.endTime !== source.end ||
			(clip as AssetClip).assetId !== source.assetId ||
			(clip as AssetClip).sourceStartTime !== source.offset ||
			project.content.getAssetById(source.assetId) !== asset ||
			asset!.filePath !== source.path ||
			project.content.timeline.getFirstTrack(TrackType.Audio) !== audioTrack ||
			project.content.timeline.getFirstTrack(TrackType.Subtitle) !== track
		)
			throw new Error(copy.sourceChanged());
		if (overwriteExisting && JSON.stringify(track.toJSON()) !== originalSubtitles)
			throw new Error(copy.sourceChanged());
		if (
			!overwriteExisting &&
			track.clips.some((item) => item.startTime < source.end && item.endTime > source.start)
		) {
			throw new Error(copy.overlap());
		}
	}
	assertCurrentSource();
	const duration = (source.end - source.start) / 1000;
	const words: SpeechWord[] = [];
	for (let start = 0; start < duration; start += 300) {
		assertCurrentSource();
		onProgress('transcribing', start / duration);
		const coreEnd = Math.min(duration, start + 300);
		const from = Math.max(0, start - 1.5);
		const to = Math.min(duration, coreEnd + 1.5);
		let response: unknown;
		try {
			response = await invoke('transcribe_audio_chunk', {
				request: {
					sourcePath: asset.filePath,
					startSeconds: source.offset / 1000 + from,
					durationSeconds: to - from,
					provider: options.provider,
					apiKey,
					language:
						options.language.trim() !== 'ar' && options.containsArabicTerms
							? ''
							: options.language.trim(),
					model: options.provider === 'groq' ? options.groqModel : options.elevenLabsModel
				}
			});
		} catch (error) {
			throw speechRequestError(error);
		}
		assertCurrentSource();
		const timelineStart = source.start / 1000;
		words.push(
			...normalizeSpeechWords(response, timelineStart + from, to - from).filter((word) => {
				const midpoint = (word.start + word.end) / 2 - timelineStart;
				return midpoint >= start && midpoint < coreEnd;
			})
		);
	}
	if (!words.length) throw new Error(copy.noSpeech());
	// Certains fournisseurs font légèrement se chevaucher les mots; conserve des bornes monotones.
	for (let i = 1; i < words.length; i++) {
		words[i].start = Math.max(words[i].start, words[i - 1].end);
		words[i].end = Math.max(words[i].start + 0.001, words[i].end);
	}
	onProgress('segmenting', 0);
	const subtitles = buildSpeechSubtitles(
		words,
		[words.length],
		options.maxWords,
		options.maxDuration
	);
	assertCurrentSource();
	// Le seuil de 2 ms correspond aux clips de silence créés ci-dessous.
	const starts = subtitles.map((segment) => Math.round(segment.start * 1000));
	const ends = subtitles.map((segment) => Math.round(segment.end * 1000));
	const firstLimit = overwriteExisting
		? 0
		: track.clips.reduce(
				(limit, existing) =>
					existing.endTime <= starts[0] ? Math.max(limit, existing.endTime) : limit,
				0
			);
	if (starts[0] - firstLimit > 2) starts[0] = Math.max(firstLimit, starts[0] - beforePadding);
	for (let index = 1; index < subtitles.length; index++) {
		const silence = starts[index] - ends[index - 1];
		if (silence <= 2) continue;
		// Répartit un silence trop court entre les deux marges sans chevauchement.
		const scale = Math.min(1, silence / Math.max(1, beforePadding + afterPadding));
		ends[index - 1] += Math.floor(afterPadding * scale);
		starts[index] -= Math.floor(beforePadding * scale);
	}
	const last = ends.length - 1;
	if (source.end - ends[last] > 2) ends[last] = Math.min(source.end, ends[last] + afterPadding);
	const clips = subtitles.map(
		(segment, index) =>
			new SubtitleClip(
				starts[index],
				ends[index],
				segment.text,
				project.content.projectTranslation.createTranslationsForSubtitleText(segment.text),
				true,
				null,
				{
					source: 'api',
					timeFrom: starts[index] / 1000,
					timeTo: ends[index] / 1000,
					matchedText: segment.text,
					words: segment.words.map((word) => ({
						word: word.word,
						start: word.start - starts[index] / 1000,
						end: word.end - starts[index] / 1000,
						spokenDuration: word.end - word.start
					}))
				}
			)
	);
	const existingClips = overwriteExisting ? [] : track.clips;
	const output = extendShortSubtitlesIntoSilence(
		[...existingClips, ...clips],
		new Set(clips),
		source.end
	);
	const imported = output.filter(
		(item) => item instanceof SubtitleClip && !existingClips.includes(item)
	);
	ProjectHistoryManager.track(
		copy.title(),
		() => {
			project.detail.audioLanguage = options.language.trim().toLowerCase() || 'ar';
			const script = new Intl.Locale(
				/^[a-z]{2,3}$/.test(project.detail.audioLanguage) ? project.detail.audioLanguage : 'und'
			).maximize().script;
			project.content.videoStyle
				.getStylesOfTarget('arabic')
				.setStyle(
					'text-orientation',
					['Arab', 'Hebr', 'Thaa', 'Nkoo', 'Adlm', 'Rohg', 'Syrc', 'Samr', 'Mand'].includes(
						script ?? ''
					)
						? 'rtl'
						: 'ltr'
				);
			if (overwriteExisting) {
				project.projectEditorState.subtitlesEditor.editSubtitle = null;
				project.projectEditorState.subtitlesEditor.pendingSplitEditNextId = null;
				project.projectEditorState.stylesEditor.selectedSubtitles = [];
			}
			track.clips = output;
			for (const [index, clip] of imported.entries()) {
				const previous = imported[index - 1];
				if (previous && clip.startTime - previous.endTime > 2) {
					track.clips.push(new SilenceClip(previous.endTime + 1, clip.startTime - 1));
				}
			}
			track.clips.sort((a, b) => a.startTime - b.startTime);
			const first = track.clips[0];
			if (first && first.startTime > 1)
				track.clips.unshift(new SilenceClip(0, first.startTime - 1));
			project.detail.updateVideoDetailAttributes();
			project.projectEditorState.subtitlesEditor.completedAiSteps = {
				correction: false,
				rearrangement: false,
				references: false
			};
		},
		project
	);
	globalState.updateVideoPreviewUI();
	return { count: clips.length };
}
