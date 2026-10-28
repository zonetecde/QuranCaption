<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import {
		normalizeTranscriptWordTimings,
		type TranscriptAlignmentMetadata
	} from '$lib/classes/Clip.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import StructuredTranscriptEditor from './transcriptComposer/StructuredTranscriptEditor.svelte';
	import TranscriptBand from './TranscriptBand.svelte';
	import type { TranscriptBandSelection } from '$lib/services/TranscriptBandService';
	import ShortcutService from '$lib/services/ShortcutService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import {
		ensureManualWordByWordEditStateIsValid,
		enterManualWordByWordEdit,
		exitManualWordByWordEdit,
		handleManualWordByWordEditShortcutKeyDown,
		handleManualWordByWordEditShortcutKeyUp,
		openManualWordByWordEditFromShortcut,
		moveManualWordByWordSelection,
		stampManualWordByWordCurrentWordAtCursor,
		type ManualWbwShortcutHandlers
	} from '$lib/services/WbwHelper';

	// État d'orchestration du segment actif; le brouillon structuré appartient au composant enfant.
	let transcriptText = $state('');
	let loadedEditId: number | null = $state(null);
	let selectedTranscriptSelection = $state<TranscriptBandSelection | null>(null);
	let transcriptBandSelectionResetKey = $state(0);
	let editShortcutTimer: ReturnType<typeof setTimeout> | null = null;
	let didTriggerManualEdit = false;
	const editShortcutHandlers: ManualWbwShortcutHandlers = {
		getTimer: () => editShortcutTimer,
		setTimer: (timer) => {
			editShortcutTimer = timer;
		},
		getDidTrigger: () => didTriggerManualEdit,
		setDidTrigger: (value) => {
			didTriggerManualEdit = value;
		},
		onShortPress: handleEditSubtitleShortcut,
		onLongPress: openManualWordByWordEditFromShortcut
	};

	const editorState = $derived(() => globalState.getSubtitlesEditorState);
	const editedTranscript = $derived(() => {
		const clip = editorState().editSubtitle;
		return clip instanceof SubtitleClip ? clip : null;
	});
	// Synchronise l'orchestration locale avec le segment choisi dans la timeline.
	$effect(() => {
		const clip = editedTranscript();
		if (clip && clip.id !== loadedEditId) {
			loadedEditId = clip.id;
			selectedTranscriptSelection = null;
			transcriptText = clip.text;
			return;
		}

		if (!clip && loadedEditId !== null) {
			loadedEditId = null;
			selectedTranscriptSelection = null;
			transcriptText = '';
		}
	});

	$effect(() => {
		const selection = selectedTranscriptSelection;
		if (!selection || transcriptText === selection.text) return;
		selectedTranscriptSelection = null;
		transcriptBandSelectionResetKey += 1;
	});

	function cancelEditing(): void {
		if (globalState.shared.wbwEdit.active) exitManualWordByWordEdit();
		editorState().editSubtitle = null;
		editorState().pendingSplitEditNextId = null;
		selectedTranscriptSelection = null;
		transcriptBandSelectionResetKey += 1;
		loadedEditId = null;
		transcriptText = '';
	}

	$effect(() => {
		ensureManualWordByWordEditStateIsValid();
	});

	/**
	 * Enregistre le texte courant avant d'ouvrir la saisie manuelle des timestamps.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture du mode WBW.
	 */
	async function openManualTimestamps(): Promise<void> {
		const clip = editedTranscript();
		if (!clip) return;
		const text = transcriptText.trim();
		if (!text) {
			toast.error(get(LL).editor.transcriptCannotBeEmpty());
			return;
		}
		if (text !== clip.text) {
			if (!globalState.getSubtitleTrack.editTranscript(clip, text)) return;
			globalState.currentProject!.detail.updateVideoDetailAttributes();
			globalState.updateVideoPreviewUI();
		}
		if (!(await enterManualWordByWordEdit(clip))) {
			toast.error(get(LL).editor.cannotEnterWordEditMode());
		}
	}

	/**
	 * Remplace le brouillon structuré par la plage choisie dans la bande transcript.
	 *
	 * @param {TranscriptBandSelection} selection Plage de mots sélectionnée.
	 * @returns {void}
	 */
	function handleTranscriptBandSelection(selection: TranscriptBandSelection): void {
		if (!editedTranscript() || !selection.text) return;
		selectedTranscriptSelection = selection;
		transcriptText = selection.text;
	}

	/**
	 * Construit les timestamps WBW correspondant à une sélection de la bande.
	 *
	 * @param {SubtitleClip} clip Sous-titre en cours d'édition.
	 * @param {TranscriptBandSelection | null} selection Sélection issue de la bande.
	 * @param {string} text Texte structuré sélectionné.
	 * @returns {TranscriptAlignmentMetadata | null} Métadonnées conservées ou `null`.
	 */
	function buildSelectionAlignmentMetadata(
		clip: SubtitleClip,
		selection: TranscriptBandSelection | null,
		text: string
	): TranscriptAlignmentMetadata | null {
		if (!selection) return null;
		const selectedWords = selection.words;
		if (selectedWords.length === 0 || selectedWords.some((word) => word.estimatedTiming))
			return null;

		const durationS = Math.max(0, (clip.endTime - clip.startTime) / 1000);
		const words = normalizeTranscriptWordTimings(
			selectedWords.map((word) => ({
				...(word.location ? { location: word.location } : {}),
				...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {}),
				word: word.text,
				start: Math.max(0, Math.min(durationS, (word.startMs - clip.startTime) / 1000)),
				end: Math.max(0, Math.min(durationS, (word.endMs - clip.startTime) / 1000))
			})),
			durationS
		);

		return {
			source: 'manual',
			segment: clip.alignmentMetadata?.segment,
			refFrom: clip.alignmentMetadata?.refFrom,
			refTo: clip.alignmentMetadata?.refTo,
			matchedText: text,
			specialType: clip.alignmentMetadata?.specialType,
			timeFrom: clip.startTime / 1000,
			timeTo: clip.endTime / 1000,
			words
		};
	}

	/**
	 * Ouvre ou ferme l'édition du sous-titre situé sous le curseur timeline.
	 *
	 * @returns {void}
	 */
	function handleEditSubtitleShortcut(): void {
		ProjectHistoryManager.track('edit subtitle shortcut', () => {
			const subtitleTrack = globalState.getSubtitleTrack;
			const clipUnderCursor = subtitleTrack.getCurrentClip(
				globalState.getTimelineState.cursorPosition
			);
			if (!(clipUnderCursor instanceof SubtitleClip)) return;
			const clip = clipUnderCursor;

			if (editorState().editSubtitle?.id === clip.id) {
				editorState().editSubtitle = null;
				return;
			}

			editorState().editSubtitle = clip;
		});
	}

	async function submitTranscript(): Promise<void> {
		const normalizedText = transcriptText.trim();

		if (!normalizedText) {
			toast.error(get(LL).editor.transcriptCannotBeEmpty());
			return;
		}

		const clip = editedTranscript();
		const selectionAlignment = clip
			? buildSelectionAlignmentMetadata(clip, selectedTranscriptSelection, normalizedText)
			: null;
		/**
		 * Applique la modification et rattache les timestamps issus de la bande si nécessaire.
		 *
		 * @returns {boolean} `true` si la modification a réussi.
		 */
		const editTranscript = (): boolean => {
			if (!clip) return globalState.getSubtitleTrack.addTranscript(normalizedText);

			const success = globalState.getSubtitleTrack.editTranscript(clip, normalizedText);
			if (success && selectionAlignment) {
				clip.alignmentMetadata = selectionAlignment;
				clip.wbwTimestampsManuallyEdited = true;
			}
			return success;
		};
		const success = selectionAlignment
			? ProjectHistoryManager.track('edit transcript from transcript band', editTranscript)
			: editTranscript();

		if (!success) return;

		globalState.currentProject!.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		toast.success(clip ? get(LL).editor.transcriptUpdated() : get(LL).editor.transcriptAdded());

		editorState().editSubtitle = null;
		editorState().pendingSplitEditNextId = null;
		selectedTranscriptSelection = null;
		transcriptBandSelectionResetKey += 1;
		loadedEditId = null;
		transcriptText = '';
	}

	// Les raccourcis de lecture restent au niveau du composeur afin de couvrir tous ses champs.
	let temporarySpeedShortcutActive = false;

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && editedTranscript()) {
			event.preventDefault();
			cancelEditing();
			return;
		}

		const isTypingTarget =
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			event.target instanceof HTMLSelectElement ||
			(event.target instanceof HTMLElement && event.target.isContentEditable);
		if (globalState.shared.wbwEdit.active && !isTypingTarget) {
			if (event.key === 'Enter') {
				event.preventDefault();
				if (!event.repeat) stampManualWordByWordCurrentWordAtCursor();
				return;
			}
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
					event.preventDefault();
					moveManualWordByWordSelection(event.key === 'ArrowRight' ? 1 : -1);
					return;
				}
			}
		}
		if (
			event.key.toLowerCase() === 's' &&
			editedTranscript() &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey &&
			!isTypingTarget
		) {
			event.preventDefault();
			event.stopPropagation();
			replaceEditedSubtitleWithSilence();
			return;
		}

		if (
			event.key === 'Enter' &&
			editedTranscript() &&
			!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) &&
			!(
				event.target instanceof Element &&
				event.target.closest('[data-structured-transcript-editor], [data-quran-passage-selector]')
			)
		) {
			event.preventDefault();
			void submitTranscript();
			return;
		}

		const hasSupportedModifier =
			(event.ctrlKey || event.shiftKey) && !event.altKey && !event.metaKey;
		if (!hasSupportedModifier) return;

		const key = event.key.toLowerCase();
		const isSpace = key === ' ' || event.code === 'Space';
		const isArrowLeft = key === 'arrowleft';
		const isArrowRight = key === 'arrowright';
		const isSpeedKey = key === 'pageup' || key === 'pagedown';
		if (!isSpace && !isArrowLeft && !isArrowRight && !isSpeedKey) return;

		event.preventDefault();
		event.stopPropagation();

		if (isSpace) {
			if (!event.repeat) globalState.getVideoPreviewState.togglePlayPause();
			return;
		}

		if (isArrowLeft || isArrowRight) {
			const offset = isArrowRight ? 2000 : -2000;
			const currentTime = globalState.getTimelineState.cursorPosition;
			const nextTime = Math.max(1, currentTime + offset);
			globalState.getTimelineState.cursorPosition = nextTime;
			globalState.getTimelineState.movePreviewTo = nextTime;
			globalState.getVideoPreviewState.scrollTimelineToCursor();
			return;
		}

		if (!event.repeat && !temporarySpeedShortcutActive) {
			temporarySpeedShortcutActive = true;
			globalState.getVideoPreviewState.setTemporaryPlaybackSpeed(true);
		}
	}

	function handleComposerKeyup(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		if ((key !== 'pageup' && key !== 'pagedown') || !temporarySpeedShortcutActive) return;

		event.preventDefault();
		event.stopPropagation();
		temporarySpeedShortcutActive = false;
		globalState.getVideoPreviewState.setTemporaryPlaybackSpeed(false);
	}

	/**
	 * Remplace le sous-titre en cours par un silence et valide l'édition.
	 *
	 * @returns {void}
	 */
	function replaceEditedSubtitleWithSilence(): void {
		const clip = editedTranscript();
		if (!clip) return;

		ProjectHistoryManager.track('replace subtitle with silence', () => {
			globalState.getSubtitleTrack.editSubtitleToSpecial(clip, 'Silence');
		});
		globalState.currentProject!.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		toast.success(get(LL).editor.subtitleUpdated());
		cancelEditing();
	}

	/**
	 * Quitte l'édition avant que les champs internes ne puissent intercepter Échap.
	 *
	 * @param {KeyboardEvent} event Événement clavier reçu en phase de capture.
	 * @returns {void}
	 */
	function handleComposerEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || event.defaultPrevented || !editedTranscript()) return;

		event.preventDefault();
		event.stopPropagation();
		cancelEditing();
	}

	onMount(() => {
		const shortcut = globalState.settings?.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE;
		window.addEventListener('keydown', handleComposerEscape, true);
		// Dans l'overlay rapide, la timeline conserve la gestion du raccourci E.
		if (!shortcut || globalState.shared.quickTimelineEditor.active) {
			return () => window.removeEventListener('keydown', handleComposerEscape, true);
		}

		ShortcutService.registerShortcut({
			key: shortcut,
			onKeyDown: (event) => handleManualWordByWordEditShortcutKeyDown(event, editShortcutHandlers),
			onKeyUp: () => handleManualWordByWordEditShortcutKeyUp(editShortcutHandlers)
		});

		return () => {
			window.removeEventListener('keydown', handleComposerEscape, true);
			ShortcutService.unregisterShortcut(shortcut);
		};
	});

	onDestroy(() => {
		if (editShortcutTimer) clearTimeout(editShortcutTimer);
		if (globalState.shared.wbwEdit.active && !globalState.shared.quickTimelineEditor.active) {
			exitManualWordByWordEdit();
		}
		if (temporarySpeedShortcutActive) {
			globalState.getVideoPreviewState.setTemporaryPlaybackSpeed(false);
		}
	});
</script>

<svelte:window onkeydown={handleComposerKeydown} onkeyup={handleComposerKeyup} />

<div class="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-5 lg:p-8">
	{#if globalState.shared.wbwEdit.active}
		<section class="flex flex-col gap-4 rounded-xl border border-yellow-400/30 bg-secondary p-4">
			<div class="flex items-start justify-between gap-3">
				<p>{$LL.editor.wbwTimestampGuide()}</p>
				<button
					type="button"
					class="shrink-0 cursor-pointer rounded-lg border border-color p-2 hover:bg-accent"
					onclick={cancelEditing}
					aria-label={$LL.editor.closeButton()}
				>
					<span class="material-icons-outlined">close</span>
				</button>
			</div>
			<div class="flex flex-wrap gap-2 text-2xl" dir="auto" data-manual-wbw-words>
				{#each globalState.shared.wbwEdit.draftWords as word, index (index)}
					<button
						type="button"
						class="cursor-pointer rounded-lg border px-3 py-2"
						class:border-yellow-400={index === globalState.shared.wbwEdit.currentWordIndex}
						class:bg-accent={index === globalState.shared.wbwEdit.currentWordIndex}
						aria-current={index === globalState.shared.wbwEdit.currentWordIndex
							? 'step'
							: undefined}
						onclick={() => {
							globalState.shared.wbwEdit.currentWordIndex = index;
						}}
					>
						{word.word}
					</button>
				{/each}
			</div>
		</section>
	{:else}
		{#key loadedEditId}
			<StructuredTranscriptEditor
				bind:value={transcriptText}
				isEditing={Boolean(editedTranscript())}
				onCancelEditing={cancelEditing}
				onSubmit={submitTranscript}
				onEditTimestamps={openManualTimestamps}
			/>
		{/key}

		<TranscriptBand
			editedClipId={editedTranscript()?.id ?? null}
			selectionResetKey={transcriptBandSelectionResetKey}
			onSelectRange={handleTranscriptBandSelection}
		/>
	{/if}
</div>
