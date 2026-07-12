<script lang="ts">
	import { Clip, Duration, SubtitleClip, TrackType } from '$lib/classes';
	import { ClipWithTranslation, SilenceClip } from '$lib/classes/Clip.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';

	const TRANSCRIPT_LIST_PAGE_SIZE = 80;
	const AUTO_SCROLL_THROTTLE_MS = 250;

	let listElement: HTMLDivElement | null = $state(null);
	let lastTranscriptId = 0;
	let lastAutoScrollAt = 0;
	let visibleClipCount = $state(TRANSCRIPT_LIST_PAGE_SIZE);
	let currentTranscriptId: number | null = $state(null);

	const allClips = $derived(() => {
		return (
			globalState.currentProject?.content.timeline.getFirstTrack(TrackType.Subtitle)?.clips ?? []
		);
	});

	const filteredClips = $derived(() => {
		const minWordCount =
			globalState.currentProject!.projectEditorState.subtitlesEditor.minWordCount;
		const clips = allClips();
		if (minWordCount <= 0) return clips;

		return clips.filter((clip) => {
			if (!(clip instanceof SubtitleClip)) return false;
			const wordCount = clip.text.trim() ? clip.text.trim().split(/\s+/).length : 0;
			return wordCount > minWordCount;
		});
	});

	const visibleClips = $derived(() => filteredClips().slice(0, visibleClipCount));

	function loadMoreVisibleClips(): void {
		visibleClipCount = Math.min(
			filteredClips().length,
			visibleClipCount + TRANSCRIPT_LIST_PAGE_SIZE
		);
	}

	function ensureTranscriptRendered(transcriptId: number): void {
		const index = filteredClips().findIndex((clip) => clip.id === transcriptId);
		if (index === -1 || index < visibleClipCount) return;
		visibleClipCount = Math.min(filteredClips().length, index + TRANSCRIPT_LIST_PAGE_SIZE);
	}

	function handleScroll(event: Event): void {
		const list = event.currentTarget as HTMLDivElement;
		if (list.scrollTop + list.clientHeight < list.scrollHeight - 600) return;
		loadMoreVisibleClips();
	}

	function selectClip(clip: Clip): void {
		const editorState = globalState.getSubtitlesEditorState;
		if (clip instanceof SubtitleClip) {
			editorState.editSubtitle = editorState.editSubtitle?.id === clip.id ? null : clip;
		} else {
			editorState.editSubtitle = null;
		}

		const fadeDuration = (globalState.getStyle('global', 'fade-duration')?.value as number) ?? 0;
		globalState.getTimelineState.cursorPosition = clip.startTime + fadeDuration;
		globalState.getTimelineState.movePreviewTo = clip.startTime + fadeDuration;
		globalState.getVideoPreviewState.scrollTimelineToCursor();
	}

	$effect(() => {
		const _cursor = globalState.getTimelineState.cursorPosition;
		const _clipCount = allClips().length;
		const current = untrack(() => globalState.getSubtitleTrack.getCurrentSubtitleToDisplay(true));
		currentTranscriptId = current?.id ?? null;
	});

	$effect(() => {
		const _clipCount = allClips().length;
		const list = listElement;
		if (list) list.scrollTop = list.scrollHeight;
	});

	$effect(() => {
		const transcriptId = currentTranscriptId;
		if (!transcriptId || !globalState.getVideoPreviewState.isPlaying) return;
		if (transcriptId === lastTranscriptId) return;

		ensureTranscriptRendered(transcriptId);
		const now = Date.now();
		if (now - lastAutoScrollAt < AUTO_SCROLL_THROTTLE_MS) return;
		lastAutoScrollAt = now;
		lastTranscriptId = transcriptId;

		setTimeout(() => {
			const target = listElement?.querySelector(
				`[data-transcript-id="${transcriptId}"]`
			) as HTMLElement | null;
			target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}, 0);
	});
</script>

<div class="z-20 flex h-full flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)]">
	<div
		class="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3"
	>
		<h3 class="m-0 hidden text-sm font-semibold text-[var(--text-primary)] xl:block">
			{$LL.editor.transcriptSegments()}
		</h3>

		<div class="flex items-center gap-2 opacity-60 transition-opacity hover:opacity-100">
			<span class="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
				{$LL.editor.minWordsLabel()}
			</span>
			<input
				type="number"
				class="h-6 w-14 rounded border border-[var(--border-color)] bg-[var(--bg-accent)] px-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
				bind:value={globalState.currentProject!.projectEditorState.subtitlesEditor.minWordCount}
				min="0"
			/>
		</div>

		<div
			class="min-w-8 rounded-lg bg-[var(--bg-primary)] px-2 py-1 text-center text-xs font-semibold text-[var(--text-secondary)]"
		>
			{filteredClips().length}
		</div>
	</div>

	<div
		class="flex flex-1 flex-col gap-2 overflow-y-auto p-2"
		bind:this={listElement}
		onscroll={handleScroll}
	>
		{#each visibleClips() as clip (clip.id)}
			{@const isTranscript = clip instanceof SubtitleClip}
			{@const isSilence = clip instanceof SilenceClip}
			{@const isSelected = globalState.getSubtitlesEditorState.editSubtitle?.id === clip.id}
			{@const isCurrent = currentTranscriptId === clip.id}
			<div
				data-transcript-id={clip.id}
				role="button"
				tabindex="0"
				class={`relative cursor-pointer rounded-xl border bg-[var(--bg-secondary)] p-3 transition-all hover:-translate-y-0.5 hover:border-[var(--accent-primary)] ${
					isSelected
						? 'border-[#ffa500] shadow-[0_4px_14px_rgba(255,165,0,0.18)]'
						: 'border-[var(--border-color)]'
				} ${isCurrent ? 'ring-1 ring-[#f2c94c]' : ''} ${isSilence ? 'opacity-70' : ''}`}
				onclick={() => selectClip(clip)}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') selectClip(clip);
				}}
			>
				<div class="mb-3 flex items-center justify-between gap-2">
					<span
						class="monospaced rounded-md border border-[var(--border-color)] bg-[var(--bg-accent)] px-2 py-1 text-xs font-medium text-[var(--accent-primary)]"
					>
						{new Duration(clip.startTime).getFormattedTime(false, false)}
					</span>

					{#if isTranscript}
						<span
							class="max-w-[60%] truncate rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary)]"
						>
							{clip.speaker}
						</span>
					{:else}
						<span
							class="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--text-thirdly)]"
						>
							{isSilence ? $LL.editor.silenceLabel() : $LL.editor.predefinedLabel()}
						</span>
					{/if}
				</div>

				{#if isSilence}
					<p class="py-2 text-center text-sm italic text-[var(--text-thirdly)]">
						{$LL.editor.silentSegment()}
					</p>
				{:else if clip instanceof ClipWithTranslation}
					<p
						dir="auto"
						class="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]"
					>
						{clip.text}
					</p>

					{#if Object.keys(clip.translations).length > 0}
						<div class="mt-3 flex flex-col gap-2 border-t border-[var(--border-color)] pt-3">
							{#each Object.entries(clip.translations) as [translation, value] (translation)}
								{#if !translation.startsWith('type')}
									<div class="flex items-start gap-2">
										<span
											class="monospaced shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-accent)] px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase text-[var(--text-thirdly)]"
										>
											{translation.slice(0, 3)}
										</span>
										<span dir="auto" class="text-sm leading-relaxed text-[var(--text-secondary)]">
											{value.text}
										</span>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
</div>
