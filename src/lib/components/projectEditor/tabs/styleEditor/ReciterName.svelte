<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import RecitersManager from '$lib/classes/Reciter';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getTimedOverlayRanges } from '$lib/services/TimedOverlayRanges';
	import { resolveQuranTextTags } from '$lib/services/QuranTextTagResolver.svelte';

	const reciter = $derived(() => {
		return RecitersManager.getReciterObject(globalState.currentProject!.detail.reciter);
	});

	const fadeDuration = $derived(() => {
		return globalState.getStyleValue('global', 'fade-duration') as number;
	});

	let reciterNameSettings = $derived(() => {
		return {
			show: Boolean(globalState.getStyleValue('global', 'show-reciter-name')),
			alwaysShow: Boolean(globalState.getStyleValue('global', 'reciter-name-always-show')),
			startTime: globalState.getStyleValue('global', 'reciter-name-time-appearance') as number,
			endTime: globalState.getStyleValue('global', 'reciter-name-time-disappearance') as number,
			ranges: getTimedOverlayRanges(
				globalState.getStyleValue('global', 'reciter-name-time-ranges'),
				globalState.getStyleValue('global', 'reciter-name-time-appearance'),
				globalState.getStyleValue('global', 'reciter-name-time-disappearance')
			),
			size: globalState.getStyleValue('global', 'reciter-size') as number,
			showArabic: globalState.getStyleValue('global', 'reciter-show-arabic'),
			showLatin: globalState.getStyleValue('global', 'reciter-show-latin'),
			reciterLatinSpacing: globalState.getStyleValue('global', 'reciter-latin-spacing') as number,
			reciterNameFormat: globalState.getStyleValue('global', 'reciter-name-format') as string,
			verticalPosition: globalState.getStyleValue(
				'global',
				'reciter-name-vertical-position'
			) as number,
			horizontalPosition: globalState.getStyleValue(
				'global',
				'reciter-name-horizontal-position'
			) as number,
			opacity: globalState.getStyleValue('global', 'reciter-opacity'),
			color: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('text-color')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			outlineWidth: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('text-outline')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			outlineColor: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('text-outline-color')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			enableOutline: globalState
				.getStyle('global', 'reciter-latin-text-style')
				.getCompositeStyle('outline-enable')!
				.getValueAt(globalState.getTimelineState.cursorPosition)
		};
	});

	const timedReciterOpacity = $derived(() => {
		return getTimedOverlayOpacity({
			alwaysShow: reciterNameSettings().alwaysShow,
			maxOpacity: Number(reciterNameSettings().opacity ?? 1),
			currentTime: globalState.getTimelineState.cursorPosition,
			fadeDuration: fadeDuration(),
			ranges: reciterNameSettings().ranges,
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
		data-overlay-max-opacity={reciterNameSettings().opacity}
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
				{resolveQuranTextTags(reciterNameSettings().reciterNameFormat, {
					number: reciter().number,
					transliteration: reciter().latin,
					arabic: reciter().arabic
				})}
			</CompositeText>
		</div>
	</div>
{/if}
