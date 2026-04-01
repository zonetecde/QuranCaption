<script lang="ts">
import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { slide } from 'svelte/transition';
import ShortcutsManager from './ShortcutsManager.svelte';
import About from './About.svelte';
import BackupSettings from './BackupSettings.svelte';
import ThemeButton, { type ThemeConfig } from './ThemeButton.svelte';

import SupportFeedbackModal from '$lib/components/home/modals/SupportFeedbackModal.svelte';
import { openUrl } from '@tauri-apps/plugin-opener';
import toast from 'svelte-5-french-toast';

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
	let isSupportModalOpen = $state(false);

	function openSupportModal(tab: 'review' | 'feedback') {
		supportModalTab = tab;
		isSupportModalOpen = true;
	}

	async function openSupportLink(url: string, fallbackLabel: string) {
		try {
			await openUrl(url);
		} catch (error) {
			console.error(`Failed to open ${fallbackLabel} URL:`, error);
			toast.error(`Unable to open ${fallbackLabel}.`);
		}
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
				<h2 class="text-xl font-semibold text-primary">Settings</h2>
				<p class="text-sm text-thirdly">Customize your experience, shortcuts, and backups</p>
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
		<div class="bg-primary border-r border-color p-3 overflow-auto">
			<div class="flex flex-col gap-2">
				{#each [
					{ name: 'Shortcuts', tab: SettingsTab.SHORTCUTS, icon: 'keyboard' },
					{ name: 'Theme', tab: SettingsTab.THEME, icon: 'light_mode' },
					{ name: 'Backup', tab: SettingsTab.BACKUP, icon: 'archive' },
					{ name: 'Support', tab: SettingsTab.SUPPORT, icon: 'volunteer_activism' },
					{ name: 'Contact', tab: SettingsTab.CONTACT, icon: 'mail' },
					{ name: 'About', tab: SettingsTab.ABOUT, icon: 'info' }
				] as setting (setting.tab)}
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
		</div>

		<!-- Content -->
		<div class="p-6 overflow-auto">
			{#if globalState.uiState.settingsTab === SettingsTab.SHORTCUTS}
				<ShortcutsManager />
			{:else if globalState.uiState.settingsTab === SettingsTab.THEME}
				<!-- Theme Selection -->
				<div class="space-y-4">
					<h3 class="text-lg font-medium text-primary">Theme</h3>
					<div class="flex items-center justify-between">
						<p class="text-sm text-thirdly">Select application theme and accent colors.</p>

						{#if globalState.settings}
							<div class="flex items-center gap-3">
								<span class="text-xs text-thirdly uppercase font-mono tracking-wider"
									>Intensity</span
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
							<p class="text-xs font-semibold uppercase tracking-wider text-thirdly">Dark</p>
							<div class="grid grid-cols-3 gap-4">
								{#each darkThemes as theme (theme.id)}
									<ThemeButton {theme} />
								{/each}
							</div>
						</div>

						<div class="space-y-3">
							<p class="text-xs font-semibold uppercase tracking-wider text-thirdly">Light</p>
							<div class="grid grid-cols-3 gap-4">
								{#each lightThemes as theme (theme.id)}
									<ThemeButton {theme} />
								{/each}
							</div>
						</div>

						<div class="space-y-3">
							<p class="text-xs font-semibold uppercase tracking-wider text-thirdly">Sepia</p>
							<div class="grid grid-cols-3 gap-4">
								{#each sepiaThemes as theme (theme.id)}
									<ThemeButton {theme} />
								{/each}
							</div>
						</div>
					</div>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.BACKUP}
				<BackupSettings />
			{:else if globalState.uiState.settingsTab === SettingsTab.SUPPORT}
				<div class="space-y-5">
					<h3 class="text-lg font-medium text-primary">Support</h3>
					<p class="text-sm text-thirdly">
						If you enjoy Quran Caption, a donation helps maintain and improve the app.
					</p>
					<div class="bg-primary border border-color rounded-xl p-4 space-y-3">
						<button
							class="support-action-btn support-donate w-full"
							onclick={() => openSupportLink('https://ko-fi.com/vzero', 'donation page')}
						>
							<span class="material-icons-outlined text-sm">favorite</span>
							Donate on Ko-fi
						</button>
					</div>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.CONTACT}
				<div class="space-y-5">
					<h3 class="text-lg font-medium text-primary">Contact</h3>
					<p class="text-sm text-thirdly">
						Leave a review, request a feature, report a bug, or join the community.
					</p>
					<div class="bg-primary border border-color rounded-xl p-4 space-y-3">
						<div class="grid grid-cols-2 gap-2">
							<button class="support-action-btn support-review" onclick={() => openSupportModal('review')}>
								<span class="material-icons-outlined text-sm">star</span>
								Leave a Review
							</button>
							<button
								class="support-action-btn support-feedback"
								onclick={() => openSupportModal('feedback')}
							>
								<span class="material-icons-outlined text-sm">construction</span>
								Feature / Bug
							</button>
						</div>
						<button
							class="support-action-btn support-discord w-full"
							onclick={() => openSupportLink('https://discord.gg/Hxfqq2QA2J', 'Discord')}
						>
							<span class="material-icons-outlined text-sm">question_answer</span>
							Join Discord
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
</style>
