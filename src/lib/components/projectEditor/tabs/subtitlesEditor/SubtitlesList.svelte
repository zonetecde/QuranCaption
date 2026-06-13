<script lang="ts">
	import { Clip, Duration, SubtitleClip, TrackType } from '$lib/classes';
	import { ClipWithTranslation, SilenceClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';

	const SUBTITLE_LIST_PAGE_SIZE = 80;
	const SUBTITLE_AUTO_SCROLL_THROTTLE_MS = 250;

	// div contenant tout les sous-titres
	let subtitlesListElement: HTMLDivElement | null = $state(null);
	let lastSubtitleId = 0;
	let lastAutoScrollAt = 0;
	let visibleClipCount = $state(SUBTITLE_LIST_PAGE_SIZE);
	let currentSubtitleId: number | null = $state(null);

	let allClips = $derived(() => {
		return (
			globalState.currentProject?.content.timeline.getFirstTrack(TrackType.Subtitle)?.clips ?? []
		);
	});

	let filteredClips = $derived(() => {
		const s = globalState.currentProject!.projectEditorState.subtitlesEditor;
		const clips = allClips();
		if (s.minWordCount <= 0) return clips;

		return clips.filter((clip) => {
			if (clip instanceof SubtitleClip) {
				const wordCount = clip.text.trim().split(/\s+/).length;
				return wordCount > s.minWordCount;
			}
			return false; // Hide other clip types when filtering
		});
	});

	let visibleFilteredClips = $derived(() => {
		return filteredClips().slice(0, visibleClipCount);
	});

	/**
	 * Augmente progressivement le nombre de sous-titres rendus.
	 * @returns {void}
	 */
	function loadMoreVisibleClips(): void {
		const nextCount = Math.min(filteredClips().length, visibleClipCount + SUBTITLE_LIST_PAGE_SIZE);
		if (nextCount > visibleClipCount) visibleClipCount = nextCount;
	}

	/**
	 * Charge assez d'éléments pour rendre un sous-titre donné.
	 * @param {number} subtitleId ID du sous-titre à rendre.
	 * @returns {void}
	 */
	function ensureSubtitleRendered(subtitleId: number): void {
		const index = filteredClips().findIndex((clip) => clip.id === subtitleId);
		if (index === -1 || index < visibleClipCount) return;
		visibleClipCount = Math.min(filteredClips().length, index + SUBTITLE_LIST_PAGE_SIZE);
	}

	/**
	 * Charge la page suivante quand le scroll approche du bas.
	 * @param {Event} event Événement de scroll de la liste.
	 * @returns {void}
	 */
	function handleSubtitlesListScroll(event: Event): void {
		const list = event.currentTarget as HTMLDivElement;
		if (list.scrollTop + list.clientHeight < list.scrollHeight - 600) return;
		loadMoreVisibleClips();
	}

	// timeline settings
	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	// récupère le sous-titre actuellement en train d'être joué
	$effect(() => {
		const _cursor = getTimelineSettings().cursorPosition;
		const _clipsLen = allClips().length;
		const subtitle = untrack(() => globalState.getSubtitleTrack.getCurrentSubtitleToDisplay(true));
		const nextId = subtitle?.id ?? null;
		if (nextId !== currentSubtitleId) {
			currentSubtitleId = nextId;
		}
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
		const subtitleId = currentSubtitleId;
		if (!subtitleId || !globalState.getVideoPreviewState.isPlaying) {
			return;
		}
		if (subtitleId === lastSubtitleId) {
			return;
		}
		ensureSubtitleRendered(subtitleId);

		const now = Date.now();
		if (now - lastAutoScrollAt < SUBTITLE_AUTO_SCROLL_THROTTLE_MS) return;
		lastAutoScrollAt = now;
		lastSubtitleId = subtitleId;

		const listElement = subtitlesListElement;
		if (!listElement) return;

		setTimeout(() => {
			const target = listElement.querySelector(
				`[data-subtitle-id="${subtitleId}"]`
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
		}, 0);
	});
</script>

<div class="z-20 flex h-full flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)]">
	<div
		class="flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] p-4"
	>
		<h3 class="m-0 text-sm font-semibold text-[var(--text-primary)] hidden xl:block">
			{$LL.editor.subtitles()}
		</h3>

		<div
			class="flex justify-center items-center gap-2 opacity-50 hover:opacity-100 transition-opacity"
		>
			<span class="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--text-secondary)]"
				>{$LL.editor.minWordsLabel()}</span
			>
			<input
				type="number"
				class="w-14 h-5 text-xs! bg-[var(--bg-accent)] border border-[var(--border-color)] rounded px-1 py-0.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
				bind:value={globalState.currentProject!.projectEditorState.subtitlesEditor.minWordCount}
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
		onscroll={handleSubtitlesListScroll}
	>
		{#each visibleFilteredClips() as _clip (_clip.id)}
			{@const clip = _clip as Clip}
			{@const subtitleClip = clip as SubtitleClip}
			{@const isSilence = subtitleClip.type === 'Silence'}
			{@const isPredefined = subtitleClip.type === 'Pre-defined Subtitle'}
			{@const isSelected =
				globalState.currentProject!.projectEditorState.subtitlesEditor.editSubtitle?.id === clip.id}
			{@const isCurrent = currentSubtitleId === clip.id}
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
							{subtitleClip.type === 'Silence'
								? $LL.editor.silenceLabel()
								: $LL.editor.predefinedLabel()}
						</div>
					{/if}
				</div>

				{#if subtitleClip.type === 'Silence'}
					<div class="flex h-0 items-center justify-center gap-2 py-4">
						<div class="text-2xl opacity-70">🔇</div>
						<span class="text-sm italic text-[var(--text-thirdly)]"
							>{$LL.editor.silentSegment()}</span
						>
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
							{#each Object.keys(subtitleClip.translations) as translation (translation)}
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
