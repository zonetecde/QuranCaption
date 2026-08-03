<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { enterManualWordByWordEdit, exitManualWordByWordEdit } from '$lib/services/WbwHelper';
	import VersePicker from '../projectEditor/tabs/subtitlesEditor/VersePicker.svelte';
	import WordsSelector from '../projectEditor/tabs/subtitlesEditor/WordsSelector.svelte';
	import SubtitlesWorkspace from '../projectEditor/tabs/subtitlesEditor/SubtitlesWorkspace.svelte';
	import SubtitlePresetPicker from '../projectEditor/tabs/subtitlesEditor/SubtitlePresetPicker.svelte';
	import TranslationInlineStylePanel from '../projectEditor/tabs/translationsEditor/TranslationInlineStylePanel.svelte';
	import ArabicText from '../projectEditor/tabs/translationsEditor/workspace/ArabicText.svelte';
	import Translation from '../projectEditor/tabs/translationsEditor/workspace/translation/Translation.svelte';
	import { onDestroy } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';

	let { close }: { close: () => void } = $props();

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
	const isTranslationMode = $derived(() => quickTimelineEditor().mode === 'translation');

	let isOpeningQuickWbwTimestampMode = $state(false);
	let isClosing = $state(false);
	let presetPickerOpen = $state(false);
	let subtitlesWorkspace: { addSubtitle: () => Promise<void> } | null = $state(null);
	let selectedWbwEditionName = $state('');

	// Initialise l'édition WBW sélectionnée avec la première édition visible.
	$effect(() => {
		const editions = editionsToShow();
		if (!selectedWbwEditionName && editions.length > 0) {
			selectedWbwEditionName = editions[0].name;
		}
	});

	// Ferme le modal quand active passe à false (appel externe depuis Navigator)
	$effect(() => {
		if (!quickTimelineEditor().active && !isClosing) {
			handleClose();
		}
	});

	$effect(() => {
		if (quickTimelineEditor().active && !clip()) {
			globalState.shared.quickTimelineEditor.active = false;
		}
	});

	$effect(() => {
		if (!quickTimelineEditor().active || !isSubtitleMode()) return;

		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (!(editedSubtitle instanceof SubtitleClip) || editedSubtitle.id !== clip()!.id) {
			globalState.shared.quickTimelineEditor.active = false;
		}
	});

	$effect(() => {
		if (!quickTimelineEditor().active || !isWbwTimestampMode() || !clip()) return;
		if (globalState.shared.wbwEdit.active || isOpeningQuickWbwTimestampMode) return;

		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (!(editedSubtitle instanceof SubtitleClip)) return;

		isOpeningQuickWbwTimestampMode = true;
		void (async () => {
			const success = await enterManualWordByWordEdit(clip()!);
			isOpeningQuickWbwTimestampMode = false;

			if (success) return;

			toast.error(get(LL).editor.cannotEnterWordEditMode());
			globalState.shared.quickTimelineEditor.active = false;
		})();
	});

	$effect(() => {
		if (!quickTimelineEditor().active || !isWbwTimestampMode()) return;

		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (!(editedSubtitle instanceof SubtitleClip) || editedSubtitle.id !== clip()!.id) {
			globalState.shared.quickTimelineEditor.active = false;
		}
	});

	/**
	 * Ferme le modal d'édition rapide.
	 * @returns {void}
	 */
	function handleClose(): void {
		if (isClosing) return;
		isClosing = true;

		const wasWbwTimestamp = isWbwTimestampMode();

		if (wasWbwTimestamp && globalState.shared.wbwEdit.active) {
			exitManualWordByWordEdit();
		}

		// Met en pause la lecture audio quand la modale WBW Timestamp se ferme.
		if (wasWbwTimestamp && globalState.getVideoPreviewState.isPlaying) {
			globalState.getVideoPreviewState.togglePlayPause();
		}

		globalState.shared.quickTimelineEditor.active = false;
		close();

		if (wasWbwTimestamp) {
			setTimeout(() => {
				globalState.getVideoPreviewState.scrollTimelineToCursor();
			}, 0);
		}
	}

	onDestroy(() => {
		if (quickTimelineEditor().active && !isClosing) {
			handleClose();
		}
	});
</script>

{#if clip()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="bg-secondary border-color border rounded-2xl w-full max-w-[95vw] shadow-2xl shadow-black flex flex-col relative overflow-hidden max-h-[85vh]"
		style="--translation-text-scale: 0.9; --translation-text-spacing-scale: 1;"
		use:mobileModalSheet={handleClose}
	>
		<!-- Header -->
		<div class="bg-gradient-to-r from-accent to-bg-accent px-4 py-3 border-b border-color">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					{#if isSubtitleMode()}
						<span class="material-icons text-accent-primary">subtitles</span>
						<h2 class="text-base font-bold text-primary">{$LL.editor.editSubtitleContext()}</h2>
					{:else if isWbwTimestampMode()}
						<span class="material-icons text-accent-primary">timeline</span>
						<h2 class="text-base font-bold text-primary">{$LL.editor.editWbwTimestampContext()}</h2>
					{:else if isWbwMode()}
						<span class="material-icons text-accent-primary">format_color_text</span>
						<h2 class="text-base font-bold text-primary">{$LL.editor.editWbwStyleContext()}</h2>
					{:else}
						<span class="material-icons text-accent-primary">translate</span>
						<h2 class="text-base font-bold text-primary">{$LL.editor.editTranslationContext()}</h2>
					{/if}
				</div>

				<button
					class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
					onclick={handleClose}
					aria-label={$LL.editor.closeButton()}
				>
					<span class="material-icons text-lg">close</span>
				</button>
			</div>
		</div>

		<!-- Body -->
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if isWbwTimestampMode()}
				<div class="min-h-0 flex-1 flex flex-col p-3">
					<div class="min-h-0 flex-1">
						<SubtitlesWorkspace
							bind:this={subtitlesWorkspace}
							useSplitHeight={false}
							showVersePicker={false}
							showPlaybackControls={true}
							onTogglePresetPicker={() => (presetPickerOpen = !presetPickerOpen)}
							onOpenAutoSegmentation={() => {}}
						/>
					</div>
					{#if presetPickerOpen}
						<div class="mt-3">
							<SubtitlePresetPicker
								onClose={() => (presetPickerOpen = false)}
								onAddQuranSubtitle={() => subtitlesWorkspace?.addSubtitle()}
							/>
						</div>
					{/if}
				</div>
			{:else if isSubtitleMode()}
				<div class="min-h-0 flex-1 flex flex-col p-3">
					<div class="min-h-0 flex-1">
						<SubtitlesWorkspace
							bind:this={subtitlesWorkspace}
							useSplitHeight={false}
							showVersePicker={true}
							showPlaybackControls={true}
							onTogglePresetPicker={() => (presetPickerOpen = !presetPickerOpen)}
							onOpenAutoSegmentation={() => {}}
						/>
					</div>
					{#if presetPickerOpen}
						<div class="mt-3">
							<SubtitlePresetPicker
								onClose={() => (presetPickerOpen = false)}
								onAddQuranSubtitle={() => subtitlesWorkspace?.addSubtitle()}
							/>
						</div>
					{/if}
				</div>
			{:else if isWbwMode()}
				<div class="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
					<ArabicText subtitle={clip()!} />

					{#each editionsToShow() as edition (edition.name)}
						<Translation {edition} subtitle={clip()!} previousSubtitle={previousSubtitle()} />
					{/each}
					<TranslationInlineStylePanel />
				</div>
			{:else}
				<div class="min-h-0 overflow-y-auto flex flex-col p-4">
					<section
						class="rounded-xl border border-color bg-secondary p-2 pt-4 text-primary space-y-6 flex-1"
					>
						<ArabicText subtitle={clip()!} />

						{#if editionsToShow().length === 0}
							<p class="text-sm text-thirdly">
								{$LL.editor.noTranslationEditionForClip()}
							</p>
						{:else}
							{#each editionsToShow() as edition (edition.name)}
								<Translation {edition} subtitle={clip()!} previousSubtitle={previousSubtitle()} />
							{/each}
						{/if}
					</section>
				</div>
			{/if}
		</div>
	</div>
{/if}
