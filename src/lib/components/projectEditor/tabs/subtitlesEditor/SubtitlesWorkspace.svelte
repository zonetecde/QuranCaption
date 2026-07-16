<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import TranscriptComposer from './TranscriptComposer.svelte';
	import TranscriptionToolbar from './TranscriptionToolbar.svelte';
</script>

<section
	data-tour-id="transcription-composer-area"
	class="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-color bg-primary shadow-lg"
	style="height: {globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight}%;"
>
	<TranscriptionToolbar />
	<div class="min-h-0 flex-1">
		<TranscriptComposer />
	</div>
</section>
