<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import Settings from '$lib/classes/Settings.svelte';
	import { ExportKind, ExportState } from '$lib/classes/Exportation.svelte';
	import SupportFeedbackModal from '$lib/components/home/modals/SupportFeedbackModal.svelte';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { DONATION_WALLETS } from '$lib/constants/donation';
	import { globalState } from '$lib/runes/main.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { shouldShowDonationPrompt } from '$lib/services/SupportPromptService';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const SUPPORT_PANEL_CONTEXT = 'post_export' as const;
	const TESTIMONIAL_COUNT = 3;

	let isPromptVisible = $state(false);
	let selectedQuoteIndex = $state(0);
	let supportModalTab = $state<'review' | 'feedback'>('feedback');
	let supportModalSource = $state<'support_prompt' | 'settings_support' | 'donation_post_export'>(
		'donation_post_export'
	);
	let isSupportModalOpen = $state(false);

	let hasInitializedExportSnapshot = false;
	const previousExportStates = new Map<number, ExportState>();

	function parseImpressions(value: unknown): number {
		if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
			return 0;
		}
		return Math.floor(value);
	}

	function detectNewVideoExportSuccess(): boolean {
		const exportations = globalState.exportations;

		// Seed snapshot first to avoid false positives from already-exported historical items.
		if (!hasInitializedExportSnapshot) {
			previousExportStates.clear();
			for (const exportation of exportations) {
				previousExportStates.set(exportation.exportId, exportation.currentState);
			}
			hasInitializedExportSnapshot = true;
			return false;
		}

		let hasNewSuccess = false;
		const activeExportIds = new Set<number>();

		for (const exportation of exportations) {
			activeExportIds.add(exportation.exportId);
			const previousState = previousExportStates.get(exportation.exportId);
			const currentState = exportation.currentState;

			if (
				exportation.exportKind === ExportKind.Video &&
				currentState === ExportState.Exported &&
				previousState !== undefined &&
				previousState !== ExportState.Exported
			) {
				hasNewSuccess = true;
			}

			previousExportStates.set(exportation.exportId, currentState);
		}

		for (const exportId of Array.from(previousExportStates.keys())) {
			if (!activeExportIds.has(exportId)) {
				previousExportStates.delete(exportId);
			}
		}

		return hasNewSuccess;
	}

	async function maybeShowDonationPrompt(): Promise<void> {
		const settings = globalState.settings;
		if (!settings) {
			isPromptVisible = false;
			return;
		}

		const hasNewVideoExportSuccess = detectNewVideoExportSuccess();
		if (!hasNewVideoExportSuccess) return;

		const lastClosedAt = settings.persistentUiState.lastClosedDonationPromptModal;
		if (!shouldShowDonationPrompt(lastClosedAt)) return;

		const impressions = parseImpressions(settings.persistentUiState.donationPromptImpressions);
		selectedQuoteIndex = impressions % TESTIMONIAL_COUNT;
		settings.persistentUiState.donationPromptImpressions = impressions + 1;
		isPromptVisible = true;

		AnalyticsService.trackSupportPanelImpression(SUPPORT_PANEL_CONTEXT, selectedQuoteIndex);

		try {
			await Settings.save();
		} catch (error) {
			console.error('Failed to persist donation prompt impression:', error);
		}
	}

	$effect(() => {
		const settings = globalState.settings;
		const exportStateSnapshot = globalState.exportations
			.map((exportation) => {
				return `${exportation.exportId}:${exportation.currentState}:${exportation.exportKind}`;
			})
			.join('|');

		settings;
		exportStateSnapshot;

		void maybeShowDonationPrompt();
	});

	async function dismissPrompt(action: 'close' | 'remind_later') {
		AnalyticsService.trackSupportPanelDismissed(SUPPORT_PANEL_CONTEXT, action);
		isPromptVisible = false;

		if (!globalState.settings) return;

		globalState.settings.persistentUiState.lastClosedDonationPromptModal = new Date().toISOString();
		try {
			await Settings.save();
		} catch (error) {
			console.error('Failed to persist donation prompt dismissal:', error);
			toast.error(get(LL).donation.failedToSavePreference());
		}
	}

	async function handleDonationClick() {
		AnalyticsService.trackSupportPanelCtaClicked(SUPPORT_PANEL_CONTEXT, 'donate');

		try {
			await openUrl('https://www.paypal.me/rayanestaszewski');
		} catch (error) {
			console.error('Failed to open PayPal URL:', error);
			toast.error(get(LL).donation.unableToOpenPaypal());
		}
	}

	async function handleKoFiClick() {
		try {
			await openUrl('https://ko-fi.com/vzero');
		} catch (error) {
			console.error('Failed to open Ko-fi URL:', error);
			toast.error(get(LL).donation.unableToOpenKofi());
		}
	}

	/**
	 * Copie une adresse de portefeuille dans le presse-papiers.
	 * @param {string} address Adresse à copier.
	 * @param {string} label Libellé affiché dans le retour visuel.
	 * @returns {Promise<void>} Promesse résolue après la tentative de copie.
	 */
	async function copyWalletAddress(address: string, label: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(address);
			toast.success(get(LL).donation.walletAddressCopied({ label }));
		} catch (error) {
			console.error(`Failed to copy ${label} address:`, error);
			toast.error(get(LL).donation.unableToCopyWallet());
		}
	}

	async function handleDiscordClick() {
		AnalyticsService.trackSupportPanelCtaClicked(SUPPORT_PANEL_CONTEXT, 'discord');

		try {
			await openUrl('https://discord.gg/Hxfqq2QA2J');
		} catch (error) {
			console.error('Failed to open Discord URL:', error);
			toast.error(get(LL).donation.unableToOpenDiscord());
		}
	}

	function openFeedbackModal() {
		AnalyticsService.trackSupportPanelCtaClicked(SUPPORT_PANEL_CONTEXT, 'feedback');
		supportModalTab = 'feedback';
		supportModalSource = 'donation_post_export';
		isSupportModalOpen = true;
	}
</script>

{#if isPromptVisible}
	<section
		class="support-prompt fixed bottom-3 right-3 xl:bottom-5 xl:right-5 z-20 w-[420px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-1.5rem)] overflow-auto rounded-2xl"
	>
		<div class="prompt-header px-4 py-3.5 flex items-start justify-between gap-3">
			<div class="flex items-start gap-3 min-w-0">
				<div
					class="w-9 h-9 rounded-full bg-accent-primary flex items-center justify-center flex-shrink-0 shadow-md mt-0.5"
				>
					<span class="material-icons-outlined text-black text-base">volunteer_activism</span>
				</div>
				<div class="min-w-0">
					<p class="text-sm font-bold text-primary leading-tight">
						{$LL.donation.supportFuture()}
					</p>
					<p class="text-[11px] text-thirdly leading-snug mt-1">
						{$LL.donation.donationsSupport()}
					</p>
				</div>
			</div>

			<button
				class="close-btn w-7 h-7 rounded-full flex items-center justify-center text-secondary hover:text-primary transition-all duration-200"
				onclick={() => dismissPrompt('close')}
				aria-label={$LL.common.closeDonationPrompt()}
				title={$LL.common.close()}
			>
				<span class="material-icons-outlined text-sm">close</span>
			</button>
		</div>

		<div class="px-4 pb-4 pt-3 flex flex-col gap-3">
			<div class="testimonial rounded-lg px-3 py-2.5">
				<p class="text-xs text-primary leading-relaxed italic">
					{#if selectedQuoteIndex === 0}
						"{$LL.donation.testimonialYahya()}"
					{:else if selectedQuoteIndex === 1}
						"{$LL.donation.testimonialAhmad()}"
					{:else}
						"{$LL.donation.testimonialSarmad()}"
					{/if}
				</p>
				<p class="text-[11px] text-thirdly mt-1.5">- {selectedQuoteIndex === 0 ? 'Brother Yahya' : selectedQuoteIndex === 1 ? 'Brother Ahmad' : 'Brother Sarmad'}</p>
			</div>

			<div class="donation-panel rounded-xl p-3.5 space-y-3">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="text-xs font-semibold uppercase tracking-[0.18em] text-thirdly">
							{$LL.donation.makeDonation()}
						</p>
					</div>
					<span class="text-[11px] text-thirdly">{$LL.donation.fastestOption()}</span>
				</div>

				<button
					class="action-btn donate w-full text-sm px-3 py-2.5 h-10 flex items-center justify-center gap-1.5"
					onclick={handleDonationClick}
					aria-label={$LL.donation.donateWithPaypal()}
				>
					<span class="material-icons-outlined text-sm">favorite</span>
					{$LL.donation.donateWithPaypal()}
				</button>

				<button
					class="action-btn kofi w-full text-sm px-3 py-2.5 h-10 flex items-center justify-center gap-1.5"
					onclick={handleKoFiClick}
					aria-label={$LL.donation.donateWithKofi()}
				>
					<span class="material-icons-outlined text-sm">coffee</span>
					{$LL.donation.donateWithKofi()}
				</button>

				<Section
					name={$LL.donation.donateInCrypto()}
					icon="account_balance_wallet"
					classes="items-center gap-2"
					contentClasses="pt-2"
					saveState={false}
					defaultExtended={false}
				>
					<div class="space-y-2">
						<p class="text-xs text-thirdly">{$LL.donation.tapWalletToCopy()}</p>
						{#each DONATION_WALLETS as wallet (wallet.label)}
							<button
								class="wallet-card w-full rounded-lg border border-color bg-secondary/70 px-3 py-2 text-left flex items-center justify-between gap-3"
								onclick={() => copyWalletAddress(wallet.address, wallet.label)}
								aria-label={$LL.common.copyWalletAddress({ wallet: wallet.label })}
							>
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="wallet-badge">{wallet.label}</span>
										<p class="text-sm font-medium text-primary">{wallet.network}</p>
									</div>
									<p class="mt-1 font-mono text-[11px] text-thirdly break-all leading-snug">
										{wallet.address}
									</p>
								</div>
								<span class="material-icons-outlined text-sm text-thirdly">content_copy</span>
							</button>
						{/each}
					</div>
				</Section>
			</div>

			<div class="secondary-links flex flex-wrap items-center justify-between gap-2">
				<button class="link-btn" onclick={openFeedbackModal} aria-label={$LL.donation.leaveFeedback()}>
					{$LL.donation.leaveFeedback()}
				</button>
				<button class="link-btn" onclick={handleDiscordClick} aria-label={$LL.donation.joinDiscord()}>
					{$LL.donation.joinDiscord()}
				</button>
				<button
					class="link-btn"
					onclick={() => dismissPrompt('remind_later')}
					aria-label={$LL.donation.remindMeLater()}
				>
					{$LL.donation.remindMeLater()}
				</button>
			</div>
		</div>
	</section>
{/if}

{#if isSupportModalOpen}
	<SupportFeedbackModal
		initialTab={supportModalTab}
		source={supportModalSource}
		close={() => {
			isSupportModalOpen = false;
		}}
	/>
{/if}

<style>
	.support-prompt {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent-primary) 7%, var(--bg-secondary)) 0%,
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

	.prompt-header {
		background: linear-gradient(
			120deg,
			color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%,
			transparent 70%
		);
		border-bottom: 1px solid color-mix(in srgb, var(--accent-primary) 12%, var(--border-color));
	}

	.close-btn:hover {
		background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
	}

	.testimonial {
		background: color-mix(in srgb, var(--bg-accent) 80%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent-primary) 14%, var(--border-color));
	}

	.donation-panel {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary)) 0%,
			color-mix(in srgb, var(--bg-accent) 75%, transparent) 100%
		);
		border: 1px solid color-mix(in srgb, var(--accent-primary) 14%, var(--border-color));
	}

	.wallet-card {
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.wallet-card:hover {
		background: color-mix(in srgb, var(--accent-primary) 7%, var(--bg-secondary));
		border-color: color-mix(in srgb, var(--accent-primary) 28%, var(--border-color));
	}

	.wallet-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.6rem;
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
		color: var(--text-primary);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.action-btn {
		border-radius: var(--radius-m);
		font-weight: 600;
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
	}

	.action-btn.donate {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: var(--text-on-accent);
	}

	.action-btn.donate:hover {
		box-shadow: 0 4px 16px color-mix(in srgb, var(--accent-primary) 40%, transparent);
	}

	.action-btn.kofi {
		border-color: color-mix(in srgb, #ff5f5f 28%, var(--border-color));
		color: color-mix(in srgb, #ff5f5f 80%, var(--text-secondary));
	}

	.action-btn.kofi:hover {
		background: rgba(255, 95, 95, 0.08);
		border-color: color-mix(in srgb, #ff5f5f 55%, var(--border-color));
		box-shadow: 0 4px 16px rgba(255, 95, 95, 0.18);
	}

	.secondary-links {
		font-size: 12px;
	}

	.link-btn {
		color: var(--text-secondary);
		text-decoration: underline;
		text-underline-offset: 3px;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: color 0.18s ease;
	}

	.link-btn:hover {
		color: var(--text-primary);
	}
</style>
