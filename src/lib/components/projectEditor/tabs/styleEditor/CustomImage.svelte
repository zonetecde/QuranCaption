<script lang="ts">
	import type { Category } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getTimedOverlayRangesFromStyles } from '$lib/services/TimedOverlayRanges';

	let { customImage, clipId }: { customImage: Category; clipId: number } = $props();

	let customImageSettings = $derived(() => {
		const time = globalState.getTimelineState.cursorPosition;
		return {
			verticalPosition: customImage.getStyle('vertical-position')?.getValueAt(time) as number,
			horizontalPosition: customImage.getStyle('horizontal-position')?.getValueAt(time) as number,
			filepath: customImage.getStyle('filepath')?.getValueAt(time) as string,
			scale: customImage.getStyle('scale')?.getValueAt(time) as number,

			opacity: () =>
				getTimedOverlayOpacity({
					alwaysShow: Boolean(customImage.getStyle('always-show')?.getValueAt(time)),
					maxOpacity: Number(customImage.getStyle('opacity')?.getValueAt(time) ?? 1),
					currentTime: globalState.getTimelineState.cursorPosition,
					fadeDuration: globalState.getStyleValue('global', 'fade-duration') as number,
					ranges: getTimedOverlayRangesFromStyles(customImage.styles),
					startTime: customImage.getStyle('time-appearance')?.getValueAt(time) as number,
					endTime: customImage.getStyle('time-disappearance')?.getValueAt(time) as number
				})
		};
	});

	const verticalStyle = $derived(customImage.getStyle('vertical-position')!);
	const horizontalStyle = $derived(customImage.getStyle('horizontal-position')!);
</script>

<div
	use:mouseDrag={{
		getInitialVertical: () =>
			Number(verticalStyle.getValueAt(globalState.getTimelineState.cursorPosition)),
		applyVertical: (v: number) =>
			verticalStyle.keyframes.length > 0
				? verticalStyle.setKeyframe(globalState.getTimelineState.cursorPosition, v)
				: (verticalStyle.value = v),
		applyHorizontal: (v: number) =>
			horizontalStyle.keyframes.length > 0
				? horizontalStyle.setKeyframe(globalState.getTimelineState.cursorPosition, v)
				: (horizontalStyle.value = v),
		getInitialHorizontal: () =>
			Number(horizontalStyle.getValueAt(globalState.getTimelineState.cursorPosition)),
		verticalMin: verticalStyle.valueMin,
		verticalMax: verticalStyle.valueMax,
		horizontalMax: horizontalStyle.valueMax,
		horizontalMin: horizontalStyle.valueMin
	}}
	class={'absolute customtext cursor-move select-none ' +
		(customImage.getStyle('above-overlay')?.getValueAt(globalState.getTimelineState.cursorPosition)
			? 'z-5'
			: '-z-1')}
	data-clip-id={clipId}
	data-overlay-max-opacity={Number(
		customImage.getStyle('opacity')?.getValueAt(globalState.getTimelineState.cursorPosition) ?? 1
	)}
	style={`transform: translateY(${customImageSettings().verticalPosition}px) translateX(${customImageSettings().horizontalPosition}px) scale(${customImageSettings().scale}); opacity: ${customImageSettings().opacity()}; `}
>
	<img src={convertFileSrc(customImageSettings().filepath)} alt={customImageSettings().filepath} />
</div>
