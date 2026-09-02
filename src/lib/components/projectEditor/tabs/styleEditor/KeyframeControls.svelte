<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let {
		active,
		hasPrevious,
		hasNext,
		disabled = false,
		onPrevious,
		onToggle,
		onNext
	}: {
		active: boolean;
		hasPrevious: boolean;
		hasNext: boolean;
		disabled?: boolean;
		onPrevious: () => void;
		onToggle: () => void;
		onNext: () => void;
	} = $props();

	const copy = $derived(
		() =>
			get(LL).style as unknown as Record<
				'previousKeyframe' | 'addKeyframe' | 'removeKeyframe' | 'nextKeyframe',
				() => string
			>
	);
</script>

<div
	class="keyframe-controls"
	class:keyframe-controls-empty={!active && !hasPrevious && !hasNext}
	data-keyframe-controls
>
	{#if hasPrevious}
		<button
			type="button"
			class="keyframe-nav"
			{disabled}
			title={copy().previousKeyframe()}
			onclick={(event) => {
				event.stopPropagation();
				onPrevious();
			}}
		>
			<span class="material-icons-outlined">chevron_left</span>
		</button>
	{/if}
	<button
		type="button"
		class="keyframe-toggle"
		class:keyframe-toggle-active={active}
		{disabled}
		aria-pressed={active}
		title={active ? copy().removeKeyframe() : copy().addKeyframe()}
		onclick={(event) => {
			event.stopPropagation();
			onToggle();
		}}
	>
		<span class="keyframe-lozenge" aria-hidden="true"></span>
	</button>
	{#if hasNext}
		<button
			type="button"
			class="keyframe-nav"
			{disabled}
			title={copy().nextKeyframe()}
			onclick={(event) => {
				event.stopPropagation();
				onNext();
			}}
		>
			<span class="material-icons-outlined">chevron_right</span>
		</button>
	{/if}
</div>

<style>
	.keyframe-controls {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		padding: 2px;
		border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
		border-radius: 0.55rem;
		background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
	}

	.keyframe-controls button {
		display: grid;
		width: 1.45rem;
		height: 1.45rem;
		place-items: center;
		border-radius: 0.35rem;
		color: var(--text-secondary);
		transition:
			color 120ms ease,
			background 120ms ease,
			transform 120ms ease;
	}

	.keyframe-controls button:not(:disabled):hover {
		background: var(--bg-accent);
		color: var(--text-primary);
	}

	.keyframe-controls button:disabled {
		opacity: 0.3;
	}

	.keyframe-controls-empty {
		border-color: transparent;
	}

	.keyframe-controls-empty .keyframe-toggle {
		opacity: 0.4;
	}

	.keyframe-controls .material-icons-outlined {
		font-size: 1rem;
	}

	.keyframe-lozenge {
		width: 0.55rem;
		height: 0.55rem;
		border: 1.5px solid currentColor;
		transform: rotate(45deg);
	}

	.keyframe-toggle-active {
		background: color-mix(in srgb, var(--accent-primary) 22%, transparent);
		color: var(--accent-primary) !important;
	}

	.keyframe-toggle-active .keyframe-lozenge {
		background: currentColor;
	}

	.keyframe-toggle:not(:disabled):active {
		transform: scale(0.88);
	}
</style>
