<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import ExportProjectData from './ExportProjectData.svelte';
	import ExportSubtitles from './ExportSubtitles.svelte';
	import ExportVideo from './ExportVideo.svelte';
	import ExportYtbChapters from './ExportYtbChapters.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	type ExportChoiceId = 'video' | 'subtitles' | 'chapters' | 'project';

	const LL_ = get(LL);

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
		}
	];

	function select(id: ExportChoiceId) {
		globalState.getExportState.selectedChoice = id;
	}
</script>

<div class="bg-secondary relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
		<div
			class="export-choice-tabs grid min-w-0 grid-cols-4 gap-1.5"
			role="radiogroup"
			aria-label={$LL.export.exportType()}
			tabindex="0"
		>
			{#each choices as c (c.id)}
				<button
					type="button"
					role="radio"
					data-choice={c.id}
					aria-checked={globalState.getExportState.selectedChoice === c.id}
					onclick={() => select(c.id)}
					class="export-choice-tab"
					class:export-choice-tab-active={globalState.getExportState.selectedChoice === c.id}
					title={c.hint()}
				>
					<span class="material-icons-outlined text-[16px]!">{c.icon}</span>
					<span>{c.label()}</span>
				</button>
			{/each}
		</div>

		<p class="mt-2 text-xs leading-snug text-thirdly">
			{choices.find((choice) => choice.id === globalState.getExportState.selectedChoice)?.hint()}
		</p>

		<!-- Dynamic panel depending on selection -->
		<div class="mt-3 min-w-0">
			{#if globalState.getExportState.selectedChoice === 'video'}
				<ExportVideo />
			{:else if globalState.getExportState.selectedChoice === 'subtitles'}
				<ExportSubtitles />
			{:else if globalState.getExportState.selectedChoice === 'chapters'}
				<ExportYtbChapters />
			{:else if globalState.getExportState.selectedChoice === 'project'}
				<ExportProjectData />
			{/if}
		</div>
	</div>
</div>

<style>
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
</style>
