<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import SupportFeedbackModal from '$lib/components/home/modals/SupportFeedbackModal.svelte';
	import {
		getSupportPromptDelayMs,
		shouldShowSupportPrompt
	} from '$lib/services/SupportPromptService';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onDestroy } from 'svelte';
	import toast from 'svelte-5-french-toast';

	let isPromptVisible = $state(false);
	let supportModalTab = $state<'review' | 'feedback'>('review');
	let isSupportModalOpen = $state(false);
	let showPromptTimer: ReturnType<typeof setTimeout> | undefined = undefined;

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

	async function handleDiscordClick() {
		try {
			await openUrl('https://discord.gg/Hxfqq2QA2J');
		} catch (error) {
			console.error('Failed to open Discord URL:', error);
			toast.error('Unable to open Discord invite.');
		}
	}

	function openReviewModal() {
		supportModalTab = 'review';
		isSupportModalOpen = true;
	}

	function openFeedbackModal() {
		supportModalTab = 'feedback';
		isSupportModalOpen = true;
	}
</script>

{#if isPromptVisible}
	<section
		class="support-prompt fixed bottom-3 right-3 xl:bottom-5 xl:right-5 z-20 w-[340px] max-w-[calc(100vw-1.5rem)] rounded-2xl overflow-hidden"
	>
		<!-- Header -->
		<div class="prompt-header px-4 py-3.5 flex items-start justify-between gap-3">
			<div class="flex items-center gap-3 min-w-0">
				<div
					class="w-9 h-9 rounded-full bg-accent-primary flex items-center justify-center flex-shrink-0 shadow-md"
				>
					<span class="material-icons-outlined text-black text-base">volunteer_activism</span>
				</div>
				<div class="min-w-0">
					<p class="text-sm font-bold text-primary leading-tight">Enjoying Quran Caption?</p>
					<p class="text-[11px] text-thirdly leading-snug mt-0.5">
						Your support helps improve the app.
					</p>
				</div>
			</div>

			<button
				class="close-btn w-7 h-7 rounded-full flex items-center justify-center text-secondary hover:text-primary transition-all duration-200"
				onclick={closeSupportPrompt}
				aria-label="Close support prompt"
				title="Close for 72 hours"
			>
				<span class="material-icons-outlined text-sm">close</span>
			</button>
		</div>

		<!-- Actions -->
		<div class="px-4 pb-4 pt-3 flex flex-col gap-2">
			<!-- Primary row -->
			<div class="flex items-center gap-2">
				<button
					class="action-btn review flex-1 text-xs px-3 py-2 h-9 flex items-center justify-center gap-1.5"
					onclick={openReviewModal}
					aria-label="Leave a review"
				>
					<span class="material-icons-outlined text-sm">star</span>
					Review
				</button>
				<button
					class="action-btn feedback flex-1 text-xs px-3 py-2 h-9 flex items-center justify-center gap-1.5"
					onclick={openFeedbackModal}
					aria-label="Request feature or report bug"
				>
					<span class="material-icons-outlined text-sm">construction</span>
					Feedback
				</button>
			</div>

			<!-- Secondary row -->
			<div class="flex items-center gap-2">
				<button
					class="action-btn discord flex-1 text-xs px-3 py-2 h-9 flex items-center justify-center gap-1.5"
					onclick={handleDiscordClick}
					aria-label="Join Discord server"
				>
					<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
						<path
							d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
						/>
					</svg>
					Discord
				</button>
				<button
					class="action-btn donate flex-1 text-xs px-3 py-2 h-9 flex items-center justify-center gap-1.5"
					onclick={handleDonationClick}
					aria-label="Make a donation"
				>
					<span class="material-icons-outlined text-sm">favorite</span>
					Donate
				</button>
			</div>
		</div>
	</section>
{/if}

{#if isSupportModalOpen}
	<SupportFeedbackModal
		initialTab={supportModalTab}
		close={() => {
			isSupportModalOpen = false;
		}}
	/>
{/if}

<style>
	/* Container */
	.support-prompt {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent-primary) 6%, var(--bg-secondary)) 0%,
			var(--bg-secondary) 100%
		);
		border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-color));
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.4),
			0 0 0 1px color-mix(in srgb, var(--accent-primary) 8%, transparent);
		animation: promptSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes promptSlideIn {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	/* Header area */
	.prompt-header {
		background: linear-gradient(
			120deg,
			color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%,
			transparent 70%
		);
		border-bottom: 1px solid color-mix(in srgb, var(--accent-primary) 12%, var(--border-color));
	}

	/* Close button */
	.close-btn {
		background: transparent;
	}
	.close-btn:hover {
		background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
	}

	/* Action buttons - shared */
	.action-btn {
		border-radius: var(--radius-m);
		font-weight: 500;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease,
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.action-btn:hover {
		transform: translateY(-1px);
		color: var(--text-primary);
	}

	/* Review */
	.action-btn.review {
		border-color: color-mix(in srgb, var(--accent-secondary) 35%, var(--border-color));
	}
	.action-btn.review:hover {
		background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
		border-color: color-mix(in srgb, var(--accent-secondary) 60%, var(--border-color));
		box-shadow: 0 3px 12px color-mix(in srgb, var(--accent-secondary) 15%, transparent);
	}

	/* Feedback */
	.action-btn.feedback {
		border-color: color-mix(in srgb, var(--accent-primary) 30%, var(--border-color));
	}
	.action-btn.feedback:hover {
		background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
		border-color: color-mix(in srgb, var(--accent-primary) 55%, var(--border-color));
		box-shadow: 0 3px 12px color-mix(in srgb, var(--accent-primary) 15%, transparent);
	}

	/* Discord */
	.action-btn.discord {
		border-color: color-mix(in srgb, #5865f2 30%, var(--border-color));
		color: color-mix(in srgb, #5865f2 70%, var(--text-secondary));
	}
	.action-btn.discord:hover {
		background: color-mix(in srgb, #5865f2 10%, transparent);
		border-color: color-mix(in srgb, #5865f2 55%, var(--border-color));
		color: #5865f2;
		box-shadow: 0 3px 12px rgba(88, 101, 242, 0.15);
	}

	/* Donate - accent filled */
	.action-btn.donate {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: var(--text-on-accent);
		font-weight: 600;
	}
	.action-btn.donate:hover {
		box-shadow: 0 4px 16px color-mix(in srgb, var(--accent-primary) 40%, transparent);
	}
</style>
