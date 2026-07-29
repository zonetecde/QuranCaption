<script lang="ts">
	import type { Edition } from '$lib/classes';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { fetchTranslationsFromOtherProjects } from '$lib/services/TranslationFetchService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import toast from 'svelte-5-french-toast';
	import ModalManager from '$lib/components/modals/ModalManager';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);

	let { edition } = $props();
	const translationMetadata = $derived(() => globalState.getTranslationMetadata(edition.language));

	async function fetchFromOtherProjects(event: MouseEvent): Promise<void> {
		const project = globalState.currentProject!;
		const skipQC1Projects = event.ctrlKey || event.metaKey;
		const fetchPromise = ProjectHistoryManager.trackAsync('fetch translations', async () => {
			const result = await fetchTranslationsFromOtherProjects({
				targetProject: project,
				edition,
				sourceProjectDetails: globalState.userProjectsDetails,
				skipQC1Projects
			});
			return result.fetched;
		});

		toast.promise(fetchPromise, {
			loading: LL_.editor.fetchingTranslations() + (skipQC1Projects ? '(only QC2)' : ''),
			success: (count) => LL_.editor.successfullyFetched(),
			error: LL_.editor.failedToFetchTranslations()
		});
	}
</script>

<div
	class="bg-accent border border-color rounded-lg p-2 hover:border-accent-primary transition-all duration-200"
>
	<Section
		name={edition.author}
		icon={translationMetadata()?.flag || ''}
		classes="flex items-center"
	>
		<!-- Toggle pour afficher dans l'éditeur -->
		<div class="bg-secondary rounded-lg px-3 py-2 border border-color">
			<label
				class="text-sm font-medium text-secondary cursor-pointer flex items-center gap-3"
				for="showInTranslationsEditor"
			>
				<div class="relative">
					<input
						type="checkbox"
						bind:checked={edition.showInTranslationsEditor}
						class="w-5 h-5 rounded"
					/>
				</div>

				<div class="flex-1">
					<span
						class="block font-medium"
						onmousedown={(event) => {
							event.preventDefault();
							edition.showInTranslationsEditor = !edition.showInTranslationsEditor;
						}}
					>
						{$LL.editor.showInEditor()}
					</span>
				</div>
			</label>
		</div>

		<!-- Boutons d'action -->
		<div class="grid grid-cols-2 gap-x-2 mt-1.5">
			<button
				class="btn btn-icon px-4 py-2 text-sm font-medium flex-1 flex-row justify-center"
				onclick={() =>
					globalState.currentProject!.content.projectTranslation.removeTranslation(edition)}
			>
				<span class="material-icons text-base mr-1">delete</span>
				{$LL.common.remove()}
			</button>

			<button
				class="btn btn-icon px-4 py-2 text-sm flex-1 flex flex-row justify-center"
				onclick={() =>
					globalState.currentProject!.content.projectTranslation.resetTranslation(edition)}
			>
				<span class="material-icons text-base mr-1">refresh</span>
				{$LL.common.reset()}
			</button>

			<!-- IA -->
			<button
				class="btn btn-icon w-full px-4 py-2 text-sm flex-1 flex flex-row justify-center mt-1.5"
				onclick={(e) => {
					fetchFromOtherProjects(e);
				}}
				title={$LL.editor.fetchTranslations()}
			>
				<span class="material-icons text-base mr-2"> cloud_sync </span>
				{$LL.editor.fetchButton()}
			</button>
			<button
				class="btn btn-icon w-full px-4 py-2 text-sm flex-1 flex flex-row justify-center mt-1.5"
				onclick={() => void ModalManager.askTranslationModal(edition)}
			>
				<span class="material-icons text-base mr-2">auto_awesome</span>
				{$LL.editor.askAi()}
			</button>
		</div>

		{#if globalState.currentProject!.detail.translations[edition.author]}
			<div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1 mt-3">
				<span>{$LL.editor.percentageReviewed()}</span>
				<span class="font-medium text-[var(--text-primary)]"
					>{globalState.currentProject!.detail.translations[edition.author]}%</span
				>
			</div>
			<div class="bg-[var(--border-color)] rounded h-2 overflow-hidden">
				<div
					class="bg-[var(--accent-primary)] h-full rounded transition-all duration-300 ease-in-out"
					style="width: {globalState.currentProject!.detail.translations[edition.author]}%;"
				></div>
			</div>
		{/if}
	</Section>
</div>
