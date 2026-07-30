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

<div
	class="bg-secondary relative mx-0.5 flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-color shadow"
>
	<!-- En-tête avec icône -->
	<div class="flex shrink-0 items-center gap-2 border-b border-color px-3 py-2.5">
		<span class="material-icons-outlined text-accent text-xl">upload_file</span>
		<h2 class="truncate text-base font-semibold text-primary">{$LL.export.exportHeading()}</h2>
	</div>

	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
		<div
			class="grid min-w-0 grid-cols-4 gap-1.5"
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
					class="group relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-1.5 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 ring-accent/70 hover:bg-white/10 hover:border-white/20 [&.selected]:border-accent/60 [&.selected]:bg-accent/10 cursor-pointer"
					class:selected={globalState.getExportState.selectedChoice === c.id}
					title={c.hint()}
				>
					<span
						class="material-icons-outlined text-lg opacity-80 transition-colors group-[.selected]:text-accent"
						>{c.icon}</span
					>
					<span
						class="line-clamp-2 text-[10px] font-medium leading-tight group-[.selected]:text-accent"
					>
						{c.label()}
					</span>
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
