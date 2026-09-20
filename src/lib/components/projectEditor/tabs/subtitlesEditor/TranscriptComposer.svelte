<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import {
		normalizeTranscriptWordTimings,
		type TranscriptAlignmentMetadata
	} from '$lib/classes/Clip.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { scheduleWbwRealign } from '$lib/services/AutoSegmentation';
	import {
		canRemoveProjectSpeaker,
		getVisibleProjectSpeakers,
		requestProjectSpeakerRemoval
	} from '$lib/services/SpeakerLibrary';
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import StructuredTranscriptEditor from './transcriptComposer/StructuredTranscriptEditor.svelte';
	import TranscriptBand from './TranscriptBand.svelte';
	import type { TranscriptBandSelection } from '$lib/services/TranscriptBandService';
	import ShortcutService from '$lib/services/ShortcutService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	// État d'orchestration du segment actif; le brouillon structuré appartient au composant enfant.
	let transcriptText = $state('');
	let loadedEditId: number | null = $state(null);
	let selectedTranscriptSelection = $state<TranscriptBandSelection | null>(null);
	let transcriptBandSelectionResetKey = $state(0);

	const editorState = $derived(() => globalState.getSubtitlesEditorState);
	const editedTranscript = $derived(() => {
		const clip = editorState().editSubtitle;
		return clip instanceof SubtitleClip ? clip : null;
	});
	const availableSpeakers = $derived(() => getVisibleProjectSpeakers());

	// Synchronise l'orchestration locale avec le segment choisi dans la timeline.
	$effect(() => {
		if (!editorState().selectedSpeaker.trim() && availableSpeakers()[0]) {
			editorState().selectedSpeaker = availableSpeakers()[0];
		}
	});

	$effect(() => {
		const clip = editedTranscript();
		if (clip && clip.id !== loadedEditId) {
			loadedEditId = clip.id;
			selectedTranscriptSelection = null;
			transcriptText = clip.text;
			editorState().selectedSpeaker = clip.speaker;
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

	function selectSpeaker(value: string): void {
		editorState().selectedSpeaker = value.trim();
	}

	async function deleteSpeaker(event: MouseEvent, value: string): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		await requestProjectSpeakerRemoval(value);
	}

	function cancelEditing(): void {
		editorState().editSubtitle = null;
		editorState().pendingSplitEditNextId = null;
		selectedTranscriptSelection = null;
		transcriptBandSelectionResetKey += 1;
		loadedEditId = null;
		transcriptText = '';
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
		if (selectedWords.length === 0) return null;

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
		const normalizedSpeaker = editorState().selectedSpeaker.trim();

		if (!normalizedText) {
			toast.error(get(LL).editor.transcriptCannotBeEmpty());
			return;
		}
		if (!normalizedSpeaker) {
			toast.error(get(LL).editor.speakerCannotBeEmpty());
			return;
		}

		const clip = editedTranscript();
		const textChanged = clip?.text !== normalizedText;
		const selectionAlignment = clip
			? buildSelectionAlignmentMetadata(clip, selectedTranscriptSelection, normalizedText)
			: null;
		/**
		 * Applique la modification et rattache les timestamps issus de la bande si nécessaire.
		 *
		 * @returns {boolean} `true` si la modification a réussi.
		 */
		const editTranscript = (): boolean => {
			if (!clip)
				return globalState.getSubtitleTrack.addTranscript(normalizedText, normalizedSpeaker);

			const success = globalState.getSubtitleTrack.editTranscript(
				clip,
				normalizedText,
				normalizedSpeaker
			);
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
		if (clip && textChanged && !selectionAlignment) scheduleWbwRealign([clip], { reason: 'text' });

		editorState().editSubtitle = null;
		editorState().pendingSplitEditNextId = null;
		selectedTranscriptSelection = null;
		transcriptBandSelectionResetKey += 1;
		loadedEditId = null;
		transcriptText = '';
		editorState().selectedSpeaker = normalizedSpeaker;
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
		if (!shortcut) {
			return () => window.removeEventListener('keydown', handleComposerEscape, true);
		}

		ShortcutService.registerShortcut({
			key: shortcut,
			onKeyDown: handleEditSubtitleShortcut
		});

		return () => {
			window.removeEventListener('keydown', handleComposerEscape, true);
			ShortcutService.unregisterShortcut(shortcut);
		};
	});

	onDestroy(() => {
		if (temporarySpeedShortcutActive) {
			globalState.getVideoPreviewState.setTemporaryPlaybackSpeed(false);
		}
	});
</script>

<svelte:window onkeydown={handleComposerKeydown} onkeyup={handleComposerKeyup} />

<div class="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-5 lg:p-8">
	<div class="space-y-3">
		<div class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-base text-accent-primary">person</span>
			{$LL.editor.speaker()}
		</div>

		<div class="flex flex-wrap items-center gap-2">
			{#each availableSpeakers() as candidate (candidate)}
				<div class="group/speaker relative inline-flex">
					<button
						type="button"
						class={`cursor-pointer rounded-full border py-2 px-4 text-sm font-semibold transition ${
							editorState().selectedSpeaker.toLocaleLowerCase() === candidate.toLocaleLowerCase()
								? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-black shadow-sm'
								: 'border-color bg-secondary text-secondary hover:border-[var(--accent-primary)] hover:bg-accent hover:text-primary'
						}`}
						onclick={() => selectSpeaker(candidate)}
					>
						{candidate}
					</button>
					{#if canRemoveProjectSpeaker(candidate)}
						<button
							type="button"
							class={'absolute -right-1 top-1 bg-secondary border-2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full opacity-0 transition hover:bg-black/15 group-hover/speaker:opacity-100 focus:opacity-100 ' +
								(editorState().selectedSpeaker === candidate
									? 'border-[var(--accent-primary)]'
									: 'border-color')}
							onclick={(event) => void deleteSpeaker(event, candidate)}
							aria-label={`Remove ${candidate}`}
							title={`Remove ${candidate} from the project`}
						>
							<span class="material-icons text-sm!">close</span>
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	{#key loadedEditId}
		<StructuredTranscriptEditor
			bind:value={transcriptText}
			isEditing={Boolean(editedTranscript())}
			onCancelEditing={cancelEditing}
			onSubmit={submitTranscript}
		/>
	{/key}

	<TranscriptBand
		editedClipId={editedTranscript()?.id ?? null}
		selectionResetKey={transcriptBandSelectionResetKey}
		onSelectRange={handleTranscriptBandSelection}
	/>
</div>
