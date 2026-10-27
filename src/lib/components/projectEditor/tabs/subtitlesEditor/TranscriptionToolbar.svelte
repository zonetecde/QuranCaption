<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
</script>

<div
	class="flex min-h-12 w-full items-center gap-3 border-b border-color bg-secondary/70 px-3 py-2"
>
	<div class="group relative flex items-center" data-tour-id="transcription-help-button">
		<button
			type="button"
			class="flex h-8 w-8 cursor-help items-center justify-center rounded-full text-secondary transition hover:bg-accent hover:text-primary"
			aria-label={$LL.editor.transcriptionHelpTitle()}
		>
			<span class="material-icons text-xl">help</span>
		</button>

		<div
			class="pointer-events-none absolute start-2 top-7 z-50 w-[420px] max-w-[80vw] translate-y-1 rounded-lg border-2 border-[var(--border-color)]/90 bg-primary px-4 py-4 text-sm text-secondary opacity-0 shadow-2xl transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100"
		>
			<h3 class="mb-2 font-semibold text-primary">{$LL.editor.transcriptionHelpTitle()}</h3>
			<p class="mb-4 text-xs leading-relaxed text-thirdly">
				{$LL.editor.transcriptionHelpDescription()}
			</p>

			<div class="space-y-2 text-xs">
				<div class="flex gap-3">
					<span
						class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold"
						>1</span
					>
					<span>{$LL.editor.transcriptionHelpPlayhead()}</span>
				</div>
				<div class="flex gap-3">
					<span
						class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold"
						>2</span
					>
					<span>{$LL.editor.transcriptionHelpText()}</span>
				</div>
			</div>

			<div class="my-4 border-t border-color"></div>
			<h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
				{$LL.editor.transcriptionShortcuts()}
			</h4>
			<div class="space-y-2 text-xs">
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.saveTranscriptShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 font-mono">{$LL.settings.enter()}</kbd>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.newLineShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 font-mono"
						>{Reflect.get($LL.editor, 'transcriptShortcutKeys').newLine()}</kbd
					>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.playPauseShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono"
						>{Reflect.get($LL.editor, 'transcriptShortcutKeys').playPause()}</kbd
					>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.seekBackwardShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono"
						>{Reflect.get($LL.editor, 'transcriptShortcutKeys').seekBackward()}</kbd
					>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.seekForwardShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono"
						>{Reflect.get($LL.editor, 'transcriptShortcutKeys').seekForward()}</kbd
					>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.temporarySpeedShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono"
						>{Reflect.get($LL.editor, 'transcriptShortcutKeys').temporarySpeed()}</kbd
					>
				</div>
			</div>
		</div>
	</div>
</div>
