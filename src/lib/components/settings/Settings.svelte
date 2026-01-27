<script lang="ts">
	import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import ShortcutsManager from './ShortcutsManager.svelte';
	import { onMount } from 'svelte';
	import About from './About.svelte';
	import ThemeButton from './ThemeButton.svelte';
	import type { ThemeConfig } from './ThemeButton.svelte';

	let {
		resolve
	}: {
		resolve: (result: boolean) => void;
	} = $props();

	const themes: ThemeConfig[] = [
		{
			id: 'default',
			name: 'Default',
			mockBg: '#0d1117',
			mockTitlebar: '#161b22',
			mockAccent: '#58a6ff',
			mockDots: 'rgba(255,255,255,0.3)'
		},
		{
			id: 'emerald-forest',
			name: 'Emerald Forest',
			mockBg: '#060908',
			mockTitlebar: '#0c120e',
			mockAccent: '#10b981'
		},
		{
			id: 'polar-ice',
			name: 'Polar Ice',
			mockBg: '#f3f6f9',
			mockTitlebar: '#ffffff',
			mockAccent: '#6366f1',
			mockDots: 'rgba(0,0,0,0.1)',
			mockText: 'rgba(0,0,0,0.1)'
		},
		{
			id: 'desert-gold',
			name: 'Desert Gold',
			mockBg: '#f4ecd8',
			mockTitlebar: '#e4d8b9',
			mockAccent: '#d4a017',
			mockDots: 'rgba(0,0,0,0.2)',
			mockText: 'rgba(0,0,0,0.2)'
		},
		{
			id: 'vintage-paper',
			name: 'Vintage Paper',
			mockBg: '#f4ecd8',
			mockTitlebar: '#e4d8b9',
			mockAccent: '#8b4513',
			mockDots: 'rgba(0,0,0,0.2)',
			mockText: 'rgba(0,0,0,0.2)'
		},
		{
			id: 'oled-stealth',
			name: 'OLED Stealth',
			mockBg: '#000000',
			mockAccent: '#00ff41',
			mockDots: 'rgba(255,255,255,0.2)'
		},
		{
			id: 'ethereal-glass',
			name: 'Ethereal Glass',
			mockBg: 'rgba(15, 23, 42, 0.8)',
			mockAccent: '#ec4899',
			mockDots: 'rgba(255,255,255,0.2)',
			specialStyle: 'backdrop-filter: blur(16px);'
		},
		{
			id: 'minimal-zen',
			name: 'Minimalist Zen',
			mockBg: '#f9f9f9',
			mockAccent: '#111827',
			mockDots: 'rgba(0,0,0,0.1)',
			mockText: 'rgba(0,0,0,0.1)'
		},
		{
			id: 'industrial-steel',
			name: 'Industrial Steel',
			mockBg: '#1e293b',
			mockAccent: '#f97316',
			mockDots: 'rgba(255,255,255,0.2)'
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
				<p class="text-sm text-thirdly">Customize your experience and shortcuts</p>
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
				{#each [{ name: 'Shortcuts', tab: SettingsTab.SHORTCUTS, icon: 'keyboard' }, { name: 'Theme', tab: SettingsTab.THEME, icon: 'light_mode' }, { name: 'About', tab: SettingsTab.ABOUT, icon: 'info' }] as setting}
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

					<div class="grid grid-cols-3 gap-4">
						{#each themes as theme}
							<ThemeButton {theme} />
						{/each}
					</div>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.ABOUT}
				<About />
			{/if}
		</div>
	</div>
</div>

<style>
	.selected {
		background-color: var(--bg-accent) !important;
		color: var(--text-primary) !important;
	}
</style>
