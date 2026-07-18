<script lang="ts">
	import BatchProgressBar from './BatchProgressBar.svelte';

	let {
		summary,
		progress,
		detail = null
	}: {
		summary: string;
		progress: number;
		detail?: string | null;
	} = $props();
</script>

<section class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
	<div class="flex flex-wrap justify-between gap-2 text-sm text-[var(--text-secondary)]">
		<span>{summary}</span>
		<span>{detail ? `${detail} · ` : ''}{progress}%</span>
	</div>
	<div class="mt-3">
		<BatchProgressBar {progress} />
	</div>
</section>
