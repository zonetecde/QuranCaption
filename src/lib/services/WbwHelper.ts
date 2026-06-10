import { SubtitleClip } from '$lib/classes';
import { Quran } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';
import {
	buildSubtitleAlignmentMetadata,
	refreshSegmentationContextFromTrack,
	type SegmentationSegment,
	type SegmentationWordTimestamp
} from '$lib/services/AutoSegmentation';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

export type ManualWordByWordDraftWord = SegmentationWordTimestamp & {
	word: string;
};

type SubtitlesEditorState = typeof globalState.getSubtitlesEditorState;
export type SubtitlesEditorStateAccessor = () => SubtitlesEditorState;

export type ManualWbwShortcutHandlers = {
	getTimer: () => ReturnType<typeof setTimeout> | null;
	setTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
	getDidTrigger: () => boolean;
	setDidTrigger: (value: boolean) => void;
	onShortPress: () => void;
	onLongPress: () => void | Promise<void>;
	delayMs?: number;
};

/**
 * Retourne le clip Quran sous le curseur pour ouvrir l'édition WBW.
 *
 * @returns {SubtitleClip | null} Clip Quran cible, sinon `null`.
 */
export function resolveManualWordByWordTargetClip(): SubtitleClip | null {
	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length <= 0) return null;

	const cursorPosition = globalState.getTimelineState.cursorPosition;
	const clipUnderCursor = subtitleTrack.getCurrentClip(cursorPosition);
	if (clipUnderCursor instanceof SubtitleClip) {
		return clipUnderCursor;
	}

	return null;
}

/**
 * Lance l'ouverture du mode WBW manuel depuis le raccourci `E`.
 *
 * @returns {Promise<void>}
 */
export async function openManualWordByWordEditFromShortcut(): Promise<void> {
	const clip = resolveManualWordByWordTargetClip();
	if (!clip) return;

	const success = await enterManualWordByWordEdit(clip);
	if (!success) {
		toast.error(get(LL).editor.cannotEnterWordEditMode());
	}
}

/**
 * Démarre le timer d'appui long du raccourci d'édition.
 *
 * @param {KeyboardEvent} event Événement natif du raccourci.
 * @param {ManualWbwShortcutHandlers} handlers Handlers et état mutable.
 * @returns {void}
 */
export function handleManualWordByWordEditShortcutKeyDown(
	event: KeyboardEvent,
	handlers: ManualWbwShortcutHandlers
): void {
	if (event.repeat || handlers.getTimer()) return;

	handlers.setDidTrigger(false);
	const delay = handlers.delayMs ?? 500;
	const timer = setTimeout(() => {
		handlers.setTimer(null);
		handlers.setDidTrigger(true);
		void handlers.onLongPress();
	}, delay);
	handlers.setTimer(timer);
}

/**
 * Termine le raccourci d'édition et décide entre appui court et appui long.
 *
 * @param {ManualWbwShortcutHandlers} handlers Handlers et état mutable.
 * @returns {void}
 */
export function handleManualWordByWordEditShortcutKeyUp(handlers: ManualWbwShortcutHandlers): void {
	const timer = handlers.getTimer();
	if (timer) {
		clearTimeout(timer);
		handlers.setTimer(null);
		if (!handlers.getDidTrigger()) {
			handlers.onShortPress();
		}
	}

	handlers.setDidTrigger(false);
}

/**
 * Synchronise la sélection WBW locale depuis un mot cliqué dans le sélecteur de verset.
 *
 * @param {number} wordIndex Index 0-based du mot cliqué dans le verset.
 * @param {SubtitlesEditorStateAccessor} subtitlesEditorState Accesseur local.
 * @returns {boolean} `true` si le clic a été consommé par le mode WBW.
 */
export function syncManualWordByWordSelectionFromVerseWord(
	wordIndex: number,
	subtitlesEditorState: SubtitlesEditorStateAccessor
): boolean {
	if (!globalState.shared.wbwEdit.active) return false;

	const editSubtitle = subtitlesEditorState().editSubtitle;
	if (!(editSubtitle instanceof SubtitleClip)) return false;
	if (
		subtitlesEditorState().selectedSurah !== editSubtitle.surah ||
		subtitlesEditorState().selectedVerse !== editSubtitle.verse
	) {
		return false;
	}
	if (wordIndex < editSubtitle.startWordIndex || wordIndex > editSubtitle.endWordIndex) {
		return false;
	}

	subtitlesEditorState().startWordIndex = wordIndex;
	subtitlesEditorState().endWordIndex = wordIndex;
	globalState.shared.wbwEdit.currentWordIndex = wordIndex - editSubtitle.startWordIndex;
	return true;
}

/**
 * Recale la sélection du sélecteur de verset sur le mot WBW courant.
 *
 * @param {SubtitlesEditorStateAccessor} subtitlesEditorState Accesseur local.
 * @returns {void}
 */
export function syncVerseSelectionWithManualWordByWordIndex(
	subtitlesEditorState: SubtitlesEditorStateAccessor
): void {
	if (!globalState.shared.wbwEdit.active) return;

	const editSubtitle = subtitlesEditorState().editSubtitle;
	if (!(editSubtitle instanceof SubtitleClip)) return;

	const wordIndex = editSubtitle.startWordIndex + globalState.shared.wbwEdit.currentWordIndex;
	subtitlesEditorState().startWordIndex = wordIndex;
	subtitlesEditorState().endWordIndex = wordIndex;
}

/**
 * Retourne le clip Quran actuellement édité en mode WBW manuel.
 *
 * @returns {SubtitleClip | null} Clip cible, sinon `null`.
 */
export function getActiveManualWordByWordClip(): SubtitleClip | null {
	const wbwEdit = globalState.shared.wbwEdit;
	if (!wbwEdit.active || wbwEdit.clipId === null || !globalState.currentProject) return null;

	const clip = globalState.getSubtitleTrack.clips.find(
		(trackClip) => trackClip instanceof SubtitleClip && trackClip.id === wbwEdit.clipId
	);
	return clip instanceof SubtitleClip ? clip : null;
}

/**
 * Quitte le mode d'édition WBW manuel et réinitialise son état runtime.
 *
 * @param {boolean} closeSubtitleEdit Indique s'il faut aussi quitter l'édition du sous-titre.
 * @returns {void}
 */
export function exitManualWordByWordEdit(closeSubtitleEdit = false): void {
	restoreTimelineZoomAfterManualWordByWordEdit();
	if (closeSubtitleEdit) {
		globalState.getSubtitlesEditorState.editSubtitle = null;
		globalState.getSubtitlesEditorState.pendingSplitEditNextId = null;
	}
	globalState.shared.wbwEdit.active = false;
	globalState.shared.wbwEdit.clipId = null;
	globalState.shared.wbwEdit.currentWordIndex = 0;
	globalState.shared.wbwEdit.draftWords = [];
	globalState.shared.wbwEdit.dragBoundaryIndex = null;
	globalState.shared.wbwEdit.previousTimelineZoom = null;
}

/**
 * Ferme le mode WBW si le clip cible n'est plus valide.
 *
 * @returns {void}
 */
export function ensureManualWordByWordEditStateIsValid(): void {
	const wbwEdit = globalState.shared.wbwEdit;
	if (!wbwEdit.active) return;
	if (!globalState.currentProject) {
		exitManualWordByWordEdit();
		return;
	}

	const clip = getActiveManualWordByWordClip();
	const editSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
	if (!(clip instanceof SubtitleClip) || !(editSubtitle instanceof SubtitleClip)) {
		exitManualWordByWordEdit();
		return;
	}

	if (clip.id !== editSubtitle.id) {
		exitManualWordByWordEdit();
	}
}

/**
 * Ouvre le mode WBW manuel pour un clip Quran cible.
 *
 * @param {SubtitleClip} clip Clip Quran à éditer.
 * @returns {Promise<boolean>} `true` si le mode a été ouvert.
 */
export async function enterManualWordByWordEdit(clip: SubtitleClip): Promise<boolean> {
	const draftWords = await buildManualWordByWordDraftWords(clip);
	if (draftWords.length === 0) return false;
	const hasExistingWordByWordTimestamps = (clip.alignmentMetadata?.words.length ?? 0) > 0;
	const timelineState = globalState.getTimelineState;
	if (!globalState.shared.wbwEdit.active) {
		globalState.shared.wbwEdit.previousTimelineZoom = timelineState.zoom;
	}
	timelineState.cursorPosition = clip.startTime;
	timelineState.zoom = 100;
	timelineState.movePreviewTo = timelineState.cursorPosition;
	globalState.getVideoPreviewState.scrollTimelineToCursor();

	globalState.getSubtitlesEditorState.editSubtitle = clip;
	globalState.shared.wbwEdit.active = true;
	globalState.shared.wbwEdit.clipId = clip.id;
	globalState.shared.wbwEdit.currentWordIndex = 0;
	globalState.shared.wbwEdit.draftWords = draftWords;
	globalState.shared.wbwEdit.dragBoundaryIndex = null;
	syncSubtitlesEditorSelectionToManualWordByWordIndex(clip);
	if (hasExistingWordByWordTimestamps) {
		syncManualWordByWordDraftToClip(clip, draftWords);
	}
	return true;
}

/**
 * Restaure le zoom timeline mémorisé avant l'entrée en mode WBW.
 *
 * @returns {void}
 */
function restoreTimelineZoomAfterManualWordByWordEdit(): void {
	const previousTimelineZoom = globalState.shared.wbwEdit.previousTimelineZoom;
	if (previousTimelineZoom === null || !globalState.currentProject) return;

	globalState.getTimelineState.zoom = previousTimelineZoom;
	globalState.getTimelineState.movePreviewTo = globalState.getTimelineState.cursorPosition;
	globalState.getVideoPreviewState.scrollTimelineToCursor();
}

/**
 * Déplace la sélection du mot courant dans la session WBW.
 *
 * @param {number} direction Direction de navigation (`-1` ou `1`).
 * @returns {void}
 */
export function moveManualWordByWordSelection(direction: number): void {
	const wbwEdit = globalState.shared.wbwEdit;
	if (!wbwEdit.active || wbwEdit.draftWords.length === 0) return;

	const nextIndex = Math.max(
		0,
		Math.min(wbwEdit.draftWords.length - 1, wbwEdit.currentWordIndex + direction)
	);
	wbwEdit.currentWordIndex = nextIndex;
}

/**
 * Décale la borne partagée entre deux mots du brouillon WBW.
 *
 * @param {number} boundaryIndex Index de la borne entre les mots `i` et `i + 1`.
 * @param {number} newBoundaryTimeS Nouvelle position relative au clip, en secondes.
 * @returns {void}
 */
export function updateManualWordByWordBoundary(
	boundaryIndex: number,
	newBoundaryTimeS: number
): void {
	const clip = getActiveManualWordByWordClip();
	const wbwEdit = globalState.shared.wbwEdit;
	if (!clip || !wbwEdit.active) return;
	if (boundaryIndex < 0 || boundaryIndex >= wbwEdit.draftWords.length - 1) return;

	const clipDurationS = getSubtitleClipDurationSeconds(clip);
	const draftWords = wbwEdit.draftWords.map((word) => ({ ...word }));
	const previousWord = draftWords[boundaryIndex];
	const nextWord = draftWords[boundaryIndex + 1];
	const minTimeS = previousWord.start;
	const maxTimeS = nextWord.end > nextWord.start ? nextWord.end : Math.max(minTimeS, clipDurationS);
	const boundaryTimeS = clampWordTime(newBoundaryTimeS, minTimeS, maxTimeS);

	previousWord.end = boundaryTimeS;
	nextWord.start = boundaryTimeS;

	applyManualWordByWordDraftUpdate(
		clip,
		normalizeManualWordByWordDraftWords(draftWords, clipDurationS)
	);
}

/**
 * Déplace le début du mot courant sur la position du curseur timeline.
 *
 * @returns {void}
 */
export function moveManualWordByWordSelectedWordStartToCursor(): void {
	const clip = getActiveManualWordByWordClip();
	const wbwEdit = globalState.shared.wbwEdit;
	if (!clip || !wbwEdit.active) return;

	const currentWordIndex = getManualWordByWordWordIndexAtCursor(clip);
	wbwEdit.currentWordIndex = currentWordIndex;
	if (currentWordIndex <= 0) return;

	updateManualWordByWordBoundary(currentWordIndex - 1, getCursorRelativeTimeForSubtitleClip(clip));
}

/**
 * Déplace la fin du mot courant sur la position du curseur timeline.
 *
 * @returns {void}
 */
export function moveManualWordByWordSelectedWordEndToCursor(): void {
	const clip = getActiveManualWordByWordClip();
	const wbwEdit = globalState.shared.wbwEdit;
	if (!clip || !wbwEdit.active) return;

	const currentWordIndex = getManualWordByWordWordIndexAtCursor(clip);
	wbwEdit.currentWordIndex = currentWordIndex;
	if (currentWordIndex >= wbwEdit.draftWords.length - 1) {
		setManualWordByWordLastWordEnd(clip, getCursorRelativeTimeForSubtitleClip(clip));
		return;
	}

	updateManualWordByWordBoundary(currentWordIndex, getCursorRelativeTimeForSubtitleClip(clip));
}

/**
 * Valide le mot courant à la position du curseur timeline.
 *
 * @returns {void}
 */
export function stampManualWordByWordCurrentWordAtCursor(): void {
	const clip = getActiveManualWordByWordClip();
	const wbwEdit = globalState.shared.wbwEdit;
	if (!clip || !wbwEdit.active || wbwEdit.draftWords.length === 0) return;

	const clipDurationS = getSubtitleClipDurationSeconds(clip);
	const draftWords = wbwEdit.draftWords.map((word) => ({ ...word }));
	const currentWord = draftWords[wbwEdit.currentWordIndex];
	if (!currentWord) return;

	const boundaryTimeS = clampWordTime(
		getCursorRelativeTimeForSubtitleClip(clip),
		currentWord.start,
		clipDurationS
	);
	currentWord.end = boundaryTimeS;

	if (wbwEdit.currentWordIndex === draftWords.length - 2) {
		draftWords[wbwEdit.currentWordIndex + 1].start = boundaryTimeS;
		draftWords[wbwEdit.currentWordIndex + 1].end = clipDurationS;
		applyManualWordByWordDraftUpdate(
			clip,
			normalizeManualWordByWordDraftWords(draftWords, clipDurationS)
		);
		refreshSegmentationContextFromTrack(false);
		exitManualWordByWordEdit(true);
		return;
	}

	if (wbwEdit.currentWordIndex < draftWords.length - 1) {
		draftWords[wbwEdit.currentWordIndex + 1].start = boundaryTimeS;
		applyManualWordByWordDraftUpdate(
			clip,
			normalizeManualWordByWordDraftWords(draftWords, clipDurationS)
		);
		wbwEdit.currentWordIndex += 1;
		syncSubtitlesEditorSelectionToManualWordByWordIndex(clip);
		return;
	}

	applyManualWordByWordDraftUpdate(
		clip,
		normalizeManualWordByWordDraftWords(draftWords, clipDurationS)
	);
	refreshSegmentationContextFromTrack(false);
	exitManualWordByWordEdit(true);
}

/**
 * Construit le brouillon WBW depuis la vraie plage Quran du clip.
 *
 * @param {SubtitleClip} clip Clip Quran à transformer en brouillon éditable.
 * @returns {Promise<ManualWordByWordDraftWord[]>} Liste des mots à éditer.
 */
export async function buildManualWordByWordDraftWords(
	clip: SubtitleClip
): Promise<ManualWordByWordDraftWord[]> {
	const verse = await Quran.getVerse(clip.surah, clip.verse);
	if (!verse) return [];

	const expectedWords = verse.words
		.slice(clip.startWordIndex, clip.endWordIndex + 1)
		.map((word, index) => ({
			location: `${clip.surah}:${clip.verse}:${clip.startWordIndex + index + 1}`,
			word: word.arabic,
			start: index === 0 ? 0 : 0,
			end: 0
		}));

	const existingWords = clip.alignmentMetadata?.words ?? [];
	if (existingWords.length !== expectedWords.length) {
		const clipDurationS = getSubtitleClipDurationSeconds(clip);
		return expectedWords.map((word, index) => ({
			...word,
			// Le premier mot couvre tout le segment au depart, les suivants restent parques a la fin
			// pour un rendu visuel progressif lors de la creation manuelle.
			start: index === 0 ? 0 : clipDurationS,
			end: clipDurationS
		}));
	}

	return normalizeManualWordByWordDraftWords(
		expectedWords.map((word, index) => ({
			...word,
			start: existingWords[index]?.start ?? word.start,
			end: existingWords[index]?.end ?? word.end
		})),
		getSubtitleClipDurationSeconds(clip)
	);
}

/**
 * Retourne la durée d'un clip Quran en secondes.
 *
 * @param {SubtitleClip} clip Clip cible.
 * @returns {number} Durée positive du clip.
 */
export function getSubtitleClipDurationSeconds(clip: SubtitleClip): number {
	return Math.max(0, (clip.endTime - clip.startTime) / 1000);
}

/**
 * Retourne la position relative du curseur dans un clip Quran.
 *
 * @param {SubtitleClip} clip Clip cible.
 * @returns {number} Temps relatif au clip, en secondes.
 */
export function getCursorRelativeTimeForSubtitleClip(clip: SubtitleClip): number {
	return clampWordTime(
		(globalState.getTimelineState.cursorPosition - clip.startTime) / 1000,
		0,
		getSubtitleClipDurationSeconds(clip)
	);
}

/**
 * Retourne l'index du mot WBW actuellement sous le curseur timeline.
 *
 * @param {SubtitleClip} clip Clip Quran cible.
 * @param {ManualWordByWordDraftWord[]} draftWords Brouillon source.
 * @returns {number} Index du mot courant sous le curseur.
 */
function getManualWordByWordWordIndexAtCursor(
	clip: SubtitleClip,
	draftWords: ManualWordByWordDraftWord[] = globalState.shared.wbwEdit.draftWords
): number {
	if (draftWords.length === 0) return 0;

	const cursorTimeS = getCursorRelativeTimeForSubtitleClip(clip);
	const matchingIndex = draftWords.findIndex((word, index) => {
		const isLastWord = index === draftWords.length - 1;
		return cursorTimeS >= word.start && (cursorTimeS <= word.end || isLastWord);
	});

	if (matchingIndex !== -1) return matchingIndex;
	if (cursorTimeS <= draftWords[0].start) return 0;
	return draftWords.length - 1;
}

/**
 * Recale le sélecteur de mots sur le mot WBW actuellement actif.
 *
 * @param {SubtitleClip} clip Clip Quran cible.
 * @returns {void}
 */
function syncSubtitlesEditorSelectionToManualWordByWordIndex(clip: SubtitleClip): void {
	const selectedWordIndex = clip.startWordIndex + globalState.shared.wbwEdit.currentWordIndex;
	globalState.getSubtitlesEditorState.selectedSurah = clip.surah;
	globalState.getSubtitlesEditorState.selectedVerse = clip.verse;
	globalState.getSubtitlesEditorState.startWordIndex = selectedWordIndex;
	globalState.getSubtitlesEditorState.endWordIndex = selectedWordIndex;
}

/**
 * Normalise un brouillon WBW pour garder une chaîne continue et non décroissante.
 *
 * @param {ManualWordByWordDraftWord[]} draftWords Brouillon source.
 * @param {number} clipDurationS Durée du clip, en secondes.
 * @returns {ManualWordByWordDraftWord[]} Brouillon nettoyé.
 */
function normalizeManualWordByWordDraftWords(
	draftWords: ManualWordByWordDraftWord[],
	clipDurationS: number
): ManualWordByWordDraftWord[] {
	let previousEnd = 0;
	return draftWords.map((word, index) => {
		const start = index === 0 ? 0 : clampWordTime(word.start, previousEnd, clipDurationS);
		const isLastWord = index === draftWords.length - 1;
		const end = isLastWord ? clipDurationS : clampWordTime(word.end, start, clipDurationS);
		previousEnd = end;
		return {
			...word,
			start,
			end
		};
	});
}

/**
 * Répercute le brouillon WBW courant sur le clip cible et sur l'état runtime.
 *
 * @param {SubtitleClip} clip Clip Quran cible.
 * @param {ManualWordByWordDraftWord[]} draftWords Brouillon à appliquer.
 * @returns {void}
 */
function applyManualWordByWordDraftUpdate(
	clip: SubtitleClip,
	draftWords: ManualWordByWordDraftWord[]
): void {
	globalState.shared.wbwEdit.draftWords = draftWords;
	syncManualWordByWordDraftToClip(clip, draftWords);
}

/**
 * Synchronise le brouillon WBW dans `alignmentMetadata.words`.
 *
 * @param {SubtitleClip} clip Clip Quran cible.
 * @param {ManualWordByWordDraftWord[]} draftWords Brouillon à persister.
 * @returns {void}
 */
function syncManualWordByWordDraftToClip(
	clip: SubtitleClip,
	draftWords: ManualWordByWordDraftWord[]
): void {
	const segment: SegmentationSegment = {
		segment: clip.alignmentMetadata?.segment ?? 0,
		ref_from: `${clip.surah}:${clip.verse}:${clip.startWordIndex + 1}`,
		ref_to: `${clip.surah}:${clip.verse}:${clip.endWordIndex + 1}`,
		matched_text: clip.text,
		time_from: clip.startTime / 1000,
		time_to: clip.endTime / 1000
	};

	markWordByWordEditAsManual(clip);
	clip.needsWbwTimestampReview = false;
	clip.alignmentMetadata = buildSubtitleAlignmentMetadata(
		clip.alignmentMetadata?.source ?? 'local',
		segment,
		draftWords
	) ?? {
		source: clip.alignmentMetadata?.source ?? 'local',
		segment: segment.segment ?? 0,
		refFrom: segment.ref_from ?? '',
		refTo: segment.ref_to ?? '',
		matchedText: segment.matched_text ?? '',
		timeFrom: segment.time_from ?? 0,
		timeTo: segment.time_to ?? 0,
		words: draftWords
	};

	globalState.currentProject?.detail.updateVideoDetailAttributes();
	globalState.updateVideoPreviewUI();
}

/**
 * Applique les flags "manuel" du clip sans effacer ses mots WBW.
 *
 * @param {SubtitleClip} clip Clip Quran édité manuellement.
 * @returns {void}
 */
function markWordByWordEditAsManual(clip: SubtitleClip): void {
	clip.comeFromIA = false;
	clip.confidence = null;
	clip.needsReview = false;
	clip.needsCoverageReview = false;
	clip.needsLongReview = false;
	clip.hasBeenVerified = false;
	// Marque les timings WBW comme édités à la main pour les protéger du re-MFA automatique.
	clip.wbwTimestampsManuallyEdited = true;
}

/**
 * Définit la fin du dernier mot du brouillon WBW.
 *
 * @param {SubtitleClip} clip Clip Quran actif.
 * @param {number} newEndTimeS Nouvelle fin relative.
 * @returns {void}
 */
function setManualWordByWordLastWordEnd(clip: SubtitleClip, newEndTimeS: number): void {
	const wbwEdit = globalState.shared.wbwEdit;
	if (wbwEdit.draftWords.length === 0) return;
	void newEndTimeS;

	const clipDurationS = getSubtitleClipDurationSeconds(clip);
	const draftWords = wbwEdit.draftWords.map((word) => ({ ...word }));
	const lastWord = draftWords[draftWords.length - 1];
	lastWord.end = clipDurationS;
	applyManualWordByWordDraftUpdate(
		clip,
		normalizeManualWordByWordDraftWords(draftWords, clipDurationS)
	);
}

/**
 * Borne un temps de mot dans un intervalle valide.
 *
 * @param {number} timeS Temps source en secondes.
 * @param {number} minTimeS Minimum autorisé.
 * @param {number} maxTimeS Maximum autorisé.
 * @returns {number} Temps borné.
 */
function clampWordTime(timeS: number, minTimeS: number, maxTimeS: number): number {
	return Math.max(minTimeS, Math.min(maxTimeS, timeS));
}
