<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import VersePicker from './VersePicker.svelte';
	import WordsSelector from './WordsSelector.svelte';
</script>

<section
	data-tour-id="verse-picker-area"
	class="overflow-hidden min-h-0 bg-primary border border-color rounded-lg shadow-lg"
	style="height: {globalState.currentProject!.projectEditorState.upperSectionHeight}%;"
>
	<div class="w-full h-full flex flex-col p-4">
		<!-- Sélecteur de verset -->
		<div class="flex-shrink-0 mb-4">
			<VersePicker />
		</div>

		<!-- Affichage des mots du verset - prend toute la hauteur restante -->
		<div class="flex-1 min-h-0">
			<WordsSelector />
		</div>
	</div>
</section>
