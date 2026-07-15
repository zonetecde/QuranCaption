<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { globalState } from '$lib/runes/main.svelte';

	const transcriptCount = $derived(
		globalState.getSubtitleTrack.clips.filter((clip) => clip instanceof SubtitleClip).length
	);
</script>

<div
	class="h-full min-h-0 space-y-6 overflow-y-auto rounded-lg border border-r-0 border-color bg-secondary px-3 py-6"
>
	<div class="flex items-center justify-center gap-2">
		<span class="material-icons text-xl text-accent">record_voice_over</span>
		<h2 class="text-xl font-bold text-primary">{$LL.editor.transcription()}</h2>
	</div>

	<div class="space-y-3">
		<h3 class="text-sm font-medium text-secondary">{$LL.editor.playbackSpeed()}</h3>
		<div class="flex flex-wrap items-center justify-center gap-2">
			{#each [0.75, 1, 1.25, 1.5, 1.75, 2] as speed (speed)}
				<button
					type="button"
					class="cursor-pointer rounded-lg border px-2.5 py-2 text-sm font-medium transition-all hover:scale-105 {globalState
						.getSubtitlesEditorState.playbackSpeed === speed
						? 'border-transparent bg-accent-primary text-[var(--text-on-accent)] shadow-lg shadow-blue-500/25'
						: 'border-color bg-secondary text-secondary hover:border-[var(--accent-primary)] hover:bg-accent hover:text-primary'}"
					onclick={() => (globalState.getSubtitlesEditorState.playbackSpeed = speed)}
				>
					{speed}x
				</button>
			{/each}
		</div>
	</div>

	<div class="space-y-3">
		<h3 class="text-sm font-medium text-secondary">{$LL.editor.transcriptionProgress()}</h3>
		<div class="space-y-3 rounded-lg bg-accent p-4">
			<div class="flex items-center justify-between">
				<span class="text-sm text-secondary">{$LL.editor.completion()}</span>
				<span class="text-sm font-bold text-accent">
					{globalState.currentProject!.detail.transcriptionProgress}%
				</span>
			</div>
			<div class="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
				<div
					class="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] transition-all duration-500"
					style="width: {globalState.currentProject!.detail.transcriptionProgress}%"
				></div>
			</div>
			<div
				class="flex items-center justify-between border-t border-color pt-3 text-xs text-secondary"
			>
				<span>{$LL.editor.transcriptSegments()}</span>
				<span class="rounded-md bg-primary px-2 py-1 font-semibold text-primary"
					>{transcriptCount}</span
				>
			</div>
		</div>
	</div>

	<div class="space-y-3">
		<h3 class="text-sm font-medium text-secondary">{$LL.editor.aiTranscription()}</h3>
		<button
			type="button"
			class="group w-full cursor-pointer rounded-lg border border-color bg-[var(--bg-accent)]/50 p-4 text-center transition hover:border-[var(--accent-primary)] hover:bg-accent"
			onclick={() => void ModalManager.aiTranscriptionModal()}
		>
			<span
				class="material-icons mb-2 text-2xl text-accent-primary transition group-hover:scale-110"
				>auto_awesome</span
			>
			<p class="text-sm font-semibold text-primary">Transcribe with WhisperX</p>
			<p class="mt-1 text-xs leading-relaxed text-secondary">
				Detect speakers, align every word and create transcript segments automatically.
			</p>
			<span class="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-primary">
				Open AI transcription
				<span class="material-icons text-sm">arrow_forward</span>
			</span>
		</button>
	</div>
</div>
