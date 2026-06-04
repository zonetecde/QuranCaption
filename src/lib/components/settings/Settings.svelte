<script lang="ts">
	import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import ShortcutsManager from './ShortcutsManager.svelte';
	import About from './About.svelte';
	import BackupSettings from './BackupSettings.svelte';
	import AiKeySettings from './AiKeySettings.svelte';
	import QuranIntegrationSettings from './QuranIntegrationSettings.svelte';
	import ThemeButton, { type ThemeConfig } from './ThemeButton.svelte';
	import AiTranslationTelemetryService from '$lib/services/AiTranslationTelemetryService';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { DONATION_WALLETS } from '$lib/constants/donation';

	import SupportFeedbackModal from '$lib/components/home/modals/SupportFeedbackModal.svelte';
	import LanguageSwitcher from '$lib/components/misc/LanguageSwitcher.svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let {
		resolve
	}: {
		resolve: (result: boolean) => void;
	} = $props();

	const lightThemes: ThemeConfig[] = [
		{
			id: 'polar-ice',
			name: 'Light & Ice',
			mockBg: '#f3f6f9',
			mockTitlebar: '#ffffff',
			mockAccent: '#6366f1',
			mockDots: 'rgba(0,0,0,0.1)',
			mockText: 'rgba(0,0,0,0.1)'
		},
		{
			id: 'minimal-zen',
			name: 'Light & Minimal',
			mockBg: '#f9f9f9',
			mockAccent: '#111827',
			mockDots: 'rgba(0,0,0,0.1)',
			mockText: 'rgba(0,0,0,0.1)'
		}
	];

	let supportModalTab = $state<'review' | 'feedback'>('review');
	let supportModalSource = $state<'support_prompt' | 'settings_support' | 'donation_post_export'>(
		'settings_support'
	);
	let isSupportModalOpen = $state(false);

	/**
	 * Copie une adresse de portefeuille dans le presse-papiers.
	 * @param {string} address Adresse à copier.
	 * @param {string} label Libellé affiché dans le toast.
	 * @returns {Promise<void>} Promesse résolue après la tentative de copie.
	 */
	async function copyWalletAddress(address: string, label: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(address);
			toast.success(get(LL).settings.copiedToClipboard({ label }));
		} catch (error) {
			console.error(`Failed to copy ${label} address:`, error);
			toast.error(get(LL).settings.unableToCopyWallet());
		}
	}

	function openSupportModal(
		tab: 'review' | 'feedback',
		source: 'support_prompt' | 'settings_support' | 'donation_post_export' = 'settings_support'
	) {
		supportModalTab = tab;
		supportModalSource = source;
		isSupportModalOpen = true;
	}

	async function openSupportLink(url: string, fallbackLabel: string) {
		try {
			await openUrl(url);
		} catch (error) {
			console.error(`Failed to open ${fallbackLabel} URL:`, error);
			toast.error(get(LL).settings.unableToOpen({ label: fallbackLabel }));
		}
	}

	async function updateAiTelemetryConsent(consent: 'unknown' | 'granted' | 'denied') {
		await AiTranslationTelemetryService.setTelemetryConsent(consent);
	}

	const sepiaThemes: ThemeConfig[] = [
		{
			id: 'desert-gold',
			name: 'Sepia Gold',
			mockBg: '#f4ecd8',
			mockTitlebar: '#e4d8b9',
			mockAccent: '#d4a017',
			mockDots: 'rgba(0,0,0,0.2)',
			mockText: 'rgba(0,0,0,0.2)'
		},
		{
			id: 'vintage-paper',
			name: 'Sepia Paper',
			mockBg: '#f4ecd8',
			mockTitlebar: '#e4d8b9',
			mockAccent: '#8b4513',
			mockDots: 'rgba(0,0,0,0.2)',
			mockText: 'rgba(0,0,0,0.2)'
		}
	];

	const darkThemes: ThemeConfig[] = [
		{
			id: 'default',
			name: 'Dark & Blue',
			mockBg: '#0d1117',
			mockTitlebar: '#161b22',
			mockAccent: '#58a6ff',
			mockDots: 'rgba(255,255,255,0.3)'
		},
		{
			id: 'emerald-forest',
			name: 'Dark & Green',
			mockBg: '#060908',
			mockTitlebar: '#0c120e',
			mockAccent: '#10b981'
		},
		{
			id: 'oled-stealth',
			name: 'Dark & Neon',
			mockBg: '#000000',
			mockAccent: '#00ff41',
			mockDots: 'rgba(255,255,255,0.2)'
		},
		{
			id: 'ethereal-glass',
			name: 'Dark & Glass',
			mockBg: 'rgba(15, 23, 42, 0.8)',
			mockAccent: '#ec4899',
			mockDots: 'rgba(255,255,255,0.2)',
			specialStyle: 'backdrop-filter: blur(16px);'
		},
		{
			id: 'inverted-minimal-zen',
			name: 'Dark & White',
			mockBg: '#111827',
			mockAccent: '#ffffff',
			mockDots: 'rgba(255,255,255,0.2)',
			mockText: 'rgba(255,255,255,0.1)'
		}
	];
</script>

<div
	class="bg-secondary border border-color rounded-2xl w-[800px] max-w-[94vw] h-[640px] p-0 shadow-2xl shadow-black/50 flex flex-col relative overflow-hidden"
	transition:slide
>
	<!-- Header -->
	<div class="bg-secondary px-6 py-5 border-b border-color flex items-center justify-between gap-4">
		<div class="flex items-center gap-4">
			<div
				class="w-12 h-12 bg-accent-primary rounded-full flex items-center justify-center shadow-md"
			>
				<span class="material-icons text-black text-xl">settings</span>
			</div>
			<div>
				<h2 class="text-xl font-semibold text-primary">{$LL.settings.settings()}</h2>
				<p class="text-sm text-thirdly">{$LL.settings.customizeExperience()}</p>
			</div>
		</div>

		<!-- Close btn -->
		<button
			class="w-10 h-10 rounded-full hover:bg-accent flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary"
			onclick={() => resolve(false)}
		>
			<span class="material-icons text-lg">close</span>
		</button>
	</div>

	<!-- Body -->
	<div class="grid grid-cols-[220px_1fr] gap-0 flex-1 min-h-0">
		<!-- Sidebar -->
		<div class="bg-primary border-r border-color p-3 overflow-auto flex flex-col">
			<div class="flex flex-col gap-2">
				{#each [{ name: $LL.settings.support(), tab: SettingsTab.SUPPORT, icon: 'volunteer_activism' }, { name: $LL.settings.shortcuts(), tab: SettingsTab.SHORTCUTS, icon: 'keyboard' }, { name: $LL.settings.theme(), tab: SettingsTab.THEME, icon: 'light_mode' }, { name: $LL.settings.notifications(), tab: SettingsTab.NOTIFICATIONS, icon: 'notifications' }, { name: $LL.settings.aiKey(), tab: SettingsTab.AI_KEY, icon: 'key' }, { name: $LL.settings.quranComIntegration(), tab: SettingsTab.QURAN_INTEGRATION, icon: 'account_circle' }, { name: $LL.settings.backup(), tab: SettingsTab.BACKUP, icon: 'archive' }, { name: $LL.settings.contact(), tab: SettingsTab.CONTACT, icon: 'mail' }, { name: $LL.settings.about(), tab: SettingsTab.ABOUT, icon: 'info' }] as setting (setting.tab)}
					<button
						class="flex items-center gap-3 text-sm px-3 py-2 rounded-lg w-full transition-colors duration-150 justify-start"
						class:selected={globalState.uiState.settingsTab === setting.tab}
						onclick={() => (globalState.uiState.settingsTab = setting.tab)}
					>
						<span class="material-icons text-accent-secondary">{setting.icon}</span>
						<span class="truncate">{setting.name}</span>
					</button>
				{/each}
			</div>
			<div class="mt-auto pt-3 border-t border-color">
				<LanguageSwitcher />
			</div>
		</div>

		<!-- Content -->
		<div class="p-6 overflow-auto">
			{#if globalState.uiState.settingsTab === SettingsTab.SHORTCUTS}
				<ShortcutsManager />
			{:else if globalState.uiState.settingsTab === SettingsTab.THEME}
				<!-- Theme Selection -->
				<div class="space-y-4">
					<h3 class="text-lg font-medium text-primary">{$LL.settings.theme()}</h3>
					<div class="flex items-center justify-between">
						<p class="text-sm text-thirdly">{$LL.settings.selectTheme()}</p>

						{#if globalState.settings}
							<div class="flex items-center gap-3">
								<span class="text-xs text-thirdly uppercase font-mono tracking-wider"
									>{$LL.settings.intensity()}</span
								>
								<div
									class="flex items-center gap-2 bg-secondary border border-color rounded-lg p-1"
								>
									<span class="material-icons text-white/50 text-sm">contrast</span>
									<input
										type="range"
										min="20"
										max="100"
										class="w-24 h-1.5 accent-accent-primary"
										bind:value={globalState.settings.persistentUiState.themeIntensity}
										onchange={() => Settings.save()}
									/>
									<span class="text-xs w-8 text-right font-mono"
										>{globalState.settings.persistentUiState.themeIntensity}%</span
									>
								</div>
							</div>
						{/if}
					</div>

					<div class="space-y-6">
						<div class="space-y-3">
							<p class="text-xs font-semibold uppercase tracking-wider text-thirdly">{$LL.settings.dark()}</p>
							<div class="grid grid-cols-3 gap-4">
								{#each darkThemes as theme (theme.id)}
									<ThemeButton {theme} />
								{/each}
							</div>
						</div>

						<div class="space-y-3">
							<p class="text-xs font-semibold uppercase tracking-wider text-thirdly">{$LL.settings.light()}</p>
							<div class="grid grid-cols-3 gap-4">
								{#each lightThemes as theme (theme.id)}
									<ThemeButton {theme} />
								{/each}
							</div>
						</div>

						<div class="space-y-3">
							<p class="text-xs font-semibold uppercase tracking-wider text-thirdly">{$LL.settings.sepia()}</p>
							<div class="grid grid-cols-3 gap-4">
								{#each sepiaThemes as theme (theme.id)}
									<ThemeButton {theme} />
								{/each}
							</div>
						</div>
					</div>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.AI_KEY}
				<AiKeySettings />
			{:else if globalState.uiState.settingsTab === SettingsTab.NOTIFICATIONS}
				<div class="space-y-5">
					<h3 class="text-lg font-medium text-primary">{$LL.settings.notifications()}</h3>
					<div class="rounded-xl border border-color bg-primary p-4">
						<label class="flex items-center justify-between gap-4">
							<div>
								<p class="text-sm font-medium text-primary">{$LL.settings.desktopNotifications()}</p>
								<p class="mt-1 text-xs text-thirdly">
									{$LL.settings.showOsNotifications()}
								</p>
							</div>
							<input
								type="checkbox"
								class="h-5 w-5 accent-accent-primary"
								bind:checked={globalState.settings!.persistentUiState.desktopNotificationsEnabled}
								onchange={() => Settings.save()}
							/>
						</label>
					</div>
					<p class="text-xs text-thirdly">
						{$LL.settings.taskbarAttention()}
					</p>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.QURAN_INTEGRATION}
				<QuranIntegrationSettings />
			{:else if globalState.uiState.settingsTab === SettingsTab.BACKUP}
				<BackupSettings />
			{:else if globalState.uiState.settingsTab === SettingsTab.SUPPORT}
				<div class="space-y-5">
					<h3 class="text-lg font-medium text-primary">{$LL.settings.support()}</h3>
					<p class="text-sm text-thirdly">
						{$LL.settings.supportMessage()}
					</p>

					<div class="bg-primary border border-color rounded-xl p-4 space-y-3">
						<button
							class="support-action-btn support-donate w-full"
							onclick={() => openSupportLink('https://www.paypal.me/rayanestaszewski', 'PayPal')}
						>
							<span class="material-icons-outlined text-sm">favorite</span>
							{$LL.settings.donateWithPaypal()}
						</button>

						<button
							class="support-action-btn support-kofi w-full"
							onclick={() => openSupportLink('https://ko-fi.com/vzero', 'Ko-fi')}
						>
							<span class="material-icons-outlined text-sm">coffee</span>
							{$LL.settings.donateWithKofi()}
						</button>
					</div>

					<h2 class="text-lg font-medium text-primary">{$LL.settings.cryptocurrencyWallets()}</h2>

					<div class="space-y-2">
						<p class="text-xs text-thirdly">{$LL.settings.tapWalletToCopy()}</p>
						{#each DONATION_WALLETS as wallet (wallet.label)}
							<button
								class="wallet-card w-full rounded-lg border border-color bg-secondary/70 px-3 py-2 text-left flex items-center justify-between gap-3"
								onclick={() => copyWalletAddress(wallet.address, wallet.label)}
								aria-label={`Copy ${wallet.label} wallet address`}
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

					<div class="bg-primary border border-color rounded-xl p-4 space-y-3">
						<div>
							<p class="text-sm font-medium text-primary">{$LL.settings.aiTranslationTelemetry()}</p>
							<p class="mt-1 text-xs text-thirdly">
								{$LL.settings.telemetryDescription()}
							</p>
						</div>
						<div class="grid grid-cols-1 gap-2 md:grid-cols-3">
							<button
								class="support-action-btn"
								class:selected={globalState.settings?.aiTranslationSettings.telemetryConsent ===
									'unknown'}
								onclick={() => updateAiTelemetryConsent('unknown')}
							>
								{$LL.settings.askOnExport()}
							</button>
							<button
								class="support-action-btn"
								class:selected={globalState.settings?.aiTranslationSettings.telemetryConsent ===
									'granted'}
								onclick={() => updateAiTelemetryConsent('granted')}
							>
								{$LL.settings.allowSending()}
							</button>
							<button
								class="support-action-btn"
								class:selected={globalState.settings?.aiTranslationSettings.telemetryConsent ===
									'denied'}
								onclick={() => updateAiTelemetryConsent('denied')}
							>
								{$LL.settings.doNotSend()}
							</button>
						</div>
					</div>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.CONTACT}
				<div class="space-y-5">
					<h3 class="text-lg font-medium text-primary">{$LL.settings.contact()}</h3>
					<p class="text-sm text-thirdly">
						{$LL.settings.contactMessage()}
					</p>
					<div class="bg-primary border border-color rounded-xl p-4 space-y-3">
						<div class="grid grid-cols-2 gap-2">
							<button
								class="support-action-btn support-review"
								onclick={() => openSupportModal('review')}
							>
								<span class="material-icons-outlined text-sm">star</span>
								{$LL.settings.leaveReview()}
							</button>
							<button
								class="support-action-btn support-feedback"
								onclick={() => openSupportModal('feedback')}
							>
								<span class="material-icons-outlined text-sm">construction</span>
								{$LL.settings.featureBug()}
							</button>
						</div>
						<button
							class="support-action-btn support-discord w-full"
							onclick={() => openSupportLink('https://discord.gg/Hxfqq2QA2J', 'Discord')}
						>
							<span class="material-icons-outlined text-sm">question_answer</span>
							{$LL.settings.joinDiscord()}
						</button>
					</div>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.ABOUT}
				<About />
			{/if}
		</div>
	</div>
</div>

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
	.selected {
		background-color: var(--bg-accent) !important;
		color: var(--text-primary) !important;
	}

	.support-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		height: 2.75rem;
		padding-inline: 0.75rem;
		border-radius: var(--radius-l);
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-weight: 500;
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease,
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.support-action-btn:hover {
		transform: translateY(-1px);
	}

	.support-action-btn.support-review {
		color: color-mix(in srgb, var(--accent-secondary) 85%, var(--text-secondary));
		border-color: color-mix(in srgb, var(--accent-secondary) 30%, var(--border-color));
	}

	.support-action-btn.support-review:hover {
		color: var(--text-primary);
		border-color: color-mix(in srgb, var(--accent-secondary) 55%, var(--border-color));
		background: color-mix(in srgb, var(--accent-secondary) 12%, transparent);
	}

	.support-action-btn.support-feedback {
		color: color-mix(in srgb, var(--accent-primary) 75%, var(--text-secondary));
		border-color: color-mix(in srgb, var(--accent-primary) 30%, var(--border-color));
	}

	.support-action-btn.support-feedback:hover {
		color: var(--text-primary);
		border-color: color-mix(in srgb, var(--accent-primary) 55%, var(--border-color));
		background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
	}

	.support-action-btn.support-discord {
		color: color-mix(in srgb, #5865f2 75%, var(--text-secondary));
		border-color: color-mix(in srgb, #5865f2 25%, var(--border-color));
	}

	.support-action-btn.support-discord:hover {
		color: #5865f2;
		border-color: color-mix(in srgb, #5865f2 55%, var(--border-color));
		background: rgba(88, 101, 242, 0.08);
	}

	.support-action-btn.support-donate {
		color: color-mix(in srgb, #ff4f9a 75%, var(--text-secondary));
		border-color: color-mix(in srgb, #ff4f9a 25%, var(--border-color));
	}

	.support-action-btn.support-donate:hover {
		color: #ff4f9a;
		border-color: color-mix(in srgb, #ff4f9a 55%, var(--border-color));
		background: rgba(255, 79, 154, 0.08);
	}

	.support-action-btn.support-kofi {
		color: color-mix(in srgb, #ff5f5f 75%, var(--text-secondary));
		border-color: color-mix(in srgb, #ff5f5f 25%, var(--border-color));
	}

	.support-action-btn.support-kofi:hover {
		color: #ff5f5f;
		border-color: color-mix(in srgb, #ff5f5f 55%, var(--border-color));
		background: rgba(255, 95, 95, 0.08);
	}

	.wallet-card {
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.wallet-card:hover {
		transform: translateY(-1px);
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
</style>
