<script lang="ts">
	import type { Category } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';

	let { customImage }: { customImage: Category } = $props();

	let customImageSettings = $derived(() => {
		return {
			verticalPosition: customImage.getStyle('vertical-position')?.value as number,
			horizontalPosition: customImage.getStyle('horizontal-position')?.value as number,
			filepath: customImage.getStyle('filepath')?.value as string,
			scale: customImage.getStyle('scale')?.value as number,

			opacity: () =>
				getTimedOverlayOpacity({
					alwaysShow: Boolean(customImage.getStyle('always-show')?.value),
					maxOpacity: Number(customImage.getStyle('opacity')?.value ?? 1),
					currentTime: globalState.getTimelineState.cursorPosition,
					fadeDuration: globalState.getStyle('global', 'fade-duration')!.value as number,
					startTime: customImage.getStyle('time-appearance')?.value as number,
					endTime: customImage.getStyle('time-disappearance')?.value as number
				})
		};
	});

	const verticalStyle = customImage.getStyle('vertical-position')!;
	const horizontalStyle = customImage.getStyle('horizontal-position')!;
</script>

<div
	use:mouseDrag={{
		getInitialVertical: () => Number(verticalStyle.value),
		applyVertical: (v: number) => (verticalStyle.value = v),
		applyHorizontal: (v: number) => (horizontalStyle.value = v),
		getInitialHorizontal: () => Number(horizontalStyle.value),
		verticalMin: verticalStyle.valueMin,
		verticalMax: verticalStyle.valueMax,
		horizontalMax: horizontalStyle.valueMax,
		horizontalMin: horizontalStyle.valueMin
	}}
	class={'absolute customtext cursor-move select-none ' +
		(customImage.getStyle('above-overlay')?.value ? 'z-5' : '-z-1')}
	style={`transform: translateY(${customImageSettings().verticalPosition}px) translateX(${customImageSettings().horizontalPosition}px) scale(${customImageSettings().scale}); opacity: ${customImageSettings().opacity()}; `}
>
	<img src={convertFileSrc(customImageSettings().filepath)} alt={customImageSettings().filepath} />
</div>
