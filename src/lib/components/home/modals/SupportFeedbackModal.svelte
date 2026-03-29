<script lang="ts">
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { invoke } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import toast from 'svelte-5-french-toast';
	import { fade } from 'svelte/transition';

	let {
		close,
		initialTab = 'review'
	}: {
		close: () => void;
		initialTab?: 'review' | 'feedback';
	} = $props();

	let activeTab = $state<'review' | 'feedback'>(initialTab);
	let feedbackType = $state<'feature' | 'bug'>('feature');
	let reviewRating = $state(0);
	let hoveredRating = $state(0);
	let email = $state('');
	let message = $state('');
	let isSubmitting = $state(false);

	const canSubmit = $derived(
		!isSubmitting &&
			email.trim().length > 0 &&
			message.trim().length > 0 &&
			(activeTab === 'feedback' || reviewRating > 0)
	);

	function resetForm() {
		activeTab = initialTab;
		feedbackType = 'feature';
		reviewRating = 0;
		hoveredRating = 0;
		email = '';
		message = '';
	}

	function closeModal() {
		resetForm();
		close();
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
		if (event.key !== 'Escape') return;
		event.preventDefault();
		closeModal();
	}

	async function submit() {
		if (!canSubmit) return;

		isSubmitting = true;
		try {
			const trimmedEmail = email.trim();
			const trimmedMessage = message.trim();

			if (activeTab === 'review') {
				AnalyticsService.trackReview(reviewRating, trimmedMessage, 'support_prompt');
			} else {
				AnalyticsService.track('support_feedback', {
					type: feedbackType,
					comment: trimmedMessage,
					source: 'support_prompt',
					created_at_iso: new Date().toISOString()
				});
			}

			const endpoint = new URL('https://www.rayanestaszewski.fr/send-message');
			endpoint.searchParams.set(
				'subject',
				activeTab === 'review'
					? 'Quran Caption Review'
					: feedbackType === 'bug'
						? 'Quran Caption Bug Report'
						: 'Quran Caption Feature Request'
			);
			endpoint.searchParams.set('email', trimmedEmail);
			endpoint.searchParams.set(
				'message',
				activeTab === 'review'
					? `Rating: ${reviewRating}/5\n\nComment: ${trimmedMessage}`
					: `Type: ${feedbackType}\n\nComment: ${trimmedMessage}`
			);

			await invoke('send_http_get', { url: endpoint.toString() });

			toast.success(
				activeTab === 'review' ? 'Thanks for your review.' : 'Thanks for your feedback.'
			);
			closeModal();
		} catch (error) {
			console.error('Failed to submit support message:', error);
			toast.error('Unable to send message.');
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div
	class="fixed inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm p-3"
	transition:fade
>
	<div
		class="bg-secondary border-color border rounded-2xl w-[680px] max-w-full max-h-[90vh] overflow-auto shadow-2xl shadow-black flex flex-col relative"
	>
		<!-- Header with gradient background -->
		<div
			class="bg-gradient-to-r from-accent to-bg-accent rounded-t-2xl px-6 py-6 border-b border-color"
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-4">
					<div
						class="w-12 h-12 bg-accent-primary rounded-full flex items-center justify-center shadow-lg"
					>
						<span class="material-icons text-black text-xl">
							{activeTab === 'review' ? 'star' : 'chat'}
						</span>
					</div>
					<div>
						<h2 class="text-2xl font-bold text-primary">
							{activeTab === 'review' ? 'Leave a Review' : 'Feature Request / Bug Report'}
						</h2>

						<p class="text-sm text-thirdly">
							{activeTab === 'review'
								? 'Your rating helps us prioritize quality.'
								: 'Share ideas or issues so we can improve Quran Caption.'}
						</p>
					</div>
				</div>

				<!-- Close button -->
				<button
					class="w-10 h-10 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary group cursor-pointer"
					onclick={closeModal}
					aria-label="Close support modal"
				>
					<span
						class="material-icons text-lg group-hover:rotate-90 transition-transform duration-200"
						>close</span
					>
				</button>
			</div>
		</div>

		<!-- Content -->
		<div class="p-6 space-y-5">
			<!-- Tab selector -->
			<div class="flex gap-3">
				<button
					class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-all duration-200 cursor-pointer text-sm font-medium {activeTab ===
					'review'
						? 'bg-accent-primary text-black border-accent-primary shadow-lg'
						: 'border-color text-secondary hover:text-primary hover:border-accent-primary'}"
					onclick={() => (activeTab = 'review')}
				>
					<span class="material-icons text-base">star</span>
					Review
				</button>
				<button
					class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-all duration-200 cursor-pointer text-sm font-medium {activeTab ===
					'feedback'
						? 'bg-accent-primary text-black border-accent-primary shadow-lg'
						: 'border-color text-secondary hover:text-primary hover:border-accent-primary'}"
					onclick={() => (activeTab = 'feedback')}
				>
					<span class="material-icons text-base">construction</span>
					Feature / Bug
				</button>
			</div>

			{#if activeTab === 'review'}
				<!-- Star rating -->
				<div class="bg-accent rounded-lg p-5 border border-color">
					<p class="text-sm font-semibold text-primary mb-3">Your rating</p>
					<div class="flex items-center gap-1.5">
						{#each [1, 2, 3, 4, 5] as star (star)}
							<button
								class="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 cursor-pointer"
								onclick={() => setRating(star)}
								onmouseenter={() => (hoveredRating = star)}
								onmouseleave={() => (hoveredRating = 0)}
								onkeydown={(event) => handleStarKeyDown(event, star)}
								aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
							>
								<span
									class="material-icons text-2xl transition-colors {(hoveredRating ||
										reviewRating) >= star
										? 'text-amber-400'
										: 'text-secondary'}"
								>
									{(hoveredRating || reviewRating) >= star ? 'star' : 'star_border'}
								</span>
							</button>
						{/each}
						{#if reviewRating > 0}
							<span class="ml-2 text-sm text-thirdly">{reviewRating}/5</span>
						{/if}
					</div>
				</div>
			{:else}
				<!-- Feedback type selector -->
				<div class="bg-accent rounded-lg p-5 border border-color">
					<p class="text-sm font-semibold text-primary mb-3">Feedback type</p>
					<div class="flex gap-3">
						<button
							class="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-all duration-200 cursor-pointer text-sm {feedbackType ===
							'feature'
								? 'bg-accent-primary text-black border-accent-primary'
								: 'border-color text-secondary hover:text-primary hover:border-accent-primary'}"
							onclick={() => (feedbackType = 'feature')}
						>
							<span class="material-icons text-base">lightbulb</span>
							Feature
						</button>
						<button
							class="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-all duration-200 cursor-pointer text-sm {feedbackType ===
							'bug'
								? 'bg-accent-primary text-black border-accent-primary'
								: 'border-color text-secondary hover:text-primary hover:border-accent-primary'}"
							onclick={() => (feedbackType = 'bug')}
						>
							<span class="material-icons text-base">bug_report</span>
							Bug
						</button>
					</div>
				</div>
			{/if}

			<!-- Email -->
			<div>
				<label for="support-email" class="block text-sm font-semibold text-primary mb-2"
					>Email</label
				>
				<input
					id="support-email"
					type="email"
					maxlength={120}
					placeholder="you@example.com"
					class="w-full text-sm rounded-lg border border-color bg-accent px-4 py-2.5 text-primary placeholder:text-thirdly focus:outline-none focus:ring-2 focus:ring-accent-primary transition-all duration-200"
					bind:value={email}
				/>
			</div>

			<!-- Message -->
			<div>
				<label for="support-message" class="block text-sm font-semibold text-primary mb-2">
					{activeTab === 'review' ? 'Comment' : 'Message'}
				</label>
				<textarea
					id="support-message"
					rows="4"
					maxlength={500}
					placeholder={activeTab === 'review'
						? 'Share your thoughts about the app...'
						: 'Describe your idea or the issue you encountered...'}
					class="w-full text-sm resize-y min-h-[110px] rounded-lg border border-color bg-accent px-4 py-2.5 text-primary placeholder:text-thirdly focus:outline-none focus:ring-2 focus:ring-accent-primary transition-all duration-200"
					bind:value={message}
				></textarea>
				<p class="mt-1 text-xs text-thirdly text-right">{message.length}/500</p>
			</div>
		</div>

		<!-- Discord help banner -->
		<div
			class="mx-6 mb-5 flex items-center gap-3 rounded-lg bg-[#5865F2]/10 border border-[#5865F2]/30 px-4 py-3"
		>
			<svg class="w-5 h-5 flex-shrink-0 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
				<path
					d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
				/>
			</svg>
			<p class="text-xs text-secondary leading-relaxed">
				Need help? Join the
				<button
					class="text-[#5865F2] font-semibold hover:underline cursor-pointer"
					onclick={() => openUrl('https://discord.gg/Hxfqq2QA2J')}
				>
					Quran Caption Discord server
				</button>
				for support and tutorials.
			</p>
		</div>

		<!-- Footer -->
		<div class="border-t border-color bg-primary px-6 py-5 rounded-b-2xl">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm text-thirdly">
					<span class="material-icons text-accent-secondary text-base">info</span>
					<span>Your message will be sent directly to the developer.</span>
				</div>

				<div class="flex gap-3">
					<button
						class="px-5 py-2.5 font-medium text-primary border border-color rounded-lg hover:bg-accent hover:border-accent-primary transition-all duration-200 cursor-pointer text-sm"
						onclick={closeModal}
					>
						Cancel
					</button>
					<button
						class="px-6 py-2.5 font-medium bg-accent-primary text-black rounded-lg hover:bg-blue-400 transition-all duration-200 flex items-center gap-2 shadow-lg cursor-pointer text-sm disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={submit}
						disabled={!canSubmit}
						aria-label={activeTab === 'review' ? 'Send review' : 'Send feedback'}
					>
						<span class="material-icons text-base">send</span>
						{isSubmitting ? 'Sending...' : activeTab === 'review' ? 'Send Review' : 'Send Feedback'}
					</button>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* Enhanced gradient backgrounds */
	.bg-gradient-to-r.from-accent.to-bg-accent {
		background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%);
	}

	/* Smooth button hover effects */
	button:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	/* Primary button special effects */
	button.bg-accent-primary:hover:not(:disabled) {
		box-shadow: 0 4px 16px rgba(88, 166, 255, 0.4);
	}

	/* Disabled button override */
	button:disabled {
		transform: none !important;
		box-shadow: none !important;
	}

	/* Modal entrance animation */
	div[class*='bg-secondary border-color'] {
		animation: modalSlideIn 0.3s ease-out;
	}

	@keyframes modalSlideIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-20px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	/* Icon rotation on close button hover */
	.group:hover .material-icons {
		transition: transform 0.2s ease;
	}
</style>
