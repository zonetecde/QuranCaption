<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import TranslationInlineStylePanel from '../tabs/translationsEditor/TranslationInlineStylePanel.svelte';
	import ArabicText from '../tabs/translationsEditor/workspace/ArabicText.svelte';
	import Translation from '../tabs/translationsEditor/workspace/translation/Translation.svelte';
	import { onDestroy } from 'svelte';

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

	$effect(() => {
		if (quickTimelineEditor().active && !clip()) {
			globalState.closeQuickTimelineEditor();
		}
	});

	/**
	 * Ferme l'editeur rapide de la timeline.
	 * @returns {void}
	 */
	function closeQuickTimelineEditorOverlay(): void {
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

	onDestroy(() => {
		if (quickTimelineEditor().active) {
			globalState.closeQuickTimelineEditor();
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
				<div class="min-h-0 overflow-y-auto">
					<section
						class="rounded-xl border border-color bg-secondary p-2 pt-4 text-primary space-y-6"
					>
						<ArabicText subtitle={clip()!} />

						{#if editionsToShow().length === 0}
							<p class="text-sm text-thirdly">No translation edition is available for this clip.</p>
						{:else}
							{#each editionsToShow() as edition (edition.name)}
								<Translation {edition} subtitle={clip()!} previousSubtitle={previousSubtitle()} />
							{/each}
						{/if}
					</section>
				</div>

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
