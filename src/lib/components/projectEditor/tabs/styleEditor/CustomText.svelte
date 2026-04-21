<script lang="ts">
	import type { Category } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import CompositeText from './CompositeText.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';

	let { customText }: { customText: Category } = $props();

	let customTextSettings = $derived(() => {
		return {
			verticalPosition: customText.getStyle('vertical-position')?.value as number,
			horizontalPosition: customText.getStyle('horizontal-position')?.value as number,
			width: Number(customText.getStyle('width')?.value ?? 80),
			text: customText.getStyle('text')?.value as string,

			opacity: () =>
				getTimedOverlayOpacity({
					alwaysShow: Boolean(customText.getStyle('always-show')?.value),
					maxOpacity: Number(customText.getStyle('opacity')?.value ?? 1),
					currentTime: globalState.getTimelineState.cursorPosition,
					fadeDuration: globalState.getStyle('global', 'fade-duration')!.value as number,
					startTime: customText.getStyle('time-appearance')?.value as number,
					endTime: customText.getStyle('time-disappearance')?.value as number
				})
		};
	});

	const verticalStyle = customText.getStyle('vertical-position')!;
	const horizontalStyle = customText.getStyle('horizontal-position')!;
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
	class="absolute customtext cursor-move select-none z-10 text-center"
	style={`width: ${customTextSettings().width}% ; transform: translateY(${customTextSettings().verticalPosition}px) translateX(${customTextSettings().horizontalPosition}px); opacity: ${customTextSettings().opacity()}; `}
>
	<CompositeText compositeStyle={customText.getCompositeStyle()!}>
		{customTextSettings().text}
	</CompositeText>
</div>
