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
		class="support-prompt fixed bottom-3 right-3 xl:bottom-5 xl:right-5 z-20 w-[360px] max-w-[calc(100vw-1.5rem)] rounded-xl border bg-secondary shadow-xl backdrop-blur-sm p-3"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-start gap-2 min-w-0">
				<span class="material-icons-outlined text-accent mt-[1px]">volunteer_activism</span>
				<div class="min-w-0">
					<p class="text-sm font-semibold text-primary leading-5">Enjoying Quran Caption?</p>
					<div class="flex items-center gap-2">
						<p class="text-xs text-secondary leading-5">Your feedback helps improve the app.</p>
						<button
							class="tiny-feedback-btn"
							onclick={openFeedbackModal}
							aria-label="Request feature or report bug"
						>
							Feature/Bug
						</button>
					</div>
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

{#if isSupportModalOpen}
	<SupportFeedbackModal
		initialTab={supportModalTab}
		close={() => {
			isSupportModalOpen = false;
		}}
	/>
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

	.tiny-feedback-btn {
		padding: 0.1rem 0.45rem;
		font-size: 0.65rem;
		line-height: 1rem;
		border-radius: 9999px;
		border: var(--border-w) solid color-mix(in srgb, var(--accent-primary) 48%, var(--border-color));
		color: var(--text-secondary);
		background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-secondary));
		transition:
			background-color var(--transition-speed) var(--transition-timing),
			color var(--transition-speed) var(--transition-timing),
			border-color var(--transition-speed) var(--transition-timing);
	}

	.tiny-feedback-btn:hover {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--accent-primary) 24%, var(--bg-secondary));
		border-color: color-mix(in srgb, var(--accent-primary) 76%, var(--border-color));
	}
</style>
