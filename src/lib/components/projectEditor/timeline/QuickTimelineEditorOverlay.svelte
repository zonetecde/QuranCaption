<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { enterManualWordByWordEdit, exitManualWordByWordEdit } from '$lib/services/WbwHelper';
	import VersePicker from '../tabs/subtitlesEditor/VersePicker.svelte';
	import WordsSelector from '../tabs/subtitlesEditor/WordsSelector.svelte';
	import TranslationInlineStylePanel from '../tabs/translationsEditor/TranslationInlineStylePanel.svelte';
	import ArabicText from '../tabs/translationsEditor/workspace/ArabicText.svelte';
	import Translation from '../tabs/translationsEditor/workspace/translation/Translation.svelte';
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';

	const quickTimelineEditor = $derived(() => globalState.shared.quickTimelineEditor);
	const translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);

	const clip = $derived(() => {
		const clipId = quickTimelineEditor().clipId;
		if (clipId === null) return null;

		const foundClip = globalState.getSubtitleTrack.getClipById(clipId);
		return foundClip instanceof SubtitleClip ? foundClip : null;
	});

	const clipIndex = $derived(() => {
		const currentClip = clip();
		if (!currentClip) return -1;
		return globalState.getSubtitleTrack.clips.findIndex(
			(trackClip) => trackClip.id === currentClip.id
		);
	});

	const previousSubtitle = $derived(() => {
		if (clipIndex() < 0) return undefined;
		return globalState.getSubtitleTrack.getSubtitleBefore(clipIndex()) ?? undefined;
	});

	const editionsToShow = $derived(() => {
		const editions =
			globalState.currentProject!.content.projectTranslation.addedTranslationEditions;
		const visibleEditions = editions.filter((edition) => edition.showInTranslationsEditor);
		return visibleEditions.length > 0 ? visibleEditions : editions;
	});

	const isWbwMode = $derived(() => quickTimelineEditor().mode === 'wbw');
	const isSubtitleMode = $derived(() => quickTimelineEditor().mode === 'subtitle');
	const isWbwTimestampMode = $derived(() => quickTimelineEditor().mode === 'wbwTimestamp');

	let isOpeningQuickWbwTimestampMode = $state(false);

	$effect(() => {
		if (quickTimelineEditor().active && !clip()) {
			globalState.closeQuickTimelineEditor();
		}
	});

	$effect(() => {
		if (!quickTimelineEditor().active || !isSubtitleMode()) return;

		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (!(editedSubtitle instanceof SubtitleClip) || editedSubtitle.id !== clip()!.id) {
			globalState.closeQuickTimelineEditor();
		}
	});

	$effect(() => {
		if (!quickTimelineEditor().active || !isWbwTimestampMode() || !clip()) return;
		if (globalState.shared.wbwEdit.active || isOpeningQuickWbwTimestampMode) return;

		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		// Évite de ré-entrer en mode WBW quand exitManualWordByWordEdit(true) a déjà
		// terminé l'édition et réinitialisé editSubtitle à null.
		if (!(editedSubtitle instanceof SubtitleClip)) return;

		isOpeningQuickWbwTimestampMode = true;
		void (async () => {
			const success = await enterManualWordByWordEdit(clip()!);
			isOpeningQuickWbwTimestampMode = false;

			if (success) return;

			toast.error('Unable to enter word-by-word edit mode for this subtitle.');
			globalState.closeQuickTimelineEditor();
		})();
	});

	$effect(() => {
		if (!quickTimelineEditor().active || !isWbwTimestampMode()) return;

		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (!(editedSubtitle instanceof SubtitleClip) || editedSubtitle.id !== clip()!.id) {
			globalState.closeQuickTimelineEditor();
		}
	});

	/**
	 * Ferme l'editeur rapide de la timeline.
	 * @returns {void}
	 */
	function closeQuickTimelineEditorOverlay(): void {
		if (isWbwTimestampMode() && globalState.shared.wbwEdit.active) {
			exitManualWordByWordEdit();
		}

		globalState.closeQuickTimelineEditor();
	}

	/**
	 * Empêche la timeline sous-jacente d'intercepter la molette quand l'overlay est ouvert.
	 * @param {WheelEvent} event Evenement de molette courant.
	 * @returns {void}
	 */
	function stopTimelineWheelPropagation(event: WheelEvent): void {
		event.stopPropagation();
	}

	/**
	 * Ferme l'overlay rapide avec Echap.
	 * @param {KeyboardEvent} event Evenement clavier courant.
	 * @returns {void}
	 */
	function handleQuickTimelineEditorEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !quickTimelineEditor().active) return;

		event.preventDefault();
		event.stopPropagation();
		closeQuickTimelineEditorOverlay();
	}

	/**
	 * Retourne le label lisible d'un raccourci configuré.
	 * @param {string[] | undefined} keys Liste des touches configurées.
	 * @param {string} fallback Texte de repli si aucune touche n'est définie.
	 * @returns {string} Raccourci formaté pour l'UI.
	 */
	function formatShortcutLabel(keys: string[] | undefined, fallback: string): string {
		if (!keys || keys.length === 0) return fallback;
		return keys.map((key) => key.toUpperCase()).join(' / ');
	}

	onMount(() => {
		window.addEventListener('keydown', handleQuickTimelineEditorEscape, true);

		return () => {
			window.removeEventListener('keydown', handleQuickTimelineEditorEscape, true);
		};
	});

	onDestroy(() => {
		if (quickTimelineEditor().active) {
			closeQuickTimelineEditorOverlay();
		}
	});
</script>

{#if clip()}
	<div
		class="absolute inset-0 z-[160] overflow-hidden border-t border-color bg-primary/95 backdrop-blur-sm"
		onwheel={stopTimelineWheelPropagation}
	>
		<div class="flex h-full min-h-0 flex-col">
			<button
				type="button"
				class="absolute top-0 left-0 h-6 w-6 shrink-0 items-center justify-center rounded-br-lg border border-color bg-accent text-secondary transition hover:text-primary"
				onclick={closeQuickTimelineEditorOverlay}
				aria-label="Close quick timeline editor"
				title="Close"
			>
				<span class="material-icons-outlined text-[13px]!">close</span>
			</button>

			<div
				class={`min-h-0 flex-1 ${
					isWbwMode() ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]' : 'flex flex-col'
				}`}
			>
				{#if isWbwTimestampMode()}
					<div class="min-h-0 overflow-y-auto">
						<section
							class="flex flex-col gap-3 rounded-xl border border-yellow-400/30 bg-secondary p-3"
						>
							<p>
								Play the audio using space, and press enter each time a word finishes being recited.
								Go to the subtitles editor for more options.
							</p>
							<div class="min-h-0">
								<WordsSelector />
							</div>
						</section>
					</div>
				{:else if isSubtitleMode()}
					<div
						class="min-h-0 flex-1 flex flex-col gap-4 rounded-xl border border-color bg-secondary overflow-hidden"
					>
						<VersePicker />
						<div class="min-h-0 flex-1">
							<WordsSelector />
						</div>
					</div>
				{:else}
					<div class="min-h-0 overflow-y-auto">
						<section
							class="rounded-xl border border-color bg-secondary p-2 pt-4 text-primary space-y-6"
						>
							<ArabicText subtitle={clip()!} />

							{#if editionsToShow().length === 0}
								<p class="text-sm text-thirdly">
									No translation edition is available for this clip.
								</p>
							{:else}
								{#each editionsToShow() as edition (edition.name)}
									<Translation {edition} subtitle={clip()!} previousSubtitle={previousSubtitle()} />
								{/each}
							{/if}
						</section>
					</div>
				{/if}

				{#if isWbwMode()}
					<div
						class="min-h-0 overflow-y-auto border-t border-color bg-secondary lg:border-t-0 lg:border-l"
					>
						<TranslationInlineStylePanel />
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
