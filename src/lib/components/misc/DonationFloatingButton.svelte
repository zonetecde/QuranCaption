<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import {
		getSupportPromptDelayMs,
		shouldShowSupportPrompt
	} from '$lib/services/SupportPromptService';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onDestroy } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import { fade } from 'svelte/transition';

	let isPromptVisible = $state(false);
	let isReviewModalOpen = $state(false);
	let reviewRating = $state(0);
	let hoveredRating = $state(0);
	let reviewComment = $state('');
	let isSubmittingReview = $state(false);
	let showPromptTimer: ReturnType<typeof setTimeout> | undefined = undefined;

	const canSubmitReview = $derived(
		!isSubmittingReview && reviewRating > 0 && reviewComment.trim().length > 0
	);

	function clearPromptTimer() {
		if (!showPromptTimer) return;
		clearTimeout(showPromptTimer);
		showPromptTimer = undefined;
	}

	function schedulePromptReappear(lastClosedAt: string | undefined) {
		clearPromptTimer();
		const delay = getSupportPromptDelayMs(lastClosedAt);
		if (delay === 0) {
			isPromptVisible = true;
			return;
		}

		isPromptVisible = false;
		showPromptTimer = setTimeout(() => {
			isPromptVisible = true;
		}, delay);
	}

	$effect(() => {
		const settings = globalState.settings;
		if (!settings) {
			isPromptVisible = false;
			clearPromptTimer();
			return;
		}

		const lastClosed = settings.persistentUiState.lastClosedSupportPromptModal;
		if (shouldShowSupportPrompt(lastClosed)) {
			isPromptVisible = true;
			clearPromptTimer();
		} else {
			schedulePromptReappear(lastClosed);
		}
	});

	onDestroy(() => {
		clearPromptTimer();
	});

	async function closeSupportPrompt() {
		if (!globalState.settings) return;

		const closedAt = new Date().toISOString();
		globalState.settings.persistentUiState.lastClosedSupportPromptModal = closedAt;
		isPromptVisible = false;
		schedulePromptReappear(closedAt);

		try {
			await Settings.save();
		} catch (error) {
			console.error('Failed to persist support prompt dismissal:', error);
			toast.error('Failed to save this preference.');
		}
	}

	async function handleDonationClick() {
		try {
			await openUrl('https://ko-fi.com/vzero');
		} catch (error) {
			console.error('Failed to open donation URL:', error);
			toast.error('Unable to open donation page.');
		}
	}

	function openReviewModal() {
		isReviewModalOpen = true;
	}

	function closeReviewModal() {
		isReviewModalOpen = false;
		hoveredRating = 0;
	}

	function resetReviewForm() {
		reviewRating = 0;
		hoveredRating = 0;
		reviewComment = '';
	}

	async function submitReview() {
		if (!canSubmitReview) return;

		isSubmittingReview = true;
		try {
			AnalyticsService.trackReview(reviewRating, reviewComment.trim(), 'support_prompt');
			toast.success('Thanks for your review.');
			resetReviewForm();
			closeReviewModal();
		} catch (error) {
			console.error('Failed to submit review event:', error);
			toast.error('Unable to send review.');
		} finally {
			isSubmittingReview = false;
		}
	}

	function setRating(star: number) {
		reviewRating = star;
	}

	function handleStarKeyDown(event: KeyboardEvent, star: number) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		setRating(star);
	}

	function handleWindowKeyDown(event: KeyboardEvent) {
		if (!isReviewModalOpen) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		closeReviewModal();
	}
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

{#if isPromptVisible}
	<section
		class="support-prompt fixed bottom-3 right-3 xl:bottom-5 xl:right-5 z-20 w-[360px] max-w-[calc(100vw-1.5rem)] rounded-xl border bg-secondary shadow-xl backdrop-blur-sm p-3"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-start gap-2 min-w-0">
				<span class="material-icons-outlined text-accent mt-[1px]">volunteer_activism</span>
				<div class="min-w-0">
					<p class="text-sm font-semibold text-primary leading-5">Enjoying Quran Caption?</p>
					<p class="text-xs text-secondary leading-5">Your feedback helps improve the app.</p>
				</div>
			</div>

			<button
				class="w-7 h-7 rounded-full flex items-center justify-center text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
				onclick={closeSupportPrompt}
				aria-label="Close support prompt"
				title="Close for 72 hours"
			>
				<span class="material-icons-outlined text-base">close</span>
			</button>
		</div>

		<div class="mt-3 flex items-center gap-2">
			<button
				class="review-btn text-xs px-3 py-2 h-10 box-border flex-1 flex items-center justify-center gap-1.5"
				onclick={openReviewModal}
				aria-label="Leave a review"
			>
				<span class="material-icons-outlined text-sm">rate_review</span>
				Leave a review
			</button>
			<button
				class="btn-accent text-xs px-3 py-2 h-10 box-border flex-1 flex items-center justify-center gap-1.5"
				onclick={handleDonationClick}
				aria-label="Make a donation"
			>
				<span class="material-icons-outlined text-sm">favorite</span>
				Make a donation
			</button>
		</div>
	</section>
{/if}

{#if isReviewModalOpen}
	<div
		class="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3"
		transition:fade
	>
		<div
			class="w-[560px] max-w-full rounded-2xl border border-color bg-secondary shadow-2xl overflow-hidden"
		>
			<div
				class="px-5 py-4 border-b border-color bg-gradient-to-r from-accent-primary/15 to-transparent"
			>
				<div class="flex items-center justify-between gap-3">
					<div>
						<h3 class="text-lg font-semibold text-primary">Leave a review</h3>
						<p class="text-sm text-secondary">Share your experience to help improve the app.</p>
					</div>
					<button
						class="w-9 h-9 rounded-full flex items-center justify-center text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
						onclick={closeReviewModal}
						aria-label="Close review modal"
					>
						<span class="material-icons-outlined">close</span>
					</button>
				</div>
			</div>

			<div class="p-5">
				<p class="text-sm font-medium text-primary">Your rating</p>
				<div class="mt-2 flex items-center gap-1">
					{#each [1, 2, 3, 4, 5] as star}
						<button
							class="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-primary/10"
							onclick={() => setRating(star)}
							onmouseenter={() => (hoveredRating = star)}
							onmouseleave={() => (hoveredRating = 0)}
							onkeydown={(event) => handleStarKeyDown(event, star)}
							aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
						>
							<span
								class={`material-icons ${
									(hoveredRating || reviewRating) >= star ? 'text-amber-400' : 'text-secondary'
								}`}
							>
								{(hoveredRating || reviewRating) >= star ? 'star' : 'star_border'}
							</span>
						</button>
					{/each}
				</div>

				<label for="support-review-comment" class="mt-4 block text-sm font-medium text-primary">
					Comment
				</label>
				<textarea
					id="support-review-comment"
					rows="5"
					maxlength={500}
					placeholder="Share your thoughts about the app..."
					class="mt-2 w-full text-sm resize-y min-h-[120px]"
					bind:value={reviewComment}
				></textarea>
				<p class="mt-1 text-xs text-thirdly">{reviewComment.length}/500</p>
			</div>

			<div class="px-5 py-4 border-t border-color flex items-center justify-end gap-2">
				<button class="btn px-4 py-2 text-sm" onclick={closeReviewModal}>Cancel</button>
				<button
					class="btn-accent px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
					onclick={submitReview}
					disabled={!canSubmitReview}
					aria-label="Send review"
				>
					<span class="material-icons-outlined text-sm">send</span>
					{isSubmittingReview ? 'Sending...' : 'Send review'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.support-prompt {
		border-color: color-mix(in srgb, var(--accent-primary) 26%, var(--border-color));
		border-width: 2px;
	}

	.review-btn {
		background-color: color-mix(in srgb, var(--accent-secondary) 18%, var(--bg-secondary));
		border: var(--border-w) solid
			color-mix(in srgb, var(--accent-secondary) 45%, var(--border-color));
		color: color-mix(in srgb, var(--text-primary) 88%, white);
		border-radius: var(--radius-m);
		transition:
			background-color var(--transition-speed) var(--transition-timing),
			border-color var(--transition-speed) var(--transition-timing),
			color var(--transition-speed) var(--transition-timing),
			scale var(--transition-speed) var(--transition-timing);
	}

	.review-btn:hover {
		background-color: color-mix(in srgb, var(--accent-secondary) 30%, var(--bg-secondary));
		border-color: color-mix(in srgb, var(--accent-secondary) 68%, var(--border-color));
		color: var(--text-primary);
		scale: 1.02;
	}
</style>
