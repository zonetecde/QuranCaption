<script lang="ts">
	import { Item } from 'svelte-contextmenu';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { moveOverlayLayer } from '$lib/services/OverlayLayerService';

	let { layerId }: { layerId: string } = $props();

	/**
	 * Déplace le calque par rapport aux éléments visibles de l'aperçu.
	 * @param {-1 | 1} direction Direction du déplacement.
	 * @returns {void}
	 */
	function move(direction: -1 | 1): void {
		const visibleIds = Array.from(
			document.querySelectorAll<HTMLElement>('#overlay [data-overlay-layer]')
		)
			.filter((element) => Number(getComputedStyle(element).opacity) > 0)
			.map((element) => element.dataset.overlayLayer!);
		moveOverlayLayer(layerId, direction, visibleIds);
	}
</script>

<Item onclick={() => move(1)}>
	<span class="material-icons-outlined">flip_to_front</span>
	{(get(LL).editor as unknown as Record<string, () => string>).moveLayerUp()}
</Item>
<Item onclick={() => move(-1)}>
	<span class="material-icons-outlined">flip_to_back</span>
	{(get(LL).editor as unknown as Record<string, () => string>).moveLayerDown()}
</Item>
