<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { tick } from 'svelte';

	const LL_ = $derived($LL);
	import { Duration, ProjectEditorTabs } from '$lib/classes';
	import type { SubtitleClip } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		findFirstSubtitleByVerseKey,
		getSubtitleVerseKeyLabel,
		goToSubtitleClip
	} from '$lib/services/SubtitleNavigation';

	let { onClose }: { onClose: () => void } = $props();

	type SearchMode = 'verse' | 'translation';

	let overlayRoot: HTMLDivElement | null = null;
	let searchInput: HTMLInputElement | null = null;
	let query = $state('');
	let searchMode: SearchMode = $state('verse');
	let sliderTime = $state(globalState.getTimelineState.cursorPosition);
	let resultMessage = $state('');

	const currentTab = $derived(() => globalState.currentProject?.projectEditorState.currentTab);
	const isTranslationsTab = $derived(() => currentTab() === ProjectEditorTabs.Translations);
	const subtitles = $derived(() => globalState.getSubtitleClips);
	const durationMs = $derived(
		() => globalState.currentProject!.content.timeline.getLongestTrackDuration().ms
	);
	const versePlaceholder = $derived(() => `Verse key (${getProjectVerseBoundsPlaceholder()})`);

	/**
	 * Focalise le champ de recherche principal.
	 * @returns {Promise<void>} Promesse résolue après la mise au focus.
	 */
	export async function focusInput(): Promise<void> {
		await tick();
		searchInput?.focus();
		searchInput?.select();
	}

	/**
	 * Indique si le focus est dans le panneau de recherche.
	 * @returns {boolean} `true` si le panneau contient l'élément actif.
	 */
	export function containsFocus(): boolean {
		const activeElement = document.activeElement;
		return !!activeElement && !!overlayRoot?.contains(activeElement);
	}

	/**
	 * Déplace le curseur vers un sous-titre et met à jour l'état UI associé.
	 * @param {SubtitleClip} clip Sous-titre cible.
	 * @param {boolean} atStart Positionne exactement au début du sous-titre.
	 * @returns {void}
	 */
	function jumpToSubtitle(clip: SubtitleClip, atStart: boolean = false): void {
		if (atStart) {
			globalState.getTimelineState.cursorPosition = clip.startTime;
			globalState.getTimelineState.movePreviewTo = clip.startTime;
			globalState.getVideoPreviewState.scrollTimelineToCursor();
		} else {
			goToSubtitleClip(clip);
		}
		sliderTime = globalState.getTimelineState.cursorPosition;
		resultMessage = getSubtitleVerseKeyLabel(clip);
	}

	/**
	 * Indique si une recherche correspond au format `sourate:verset`.
	 * @param {string} value Valeur saisie.
	 * @returns {boolean} `true` si la valeur est une clé de verset valide.
	 */
	function isVerseKeySearch(value: string): boolean {
		return /^\d+\s*:\s*\d+$/.test(value);
	}

	/**
	 * Active tous les filtres de traductions pour que la recherche ne masque aucun résultat.
	 * @returns {void}
	 */
	function showAllTranslationFilters(): void {
		const translationsState = globalState.getTranslationsState;
		translationsState.checkOnlyFilters(Object.keys(translationsState.filters));
	}

	/**
	 * Retourne les bornes de versets du projet pour le placeholder de recherche.
	 * @returns {string} Bornes au format `sourate:verset - sourate:verset`.
	 */
	function getProjectVerseBoundsPlaceholder(): string {
		const parts = globalState.currentProject?.detail.verseRange.parts ?? [];
		const firstPart = parts[0];
		const lastPart = parts.at(-1);
		if (!firstPart || !lastPart) return '2:255';

		return `${firstPart.surah}:${firstPart.verseStart} - ${lastPart.surah}:${lastPart.verseEnd}`;
	}

	/**
	 * Demande au workspace de traductions de scroller vers un sous-titre.
	 * @param {SubtitleClip} clip Sous-titre cible.
	 * @returns {void}
	 */
	function scrollTranslationWorkspaceToSubtitle(clip: SubtitleClip): void {
		showAllTranslationFilters();
		globalState.getTranslationsState.searchQuery = '';
		globalState.shared.translationScrollTargetClipId = clip.id;
		sliderTime = clip.startTime;
		resultMessage = getSubtitleVerseKeyLabel(clip);
	}

	/**
	 * Lance la recherche selon l'onglet courant.
	 * @returns {void}
	 */
	function submitSearch(): void {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) {
			resultMessage = '';
			if (isTranslationsTab()) {
				globalState.getTranslationsState.searchQuery = '';
			}
			return;
		}

		if (isTranslationsTab()) {
			showAllTranslationFilters();
			if (searchMode === 'verse' && !isVerseKeySearch(trimmedQuery)) {
				searchMode = 'translation';
			}
			globalState.getTranslationsState.searchQuery = trimmedQuery;
			resultMessage = trimmedQuery;
			if (searchMode === 'verse') {
				const targetClip = findFirstSubtitleByVerseKey(trimmedQuery);
				if (targetClip) {
					globalState.shared.translationScrollTargetClipId = targetClip.id;
				}
			}
			return;
		}

		const targetClip = findFirstSubtitleByVerseKey(trimmedQuery);
		if (!targetClip) {
			resultMessage = LL_.editor.noSubtitleFallback();
			return;
		}

		jumpToSubtitle(targetClip);
	}

	/**
	 * Déplace le curseur depuis la position du slider.
	 * @param {Event} event Événement du slider.
	 * @returns {void}
	 */
	function handleSliderInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		const time = Number(target.value);
		const clip = subtitles().reduce<SubtitleClip | null>(
			(closest, candidate) =>
				!closest || Math.abs(candidate.startTime - time) < Math.abs(closest.startTime - time)
					? candidate
					: closest,
			null
		);
		if (!clip) return;
		target.value = String(clip.startTime);

		if (isTranslationsTab()) {
			scrollTranslationWorkspaceToSubtitle(clip);
			return;
		}

		jumpToSubtitle(clip, true);
	}

	/**
	 * Conserve une navigation de sous-titre en sous-titre avec les flèches du slider.
	 * @param {KeyboardEvent} event Événement clavier du slider.
	 * @returns {void}
	 */
	function handleSliderKeydown(event: KeyboardEvent): void {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
		const clip = forward
			? subtitles().find((clip) => clip.startTime > sliderTime)
			: subtitles().findLast((clip) => clip.startTime < sliderTime);
		if (!clip) return;
		(event.target as HTMLInputElement).value = String(clip.startTime);
		handleSliderInput(event);
	}

	$effect(() => {
		if (isTranslationsTab()) {
			query = globalState.getTranslationsState.searchQuery;
			return;
		}

		if (searchMode === 'translation') {
			searchMode = 'verse';
		}
	});

	$effect(() => {
		sliderTime = globalState.getTimelineState.cursorPosition;
	});
</script>

<div
	class="fixed end-4 top-14 z-[1300] w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-color bg-secondary p-3 shadow-xl shadow-black/35"
	data-project-search-overlay="true"
	bind:this={overlayRoot}
>
	<form
		class="space-y-3"
		onsubmit={(event) => {
			event.preventDefault();
			submitSearch();
		}}
	>
		<div class="flex items-center gap-2">
			<span class="material-icons text-accent-primary text-xl">search</span>
			<div class="min-w-0 flex-1">
				<div class="text-sm font-semibold text-primary">
					{isTranslationsTab()
						? $LL.editor.searchTranslationsLabel()
						: $LL.editor.searchVerseLabel()}
				</div>
				{#if resultMessage}
					<div class="truncate text-xs text-thirdly">{resultMessage}</div>
				{/if}
			</div>
			<button
				type="button"
				class="btn flex h-8 w-8 items-center justify-center p-0"
				onclick={onClose}
				aria-label={$LL.editor.closeSearch()}
			>
				<span class="material-icons text-base">close</span>
			</button>
		</div>

		{#if isTranslationsTab()}
			<div class="grid grid-cols-2 gap-1 rounded-lg border border-color bg-primary p-1">
				<button
					type="button"
					class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors {searchMode ===
					'verse'
						? 'bg-accent-primary text-[var(--text-on-accent)]'
						: 'text-secondary hover:bg-accent hover:text-primary'}"
					onclick={() => (searchMode = 'verse')}
				>
					{$LL.editor.verseButton()}
				</button>
				<button
					type="button"
					class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors {searchMode ===
					'translation'
						? 'bg-accent-primary text-[var(--text-on-accent)]'
						: 'text-secondary hover:bg-accent hover:text-primary'}"
					onclick={() => (searchMode = 'translation')}
				>
					{$LL.editor.searchTranslations()}
				</button>
			</div>
		{/if}

		<div class="flex gap-2">
			<div class="relative min-w-0 flex-1">
				<input
					bind:this={searchInput}
					bind:value={query}
					type="text"
					autocomplete="off"
					class="w-full rounded-lg border border-color bg-primary py-2 ps-3 text-sm text-primary outline-none focus:border-[var(--accent-primary)] {query
						? 'pe-9'
						: 'pe-3'}"
					placeholder={isTranslationsTab() && searchMode === 'translation'
						? $LL.editor.searchTranslations()
						: versePlaceholder()}
				/>
				{#if query}
					<button
						type="button"
						class="absolute end-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-thirdly)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
						onclick={() => {
							query = '';
							resultMessage = '';
							if (isTranslationsTab()) {
								globalState.getTranslationsState.searchQuery = '';
							}
							searchInput?.focus();
						}}
						aria-label={$LL.editor.clearSearch()}
					>
						<span class="material-icons text-sm">close</span>
					</button>
				{/if}
			</div>
			<button type="submit" class="btn-accent flex items-center gap-1.5 px-3 py-2 text-sm">
				<span class="material-icons text-base">keyboard_return</span>
				{$LL.common.go()}
			</button>
		</div>

		<div class="rounded-lg border border-color bg-primary px-3 py-2">
			<div class="mb-1 flex items-center justify-between gap-3 text-xs" dir="ltr">
				<span class="text-thirdly">{$LL.editor.timelineLabel()}</span>
				<span class="monospaced shrink-0 font-medium text-primary">
					{new Duration(sliderTime).getFormattedTime(false)} / {new Duration(
						durationMs()
					).getFormattedTime(false)}
				</span>
			</div>
			<input
				type="range"
				class="w-full accent-[var(--accent-primary)]"
				min="0"
				max={Math.max(1, durationMs())}
				step="1"
				value={sliderTime}
				disabled={subtitles().length === 0}
				oninput={handleSliderInput}
				onkeydown={handleSliderKeydown}
				aria-label={$LL.editor.timelineLabel()}
				dir="ltr"
			/>
		</div>
	</form>
</div>
