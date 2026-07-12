<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, tick } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	let transcriptText = $state('');
	let loadedEditId: number | null = null;
	let transcriptInput: HTMLTextAreaElement | null = $state(null);

	const editorState = $derived(() => globalState.getSubtitlesEditorState);

	const editedTranscript = $derived(() => {
		const clip = editorState().editSubtitle;
		return clip instanceof SubtitleClip ? clip : null;
	});

	const availableSpeakers = $derived(() => {
		const values = [
			globalState.currentProject?.detail.speaker ?? '',
			...editorState().additionalSpeakers,
			...globalState.getSubtitleTrack.clips
				.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
				.map((clip) => clip.speaker)
		];
		const seen = new Set<string>();

		return values.filter((value) => {
			const normalized = value.trim();
			const key = normalized.toLocaleLowerCase();
			if (!normalized || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	});

	$effect(() => {
		if (!editorState().selectedSpeaker.trim()) {
			editorState().selectedSpeaker =
				globalState.currentProject?.detail.speaker?.trim() ||
				availableSpeakers()[0] ||
				'Unknown speaker';
		}
	});

	$effect(() => {
		const clip = editedTranscript();
		if (clip && clip.id !== loadedEditId) {
			loadedEditId = clip.id;
			transcriptText = clip.text;
			editorState().selectedSpeaker = clip.speaker;
			void tick().then(() => transcriptInput?.focus());
			return;
		}

		if (!clip && loadedEditId !== null) {
			loadedEditId = null;
			transcriptText = '';
		}
	});

	function selectSpeaker(value: string): void {
		editorState().selectedSpeaker = value.trim();
		void tick().then(() => transcriptInput?.focus());
	}

	function cancelEditing(): void {
		editorState().editSubtitle = null;
		editorState().pendingSplitEditNextId = null;
		loadedEditId = null;
		transcriptText = '';
		void tick().then(() => transcriptInput?.focus());
	}

	async function submitTranscript(): Promise<void> {
		const normalizedText = transcriptText.trim();
		const normalizedSpeaker = editorState().selectedSpeaker.trim();

		if (!normalizedText) {
			toast.error(get(LL).editor.transcriptCannotBeEmpty());
			return;
		}
		if (!normalizedSpeaker) {
			toast.error(get(LL).editor.speakerCannotBeEmpty());
			return;
		}

		const clip = editedTranscript();
		const success = clip
			? globalState.getSubtitleTrack.editTranscript(clip, normalizedText, normalizedSpeaker)
			: globalState.getSubtitleTrack.addTranscript(normalizedText, normalizedSpeaker);

		if (!success) return;

		globalState.currentProject!.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		toast.success(clip ? get(LL).editor.transcriptUpdated() : get(LL).editor.transcriptAdded());

		editorState().editSubtitle = null;
		editorState().pendingSplitEditNextId = null;
		loadedEditId = null;
		transcriptText = '';
		editorState().selectedSpeaker = normalizedSpeaker;
		await tick();
		transcriptInput?.focus();
	}

	let temporarySpeedShortcutActive = false;

	function handleComposerKeydown(event: KeyboardEvent): void {
		const hasSupportedModifier =
			(event.ctrlKey || event.shiftKey) && !event.altKey && !event.metaKey;
		if (!hasSupportedModifier) return;

		const key = event.key.toLowerCase();
		const isSpace = key === ' ' || event.code === 'Space';
		const isArrowLeft = key === 'arrowleft';
		const isArrowRight = key === 'arrowright';
		const isSpeedKey = key === 'pageup' || key === 'pagedown';
		if (!isSpace && !isArrowLeft && !isArrowRight && !isSpeedKey) return;

		event.preventDefault();
		event.stopPropagation();

		if (isSpace) {
			if (!event.repeat) globalState.getVideoPreviewState.togglePlayPause();
			return;
		}

		if (isArrowLeft || isArrowRight) {
			const offset = isArrowRight ? 2000 : -2000;
			const currentTime = globalState.getTimelineState.cursorPosition;
			const nextTime = Math.max(1, currentTime + offset);
			globalState.getTimelineState.cursorPosition = nextTime;
			globalState.getTimelineState.movePreviewTo = nextTime;
			globalState.getVideoPreviewState.scrollTimelineToCursor();
			return;
		}

		if (!event.repeat && !temporarySpeedShortcutActive) {
			temporarySpeedShortcutActive = true;
			globalState.getVideoPreviewState.setTemporaryPlaybackSpeed(true);
		}
	}

	function handleComposerKeyup(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		if ((key !== 'pageup' && key !== 'pagedown') || !temporarySpeedShortcutActive) return;

		event.preventDefault();
		event.stopPropagation();
		temporarySpeedShortcutActive = false;
		globalState.getVideoPreviewState.setTemporaryPlaybackSpeed(false);
	}

	onDestroy(() => {
		if (temporarySpeedShortcutActive) {
			globalState.getVideoPreviewState.setTemporaryPlaybackSpeed(false);
		}
	});

	function handleTranscriptKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submitTranscript();
			return;
		}

		if (event.key === 'Escape' && editedTranscript()) {
			event.preventDefault();
			cancelEditing();
		}
	}
</script>

<div
	class="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-5 lg:p-8"
	onkeydown={handleComposerKeydown}
	onkeyup={handleComposerKeyup}
>
	<div class="space-y-3">
		<label class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-base text-accent-primary">person</span>
			{$LL.editor.speaker()}
		</label>

		<div class="flex flex-wrap items-center gap-2">
			{#each availableSpeakers() as candidate (candidate)}
				<button
					type="button"
					class={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold transition ${
						editorState().selectedSpeaker.toLocaleLowerCase() === candidate.toLocaleLowerCase()
							? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-black shadow-sm'
							: 'border-color bg-secondary text-secondary hover:border-[var(--accent-primary)] hover:bg-accent hover:text-primary'
					}`}
					onclick={() => selectSpeaker(candidate)}
				>
					{candidate}
				</button>
			{/each}
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-3">
		<div class="flex items-center justify-between gap-3">
			<label
				for="transcript-text"
				class="flex items-center gap-2 text-sm font-semibold text-primary"
			>
				<span class="material-icons text-base text-accent-primary">notes</span>
				{$LL.editor.transcriptText()}
			</label>

			{#if editedTranscript()}
				<div class="flex items-center gap-2 text-xs font-semibold text-accent-primary">
					<span class="material-icons text-sm">edit</span>
					{$LL.editor.editingTranscript()}
					<button
						type="button"
						class="ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-secondary transition hover:bg-accent hover:text-primary"
						onclick={cancelEditing}
						aria-label={$LL.editor.cancelEditing()}
					>
						<span class="material-icons text-base">close</span>
					</button>
				</div>
			{/if}
		</div>

		<textarea
			id="transcript-text"
			bind:this={transcriptInput}
			bind:value={transcriptText}
			dir="auto"
			class="min-h-48 flex-1 resize-none rounded-xl border border-color bg-secondary px-5 py-4 text-base leading-relaxed text-primary outline-none transition focus:border-[var(--accent-primary)]"
			placeholder={$LL.editor.transcriptPlaceholder()}
			onkeydown={handleTranscriptKeydown}
		></textarea>
	</div>
</div>
