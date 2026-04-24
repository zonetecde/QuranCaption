<script lang="ts">
	import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
	import { hasClipReviewIssue, isClipPendingVerification } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';

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
</script>

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
				<p class="min-h-8 text-thirdly leading-tight text-wrap break-words">Coverage issues</p>
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
