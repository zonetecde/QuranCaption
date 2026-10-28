<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import { globalState } from '$lib/runes/main.svelte';
	import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	const DONATION_API_URL = 'https://api.qurancaption.com/donation/progress?product=minbar-caption';
	const CACHE_MS = 5 * 60 * 1000;
	const BANNER_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

	type DonationData = {
		currentAmount: number;
		goal: number;
		updatedAt: string;
	};

	let currentAmount = $state(0);
	let goal = $state(250);
	let isLoading = $state(true);
	let isVisible = $state(true);
	let isSetupDismissed = $state(false);
	const needsTranscriptionKey = $derived(
		Boolean(globalState.settings) &&
			!globalState.settings?.speechToTextSettings.groqApiKey.trim() &&
			!globalState.settings?.speechToTextSettings.elevenLabsApiKey.trim()
	);
	const setupCopy = $derived(
		$LL.settings as unknown as {
			apiSetupTitle: () => string;
			apiSetupDescription: () => string;
			configureApiKeys: () => string;
		}
	);

	let percentage = $derived(Math.min((currentAmount / goal) * 100, 100));
	let isComplete = $derived(currentAmount >= goal);

	/** Nom du mois en cours, localisé. */
	let monthName = $derived.by(() => {
		const lang = globalState.settings?.persistentUiState.language ?? 'en';
		return new Intl.DateTimeFormat(lang, { month: 'long' }).format(new Date());
	});

	let lastFetchTime = 0;
	let cachedData: DonationData | null = null;

	async function fetchProgress() {
		try {
			const response = await fetch(DONATION_API_URL);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as DonationData;
			cachedData = data;
			lastFetchTime = Date.now();
			currentAmount = data.currentAmount;
			goal = data.goal;
		} catch {
			isVisible = false;
		} finally {
			isLoading = false;
		}
	}

	async function loadProgress() {
		if (cachedData && Date.now() - lastFetchTime < CACHE_MS) {
			currentAmount = cachedData.currentAmount;
			goal = cachedData.goal;
			isLoading = false;
			return;
		}
		await fetchProgress();
	}

	function shouldShowBanner(): boolean {
		const settings = globalState.settings;
		if (!settings) return true;
		const lastClosed = settings.persistentUiState.lastClosedDonationBanner;
		if (!lastClosed) return true;
		return Date.now() - new Date(lastClosed).getTime() >= BANNER_COOLDOWN_MS;
	}

	async function dismissBanner() {
		isVisible = false;
		const settings = globalState.settings;
		if (!settings) return;
		settings.persistentUiState.lastClosedDonationBanner = new Date().toISOString();
		try {
			await Settings.save();
		} catch (error) {
			console.error('Failed to persist banner dismissal:', error);
			toast.error(get(LL).donation.failedToSavePreference());
		}
	}

	function handleDonateClick() {
		globalState.uiState.settingsTab = SettingsTab.SUPPORT;
		globalState.uiState.isSettingsOpen = true;
	}

	/**
	 * Ouvre les réglages expliquant la configuration des clés de transcription et d'IA textuelle.
	 * @returns {void}
	 */
	function openApiKeySettings(): void {
		globalState.uiState.settingsTab = SettingsTab.TRANSCRIPT_KEY;
		globalState.uiState.isSettingsOpen = true;
	}

	$effect(() => {
		if (!globalState.settings || needsTranscriptionKey) return;
		if (shouldShowBanner()) {
			void loadProgress();
		} else {
			isVisible = false;
		}
	});
</script>

{#if needsTranscriptionKey && !isSetupDismissed && !globalState.uiState.isTourActive}
	<div class="donation-banner fixed z-[900]">
		<div class="banner-content flex items-start gap-2 p-3.5 sm:p-4">
			<button
				type="button"
				class="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-start"
				onclick={openApiKeySettings}
				aria-label={setupCopy.configureApiKeys()}
			>
				<span class="banner-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
					<span class="material-icons-outlined text-2xl">key</span>
				</span>
				<span class="min-w-0 flex-1">
					<strong class="block text-[15px] font-bold leading-tight text-primary sm:text-base"
						>{setupCopy.apiSetupTitle()}</strong
					>
					<span class="mt-1 block text-xs leading-snug text-secondary sm:text-[13px]"
						>{setupCopy.apiSetupDescription()}</span
					>
					<span
						class="donate-btn mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold"
					>
						{setupCopy.configureApiKeys()}
						<span class="material-icons-outlined text-lg">arrow_forward</span>
					</span>
				</span>
			</button>
			<button
				type="button"
				class="close-btn flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-thirdly transition-colors hover:bg-white/10 hover:text-primary"
				onclick={() => {
					isSetupDismissed = true;
				}}
				aria-label={$LL.common.close()}
				title={$LL.common.close()}
			>
				<span class="material-icons-outlined text-base">close</span>
			</button>
		</div>
	</div>
{:else if !needsTranscriptionKey && isVisible && !isLoading}
	<div class="donation-banner fixed z-[900]">
		<div class="banner-content p-3.5 sm:p-4">
			<div class="flex items-start gap-3">
				<div class="banner-icon shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center">
					<span class="material-icons-outlined text-2xl">volunteer_activism</span>
				</div>

				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-3">
						<p
							class="flex flex-wrap items-center gap-x-2 text-[11px] font-bold uppercase text-accent-primary"
						>
							<span>{$LL.donation.monthlyGoal()}</span>
							<span>{monthName}</span>
						</p>
						<span class="progress-badge shrink-0 font-mono text-[12px] font-bold tabular-nums">
							{percentage.toFixed(0)}%
						</span>
					</div>
					<p class="mt-1 text-[15px] sm:text-base font-bold text-primary leading-tight">
						{$LL.donation.supportFuture()}
					</p>
					<p class="mt-1 text-[12px] sm:text-[13px] text-secondary leading-snug">
						{$LL.donation.donationsSupport()}
					</p>
				</div>

				<!-- Fermer -->
				<button
					class="close-btn shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-thirdly hover:text-primary hover:bg-white/10 transition-colors"
					onclick={dismissBanner}
					aria-label={get(LL).common.close()}
					title={get(LL).common.close()}
				>
					<span class="material-icons-outlined text-base">close</span>
				</button>
			</div>

			<div class="mt-3 flex flex-col sm:flex-row sm:items-end gap-3">
				<div class="flex-1 min-w-0">
					<span class="text-[12px] font-mono font-semibold text-primary tracking-tight">
						{$LL.donation.donationProgress({
							raised: `$${currentAmount.toFixed(0)}`,
							goal: `$${goal}`
						})}
					</span>
					<div class="progress-track mt-1.5 h-2.5 rounded-full overflow-hidden">
						<div
							class="progress-fill h-full rounded-full transition-all duration-700 ease-out"
							class:complete={isComplete}
							style="width: {percentage}%"
						></div>
					</div>
				</div>

				<!-- Bouton don -->
				<button
					class="donate-btn shrink-0 w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
					onclick={handleDonateClick}
					aria-label={$LL.donation.donateToHelp()}
				>
					<span class="material-icons-outlined text-lg">favorite</span>
					<span>{$LL.donation.makeDonation()}</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.donation-banner {
		bottom: 0;
		left: 50%;
		width: min(calc(100vw - 1rem), 760px);
		transform: translateX(-50%);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--accent-primary) 10%, var(--bg-secondary)) 0%,
				var(--bg-secondary) 100%
			),
			var(--bg-secondary);
		border: 1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-color));
		border-bottom: 0;
		border-radius: 1.25rem 1.25rem 0 0;
		box-shadow:
			0 -14px 42px rgba(0, 0, 0, 0.36),
			inset 0 1px 0 rgba(255, 255, 255, 0.12);
		overflow: hidden;
		animation: bannerSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.donation-banner::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.08),
			transparent 20%,
			transparent 80%,
			rgba(255, 255, 255, 0.05)
		);
	}

	.banner-content {
		position: relative;
	}

	.banner-icon {
		background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
		color: var(--accent-primary);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 0 18px color-mix(in srgb, var(--accent-primary) 24%, transparent);
	}

	.progress-badge {
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
		color: var(--accent-primary);
	}

	.progress-track {
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.28);
	}

	.progress-fill {
		background: linear-gradient(
			90deg,
			var(--accent-primary),
			color-mix(in srgb, var(--accent-primary) 55%, #ffffff)
		);
		box-shadow: 0 0 16px color-mix(in srgb, var(--accent-primary) 34%, transparent);
	}

	.progress-fill.complete {
		background: linear-gradient(90deg, #16a34a, #84cc16);
		box-shadow: 0 0 18px rgba(132, 204, 22, 0.45);
	}

	@keyframes bannerSlideUp {
		from {
			opacity: 0;
			transform: translate(-50%, 100%);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	.donate-btn {
		background: var(--accent-primary);
		border: 1px solid rgba(255, 255, 255, 0.22);
		color: var(--text-on-accent);
		box-shadow:
			0 10px 24px color-mix(in srgb, var(--accent-primary) 24%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.22);
	}

	.donate-btn:hover {
		box-shadow:
			0 12px 30px color-mix(in srgb, var(--accent-primary) 34%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.28);
		transform: translateY(-1px);
	}
</style>
