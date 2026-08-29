<script lang="ts">
	import type { Category } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import CompositeText from './CompositeText.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getTimedOverlayRangesFromStyles } from '$lib/services/TimedOverlayRanges';

	let { customText, clipId }: { customText: Category; clipId: number } = $props();

	let customTextSettings = $derived(() => {
		const time = globalState.getTimelineState.cursorPosition;
		return {
			verticalPosition: customText.getStyle('vertical-position')?.getValueAt(time) as number,
			horizontalPosition: customText.getStyle('horizontal-position')?.getValueAt(time) as number,
			width: Number(customText.getStyle('width')?.getValueAt(time) ?? 80),
			text: customText.getStyle('text')?.getValueAt(time) as string,

			opacity: () =>
				getTimedOverlayOpacity({
					alwaysShow: Boolean(customText.getStyle('always-show')?.getValueAt(time)),
					maxOpacity: Number(customText.getStyle('opacity')?.getValueAt(time) ?? 1),
					currentTime: globalState.getTimelineState.cursorPosition,
					fadeDuration: globalState.getStyleValue('global', 'fade-duration') as number,
					ranges: getTimedOverlayRangesFromStyles(customText.styles),
					startTime: customText.getStyle('time-appearance')?.getValueAt(time) as number,
					endTime: customText.getStyle('time-disappearance')?.getValueAt(time) as number
				})
		};
	});

	let verticalStyle = $derived(customText.getStyle('vertical-position')!);
	let horizontalStyle = $derived(customText.getStyle('horizontal-position')!);
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
	class="absolute customtext cursor-move select-none z-10 text-center"
	data-clip-id={clipId}
	data-overlay-max-opacity={Number(
		customText.getStyle('opacity')?.getValueAt(globalState.getTimelineState.cursorPosition) ?? 1
	)}
	style={`width: ${customTextSettings().width}% ; transform: translateY(${customTextSettings().verticalPosition}px) translateX(${customTextSettings().horizontalPosition}px); opacity: ${customTextSettings().opacity()}; `}
>
	<CompositeText compositeStyle={customText.getCompositeStyle()!}>
		{customTextSettings().text}
	</CompositeText>
</div>
