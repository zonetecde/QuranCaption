<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount, untrack } from 'svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { draw, fade } from 'svelte/transition';
	import CompositeText from './CompositeText.svelte';
	import RecitersManager from '$lib/classes/Reciter';

	const reciter = $derived(() => {
		return RecitersManager.getReciterObject(globalState.currentProject!.detail.reciter);
	});

	let reciterNameSettings = $derived(() => {
		return {
			show: globalState.getStyle('global', 'show-reciter-name')!.value,
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
</script>

{#if reciterNameSettings().show && reciter().latin !== 'not set'}
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
		style={`transform: translateY(${reciterNameSettings().verticalPosition}px) translateX(${reciterNameSettings().horizontalPosition}px); opacity: ${reciterNameSettings().opacity};`}
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
