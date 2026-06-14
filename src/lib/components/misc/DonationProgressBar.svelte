<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { globalState } from '$lib/runes/main.svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	const DONATION_API_URL = 'https://api.qurancaption.com/donation/progress';
	const CACHE_MS = 5 * 60 * 1000;
	const BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

	type DonationData = {
		currentAmount: number;
		goal: number;
		updatedAt: string;
	};

	let currentAmount = $state(0);
	let goal = $state(250);
	let isLoading = $state(true);
	let isVisible = $state(true);

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

	async function handleDonateClick() {
		try {
			await openUrl('https://www.paypal.me/rayanestaszewski');
		} catch (error) {
			console.error('Failed to open PayPal:', error);
			toast.error(get(LL).donation.unableToOpenPaypal());
		}
	}

	$effect(() => {
		if (shouldShowBanner()) {
			void loadProgress();
		} else {
			isVisible = false;
		}
	});
</script>

{#if isVisible && !isLoading}
	<div class="donation-banner fixed bottom-0 left-0 right-0 z-30">
		<div class="flex items-center gap-3 sm:gap-4 px-4 py-2.5 max-w-screen-2xl mx-auto">
			<!-- Mois + objectif -->
			<div class="hidden md:flex items-center gap-2.5 min-w-0 flex-shrink-0">
				<span class="material-icons-outlined text-accent-primary text-xl">volunteer_activism</span>
				<div class="min-w-0 leading-tight">
					<p class="text-[13px] font-semibold text-primary">{monthName} goal</p>
					<p class="text-[11px] text-thirdly">{$LL.donation.donationsSupport()}</p>
				</div>
			</div>

			<!-- Barre de progression -->
			<div class="flex-1 min-w-0">
				<div class="flex items-baseline justify-between gap-2 mb-1">
					<span class="text-[15px] font-mono font-bold text-primary tracking-tight">
						${currentAmount.toFixed(0)}<span class="text-[12px] text-thirdly font-normal"
							>/${goal}</span
						>
					</span>
					<span class="text-[13px] font-mono font-semibold text-accent-primary tabular-nums">
						{percentage.toFixed(0)}%
					</span>
				</div>
				<div class="h-2 rounded-full bg-secondary/25 overflow-hidden border border-white/5">
					<div
						class="h-full rounded-full transition-all duration-700 ease-out"
						class:bg-accent-primary={!isComplete}
						class:bg-green-500={isComplete}
						style="width: {percentage}%"
					></div>
				</div>
			</div>

			<!-- Bouton don -->
			<button
				class="donate-btn shrink-0 flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200"
				onclick={handleDonateClick}
				aria-label={$LL.donation.donateToHelp()}
			>
				<span class="material-icons-outlined text-lg">favorite</span>
				<span class="hidden sm:inline">{$LL.donation.makeDonation()}</span>
			</button>

			<!-- Fermer -->
			<button
				class="close-btn shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-thirdly hover:text-primary hover:bg-secondary/40 transition-colors"
				onclick={dismissBanner}
				aria-label={get(LL).common.close()}
				title={get(LL).common.close()}
			>
				<span class="material-icons-outlined text-base">close</span>
			</button>
		</div>
	</div>

	<div class="banner-spacer h-12 sm:h-[3.25rem]"></div>
{/if}

<style>
	.donation-banner {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--accent-primary) 6%, var(--bg-secondary)) 0%,
			var(--bg-secondary) 100%
		);
		border-top: 1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-color));
		box-shadow: 0 -6px 30px rgba(0, 0, 0, 0.35);
		animation: bannerSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes bannerSlideUp {
		from {
			opacity: 0;
			transform: translateY(100%);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.donate-btn {
		background: var(--accent-primary);
		border: 1px solid var(--accent-primary);
		color: var(--text-on-accent);
	}

	.donate-btn:hover {
		box-shadow: 0 0 22px color-mix(in srgb, var(--accent-primary) 40%, transparent);
		transform: translateY(-1px);
	}
</style>
