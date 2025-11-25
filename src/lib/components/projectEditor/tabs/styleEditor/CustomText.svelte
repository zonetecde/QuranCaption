<script lang="ts">
	import type { Category } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import CompositeText from './CompositeText.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';

	let { customText }: { customText: Category } = $props();

	let customTextSettings = $derived(() => {
		return {
			verticalPosition: customText.getStyle('vertical-position')?.value as number,
			horizontalPosition: customText.getStyle('horizontal-position')?.value as number,
			text: customText.getStyle('text')?.value as string,

			opacity: () => {
				const alwaysShow = customText.getStyle('always-show')?.value as number;
				const maxOpacity = Number(customText.getStyle('opacity')?.value ?? 1);

				// Si on veut toujours qu'il soit affiché, alors on retourne l'opacité max
				if (alwaysShow) return maxOpacity;

				const fadeDuration = globalState.getStyle('global', 'fade-duration')!.value as number;
				const currentTime = globalState.getTimelineState.cursorPosition;

				const startTime = customText.getStyle('time-appearance')?.value as number;
				const endTime = customText.getStyle('time-disappearance')?.value as number;

				// Avant l'apparition
				if (currentTime < startTime) return 0;

				// Si la durée de fondu est nulle ou négative, on bascule directement entre 0 et maxOpacity
				if (fadeDuration <= 0) {
					if (currentTime >= startTime && currentTime <= endTime) return maxOpacity;
					return 0;
				}

				// Fondu entrant : startTime -> startTime + fadeDuration
				if (currentTime >= startTime && currentTime < startTime + fadeDuration) {
					const t = (currentTime - startTime) / fadeDuration;
					return Math.max(0, Math.min(1, t)) * maxOpacity;
				}

				// Pleine opacité entre la fin du fondu entrant et le début du fondu sortant
				if (currentTime >= startTime + fadeDuration && currentTime < endTime - fadeDuration)
					return maxOpacity;

				// Fondu sortant : endTime - fadeDuration -> endTime
				if (currentTime >= endTime - fadeDuration && currentTime <= endTime) {
					const t = (endTime - currentTime) / fadeDuration;
					return Math.max(0, Math.min(1, t)) * maxOpacity;
				}

				// Après la disparition
				return 0;
			}
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
	class="absolute customtext cursor-move select-none z-10"
	style={`transform: translateY(${customTextSettings().verticalPosition}px) translateX(${customTextSettings().horizontalPosition}px); opacity: ${customTextSettings().opacity()}; `}
>
	<CompositeText compositeStyle={customText.getCompositeStyle()!}>
		{customTextSettings().text}
	</CompositeText>
</div>
