<script lang="ts">
	import { Style } from '$lib/classes/VideoStyle.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { globalState } from '$lib/runes/main.svelte';
	import { getOverlayLayerOrder, setOverlayLayerPosition } from '$lib/services/OverlayLayerService';
	import NumberControl from './NumberControl.svelte';

	let { layerId }: { layerId: string } = $props();
	const order = $derived(getOverlayLayerOrder(globalState.currentProject!.content));
	const position = $derived(order.indexOf(layerId) + 1);
	const label = $derived(
		(get(LL).editor as unknown as Record<string, () => string>).overlayLayerOrder()
	);
	const sliderStyle = $derived(new Style({ valueMin: 1, valueMax: order.length, step: 1 }));
</script>

{#if position > 0}
	<div class="border-t border-color py-2" role="group" aria-label={label}>
		<div class="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
			<span class="material-icons-outlined text-[18px]! text-secondary">layers</span>
			<span>{label}</span>
		</div>
		<NumberControl
			style={sliderStyle}
			value={position}
			onChange={(value) => setOverlayLayerPosition(layerId, Number(value))}
		/>
	</div>
{/if}
