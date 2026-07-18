<script lang="ts">
	let {
		progress,
		indeterminate = false
	}: {
		progress: number;
		indeterminate?: boolean;
	} = $props();

	let normalizedProgress = $derived(Math.max(0, Math.min(100, progress)));
</script>

<div class="h-2 overflow-hidden rounded bg-[var(--border-color)]" aria-hidden="true">
	<div
		class:animate-pulse={indeterminate}
		class="h-full rounded bg-[var(--accent-primary)] transition-[width]"
		style={`width: ${indeterminate ? 100 : normalizedProgress}%`}
	></div>
</div>
