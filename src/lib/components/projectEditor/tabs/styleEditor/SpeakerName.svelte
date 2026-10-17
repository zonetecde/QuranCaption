<script lang="ts">
	import { highlightStyleCategory } from '$lib/components/projectEditor/tabs/styleEditor/presets/actions/styleActions';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import SpeakersManager from '$lib/classes/Speaker';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getTimedOverlayRanges } from '$lib/services/TimedOverlayRanges';

	const speaker = $derived(() => {
		return SpeakersManager.getSpeakerObject(globalState.currentProject!.detail.speaker);
	});

	const fadeDuration = $derived(() => {
		return globalState.getStyleValue('global', 'fade-duration') as number;
	});

	let speakerNameSettings = $derived(() => {
		return {
			show: Boolean(globalState.getStyleValue('global', 'show-speaker-name')),
			alwaysShow: Boolean(globalState.getStyleValue('global', 'speaker-name-always-show')),
			startTime: globalState.getStyleValue('global', 'speaker-name-time-appearance') as number,
			endTime: globalState.getStyleValue('global', 'speaker-name-time-disappearance') as number,
			ranges: getTimedOverlayRanges(
				globalState.getStyleValue('global', 'speaker-name-time-ranges'),
				globalState.getStyleValue('global', 'speaker-name-time-appearance'),
				globalState.getStyleValue('global', 'speaker-name-time-disappearance')
			),
			size: globalState.getStyleValue('global', 'speaker-size') as number,
			showArabic: globalState.getStyleValue('global', 'speaker-show-arabic'),
			showLatin: globalState.getStyleValue('global', 'speaker-show-latin'),
			speakerLatinSpacing: globalState.getStyleValue('global', 'speaker-latin-spacing') as number,
			speakerNameFormat: globalState.getStyleValue('global', 'speaker-name-format') as string,
			verticalPosition: globalState.getStyleValue(
				'global',
				'speaker-name-vertical-position'
			) as number,
			horizontalPosition: globalState.getStyleValue(
				'global',
				'speaker-name-horizontal-position'
			) as number,
			opacity: globalState.getStyleValue('global', 'speaker-opacity'),
			color: globalState
				.getStyle('global', 'speaker-latin-text-style')
				.getCompositeStyle('text-color')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			outlineWidth: globalState
				.getStyle('global', 'speaker-latin-text-style')
				.getCompositeStyle('text-outline')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			outlineColor: globalState
				.getStyle('global', 'speaker-latin-text-style')
				.getCompositeStyle('text-outline-color')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			enableOutline: globalState
				.getStyle('global', 'speaker-latin-text-style')
				.getCompositeStyle('outline-enable')!
				.getValueAt(globalState.getTimelineState.cursorPosition)
		};
	});

	const timedSpeakerOpacity = $derived(() => {
		return getTimedOverlayOpacity({
			alwaysShow: speakerNameSettings().alwaysShow,
			maxOpacity: Number(speakerNameSettings().opacity ?? 1),
			currentTime: globalState.getTimelineState.cursorPosition,
			fadeDuration: fadeDuration(),
			ranges: speakerNameSettings().ranges,
			startTime: speakerNameSettings().startTime,
			endTime: speakerNameSettings().endTime
		});
	});
</script>

{#if speakerNameSettings().show && speaker().latin !== 'not set' && timedSpeakerOpacity() > 0}
	<div
		ondblclick={() => {
			highlightStyleCategory(globalState.currentProject!, 'global', 'speaker-name');
		}}
		use:mouseDrag={{
			target: 'global',
			verticalStyleId: 'speaker-name-vertical-position',
			horizontalStyleId: 'speaker-name-horizontal-position'
		}}
		class="w-[100px] absolute flex flex-col items-center cursor-move select-none z-10"
		data-overlay-max-opacity={speakerNameSettings().opacity}
		style={`transform: translateY(${speakerNameSettings().verticalPosition}px) translateX(${speakerNameSettings().horizontalPosition}px); opacity: ${timedSpeakerOpacity()};`}
	>
		{#if speaker().number !== -1}
			<p
				class="speakers-font"
				style={`opacity: ${speakerNameSettings().showArabic && speaker().number !== -1 ? 1 : 0} !important; font-size: ${speakerNameSettings().size}rem !important; ${globalState.getStyle('global', 'speaker-latin-text-style')!.generateCSSForComposite()}; font-family: 'Speakers' !important;`}
			>
				{speaker().number}
			</p>
		{:else}
			<p
				class="arabic w-[300px] text-center h-[155px] pt-7"
				style={`opacity: ${speakerNameSettings().showArabic ? 1 : 0}; font-size: ${speakerNameSettings().size / 2}rem;`}
			>
				{speaker().arabic}
			</p>
		{/if}

		<div
			class="w-[700px] text-center"
			style={`margin-top: ${-speakerNameSettings().speakerLatinSpacing}rem; opacity: ${speakerNameSettings().showLatin ? 1 : 0};`}
		>
			<CompositeText compositeStyle={globalState.getStyle('global', 'speaker-latin-text-style')!}>
				{speakerNameSettings()
					.speakerNameFormat.replace('<number>', speaker().toString())
					.replace('<transliteration>', speaker().latin)
					.replace('<arabic>', speaker().arabic)}
			</CompositeText>
		</div>
	</div>
{/if}
