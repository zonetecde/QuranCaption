<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { convertFileSrc } from '@tauri-apps/api/core';

	const imagePath = $derived(() => {
		const val = globalState.getStyle('global', 'ayah-container-image')?.value;
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
		return globalState.getStyle('global', 'ayah-container-vertical-position')?.value as number;
	});

	const horizontalPosition = $derived(() => {
		return globalState.getStyle('global', 'ayah-container-horizontal-position')?.value as number;
	});

	const containerWidth = $derived(() => {
		return globalState.getStyle('global', 'ayah-container-width')?.value as number;
	});

	const containerHeight = $derived(() => {
		return globalState.getStyle('global', 'ayah-container-height')?.value as number;
	});

	const stretch = $derived(() => {
		return Boolean(globalState.getStyle('global', 'ayah-container-stretch')?.value);
	});

	const opacity = $derived(() => {
		return getTimedOverlayOpacity({
			alwaysShow: Boolean(globalState.getStyle('global', 'always-show')?.value),
			maxOpacity: 1,
			currentTime: globalState.getTimelineState.cursorPosition,
			fadeDuration: globalState.getStyle('global', 'fade-duration')!.value as number,
			startTime: globalState.getStyle('global', 'time-appearance')?.value as number,
			endTime: globalState.getStyle('global', 'time-disappearance')?.value as number
		});
	});

	const verticalStyle = globalState.getStyle('global', 'ayah-container-vertical-position')!;
	const horizontalStyle = globalState.getStyle('global', 'ayah-container-horizontal-position')!;
</script>

{#if imageSrc()}
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
