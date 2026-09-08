<script lang="ts">
	let { times, zoom, offset }: { times: number[]; zoom: number; offset: number } = $props();
</script>

{#each times as time (time)}
	<span
		class="keyframe-marker"
		data-keyframe-marker
		style:left={`${(time / 1000) * zoom + offset}px`}
		aria-hidden="true"
	></span>
{/each}

<style>
	.keyframe-marker {
		position: absolute;
		top: 14px;
		width: 6px;
		height: 6px;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 70%, white);
		background: var(--accent-primary);
		box-shadow: 0 0 4px color-mix(in srgb, var(--accent-primary) 55%, transparent);
		transform: translate(-50%, -50%) rotate(45deg);
		pointer-events: none;
		z-index: 12;
	}
</style>
