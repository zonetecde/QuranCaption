<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import ExportProjectData from './ExportProjectData.svelte';
	import ExportSubtitles from './ExportSubtitles.svelte';
	import ExportVideo from './ExportVideo.svelte';
	import ExportYtbChapters from './ExportYtbChapters.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { Quran } from '$lib/classes/Quran';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import toast from 'svelte-5-french-toast';
	import { invoke } from '@tauri-apps/api/core';

	type ExportChoiceId = 'video' | 'subtitles' | 'chapters' | 'project' | 'thumbnail';

	const LL_ = get(LL);
	let panelScale = $derived(
		1 + (globalState.settings?.persistentUiState.editorPanelScalePercent ?? -15) / 100
	);
	let thumbnailCopy = $derived(
		$LL.export as unknown as Record<
			| 'generateThumbnail'
			| 'thumbnailDescription'
			| 'thumbnailSummary'
			| 'thumbnailTranslationLanguage'
			| 'thumbnailOpen'
			| 'thumbnailOpenError'
			| 'thumbnailTemplates'
			| 'thumbnailTemplatesError',
			() => string
		>
	);
	let thumbnailTemplates = $state<{ hash: string; name: string; preview: string }[]>([]);
	let thumbnailTemplate = $state('');
	let thumbnailTemplatesStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let thumbnailSurah = $derived(globalState.currentProject!.detail.getProminentSurah());
	let thumbnailReciter = $derived(globalState.currentProject!.detail.reciter);
	let thumbnailLanguage = $derived(
		globalState.getProjectTranslation.addedTranslationEditions[0]?.language || 'English'
	);
	let thumbnailUrl = $derived.by(() => {
		const url = new URL('https://quranthumbnails.com/editor');
		if (thumbnailSurah) url.searchParams.set('surah', String(thumbnailSurah));
		if (thumbnailReciter && thumbnailReciter !== 'not set') {
			url.searchParams.set('reciter', thumbnailReciter);
		}
		url.searchParams.set('translationLanguage', thumbnailLanguage);
		url.hash = thumbnailTemplate;
		return url.toString();
	});

	// Export choices
	const choices: { id: ExportChoiceId; label: () => string; icon: string; hint: () => string }[] = [
		{
			id: 'video',
			label: () => LL_.export.videoExportOption(),
			icon: 'movie',
			hint: () => LL_.export.videoExportDescription()
		},
		{
			id: 'subtitles',
			label: () => LL_.export.subtitlesExportOption(),
			icon: 'subtitles',
			hint: () => LL_.export.subtitlesExportDescription()
		},
		{
			id: 'chapters',
			label: () => LL_.export.youtubeChaptersOption(),
			icon: 'schedule',
			hint: () => LL_.export.youtubeChaptersDescription()
		},
		{
			id: 'project',
			label: () => LL_.export.projectDataOption(),
			icon: 'folder',
			hint: () => LL_.export.projectDataDescription()
		},
		{
			id: 'thumbnail',
			label: () => thumbnailCopy.generateThumbnail(),
			icon: 'image',
			hint: () => thumbnailCopy.thumbnailOpen()
		}
	];

	function select(id: ExportChoiceId) {
		globalState.getExportState.selectedChoice = id;
	}

	$effect(() => {
		if (
			globalState.getExportState.selectedChoice === 'thumbnail' &&
			thumbnailTemplatesStatus === 'idle'
		) {
			void loadThumbnailTemplates();
		}
	});

	/**
	 * Lit les modèles proposés dans la galerie publique de Quran Thumbnails.
	 * @returns {Promise<void>} Promesse résolue après la mise à jour des modèles ou de l'erreur.
	 */
	async function loadThumbnailTemplates(): Promise<void> {
		thumbnailTemplatesStatus = 'loading';
		try {
			const templates = await invoke<typeof thumbnailTemplates>('get_thumbnail_templates');
			if (templates.length === 0) throw new Error('No thumbnail templates found');
			thumbnailTemplates = templates;
			thumbnailTemplatesStatus = 'ready';
		} catch (error) {
			console.error('Failed to load thumbnail templates:', error);
			thumbnailTemplatesStatus = 'error';
		}
	}

	/**
	 * Ouvre le créateur de miniatures avec les informations du projet.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture ou l'affichage d'une erreur.
	 */
	async function openThumbnailEditor(): Promise<void> {
		if (!thumbnailTemplate) return;
		try {
			await openUrl(thumbnailUrl);
		} catch (error) {
			console.error('Failed to open thumbnail editor:', error);
			toast.error(thumbnailCopy.thumbnailOpenError());
		}
	}
</script>

<div
	class="export-settings-scale bg-secondary relative flex h-full min-w-0 flex-1 flex-col overflow-hidden"
	style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
>
	<div class="min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden px-2 pb-0 pt-3">
		<div
			class="export-choice-tabs grid min-w-0 flex-shrink-0 grid-cols-[repeat(4,minmax(0,1fr))_2rem] gap-1.5"
			role="radiogroup"
			aria-label={$LL.export.exportType()}
			tabindex="0"
		>
			{#each choices as c (c.id)}
				<button
					type="button"
					role="radio"
					data-choice={c.id}
					aria-label={c.label()}
					aria-checked={globalState.getExportState.selectedChoice === c.id}
					onclick={() => select(c.id)}
					class="export-choice-tab"
					class:export-choice-tab-active={globalState.getExportState.selectedChoice === c.id}
					title={c.id === 'thumbnail' ? c.label() : c.hint()}
				>
					<span class="material-icons-outlined shrink-0 text-[16px]!" aria-hidden="true"
						>{c.icon}</span
					>
					{#if c.id !== 'thumbnail'}
						<span class="truncate">{c.label()}</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Dynamic panel depending on selection -->
		<div class="mt-3 min-h-0 min-w-0 flex-1 overflow-hidden">
			{#if globalState.getExportState.selectedChoice === 'video'}
				<ExportVideo />
			{:else if globalState.getExportState.selectedChoice === 'subtitles'}
				<ExportSubtitles />
			{:else if globalState.getExportState.selectedChoice === 'chapters'}
				<ExportYtbChapters />
			{:else if globalState.getExportState.selectedChoice === 'project'}
				<ExportProjectData />
			{:else if globalState.getExportState.selectedChoice === 'thumbnail'}
				<div class="flex h-full min-h-0 flex-col rounded-lg border border-color bg-secondary p-3">
					<div class="min-h-0 flex-1 overflow-y-auto">
						<h3 class="mb-2 text-lg font-semibold text-primary">
							{thumbnailCopy.generateThumbnail()}
						</h3>
						<p class="mb-6 text-sm text-thirdly">{thumbnailCopy.thumbnailDescription()}</p>
						<h4 class="mb-3 text-base font-medium text-secondary">
							{thumbnailCopy.thumbnailTemplates()}
						</h4>
						<div class="mb-6">
							{#if thumbnailTemplatesStatus === 'loading'}
								<p class="text-sm text-thirdly" role="status">{$LL.common.loading()}</p>
							{:else if thumbnailTemplatesStatus === 'error'}
								<p class="mb-2 text-sm text-thirdly" role="status">
									{thumbnailCopy.thumbnailTemplatesError()}
								</p>
								<button class="btn-secondary" onclick={loadThumbnailTemplates}
									>{$LL.common.retry()}</button
								>
							{:else if thumbnailTemplatesStatus === 'ready'}
								<div class="grid grid-cols-2 gap-2">
									{#each thumbnailTemplates as template, index (template.hash)}
										<button
											class="thumbnail-choice relative overflow-hidden rounded-lg border border-color bg-accent text-sm text-primary hover:border-accent cursor-pointer"
											class:selected={thumbnailTemplate === template.hash}
											class:col-span-2={thumbnailTemplates.length % 2 !== 0 &&
												index === thumbnailTemplates.length - 1}
											aria-pressed={thumbnailTemplate === template.hash}
											onclick={() => (thumbnailTemplate = template.hash)}
										>
											{#if template.preview}
												<img
													src={template.preview}
													alt=""
													class="aspect-video w-full object-cover"
													loading="lazy"
												/>
											{/if}
											<span class="block p-3">{template.name}</span>
											{#if thumbnailTemplate === template.hash}
												<span
													class="material-icons-outlined absolute top-2 right-2 rounded-full bg-secondary text-accent"
													aria-hidden="true">check_circle</span
												>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</div>
						<h4 class="mb-3 text-base font-medium text-secondary">
							{thumbnailCopy.thumbnailSummary()}
						</h4>
						<dl class="space-y-3 rounded-lg border border-color bg-accent p-4 text-sm">
							<div>
								<dt class="text-thirdly">{$LL.editor.surah()}</dt>
								<dd class="text-primary">
									{thumbnailSurah
										? `${thumbnailSurah} · ${Quran.surahs[thumbnailSurah - 1]?.name ?? ''}`
										: $LL.editor.notSet()}
								</dd>
							</div>
							<div>
								<dt class="text-thirdly">{$LL.home.reciter()}</dt>
								<dd class="break-words text-primary">
									{thumbnailReciter && thumbnailReciter !== 'not set'
										? thumbnailReciter
										: $LL.editor.notSet()}
								</dd>
							</div>
							<div>
								<dt class="text-thirdly">{thumbnailCopy.thumbnailTranslationLanguage()}</dt>
								<dd class="text-primary">
									{globalState.getProjectTranslation.addedTranslationEditions[0]?.language ||
										$LL.common.english()}
								</dd>
							</div>
						</dl>
					</div>
					<div class="mt-4 flex flex-shrink-0 justify-center border-t border-color pt-4">
						<button
							class="btn-accent flex items-center gap-2 w-full justify-center px-3 py-3 font-medium"
							onclick={openThumbnailEditor}
							disabled={!thumbnailTemplate}
						>
							{thumbnailCopy.thumbnailOpen()}
							<span class="material-icons-outlined text-base" aria-hidden="true">open_in_new</span>
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.export-settings-scale {
		max-width: 100%;
		zoom: var(--editor-panel-scale);
	}

	.export-choice-tab {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border: 1px solid var(--border-color);
		border-radius: 0.55rem;
		padding: 0.38rem 0.25rem;
		background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
		color: var(--text-secondary);
		font-size: 0.68rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: 150ms ease;
	}

	.export-choice-tab:hover {
		background: var(--bg-accent);
		color: var(--text-primary);
	}

	.export-choice-tab-active {
		border-color: color-mix(in srgb, var(--accent-primary) 70%, var(--border-color));
		background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-secondary));
		color: var(--accent-primary);
	}
	/* Priorité sur le fond imposé par la règle globale .selected. */
	.thumbnail-choice.selected {
		background-color: color-mix(in srgb, var(--accent-primary) 25%, var(--bg-secondary)) !important;
		border-color: var(--accent-primary);
		color: var(--accent-primary) !important;
		box-shadow: inset 0 0 0 2px var(--accent-primary);
	}
</style>
