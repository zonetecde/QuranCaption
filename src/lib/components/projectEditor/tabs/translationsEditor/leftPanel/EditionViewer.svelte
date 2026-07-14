<script lang="ts">
	import type { Edition } from '$lib/classes';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { get } from 'svelte/store';

	type TranslationCopy = {
		quranEdition: () => string;
	};

	let { edition }: { edition: Edition } = $props();
	const copy = get(LL).translations as unknown as TranslationCopy;
	const translationMetadata = $derived(() => globalState.getTranslationMetadata(edition.language));

	/**
	 * Réinitialise une langue dans une transaction undo/redo.
	 * @returns {Promise<void>} Promesse résolue après la réinitialisation.
	 */
	async function resetLanguage(): Promise<void> {
		await ProjectHistoryManager.trackAsync('reset translation language', async () => {
			await globalState.getProjectTranslation.resetTranslation(edition);
		});
	}

	/**
	 * Supprime une langue dans une transaction undo/redo.
	 * @returns {Promise<void>} Promesse résolue après la suppression.
	 */
	async function removeLanguage(): Promise<void> {
		await ProjectHistoryManager.trackAsync('remove translation language', async () => {
			await globalState.getProjectTranslation.removeTranslation(edition);
		});
	}
</script>

<div
	class="bg-accent border border-color rounded-lg p-2 hover:border-accent-primary transition-all duration-200"
>
	<Section
		name={edition.language}
		icon={translationMetadata()?.flag || ''}
		classes="flex items-center"
	>
		<div class="rounded-lg border border-color bg-secondary px-3 py-2">
			<p class="text-xs text-thirdly">{copy.quranEdition()}</p>
			<p class="mt-1 text-sm font-medium text-primary">{edition.quranEdition?.author ?? ''}</p>
		</div>

		<label
			class="mt-2 flex cursor-pointer items-center gap-3 rounded-lg border border-color bg-secondary px-3 py-2"
		>
			<input
				type="checkbox"
				checked={edition.showInTranslationsEditor}
				onchange={(event) => {
					ProjectHistoryManager.track('toggle translation language visibility', () => {
						edition.showInTranslationsEditor = event.currentTarget.checked;
					});
				}}
			/>
			<span class="text-sm text-secondary">{$LL.editor.showInEditor()}</span>
		</label>

		<div class="mt-2 grid grid-cols-2 gap-2">
			<button class="btn btn-icon px-3 py-2 text-sm" onclick={() => void removeLanguage()}>
				<span class="material-icons text-base">delete</span>
				{$LL.common.remove()}
			</button>
			<button class="btn btn-icon px-3 py-2 text-sm" onclick={() => void resetLanguage()}>
				<span class="material-icons text-base">refresh</span>
				{$LL.common.reset()}
			</button>
		</div>

		{#if globalState.currentProject!.detail.translations[edition.language] !== undefined}
			<div class="mt-3">
				<div class="mb-1 flex justify-between text-xs text-secondary">
					<span>{$LL.editor.percentageReviewed()}</span>
					<span>{globalState.currentProject!.detail.translations[edition.language]}%</span>
				</div>
				<div class="h-2 overflow-hidden rounded bg-[var(--border-color)]">
					<div
						class="h-full rounded bg-[var(--accent-primary)]"
						style={`width: ${globalState.currentProject!.detail.translations[edition.language]}%;`}
					></div>
				</div>
			</div>
		{/if}
	</Section>
</div>
