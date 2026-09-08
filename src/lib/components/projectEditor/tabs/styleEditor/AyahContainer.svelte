<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getTimedOverlayRanges } from '$lib/services/TimedOverlayRanges';
	import { convertFileSrc } from '@tauri-apps/api/core';

	const imagePath = $derived(() => {
		const val = globalState.getStyleValue('global', 'ayah-container-image');
		return val ? String(val) : null;
	});

	const imageSrc = $derived(() => {
		const path = imagePath();
		return path
			? path.includes('/') || path.includes('\\')
				? convertFileSrc(path)
				: '/ayah-container/' + path
			: null;
	});

	const verticalPosition = $derived(() => {
		return globalState.getStyleValue('global', 'ayah-container-vertical-position') as number;
	});

	const horizontalPosition = $derived(() => {
		return globalState.getStyleValue('global', 'ayah-container-horizontal-position') as number;
	});

	const containerWidth = $derived(() => {
		return globalState.getStyleValue('global', 'ayah-container-width') as number;
	});

	const containerHeight = $derived(() => {
		return globalState.getStyleValue('global', 'ayah-container-height') as number;
	});

	const stretch = $derived(() => {
		return Boolean(globalState.getStyleValue('global', 'ayah-container-stretch'));
	});

	const opacity = $derived(() => {
		return getTimedOverlayOpacity({
			alwaysShow: Boolean(globalState.getStyleValue('global', 'always-show')),
			maxOpacity: 1,
			currentTime: globalState.getTimelineState.cursorPosition,
			fadeDuration: globalState.getStyleValue('global', 'fade-duration') as number,
			ranges: getTimedOverlayRanges(
				globalState.getStyleValue('global', 'ayah-container-time-ranges'),
				globalState.getStyleValue('global', 'time-appearance'),
				globalState.getStyleValue('global', 'time-disappearance')
			),
			startTime: globalState.getStyleValue('global', 'time-appearance') as number,
			endTime: globalState.getStyleValue('global', 'time-disappearance') as number
		});
	});

	const verticalStyle = globalState.getStyle('global', 'ayah-container-vertical-position')!;
	const horizontalStyle = globalState.getStyle('global', 'ayah-container-horizontal-position')!;
</script>

{#if imageSrc()}
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
		class="absolute cursor-move select-none z-1"
		style="top: 50%; left: 50%; transform: translate(-50%, -50%) translateY({verticalPosition()}px) translateX({horizontalPosition()}px); width: {containerWidth()}%; height: {containerHeight()}%; opacity: {opacity()};"
	>
		<img
			src={imageSrc()}
			alt="Ayah container"
			class="w-full h-full"
			style="object-fit: {stretch() ? 'fill' : 'contain'};"
		/>
	</div>
{/if}
