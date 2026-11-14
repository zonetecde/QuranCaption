<script lang="ts">
	import type { Snippet } from 'svelte';
	import { roundedTextOutline } from '$lib/services/RoundedTextOutline';

	let { css, children }: { css: string; children: Snippet } = $props();
	// Séparer les halos du tracé conserve sa couleur et contourne leur incompatibilité dans WebKit.
	let separateLayers = $derived(css.includes('-webkit-text-stroke:'));
</script>

{#if separateLayers}
	<span class="native-text-effects">
		<span class="native-text-shadows" aria-hidden="true">{@render children()}</span>
		<span class="native-text-foreground" use:roundedTextOutline={css}>{@render children()}</span>
	</span>
{:else}
	{@render children()}
{/if}

<style>
	.native-text-effects {
		display: grid;
	}

	.native-text-shadows,
	.native-text-foreground {
		grid-area: 1 / 1;
		min-width: 0;
	}

	.native-text-shadows {
		z-index: 0;
		pointer-events: none;
		user-select: none;
	}

	.native-text-shadows,
	.native-text-shadows :global(*) {
		-webkit-text-fill-color: transparent !important;
		-webkit-text-stroke-width: 0 !important;
		paint-order: normal !important;
	}

	.native-text-foreground {
		position: relative;
		z-index: 1;
	}

	/* Le décor SVG ne doit pas fausser la hauteur ni le nombre de lignes du texte. */
	:global(.subtitle-layout-measurement) .native-text-foreground :global(.rounded-text-outline) {
		display: none;
	}

	.native-text-foreground,
	.native-text-foreground :global(*) {
		-webkit-text-stroke-width: 0 !important;
		text-shadow: none !important;
		text-decoration: none !important;
		background: none !important;
		box-shadow: none !important;
	}

	.native-text-foreground :global(*)::before,
	.native-text-foreground :global(*)::after {
		visibility: hidden !important;
	}
</style>
