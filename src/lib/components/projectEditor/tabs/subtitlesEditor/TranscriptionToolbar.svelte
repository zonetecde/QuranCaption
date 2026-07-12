<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { addProjectSpeaker, getVisibleProjectSpeakers } from '$lib/services/SpeakerLibrary';
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	let isAddingSpeaker = $state(false);
	let newSpeaker = $state('');
	let speakerInput: HTMLInputElement | null = $state(null);

	const knownSpeakers = $derived(() => getVisibleProjectSpeakers());

	async function openSpeakerInput(): Promise<void> {
		isAddingSpeaker = true;
		newSpeaker = '';
		await tick();
		speakerInput?.focus();
	}

	function closeSpeakerInput(): void {
		isAddingSpeaker = false;
		newSpeaker = '';
	}

	function addSpeaker(): void {
		const normalized = newSpeaker.trim();
		if (!normalized) return;

		const existing = knownSpeakers().find(
			(speaker) => speaker.toLocaleLowerCase() === normalized.toLocaleLowerCase()
		);
		if (existing) {
			globalState.getSubtitlesEditorState.selectedSpeaker = existing;
			toast.success(get(LL).editor.speakerSelected({ speaker: existing }));
			closeSpeakerInput();
			return;
		}

		const addedSpeaker = addProjectSpeaker(normalized);
		if (!addedSpeaker) return;
		globalState.getSubtitlesEditorState.selectedSpeaker = addedSpeaker;
		toast.success(get(LL).editor.speakerAdded({ speaker: addedSpeaker }));
		closeSpeakerInput();
	}

	function handleSpeakerInputKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			addSpeaker();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			closeSpeakerInput();
		}
	}
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
			class="pointer-events-none absolute left-2 top-7 z-50 w-[420px] max-w-[80vw] translate-y-1 rounded-lg border-2 border-[var(--border-color)]/90 bg-primary px-4 py-4 text-sm text-secondary opacity-0 shadow-2xl transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100"
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
					<span>{$LL.editor.transcriptionHelpSpeaker()}</span>
				</div>
				<div class="flex gap-3">
					<span
						class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold"
						>3</span
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
					<kbd class="rounded bg-accent px-2 py-1 font-mono">Enter</kbd>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.newLineShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 font-mono">Shift + Enter</kbd>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.playPauseShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono">Ctrl/Shift + Space</kbd>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.seekBackwardShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono">Ctrl/Shift + ←</kbd>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.seekForwardShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono">Ctrl/Shift + →</kbd>
				</div>
				<div class="flex items-center justify-between gap-4">
					<span>{$LL.editor.temporarySpeedShortcut()}</span>
					<kbd class="rounded bg-accent px-2 py-1 text-right font-mono"
						>Ctrl/Shift + PageUp/PageDown</kbd
					>
				</div>
			</div>
		</div>
	</div>

	<div class="ml-auto flex items-center gap-2">
		{#if isAddingSpeaker}
			<input
				bind:this={speakerInput}
				bind:value={newSpeaker}
				type="text"
				class="h-8 min-w-48 rounded-lg border border-color bg-primary px-3 text-sm text-primary outline-none focus:border-[var(--accent-primary)]"
				placeholder={$LL.editor.newSpeakerPlaceholder()}
				onkeydown={handleSpeakerInputKeydown}
			/>
			<button
				type="button"
				class="btn-accent flex h-8 cursor-pointer items-center gap-1 rounded-lg px-3 text-xs font-semibold"
				onclick={addSpeaker}
			>
				<span class="material-icons text-base">check</span>
				{$LL.common.confirm()}
			</button>
			<button
				type="button"
				class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary transition hover:bg-accent hover:text-primary"
				onclick={closeSpeakerInput}
				aria-label={$LL.common.cancel()}
			>
				<span class="material-icons text-base">close</span>
			</button>
		{:else}
			<button
				type="button"
				class="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-color px-3 text-xs font-semibold text-secondary transition hover:border-[var(--accent-primary)] hover:bg-accent hover:text-primary"
				onclick={() => void openSpeakerInput()}
			>
				<span class="material-icons text-base">person_add</span>
				{$LL.editor.addSpeaker()}
			</button>
		{/if}
	</div>
</div>
