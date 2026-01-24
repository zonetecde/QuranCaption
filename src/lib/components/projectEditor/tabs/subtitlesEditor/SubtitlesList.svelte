<script lang="ts">
	import { Clip, Duration, SubtitleClip, TrackType } from '$lib/classes';
	import { ClipWithTranslation, SilenceClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';

	// div contenant tout les sous-titres
	let subtitlesListElement: HTMLDivElement | null = $state(null);
	let lastSubtitleId = 0;

	let minWordCount = $state(0);

	let allClips = $derived(() => {
		return (
			globalState.currentProject?.content.timeline.getFirstTrack(TrackType.Subtitle)?.clips ?? []
		);
	});

	let filteredClips = $derived(() => {
		const clips = allClips();
		if (minWordCount <= 0) return clips;

		return clips.filter((clip) => {
			if (clip instanceof SubtitleClip) {
				const wordCount = clip.text.trim().split(/\s+/).length;
				return wordCount > minWordCount;
			}
			return false; // Hide other clip types when filtering
		});
	});

	// timeline settings
	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	// récupère le sous-titre actuellement en train d'être joué
	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay(true);
		});
	});

	$effect(() => {
		const _ = globalState.currentProject!.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips
			.length;

		// Dès qu'on ajoute un sous-titre, scroll en bas de la liste
		const list = document.querySelector('.subtitles-list');
		if (list) {
			list.scrollTop = list.scrollHeight;
		}
	});

	$effect(() => {
		// scroll sur le sous-titre actuellement en train d'être joué
		const subtitle = currentSubtitle();
		if (!subtitle || !globalState.getVideoPreviewState.isPlaying) {
			return;
		}
		if (subtitle.id === lastSubtitleId) {
			return;
		}
		lastSubtitleId = subtitle.id;

		const listElement = subtitlesListElement;
		if (!listElement) return;

		const target = listElement.querySelector(
			`[data-subtitle-id="${subtitle.id}"]`
		) as HTMLElement | null;
		if (!target) return;

		// si le scroll est petit, alors smooth, sinon instant
		const targetTop = target.offsetTop;
		const listScrollTop = listElement.scrollTop;
		const listHeight = listElement.clientHeight;
		const targetCenter = targetTop - listScrollTop - listHeight / 2;
		const scrollDistance = Math.abs(targetCenter);
		const behavior = scrollDistance < 500 ? 'smooth' : 'instant';
		target.scrollIntoView({ block: 'center', behavior });
	});
</script>

<div class="z-20 flex h-full flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)]">
	<div
		class="flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] p-4"
	>
		<h3 class="m-0 text-sm font-semibold text-[var(--text-primary)] hidden xl:block">Subtitles</h3>

		<div
			class="flex justify-center items-center gap-2 opacity-50 hover:opacity-100 transition-opacity"
		>
			<span class="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--text-secondary)]"
				>Min words</span
			>
			<input
				type="number"
				class="w-14 h-5 text-xs! bg-[var(--bg-accent)] border border-[var(--border-color)] rounded px-1 py-0.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
				bind:value={minWordCount}
				min="0"
			/>
		</div>

		<div
			class="min-w-[1.5rem] rounded-lg bg-[var(--bg-primary)] px-2 py-1 text-center text-xs font-semibold text-[var(--text-secondary)]"
		>
			{filteredClips().length}
		</div>
	</div>

	<div
		class="subtitles-list flex flex-1 flex-col gap-2 overflow-y-auto p-2"
		bind:this={subtitlesListElement}
	>
		{#each filteredClips() as _clip, index (_clip.id)}
			{@const clip = _clip as Clip}
			{@const subtitleClip = clip as SubtitleClip}
			{@const isSilence = subtitleClip.type === 'Silence'}
			{@const isPredefined = subtitleClip.type === 'Pre-defined Subtitle'}
			{@const isSelected =
				globalState.currentProject!.projectEditorState.subtitlesEditor.editSubtitle?.id === clip.id}
			{@const isCurrent = currentSubtitle()?.id === clip.id}
			<div
				data-subtitle-id={clip.id}
				onclick={() => {
					const s = globalState.currentProject!.projectEditorState.subtitlesEditor;
					if (s.editSubtitle && s.editSubtitle.id === clip.id) {
						// Si on reclique sur le même, on désélectionne
						s.editSubtitle = null;
						return;
					}
					if (clip instanceof SilenceClip || clip instanceof ClipWithTranslation) {
						if (clip instanceof ClipWithTranslation) {
							clip.markAsManualEdit();
						}
						s.editSubtitle = clip;

						// get fade duration from timeline settings
						const fadeDuration = globalState.getStyle('global', 'fade-duration')!.value as number;

						// Synchronize timeline and video preview
						globalState.currentProject!.projectEditorState.timeline.cursorPosition =
							clip.startTime + fadeDuration;
						globalState.currentProject!.projectEditorState.timeline.movePreviewTo =
							clip.startTime + fadeDuration;
						globalState.currentProject!.projectEditorState.videoPreview.scrollTimelineToCursor();
					}
				}}
				class={`relative cursor-pointer rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-primary)] hover:bg-opacity-80 ${
					isSilence ? 'border-l-[3px] border-l-[var(--text-thirdly)] !bg-[var(--bg-accent)]' : ''
				} ${isPredefined ? 'border-l-[3px] border-l-[var(--accent-secondary)]' : ''} ${
					isCurrent
						? '!border-[#866322] shadow-[0_6px_16px_rgba(242,201,76,0.25)]'
						: isSelected
							? '!border-[#ffa500] !border-[1.5px]'
							: ''
				}`}
			>
				<div class="mb-3 flex items-center justify-between">
					<div>
						<span
							class="monospaced rounded-md border border-[var(--border-color)] bg-[var(--bg-accent)] px-2 py-1 text-xs font-medium text-[var(--accent-primary)]"
							>{new Duration(clip.startTime).getFormattedTime(false, false)}</span
						>
					</div>

					{#if subtitleClip.type !== 'Silence' && subtitleClip.type !== 'Pre-defined Subtitle'}
						<div
							class="rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]"
						>
							<span class="monospaced">{subtitleClip.surah}:{subtitleClip.verse}</span>
						</div>
					{:else}
						<div
							class={`rounded-md px-2 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.05em] ${
								isSilence
									? 'border border-[var(--text-thirdly)] bg-[var(--bg-accent)] text-[var(--text-thirdly)]'
									: 'border border-[var(--accent-secondary)] bg-[var(--accent-secondary)] text-black'
							}`}
						>
							{subtitleClip.type === 'Silence' ? 'SILENCE' : 'PRE-DEFINED'}
						</div>
					{/if}
				</div>

				{#if subtitleClip.type === 'Silence'}
					<div class="flex h-0 items-center justify-center gap-2 py-4">
						<div class="text-2xl opacity-70">🔇</div>
						<span class="text-sm italic text-[var(--text-thirdly)]">Silent segment</span>
					</div>
				{:else}
					<div
						dir="rtl"
						class={`arabic mb-3 text-lg leading-[1.8] text-right text-[var(--text-primary)] ${
							isPredefined ? 'italic text-[var(--text-secondary)]' : ''
						}`}
					>
						{subtitleClip.text}
					</div>

					{#if Object.keys(subtitleClip.translations).length > 0}
						<div class="flex flex-col gap-2 border-t border-[var(--border-color)] pt-3">
							{#each Object.keys(subtitleClip.translations) as translation}
								{#if translation.startsWith('type') === false}
									<div class="flex items-start gap-2">
										<span
											class="monospaced mt-0.5 shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-accent)] px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase text-[var(--text-thirdly)]"
											>{translation.slice(0, 3).toUpperCase()}</span
										>
										<span class="flex-1 text-sm leading-[1.5] text-[var(--text-secondary)]">
											{subtitleClip.translations[translation].text}
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
