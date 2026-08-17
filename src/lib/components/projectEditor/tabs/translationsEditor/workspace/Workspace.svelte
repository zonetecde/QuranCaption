<script lang="ts">
	import { SubtitleClip } from '$lib/classes/Clip.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		getStructuredTranslationDraft,
		serializeStructuredTranslation
	} from '$lib/services/StructuredTranslationService';
	import { onDestroy, onMount } from 'svelte';
	import ArabicText from './ArabicText.svelte';
	import NoTranslationsToShow from './NoTranslationsToShow.svelte';
	import Translation from './translation/Translation.svelte';
	import { createWorkspaceLastRead } from './utils/lastRead.svelte';

	let {
		setAddTranslationModalVisibility
	}: {
		setAddTranslationModalVisibility: (visible: boolean) => void;
	} = $props();

	const PAGE_SIZE = 10;
	let playbackClipId = $state<number | null>(null);

	/**
	 * Starts or pauses playback for the selected subtitle.
	 * @param {SubtitleClip} clip Subtitle to play.
	 * @returns {void}
	 */
	function toggleSubtitlePlayback(clip: SubtitleClip): void {
		const videoPreview = globalState.getVideoPreviewState;
		if (playbackClipId === clip.id && videoPreview.isPlaying) {
			videoPreview.togglePlayPause();
			playbackClipId = null;
			return;
		}

		globalState.getTimelineState.cursorPosition = clip.startTime;
		globalState.getTimelineState.movePreviewTo = clip.startTime;
		playbackClipId = clip.id;
		if (!videoPreview.isPlaying) videoPreview.togglePlayPause();
	}

	/**
	 * Returns whether a subtitle is currently being played.
	 * @param {number} clipId Subtitle identifier.
	 * @returns {boolean} Whether the subtitle is active.
	 */
	function isSubtitlePlaying(clipId: number): boolean {
		return playbackClipId === clipId && globalState.getVideoPreviewState.isPlaying;
	}

	$effect(() => {
		if (playbackClipId === null) return;

		const videoPreview = globalState.getVideoPreviewState;
		if (!videoPreview.isPlaying) {
			playbackClipId = null;
			return;
		}

		const clip = globalState.getSubtitleTrack.getClipById(playbackClipId);
		if (!clip) {
			playbackClipId = null;
			return;
		}

		const cursorPosition = globalState.getTimelineState.cursorPosition;
		if (cursorPosition < clip.startTime || cursorPosition >= clip.endTime) {
			videoPreview.togglePlayPause();
			playbackClipId = null;
		}
	});

	let visibleCount = $state(PAGE_SIZE);
	const translationsEditorState = () =>
		globalState.currentProject!.projectEditorState.translationsEditor;
	const editionsToShow = $derived(() =>
		globalState.getProjectTranslation.addedTranslationEditions.filter(
			(language) => language.showInTranslationsEditor
		)
	);

	/**
	 * Garantit que chaque sous-titre possède une traduction structurée pour chaque langue.
	 * @returns {void}
	 */
	function ensureSubtitleTranslations(): void {
		globalState.getProjectTranslation.normalizeProjectLanguages();
		const supportedStatuses = new Set([
			'to translate',
			'ai translated',
			'reviewed',
			'completed by default',
			'error'
		]);
		const filters = translationsEditorState().filters;
		if (filters['to review'] !== undefined && filters['to translate'] === undefined) {
			filters['to translate'] = filters['to review'];
		}
		delete filters['to review'];

		for (const subtitle of globalState.getSubtitleClips) {
			for (const language of globalState.getProjectTranslation.addedTranslationEditions) {
				const existing = subtitle.translations[language.name];
				if (!existing) {
					subtitle.translations[language.name] =
						globalState.getProjectTranslation.createTranslationForText(subtitle.text);
					continue;
				}
				if (!(existing instanceof VerseTranslation)) continue;

				if (!existing.isStructuredTranslation) {
					const migratedDraft = getStructuredTranslationDraft(subtitle.text, existing.text);
					existing.text = serializeStructuredTranslation(migratedDraft);
					existing.isStructuredTranslation = true;
					existing.isBruteForce = true;
					existing.clearInlineStyles();
					existing.clearWbwRanges();
				}
				if (existing.status === 'to review') existing.status = 'to translate';
				else if (!supportedStatuses.has(existing.status)) existing.status = 'to translate';
			}
		}
	}

	const subtitlesToShow = $derived(() => {
		const search = translationsEditorState().searchQuery.trim().toLowerCase();
		const filters = translationsEditorState().filters;
		const visibleEditionNames = new Set(editionsToShow().map((language) => language.name));

		return globalState.getSubtitleClips.filter((subtitle) => {
			const visibleTranslations = Object.entries(subtitle.translations).filter(([name]) =>
				visibleEditionNames.has(name)
			);
			if (visibleTranslations.length === 0) return false;

			const matchesStatus = visibleTranslations.some(
				([, translation]) => filters[translation.status]
			);
			if (!matchesStatus) return false;
			if (!search) return true;

			return (
				subtitle.text.toLowerCase().includes(search) ||
				visibleTranslations.some(([, translation]) =>
					translation.text.toLowerCase().includes(search)
				)
			);
		});
	});

	/**
	 * Retourne l'index visible d'un clip pour la reprise de lecture.
	 * @param {number} clipId Identifiant du clip.
	 * @returns {number} Index du clip ou `-1`.
	 */
	function getGroupIndexForClipId(clipId: number): number {
		return subtitlesToShow().findIndex((clip) => clip.id === clipId);
	}

	const lastRead = createWorkspaceLastRead({
		getEditorState: translationsEditorState,
		getGroupIndexForClipId,
		getVisibleCount: () => visibleCount,
		setVisibleCount: (count) => {
			visibleCount = count;
		},
		saveProject: () => globalState.currentProject?.save(false)
	});

	/**
	 * Charge la page suivante lorsque l'utilisateur atteint le bas du workspace.
	 * @param {HTMLElement} container Conteneur scrollable.
	 * @returns {void}
	 */
	function loadMoreIfNeeded(container: HTMLElement): void {
		if (container.scrollTop + container.clientHeight < container.scrollHeight - 50) return;
		visibleCount = Math.min(visibleCount + PAGE_SIZE, subtitlesToShow().length);
	}

	/**
	 * Fait défiler le workspace vers un clip demandé par une autre partie de l'éditeur.
	 * @param {number} clipId Identifiant du clip.
	 * @returns {void}
	 */
	function scrollToRequestedClip(clipId: number): void {
		const index = getGroupIndexForClipId(clipId);
		if (index < 0) return;
		visibleCount = Math.max(visibleCount, index + 1);
		setTimeout(() => {
			const target = lastRead.container?.querySelector(`[data-translation-clip-id="${clipId}"]`);
			if (target instanceof HTMLElement)
				target.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}, 0);
	}

	$effect(() => {
		const _clips = globalState.getSubtitleClips.map((clip) => `${clip.id}:${clip.text}`);
		const _languages = globalState.getProjectTranslation.addedTranslationEditions.map(
			(language) => language.name
		);
		ensureSubtitleTranslations();
	});

	$effect(() => {
		const total = subtitlesToShow().length;
		if (visibleCount > total) visibleCount = total;
		if (total > 0 && visibleCount === 0) visibleCount = Math.min(PAGE_SIZE, total);
	});

	$effect(() => {
		lastRead.tryResume();
	});

	$effect(() => {
		const targetClipId = globalState.shared.translationScrollTargetClipId;
		if (targetClipId === null) return;
		scrollToRequestedClip(targetClipId);
		globalState.shared.translationScrollTargetClipId = null;
	});

	onMount(() => lastRead.init());
	onDestroy(() => lastRead.cleanup());
</script>

<section
	data-tour-id="translations-workspace"
	class="min-h-0 bg-secondary border border-color rounded-lg shadow-lg h-full overflow-y-auto overflow-x-hidden"
	id="translations-workspace"
	bind:this={lastRead.container}
	onscroll={(event) => {
		const container = event.currentTarget as HTMLElement;
		loadMoreIfNeeded(container);
		lastRead.scheduleViewportCapture(container);
	}}
>
	{#if globalState.getProjectTranslation.addedTranslationEditions.length === 0}
		<div class="flex items-center flex-col gap-6 justify-center h-full pb-10">
			<div class="flex flex-col items-center gap-4">
				<div class="w-16 h-16 bg-accent rounded-full flex items-center justify-center">
					<span class="material-icons text-accent text-2xl">translate</span>
				</div>
				<div class="text-center">
					<h3 class="text-primary text-lg font-semibold mb-2">
						{$LL.editor.noTranslationsYetHeading()}
					</h3>
					<p class="text-thirdly text-sm max-w-md">{$LL.editor.startByAdding()}</p>
				</div>
			</div>
			<button
				class="btn-accent px-6 py-3 text-sm font-semibold rounded-lg flex items-center gap-2"
				onclick={() => setAddTranslationModalVisibility(true)}
			>
				<span class="material-icons text-base">add</span>
				{$LL.translations.addTranslation()}
			</button>
		</div>
	{:else}
		<div class="flex min-h-full p-4 flex-col bg-secondary gap-y-4">
			{#if translationsEditorState().isInlineStyleMode}
				<div
					class="sticky top-0 z-20 flex items-start justify-between gap-3 rounded-xl border border-[var(--accent-primary)]/45 bg-[color-mix(in_srgb,var(--accent-primary)_14%,var(--bg-secondary))] px-4 py-3 text-primary shadow-lg backdrop-blur"
				>
					<div class="flex min-w-0 gap-3">
						<span class="material-icons-outlined text-accent-primary">brush</span>
						<div class="min-w-0">
							<p class="text-sm font-semibold">{$LL.editor.wordStylingActive()}</p>
							<p class="mt-1 text-xs leading-relaxed text-secondary">
								{$LL.editor.wordStylesDescription()}
							</p>
						</div>
					</div>
					<button
						class="btn-accent px-3 py-1.5 text-xs font-semibold"
						onclick={() => (translationsEditorState().isInlineStyleMode = false)}
					>
						{$LL.editor.exitStyling()}
					</button>
				</div>
			{/if}

			{#if subtitlesToShow().length === 0}
				<NoTranslationsToShow />
			{:else}
				{#each subtitlesToShow().slice(0, visibleCount) as clip (clip.id)}
					<section
						class="relative rounded-xl border border-color bg-primary/25 p-4 text-primary transition-all duration-300 {lastRead.highlightedClipId ===
						clip.id
							? 'ring-1 ring-[var(--accent-primary)]/50'
							: ''}"
						data-translation-clip-id={clip.id}
					>
						<ArabicText
							subtitle={clip as SubtitleClip}
							isPlaying={isSubtitlePlaying(clip.id)}
							onPlaybackToggle={() => toggleSubtitlePlayback(clip as SubtitleClip)}
						/>
						<div class="mt-4 space-y-3">
							{#each editionsToShow() as edition (edition.name)}
								<Translation {edition} subtitle={clip as SubtitleClip} />
							{/each}
						</div>
					</section>
				{/each}
				{#if visibleCount < subtitlesToShow().length}
					<div class="text-center py-4 text-thirdly text-sm">{$LL.editor.scrollingToLoad()}</div>
				{/if}
			{/if}
		</div>
	{/if}
</section>
