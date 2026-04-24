<script lang="ts">
	import { AssetClip, PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes';
	import {
		canonicalizePredefinedSubtitleType,
		hasClipReviewIssue,
		isClipPendingVerification
	} from '$lib/classes/Clip.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		clearLongSegmentsReview,
		getLongSubtitleClips,
		markLongSegmentsForReview,
		subdivideLongSubtitleSegments
	} from '$lib/services/AutoSegmentation';
	import AutoSegmentationModal from './modal/AutoSegmentationModal.svelte';

	import { fade } from 'svelte/transition';
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';

	let presetChoice: string = $state('');
	let autoSegmentationModalVisible = $state(false);

	// Compte le nombre de segments à revue
	let segmentsNeedingReview = $derived(
		(globalState.getSubtitleTrack?.clips || []).filter(
			(clip): clip is SubtitleClip | PredefinedSubtitleClip =>
				(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
				isClipPendingVerification(clip)
		).length
	);
	// Compte le nombre de segments initialement à review
	let initialLowConfidenceCount = $derived(
		(globalState.getSubtitleTrack?.clips || []).filter(
			(clip): clip is SubtitleClip | PredefinedSubtitleClip =>
				(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
				hasClipReviewIssue(clip)
		).length
	);
	// Compte le nombre de segments revus
	let reviewedCount = $derived(
		(globalState.getSubtitleTrack?.clips || []).filter(
			(clip): clip is SubtitleClip | PredefinedSubtitleClip =>
				(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
				hasClipReviewIssue(clip) &&
				clip.hasBeenVerified === true
		).length
	);
	let lowConfidenceSegmentsNeedingReview = $derived(
		(globalState.getSubtitleTrack?.clips || []).filter(
			(clip): clip is SubtitleClip | PredefinedSubtitleClip =>
				(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
				isClipPendingVerification(clip) &&
				clip.needsReview
		).length
	);
	let coverageSegmentsNeedingReview = $derived(
		(globalState.getSubtitleTrack?.clips || []).filter(
			(clip): clip is SubtitleClip | PredefinedSubtitleClip =>
				(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
				isClipPendingVerification(clip) &&
				clip.needsCoverageReview
		).length
	);
	let longSegmentsNeedingReview = $derived(
		(globalState.getSubtitleTrack?.clips || []).filter(
			(clip): clip is SubtitleClip | PredefinedSubtitleClip =>
				(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
				isClipPendingVerification(clip) &&
				clip.needsLongReview
		).length
	);
	let longSegmentsMatchingThreshold = $derived(
		getLongSubtitleClips(globalState.getSubtitlesEditorState.longSegmentMinWords).length
	);
	let longSegmentsMarkedCount = $derived(
		(globalState.getSubtitleClips || []).filter((clip) => clip.needsLongReview === true).length
	);
	let hasSubtitleSegments = $derived((globalState.getSubtitleClips || []).length > 0);
	let hasUsedAiSegmentation = $derived(
		globalState.getSubtitlesEditorState.segmentationContext.source !== null
	);
	const SUBDIVIDE_MIN_LIMIT = 1;
	const SUBDIVIDE_MAX_LIMIT = 30;
	const SUBDIVIDE_DISABLED_SENTINEL = SUBDIVIDE_MAX_LIMIT + 1;
	let enableMaxWords = $state(
		globalState.getSubtitlesEditorState.subdivideMaxWordsPerSegment < SUBDIVIDE_MAX_LIMIT
	);
	let enableMaxDuration = $state(
		globalState.getSubtitlesEditorState.subdivideMaxDurationPerSegment < SUBDIVIDE_MAX_LIMIT
	);
	let lastEnabledMaxWords = $state(SUBDIVIDE_MAX_LIMIT);
	let lastEnabledMaxDuration = $state(SUBDIVIDE_MAX_LIMIT);

	// Navigation vers le prochain segment à review
	function goToNextSegmentToReview() {
		const clips = (globalState.getSubtitleTrack?.clips || [])
			.filter(
				(clip): clip is SubtitleClip | PredefinedSubtitleClip =>
					(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
					isClipPendingVerification(clip)
			)
			.sort((a, b) => a.startTime - b.startTime);
		// Trouve le premier segment à review (trié par startTime)
		if (clips.length === 0) return;

		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const nextSegment =
			clips.find((clip) => clip.startTime > cursorPosition) ??
			clips.find((clip) => clip.startTime <= cursorPosition && clip.endTime >= cursorPosition) ??
			clips[0];

		if (nextSegment) {
			// Déplace le curseur de la timeline au début du segment
			moveCursorToSubtitle(nextSegment);

			// On ignore la vérification automatique pour ce saut explicite vers le prochain segment
			setTimeout(() => {
				nextSegment.hasBeenVerified = false;
			}, 0);
		}
	}

	/**
	 * Déplace le curseur de la timeline sur un sous-titre donné.
	 *
	 * @param {SubtitleClip} clip Sous-titre cible.
	 */
	function moveCursorToSubtitle(clip: SubtitleClip | PredefinedSubtitleClip): void {
		globalState.getTimelineState.cursorPosition = clip.startTime;
		globalState.getTimelineState.movePreviewTo = clip.startTime;
		globalState.getVideoPreviewState.scrollTimelineToCursor();
	}

	/**
	 * Marque en rose tous les segments dépassant le seuil courant.
	 */
	function handleMarkLongSegments(): void {
		const markedCount = markLongSegmentsForReview(
			globalState.getSubtitlesEditorState.longSegmentMinWords
		);
		if (markedCount <= 0) {
			toast('No long segment matches the current threshold.');
			return;
		}

		toast.success(`${markedCount} long segment${markedCount > 1 ? 's were' : ' was'} marked.`);
	}

	/**
	 * Efface tous les marquages roses de segments longs.
	 */
	function handleClearLongSegments(): void {
		clearLongSegmentsReview();
	}

	/**
	 * Lance la subdivision automatique des segments longs selon les critères actifs.
	 */
	async function handleSubdivideLongSegments(): Promise<void> {
		if (!globalState.getSubtitlesEditorState.segmentationContext.includeWbwTimestamps) {
			toast.error(
				'These subtitles were generated without word-by-word timestamps. Enable "Include word-by-word timestamps" in Segmentation settings, then run the segmentation again.'
			);
			return;
		}

		const splitCount = await subdivideLongSubtitleSegments();
		if (splitCount <= 0) {
			toast('No subtitles match the current split rules.');
			return;
		}

		toast.success(
			`${splitCount} subtitle split${splitCount > 1 ? 's were' : ' was'} applied automatically.`
		);
	}

	type SpecialPreset =
		| 'Silence'
		| 'Basmala'
		| "Isti'adha"
		| 'Amin'
		| 'Takbir'
		| 'Tahmeed'
		| 'Tasleem'
		| 'Sadaqa';

	function isSpecialPreset(value: string): value is SpecialPreset {
		return (
			value === 'Silence' ||
			value === 'Basmala' ||
			value === "Isti'adha" ||
			value === 'Amin' ||
			value === 'Takbir' ||
			value === 'Tahmeed' ||
			value === 'Tasleem' ||
			value === 'Sadaqa'
		);
	}

	function isEditableSubtitle(
		clip: { type?: string } | null
	): clip is SubtitleClip | PredefinedSubtitleClip | SilenceClip {
		return (
			!!clip &&
			(clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle' || clip.type === 'Silence')
		);
	}

	$effect(() => {
		const editSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (editSubtitle) {
			switch (editSubtitle.type) {
				case 'Silence':
					presetChoice = 'Silence';
					break;
				case 'Pre-defined Subtitle': {
					const predefinedSubtitle = editSubtitle as PredefinedSubtitleClip;
					const normalizedType = canonicalizePredefinedSubtitleType(
						predefinedSubtitle.predefinedSubtitleType
					);
					presetChoice = normalizedType === 'Other' ? '' : normalizedType;
					break;
				}
				case 'Subtitle':
					presetChoice = "Qur'an";
					break;
				default:
					presetChoice = '';
			}
		} else {
			presetChoice = '';
		}
	});

	async function applySubtitleChanges() {
		// Si on veut changer le sous-titre en Qur'an
		if (presetChoice === "Qur'an") {
			// Alors on explique à l'utilisateur qu'il doit sélectionner les mots
			await ModalManager.confirmModal(
				"To make this subtitle Qur'an, please select the words in the selector and press Enter to apply it."
			);
		} else {
			// Sinon on applique le changement de sous-titre
			const subtitleTrack = globalState.getSubtitleTrack;
			const editSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
			if (!isSpecialPreset(presetChoice) || !isEditableSubtitle(editSubtitle)) {
				return;
			}
			subtitleTrack.editSubtitleToSpecial(editSubtitle, presetChoice);

			// Si un ID de sous-titre suivant est en attente (après une division), on passe à ce sous-titre
			const pendingId = globalState.getSubtitlesEditorState.pendingSplitEditNextId;
			if (pendingId && editSubtitle.id !== pendingId) {
				const nextClip = subtitleTrack.getClipById(pendingId);
				globalState.getSubtitlesEditorState.editSubtitle = nextClip ?? null;
			} else {
				globalState.getSubtitlesEditorState.editSubtitle = null;
			}
			globalState.getSubtitlesEditorState.pendingSplitEditNextId = null;
		}
	}

	function handleEditModeShortcut(event: KeyboardEvent) {
		const editSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (!isEditableSubtitle(editSubtitle)) return;

		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
			return;
		}

		const key = event.key.toLowerCase();
		let newPreset: string | null = null;

		if (key === 's') newPreset = 'Silence';
		else if (key === 'b') newPreset = 'Basmala';
		else if (key === 'i') newPreset = "Isti'adha";

		if (!newPreset) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		presetChoice = newPreset;
		void applySubtitleChanges();
	}

	onMount(() => {
		document.addEventListener('keydown', handleEditModeShortcut, true);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleEditModeShortcut, true);
	});

	$effect(() => {
		const state = globalState.getSubtitlesEditorState;
		const currentValue = state.subdivideMaxWordsPerSegment;

		if (!enableMaxWords) {
			if (currentValue >= SUBDIVIDE_MIN_LIMIT && currentValue <= SUBDIVIDE_MAX_LIMIT) {
				lastEnabledMaxWords = currentValue;
			}
			state.subdivideMaxWordsPerSegment = SUBDIVIDE_DISABLED_SENTINEL;
			return;
		}

		const fallbackValue =
			lastEnabledMaxWords >= SUBDIVIDE_MIN_LIMIT && lastEnabledMaxWords <= SUBDIVIDE_MAX_LIMIT
				? lastEnabledMaxWords
				: SUBDIVIDE_MAX_LIMIT;
		const restoredValue =
			currentValue < SUBDIVIDE_MIN_LIMIT || currentValue > SUBDIVIDE_MAX_LIMIT
				? fallbackValue
				: currentValue;
		const clampedValue = Math.min(
			SUBDIVIDE_MAX_LIMIT,
			Math.max(SUBDIVIDE_MIN_LIMIT, restoredValue)
		);
		state.subdivideMaxWordsPerSegment = clampedValue;
		lastEnabledMaxWords = clampedValue;
	});

	$effect(() => {
		const state = globalState.getSubtitlesEditorState;
		const currentValue = state.subdivideMaxDurationPerSegment;

		if (!enableMaxDuration) {
			if (currentValue >= SUBDIVIDE_MIN_LIMIT && currentValue <= SUBDIVIDE_MAX_LIMIT) {
				lastEnabledMaxDuration = currentValue;
			}
			state.subdivideMaxDurationPerSegment = SUBDIVIDE_DISABLED_SENTINEL;
			return;
		}

		const fallbackValue =
			lastEnabledMaxDuration >= SUBDIVIDE_MIN_LIMIT && lastEnabledMaxDuration <= SUBDIVIDE_MAX_LIMIT
				? lastEnabledMaxDuration
				: SUBDIVIDE_MAX_LIMIT;
		const restoredValue =
			currentValue < SUBDIVIDE_MIN_LIMIT || currentValue > SUBDIVIDE_MAX_LIMIT
				? fallbackValue
				: currentValue;
		const clampedValue = Math.min(
			SUBDIVIDE_MAX_LIMIT,
			Math.max(SUBDIVIDE_MIN_LIMIT, restoredValue)
		);
		state.subdivideMaxDurationPerSegment = clampedValue;
		lastEnabledMaxDuration = clampedValue;
	});
</script>

<div
	class="bg-secondary h-full min-h-0 overflow-y-auto border border-color rounded-lg py-6 px-3 space-y-6 border-r-0 overflow-x-hidden"
>
	<!-- Header with icon -->
	<div class="flex gap-x-2 items-center justify-center">
		<span class="material-icons text-accent text-xl">subtitles</span>
		<h2 class="text-xl font-bold text-primary">Subtitles Editor</h2>
	</div>

	{#if globalState.getSubtitlesEditorState.editSubtitle}
		<!-- Subtitle editing mode -->
		<div class="space-y-5">
			<div
				class="rounded-xl border border-[var(--border-color)]/60 bg-gradient-to-br from-secondary to-secondary/60 backdrop-blur-sm p-4 shadow-inner"
			>
				<div class="flex items-start gap-3">
					<span class="material-icons text-accent text-3xl">edit_note</span>
					<div class="xl:space-y-1">
						<h3 class="text-lg font-semibold text-primary tracking-wide flex items-center gap-2">
							Editing Subtitle
							<span
								class="px-2 py-0.5 text-[10px] uppercase rounded-full bg-accent-primary/15 text-accent-primary border border-accent-primary/30"
								>Active</span
							>
						</h3>
						<p class="text-xs leading-relaxed text-secondary">
							Select the words in the selector then press Enter to adjust the range. You can also
							quickly apply one of the presets below.
						</p>
					</div>
				</div>
			</div>
			<!-- Presets -->
			<div class="max-h-[39vh] xl:max-h-none overflow-y-auto pr-1 pt-1">
				<div class="grid grid-cols-2 gap-3">
					{#each [{ label: "Qur'an", shortcut: 'select words + enter', icon: 'menu_book', gradient: 'from-amber-600 to-amber-700' }, { label: 'Silence', shortcut: 's', icon: 'volume_off', gradient: 'from-zinc-600 to-zinc-700' }, { label: "Isti'adha", shortcut: 'i', icon: 'self_improvement', gradient: 'from-emerald-600 to-emerald-700' }, { label: 'Basmala', shortcut: 'b', icon: 'spa', gradient: 'from-indigo-600 to-indigo-700' }, { label: 'Amin', shortcut: 'none', icon: 'front_hand', gradient: 'from-blue-600 to-blue-700' }, { label: 'Takbir', shortcut: 'none', icon: 'campaign', gradient: 'from-violet-600 to-violet-700' }, { label: 'Tahmeed', shortcut: 'none', icon: 'record_voice_over', gradient: 'from-rose-600 to-rose-700' }, { label: 'Tasleem', shortcut: 'none', icon: 'waving_hand', gradient: 'from-teal-600 to-teal-700' }, { label: 'Sadaqa', shortcut: 'none', icon: 'verified', gradient: 'from-orange-600 to-orange-700' }] as preset (preset.label)}
						<button
							class="group relative overflow-hidden rounded-lg border transition-all duration-300 focus:outline-none cursor-pointer {presetChoice ===
							preset.label
								? 'border-accent-primary bg-accent-primary/10 shadow-lg shadow-accent-primary/30'
								: 'border-[var(--border-color)]/50 bg-secondary/70 hover:shadow-lg hover:shadow-accent-primary/20'} focus:ring-2 focus:ring-accent-primary/60"
							onclick={() => {
								presetChoice = preset.label;
							}}
						>
							<div
								class="absolute inset-0 bg-gradient-to-br transition-opacity duration-300 {preset.gradient} {presetChoice ===
								preset.label
									? 'opacity-75'
									: 'opacity-0 group-hover:opacity-90'}"
							></div>
							<div class="relative flex flex-col items-center justify-center py-4 gap-1">
								<span
									class="material-icons text-xl transition-all duration-300 {presetChoice ===
									preset.label
										? 'text-white scale-110'
										: 'text-accent-primary group-hover:scale-110 group-hover:text-white'}"
								>
									{preset.icon}
								</span>
								<span
									class="text-xs font-medium tracking-wide transition-all duration-300 {presetChoice ===
									preset.label
										? 'text-white'
										: 'text-secondary group-hover:text-white'}"
								>
									{preset.label}
								</span>
								<span
									class="text-[9px] opacity-45 uppercase tracking-wide transition-all duration-300 {presetChoice ===
									preset.label
										? 'text-white/90'
										: 'text-secondary/70 group-hover:text-white/90'}"
								>
									{preset.shortcut}
								</span>
							</div>
						</button>
					{/each}
				</div>
			</div>

			<!-- Actions -->
			<div class="flex items-center justify-center gap-4 pt-2">
				<button
					class="flex items-center gap-2 px-3 py-2 rounded-md bg-accent-primary text-black text-xs font-semibold tracking-wide hover:brightness-110 transition cursor-pointer"
					onclick={applySubtitleChanges}
				>
					<span class="material-icons text-base">done</span>
					Apply
				</button>
				<button
					class="flex items-center gap-2 px-3 py-2 rounded-md border border-color text-secondary text-xs hover:bg-secondary/60 transition cursor-pointer"
					onclick={() => {
						globalState.getSubtitlesEditorState.editSubtitle = null;
						globalState.getSubtitlesEditorState.pendingSplitEditNextId = null;
					}}
				>
					<span class="material-icons text-base">close</span>
					Cancel
				</button>
			</div>
		</div>
	{:else}
		<!-- Playback Speed Section -->
		<div class="space-y-3">
			<h3 class="text-sm font-medium text-secondary mb-3">Playback Speed</h3>
			<div class="flex items-center justify-center gap-1 2xl:gap-2">
				{#each [0.75, 1, 1.5, 1.75, 2] as speed (speed)}
					<button
						class="px-2 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer hover:scale-105 border {globalState
							.currentProject!.projectEditorState.subtitlesEditor.playbackSpeed === speed
							? 'bg-accent-primary text-black border-transparent shadow-lg shadow-blue-500/25'
							: 'bg-secondary text-secondary border-color hover:bg-accent hover:text-primary hover:border-[var(--accent-primary)]'}"
						onclick={() => {
							globalState.getSubtitlesEditorState.playbackSpeed = speed;
						}}
					>
						{speed}x
					</button>
				{/each}
			</div>
		</div>

		<!-- Options Section -->
		<div class="space-y-4">
			<h3 class="text-sm font-medium text-secondary mb-3">Display Options</h3>

			<div class="bg-accent rounded-lg p-4 space-y-4">
				<div class="flex items-center justify-between">
					<label class="text-sm font-medium text-primary cursor-pointer" for="showWordTranslation">
						Show Word Translation
					</label>
					<input
						id="showWordTranslation"
						type="checkbox"
						bind:checked={globalState.getSubtitlesEditorState.showWordTranslation}
						class="w-5 h-5"
					/>
				</div>

				<div class="flex items-center justify-between">
					<label
						class="text-sm font-medium text-primary cursor-pointer"
						for="showWordTransliteration"
					>
						Show Word Transliteration
					</label>
					<input
						id="showWordTransliteration"
						type="checkbox"
						bind:checked={globalState.getSubtitlesEditorState.showWordTransliteration}
						class="w-5 h-5"
					/>
				</div>
			</div>
		</div>

		<!-- Progress Section -->
		<div class="space-y-3">
			<h3 class="text-sm font-medium text-secondary mb-3">Caption Progress</h3>
			<div class="bg-accent rounded-lg p-4">
				<div class="flex items-center justify-between mb-2">
					<span class="text-sm text-secondary">Completion</span>
					<span class="text-sm font-bold text-accent">
						{globalState.currentProject!.detail.percentageCaptioned}%
					</span>
				</div>
				<div class="w-full bg-secondary rounded-full h-3 relative overflow-hidden">
					<div
						class="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] h-full rounded-full
					       transition-all duration-500 ease-out relative"
						style="width: {globalState.currentProject!.detail.percentageCaptioned}%"
					>
						<div class="absolute inset-0 bg-white/20 rounded-full animate-pulse"></div>
					</div>
				</div>
			</div>
		</div>

		<div class="space-y-4">
			<h3 class="text-sm font-medium text-secondary mb-3">AI-Assisted Segmentation</h3>
			<div class="bg-accent rounded-lg p-4 space-y-3">
				<button
					data-tour-id="auto-segment-button"
					class="btn-accent w-full px-3 py-2 rounded-md text-xs flex items-center justify-center gap-2"
					type="button"
					title="Auto segment audio into Quran verses"
					onclick={() => (autoSegmentationModalVisible = true)}
				>
					<span class="material-icons text-base">auto_awesome</span>
					Auto-Segment
				</button>
			</div>
		</div>

		{#if (globalState.getAudioTrack?.clips || []).some((c) => c instanceof AssetClip && (globalState.currentProject?.content.getAssetById(c.assetId)?.metadata?.nativeTiming || globalState.currentProject?.content.getAssetById(c.assetId)?.metadata?.mp3Quran))}
			<div class="space-y-4">
				<h3 class="text-sm font-medium text-secondary mb-3">Native Timing</h3>
				<div class="bg-accent rounded-lg p-4 space-y-3">
					<button
						class="w-full px-3 py-2 rounded-md bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-[var(--accent-primary)]/20 transition cursor-pointer"
						type="button"
						onclick={async () => {
							const { runNativeSegmentation } = await import('$lib/services/AutoSegmentation');
							await runNativeSegmentation();
						}}
					>
						Load subtitles from native timing
					</button>
				</div>
			</div>
		{/if}

		<div class="space-y-3">
			{#if segmentsNeedingReview > 0}
				<h3 class="text-sm font-medium text-secondary mb-3">Needs review</h3>

				<div class="bg-accent rounded-lg p-3 space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<span class="material-icons text-yellow-400 text-sm">warning</span>
							<span class="text-xs text-secondary">Segments to review</span>
						</div>
						<span class="text-xs font-bold text-yellow-400">
							{segmentsNeedingReview} remaining
						</span>
					</div>
					<div class="w-full bg-secondary rounded-full h-2 relative overflow-hidden">
						<div
							class="bg-gradient-to-r from-green-500 to-green-400 h-full rounded-full transition-all duration-500 ease-out"
							style="width: {initialLowConfidenceCount > 0
								? (reviewedCount / initialLowConfidenceCount) * 100
								: 0}%"
						></div>
					</div>
					<div class="flex items-center justify-between text-[10px] text-thirdly">
						<span>{reviewedCount} verified</span>
						<span>{initialLowConfidenceCount} total flagged</span>
					</div>
					<div class="grid grid-cols-3 gap-2 text-[10px]">
						<div
							class="min-h-16 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-2 flex flex-col justify-between"
						>
							<p class="min-h-8 text-thirdly leading-tight text-wrap break-words">Low confidence</p>
							<p class="text-sm font-semibold leading-none text-yellow-300 self-start">
								{lowConfidenceSegmentsNeedingReview}
							</p>
						</div>
						<div
							class="min-h-16 rounded-md border border-orange-500/30 bg-orange-500/10 px-2 py-2 flex flex-col justify-between"
						>
							<p class="min-h-8 text-thirdly leading-tight text-wrap break-words">
								Coverage issues
							</p>
							<p class="text-sm font-semibold leading-none text-orange-300 self-start">
								{coverageSegmentsNeedingReview}
							</p>
						</div>
						<div
							class="min-h-16 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-2 flex flex-col justify-between"
						>
							<p class="min-h-8 text-thirdly leading-tight text-wrap break-words">Too long</p>
							<p class="text-sm font-semibold leading-none text-rose-300 self-start">
								{longSegmentsNeedingReview}
							</p>
						</div>
					</div>
					{#if segmentsNeedingReview > 0}
						<button
							class="w-full px-2 py-1.5 rounded-md bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-yellow-500/30 transition cursor-pointer"
							type="button"
							onclick={goToNextSegmentToReview}
						>
							<span class="material-icons text-sm">skip_next</span>
							Next Segment
						</button>
					{/if}
				</div>
			{/if}

			{#if hasSubtitleSegments}
				<h3 class="text-sm font-medium text-secondary mb-3">Long subtitles</h3>

				<div class="bg-accent rounded-lg p-3 space-y-3">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-1.5">
							<span class="material-icons text-pink-400 text-sm">flag</span>
							<span class="text-xs text-secondary">Mark long subtitles</span>
						</div>
						<span class="text-xs font-bold text-pink-400">{longSegmentsMarkedCount} marked</span>
					</div>

					<div class="space-y-2">
						<label class="text-[11px] text-thirdly" for="long-segment-min-words"> Min words </label>
						<input
							id="long-segment-min-words"
							type="number"
							min="1"
							bind:value={globalState.getSubtitlesEditorState.longSegmentMinWords}
							class="w-full rounded-md border border-color bg-secondary px-2 py-1.5 text-sm text-primary"
						/>
						<p class="text-[10px] text-thirdly">
							{longSegmentsMatchingThreshold} segment(s) match the current threshold.
						</p>
					</div>

					<div class="grid grid-cols-3 gap-2">
						<button
							class="px-2 py-1.5 rounded-md bg-pink-500/20 border border-pink-500/40 text-pink-300 font-medium flex items-center justify-center gap-1.5 hover:bg-pink-500/30 transition cursor-pointer text-xs {longSegmentsMarkedCount <=
							0
								? 'col-span-3'
								: 'col-span-2'}"
							type="button"
							onclick={handleMarkLongSegments}
						>
							<span class="material-icons text-sm!">flag</span>
							Mark
						</button>
						{#if longSegmentsMarkedCount > 0}
							<button
								class="px-2 py-1.5 rounded-md bg-secondary border border-color text-secondary text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-secondary/80 transition cursor-pointer"
								type="button"
								onclick={handleClearLongSegments}
							>
								<span class="material-icons text-sm!">cancel</span>
								Clear
							</button>
						{/if}
					</div>
				</div>
			{/if}

			{#if hasUsedAiSegmentation}
				<div class="bg-accent rounded-lg p-4 space-y-4">
					<p class="text-sm font-medium text-primary">Split long subtitles</p>
					<p class="text-xs text-secondary">
						Choose limits, then disable any criterion with its toggle.
					</p>

					<div class="space-y-2">
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-primary">Max words per segments</span>
							<div class="flex items-center gap-2">
								<label class="flex items-center gap-1.5 text-[11px] text-secondary">
									<input type="checkbox" bind:checked={enableMaxWords} class="w-4 h-4" />
									On
								</label>
								<input
									type="number"
									min={SUBDIVIDE_MIN_LIMIT}
									max={SUBDIVIDE_MAX_LIMIT}
									bind:value={globalState.getSubtitlesEditorState.subdivideMaxWordsPerSegment}
									class="w-16 rounded-md border border-color bg-secondary px-1.5 py-0.5 text-xs text-primary disabled:opacity-40"
									disabled={!enableMaxWords}
								/>
							</div>
						</div>
						<input
							type="range"
							min={SUBDIVIDE_MIN_LIMIT}
							max={SUBDIVIDE_MAX_LIMIT}
							step="1"
							bind:value={globalState.getSubtitlesEditorState.subdivideMaxWordsPerSegment}
							class="w-full"
							disabled={!enableMaxWords}
						/>
						<div class="flex items-center justify-between text-[10px] text-thirdly">
							<span>{SUBDIVIDE_MIN_LIMIT}</span>
							<span>{SUBDIVIDE_MAX_LIMIT}</span>
						</div>
					</div>

					<div class="space-y-2">
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-primary">Max durations per segments</span>
							<div class="flex items-center gap-2">
								<label class="flex items-center gap-1.5 text-[11px] text-secondary">
									<input type="checkbox" bind:checked={enableMaxDuration} class="w-4 h-4" />
									On
								</label>
								<input
									type="number"
									min={SUBDIVIDE_MIN_LIMIT}
									max={SUBDIVIDE_MAX_LIMIT}
									bind:value={globalState.getSubtitlesEditorState.subdivideMaxDurationPerSegment}
									class="w-16 rounded-md border border-color bg-secondary py-0.5 text-xs text-primary disabled:opacity-40"
									disabled={!enableMaxDuration}
								/>
							</div>
						</div>
						<input
							type="range"
							min={SUBDIVIDE_MIN_LIMIT}
							max={SUBDIVIDE_MAX_LIMIT}
							step="1"
							bind:value={globalState.getSubtitlesEditorState.subdivideMaxDurationPerSegment}
							class="w-full"
							disabled={!enableMaxDuration}
						/>
						<div class="flex items-center justify-between text-[10px] text-thirdly">
							<span>{SUBDIVIDE_MIN_LIMIT}</span>
							<span>{SUBDIVIDE_MAX_LIMIT}</span>
						</div>
					</div>

					<label class="flex items-start gap-2 cursor-pointer">
						<input
							type="checkbox"
							bind:checked={globalState.getSubtitlesEditorState.subdivideOnlySplitAtStopSigns}
							class="mt-0.5 w-4 h-4"
						/>
						<span class="space-y-1">
							<span class="block text-sm text-primary">Only split at stop signs</span>
							<span class="block text-xs text-thirdly">
								Segments without a waqf mark stay as-is, even if they exceed word/duration limits.
							</span>
						</span>
					</label>

					<button
						class="btn-accent w-full px-3 py-2 rounded-md text-sm flex items-center justify-center gap-2"
						type="button"
						onclick={handleSubdivideLongSegments}
					>
						<span class="material-icons text-base">call_split</span>
						Split
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if autoSegmentationModalVisible}
	<div class="modal-wrapper" transition:fade>
		<AutoSegmentationModal close={() => (autoSegmentationModalVisible = false)} />
	</div>
{/if}

<style>
	.animate-pulse {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}
</style>
