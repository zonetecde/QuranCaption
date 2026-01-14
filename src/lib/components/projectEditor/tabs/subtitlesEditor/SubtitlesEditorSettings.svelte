<script lang="ts">
	import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { globalState } from '$lib/runes/main.svelte';
	import AutoSegmentationModal from './modal/AutoSegmentationModal.svelte';

	import { fade } from 'svelte/transition';

	let presetChoice: string = $state('');
	let autoSegmentationModalVisible = $state(false);

	// Compte le nombre de segments à revue
	let segmentsNeedingReview = $derived(
		(globalState.getSubtitleClips || []).filter((clip) => clip.needsReview === true).length
	);
	// Compte le nombre de segments initialement à review
	let initialLowConfidenceCount = $derived(
		globalState.getSubtitlesEditorState?.initialLowConfidenceCount ?? 0
	);
	// Compte le nombre de segments revus
	let reviewedCount = $derived(Math.max(0, initialLowConfidenceCount - segmentsNeedingReview));

	// Navigation vers le prochain segment à review
	function goToNextSegmentToReview() {
		const clips = globalState.getSubtitleClips || [];
		// Trouve le premier segment à review (trié par startTime)
		const nextSegment = clips
			.filter((clip) => clip.needsReview === true)
			.sort((a, b) => a.startTime - b.startTime)[0];

		if (nextSegment) {
			// Déplace le curseur de la timeline au début du segment
			globalState.getTimelineState.cursorPosition = nextSegment.startTime;
			globalState.getTimelineState.movePreviewTo = nextSegment.startTime;
			globalState.getVideoPreviewState.scrollTimelineToCursor();
		}
	}

	type SpecialPreset = 'Silence' | 'Istiadhah' | 'Basmala';

	function isSpecialPreset(value: string): value is SpecialPreset {
		return value === 'Silence' || value === 'Istiadhah' || value === 'Basmala';
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
				case 'Pre-defined Subtitle':
					const predefinedSubtitle = editSubtitle as PredefinedSubtitleClip;
					switch (predefinedSubtitle.predefinedSubtitleType) {
						case 'Istiadhah':
							presetChoice = 'Istiadhah';
							break;
						case 'Basmala':
							presetChoice = 'Basmala';
							break;
						default:
							presetChoice = '';
					}
					break;
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
			globalState.getSubtitlesEditorState.editSubtitle = null;
		}
	}
</script>

<div class="bg-secondary h-full border border-color rounded-lg py-6 px-3 space-y-6 border-r-0">
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
					<div class="space-y-1">
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
			<div class="grid grid-cols-2 gap-3 pt-1">
				{#each [{ label: 'Silence', icon: 'volume_off', gradient: 'from-zinc-600 to-zinc-700' }, { label: 'Istiadhah', icon: 'self_improvement', gradient: 'from-emerald-600 to-emerald-700' }, { label: 'Basmala', icon: 'spa', gradient: 'from-indigo-600 to-indigo-700' }, { label: "Qur'an", icon: 'menu_book', gradient: 'from-amber-600 to-amber-700' }] as preset}
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
						<div class="relative flex flex-col items-center justify-center py-4 gap-2">
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
						</div>
					</button>
				{/each}
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
				{#each [0.75, 1, 1.5, 1.75, 2] as speed}
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
					class="btn-accent w-full px-3 py-2 rounded-md text-xs flex items-center justify-center gap-2"
					type="button"
					title="Auto segment audio into Quran verses"
					onclick={() => (autoSegmentationModalVisible = true)}
				>
					<span class="material-icons text-base">auto_awesome</span>
					Auto-Segment
				</button>

				{#if (globalState.getAudioTrack?.clips || []).some((c) => globalState.currentProject?.content.getAssetById(c.assetId)?.metadata?.mp3Quran)}
					<div
						class="bg-secondary/30 border border-dashed border-[var(--accent-primary)]/50 rounded-lg p-3"
					>
						<div
							class="flex items-center gap-2 mb-2 text-xs text-[var(--accent-primary)] font-medium"
						>
							<span class="material-icons text-sm">verified</span>
							Available Native Timing
						</div>
						<button
							class="w-full px-3 py-2 rounded-md bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-[var(--accent-primary)]/20 transition cursor-pointer"
							type="button"
							onclick={async () => {
							const { runNativeSegmentation } = await import('$lib/services/AutoSegmentation');
							await runNativeSegmentation();
						}}
						>
							<span class="material-icons text-base">flash_on</span>
							Auto-Segment (Mp3Quran)
						</button>
					</div>
				{/if}
			</div>
		</div>

		<div class="space-y-3">
			{#if initialLowConfidenceCount > 0 && segmentsNeedingReview > 0}
				<div class="bg-accent rounded-lg p-3 space-y-2">
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
						<span>{reviewedCount} reviewed</span>
						<span>{initialLowConfidenceCount} needs review</span>
					</div>
					<button
						class="w-full mt-2 px-2 py-1.5 rounded-md bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-yellow-500/30 transition cursor-pointer"
						type="button"
						onclick={goToNextSegmentToReview}
					>
						<span class="material-icons text-sm">skip_next</span>
						Next Segment
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
