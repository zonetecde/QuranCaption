<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		canRemoveProjectSpeaker,
		getVisibleProjectSpeakers,
		requestProjectSpeakerRemoval
	} from '$lib/services/SpeakerLibrary';
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

	const availableSpeakers = $derived(() => getVisibleProjectSpeakers());

	$effect(() => {
		if (!editorState().selectedSpeaker.trim() && availableSpeakers()[0]) {
			editorState().selectedSpeaker = availableSpeakers()[0];
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

	async function deleteSpeaker(event: MouseEvent, value: string): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		await requestProjectSpeakerRemoval(value);
		await tick();
		transcriptInput?.focus();
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
				<div class="group/speaker relative inline-flex">
					<button
						type="button"
						class={`cursor-pointer rounded-full border py-2 px-4 text-sm font-semibold transition ${
							editorState().selectedSpeaker.toLocaleLowerCase() === candidate.toLocaleLowerCase()
								? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-sm'
								: 'border-color bg-secondary text-secondary hover:border-[var(--accent-primary)] hover:bg-accent hover:text-primary'
						}`}
						onclick={() => selectSpeaker(candidate)}
					>
						{candidate}
					</button>
					{#if canRemoveProjectSpeaker(candidate)}
						<button
							type="button"
							class={'absolute -right-1 top-1 bg-secondary border-2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full opacity-0 transition hover:bg-black/15 group-hover/speaker:opacity-100 focus:opacity-100 ' +
								(editorState().selectedSpeaker === candidate
									? 'border-[var(--accent-primary)]'
									: 'border-color')}
							onclick={(event) => void deleteSpeaker(event, candidate)}
							aria-label={`Remove ${candidate}`}
							title={`Remove ${candidate} from the project`}
						>
							<span class="material-icons text-sm!">close</span>
						</button>
					{/if}
				</div>
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
			class="min-h-48 flex-1 resize-none rounded-xl border border-color bg-secondary px-5 py-4 text-xl! leading-relaxed text-primary outline-none transition focus:border-[var(--accent-primary)] noto-sans-arabic"
			placeholder={$LL.editor.transcriptPlaceholder()}
			onkeydown={handleTranscriptKeydown}
		></textarea>
	</div>
</div>

<style>
	.noto-sans-arabic {
		font-family: 'Noto Sans Arabic', sans-serif;
	}
</style>
