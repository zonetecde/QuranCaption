<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import RecitersManager from '$lib/classes/Reciter';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';

	const reciter = $derived(() => {
		return RecitersManager.getReciterObject(globalState.currentProject!.detail.reciter);
	});

	const fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	let reciterNameSettings = $derived(() => {
		return {
			show: Boolean(globalState.getStyle('global', 'show-reciter-name')!.value),
			alwaysShow: Boolean(globalState.getStyle('global', 'reciter-name-always-show')!.value),
			startTime: globalState.getStyle('global', 'reciter-name-time-appearance')!.value as number,
			endTime: globalState.getStyle('global', 'reciter-name-time-disappearance')!.value as number,
			size: globalState.getStyle('global', 'reciter-size')!.value as number,
			showArabic: globalState.getStyle('global', 'reciter-show-arabic')!.value,
			showLatin: globalState.getStyle('global', 'reciter-show-latin')!.value,
			reciterLatinSpacing: globalState.getStyle('global', 'reciter-latin-spacing')!.value as number,
			reciterNameFormat: globalState.getStyle('global', 'reciter-name-format')!.value as string,
			verticalPosition: globalState.getStyle('global', 'reciter-name-vertical-position')!
				.value as number,
			horizontalPosition: globalState.getStyle('global', 'reciter-name-horizontal-position')!
				.value as number,
			opacity: globalState.getStyle('global', 'reciter-opacity')!.value,
			color: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('text-color')!.value,
			outlineWidth: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('text-outline')!.value,
			outlineColor: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('text-outline-color')!.value,
			enableOutline: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('outline-enable')!.value
		};
	});

	const timedReciterOpacity = $derived(() => {
		return getTimedOverlayOpacity({
			alwaysShow: reciterNameSettings().alwaysShow,
			maxOpacity: Number(reciterNameSettings().opacity ?? 1),
			currentTime: globalState.getTimelineState.cursorPosition,
			fadeDuration: fadeDuration(),
			startTime: reciterNameSettings().startTime,
			endTime: reciterNameSettings().endTime
		});
	});
</script>

{#if reciterNameSettings().show && reciter().latin !== 'not set' && timedReciterOpacity() > 0}
	<div
		ondblclick={() => {
			globalState.getVideoStyle.highlightCategory('global', 'reciter-name');
		}}
		use:mouseDrag={{
			target: 'global',
			verticalStyleId: 'reciter-name-vertical-position',
			horizontalStyleId: 'reciter-name-horizontal-position'
		}}
		class="w-[100px] absolute flex flex-col items-center cursor-move select-none z-10"
		style={`transform: translateY(${reciterNameSettings().verticalPosition}px) translateX(${reciterNameSettings().horizontalPosition}px); opacity: ${timedReciterOpacity()};`}
	>
		{#if reciter().number !== -1}
			<p
				class="reciters-font"
				style={`opacity: ${reciterNameSettings().showArabic && reciter().number !== -1 ? 1 : 0} !important; font-size: ${reciterNameSettings().size}rem !important; ${globalState.getStyle('global', 'reciter-latin-text-style')!.generateCSSForComposite()}; font-family: 'Reciters' !important;`}
			>
				{reciter().number}
			</p>
		{:else}
			<p
				class="arabic w-[300px] text-center h-[155px] pt-7"
				style={`opacity: ${reciterNameSettings().showArabic ? 1 : 0}; font-size: ${reciterNameSettings().size / 2}rem;`}
			>
				{reciter().arabic}
			</p>
		{/if}

		<div
			class="w-[700px] text-center"
			style={`margin-top: ${-reciterNameSettings().reciterLatinSpacing}rem; opacity: ${reciterNameSettings().showLatin ? 1 : 0};`}
		>
			<CompositeText compositeStyle={globalState.getStyle('global', 'reciter-latin-text-style')!}>
				{reciterNameSettings()
					.reciterNameFormat.replace('<number>', reciter().toString())
					.replace('<transliteration>', reciter().latin)
					.replace('<arabic>', reciter().arabic)}
			</CompositeText>
		</div>
	</div>
{/if}
