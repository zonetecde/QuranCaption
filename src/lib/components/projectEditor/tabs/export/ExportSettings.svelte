<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import ExportProjectData from './ExportProjectData.svelte';
	import ExportSubtitles from './ExportSubtitles.svelte';
	import ExportVideo from './ExportVideo.svelte';
	import ExportYtbChapters from './ExportYtbChapters.svelte';

	type ExportChoiceId = 'video' | 'subtitles' | 'chapters' | 'project';

	// Export choices (English labels & hints)
	const choices: { id: ExportChoiceId; label: string; icon: string; hint: string }[] = [
		{ id: 'video', label: 'Video', icon: 'movie', hint: 'Export full rendered video' },
		{
			id: 'subtitles',
			label: 'Subtitles',
			icon: 'subtitles',
			hint: 'Generate .srt / .vtt caption file'
		},
		{
			id: 'chapters',
			label: 'YouTube Chapters',
			icon: 'schedule',
			hint: 'Timestamped chapter list'
		},
		{ id: 'project', label: 'Project Data', icon: 'folder', hint: 'Export project raw data' }
	];

	function select(id: ExportChoiceId) {
		globalState.getExportState.selectedChoice = id;
	}
</script>

<div
	class="bg-secondary h-full border border-color mx-0.5 rounded-xl relative flex flex-col shadow overflow-auto"
>
	<!-- En-tête avec icône -->
	<div class="flex gap-x-2 items-center justify-center px-3 mb-2 mt-4">
		<span class="material-icons-outlined text-accent text-2xl">upload_file</span>
		<h2 class="text-xl font-semibold text-primary tracking-wide">Export</h2>
	</div>

	<div class="mt-4 px-3 pb-4">
		<div
			class="grid grid-cols-2 gap-3 mb-3"
			role="radiogroup"
			aria-label="Export type"
			tabindex="0"
		>
			{#each choices as c (c.id)}
				<button
					type="button"
					role="radio"
					data-choice={c.id}
					aria-checked={globalState.getExportState.selectedChoice === c.id}
					onclick={() => select(c.id)}
					class="group relative flex flex-col items-start rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 ring-accent/70 hover:bg-white/10 hover:border-white/20 [&.selected]:border-accent/60 [&.selected]:bg-accent/10 cursor-pointer group"
					class:selected={globalState.getExportState.selectedChoice === c.id}
					title={c.hint}
				>
					<div class="flex flex-row items-center gap-x-2">
						<span
							class="material-icons-outlined text-base md:text-lg opacity-80 group-[.selected]:text-accent transition-colors"
							>{c.icon}</span
						>
						<span class="flex flex-col">
							<span
								class="font-medium tracking-wide text-sm md:text-[0.83rem] group-[.selected]:text-accent"
								>{c.label}</span
							>
						</span>
					</div>

					<span
						class="max-h-0 mt-0 group-hover:mt-3 group-hover:max-h-40 opacity-0 group-hover:opacity-100 transition-all duration-200 md:text-xs text-secondary/70 leading-snug"
						>{c.hint}</span
					>

					{#if globalState.getExportState.selectedChoice === c.id}
						<span class="absolute top-2 right-2 material-icons-outlined text-accent text-sm"
							>check_circle</span
						>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Dynamic panel depending on selection -->
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
