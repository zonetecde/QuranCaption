<script lang="ts">
	import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import ShortcutsManager from './ShortcutsManager.svelte';
	import { onMount } from 'svelte';
	import About from './About.svelte';

	let {
		resolve
	}: {
		resolve: (result: boolean) => void;
	} = $props();
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
				<!-- Simple theme placeholder, keep it épuré. -->
				<div class="space-y-4">
					<h3 class="text-lg font-medium text-primary">Theme</h3>
					<p class="text-sm text-thirdly">Select application theme and accent colors.</p>

					<div class="grid grid-cols-3 gap-4">
						<!-- Default Theme -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'default'}
							class:border-color={globalState.settings?.persistentUiState?.theme !== 'default'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'default'}
							onclick={() => {
								console.log('Switching to Default');
								if (globalState.settings) globalState.settings.persistentUiState.theme = 'default';
							}}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#0d1117] relative border border-white/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#161b22] border-b border-white/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-red-500/50"></div>
									<div class="w-2 h-2 rounded-full bg-yellow-500/50"></div>
									<div class="w-2 h-2 rounded-full bg-green-500/50"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#58a6ff] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-white/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Default</span>
								{#if globalState.settings?.persistentUiState?.theme === 'default'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Blue Ocean -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'blue-ocean'}
							class:border-color={globalState.settings?.persistentUiState?.theme !== 'blue-ocean'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'blue-ocean'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'blue-ocean')}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#0f172a] relative border border-white/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#0f172a] border-b border-white/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#0ea5e9] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-white/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Blue Ocean</span>
								{#if globalState.settings?.persistentUiState?.theme === 'blue-ocean'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Orange Mechanic -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'orange-mechanic'}
							class:border-color={globalState.settings?.persistentUiState?.theme !==
								'orange-mechanic'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'orange-mechanic'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'orange-mechanic')}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#0f172a] relative border border-white/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#1e293b] border-b border-white/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#f97316] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-white/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Orange Mechanic</span>
								{#if globalState.settings?.persistentUiState?.theme === 'orange-mechanic'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Blue Light Ocean -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'blue-light-ocean'}
							class:border-color={globalState.settings?.persistentUiState?.theme !==
								'blue-light-ocean'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme ===
								'blue-light-ocean'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'blue-light-ocean')}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#f8fafc] relative border border-black/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#ffffff] border-b border-black/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-black/10"></div>
									<div class="w-2 h-2 rounded-full bg-black/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#0ea5e9] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-black/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Blue Light Ocean</span>
								{#if globalState.settings?.persistentUiState?.theme === 'blue-light-ocean'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Cyber Violet (New) -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'cyber-violet'}
							class:border-color={globalState.settings?.persistentUiState?.theme !== 'cyber-violet'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'cyber-violet'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'cyber-violet')}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#0b0e14] relative border border-white/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#13111c] border-b border-white/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#8b5cf6] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-white/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Cyber Violet</span>
								{#if globalState.settings?.persistentUiState?.theme === 'cyber-violet'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Emerald Forest (New) -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'emerald-forest'}
							class:border-color={globalState.settings?.persistentUiState?.theme !==
								'emerald-forest'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'emerald-forest'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'emerald-forest')}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#060908] relative border border-white/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#0c120e] border-b border-white/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#10b981] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-white/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Emerald Forest</span>
								{#if globalState.settings?.persistentUiState?.theme === 'emerald-forest'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Polar Ice (New) -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'polar-ice'}
							class:border-color={globalState.settings?.persistentUiState?.theme !== 'polar-ice'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'polar-ice'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'polar-ice')}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#f3f6f9] relative border border-black/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#ffffff] border-b border-black/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-black/10"></div>
									<div class="w-2 h-2 rounded-full bg-black/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#6366f1] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-black/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Polar Ice</span>
								{#if globalState.settings?.persistentUiState?.theme === 'polar-ice'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Desert Gold -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'desert-gold'}
							class:border-color={globalState.settings?.persistentUiState?.theme !== 'desert-gold'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'desert-gold'}
							onclick={() => {
								console.log('Switching to Desert Gold');
								if (globalState.settings)
									globalState.settings.persistentUiState.theme = 'desert-gold';
							}}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#fcfaf7] relative border border-black/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#fffcf9] border-b border-black/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-black/10"></div>
									<div class="w-2 h-2 rounded-full bg-black/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#d4a017] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-black/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Desert Gold</span>
								{#if globalState.settings?.persistentUiState?.theme === 'desert-gold'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Crimson Ember -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'crimson-ember'}
							class:border-color={globalState.settings?.persistentUiState?.theme !==
								'crimson-ember'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'crimson-ember'}
							onclick={() => {
								console.log('Switching to Crimson Ember');
								if (globalState.settings)
									globalState.settings.persistentUiState.theme = 'crimson-ember';
							}}
						>
							<div
								class="w-full h-24 rounded-lg bg-[#0f0f12] relative border border-white/10 shadow-sm overflow-hidden"
							>
								<!-- Mock UI -->
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#16161d] border-b border-white/5 flex items-center px-2 gap-1"
								>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
									<div class="w-2 h-2 rounded-full bg-white/10"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded bg-[#f63049] opacity-80"></div>
								<div class="absolute top-16 left-3 w-24 h-2 rounded bg-white/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm">Crimson Ember</span>
								{#if globalState.settings?.persistentUiState?.theme === 'crimson-ember'}
									<span class="material-icons text-accent-primary text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Vintage Paper -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							style="background-color: #f4ecd8;"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'vintage-paper'}
							class:border-color={globalState.settings?.persistentUiState?.theme !==
								'vintage-paper'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'vintage-paper'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'vintage-paper')}
						>
							<div
								class="w-full h-24 rounded-sm bg-[#ece2c6] relative border border-[#c4b494] shadow-sm overflow-hidden"
								style="background-image: url('https://www.transparenttextures.com/patterns/paper-fibers.png');"
							>
								<div
									class="absolute top-0 left-0 w-full h-6 bg-[#e4d8b9] border-b border-[#c4b494] flex items-center px-2"
								>
									<div class="w-2 h-2 rounded-full bg-[#3d3420]/20 mr-1"></div>
									<div class="w-2 h-2 rounded-full bg-[#3d3420]/20"></div>
								</div>
								<div
									class="absolute top-10 left-3 w-16 h-4 rounded-sm bg-[#8b4513] opacity-80"
								></div>
								<div class="absolute top-16 left-3 w-20 h-1.5 bg-[#3d3420]/30"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm !text-[#3d3420]">Vintage Paper</span>
								{#if globalState.settings?.persistentUiState?.theme === 'vintage-paper'}
									<span class="material-icons text-[#8b4513] text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- OLED Stealth -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							style="background-color: #000000;"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'oled-stealth'}
							class:border-color={globalState.settings?.persistentUiState?.theme !== 'oled-stealth'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'oled-stealth'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'oled-stealth')}
						>
							<div
								class="w-full h-24 rounded-none bg-black relative border border-[#222222] shadow-sm overflow-hidden"
							>
								<div
									class="absolute top-0 left-0 w-full h-6 bg-black border-b border-[#222222] flex items-center px-2"
								>
									<div class="w-2 h-2 rounded-none bg-[#222222] mr-1"></div>
									<div class="w-2 h-2 rounded-none bg-[#222222]"></div>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 rounded-none bg-[#00ff41]"></div>
								<div class="absolute top-16 left-3 w-24 h-1.5 bg-[#333333]"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm text-white">OLED Stealth</span>
								{#if globalState.settings?.persistentUiState?.theme === 'oled-stealth'}
									<span class="material-icons text-[#00ff41] text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Ethereal Glass -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							style="background: linear-gradient(135deg, #1e293b, #0f172a);"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'ethereal-glass'}
							class:border-color={globalState.settings?.persistentUiState?.theme !==
								'ethereal-glass'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'ethereal-glass'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'ethereal-glass')}
						>
							<div
								class="w-full h-24 rounded-2xl bg-white/5 backdrop-blur-md relative border border-white/10 shadow-xl overflow-hidden"
							>
								<div
									class="absolute -top-10 -right-10 w-24 h-24 bg-pink-500/20 rounded-full blur-2xl"
								></div>
								<div
									class="absolute top-0 left-0 w-full h-6 bg-white/5 border-b border-white/5 flex items-center px-2"
								>
									<div class="w-2 h-2 rounded-full bg-white/20 mr-1"></div>
								</div>
								<div
									class="absolute top-10 left-3 w-16 h-4 rounded-full bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.5)]"
								></div>
								<div class="absolute top-16 left-3 w-20 h-2 rounded-full bg-white/10"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm text-white">Ethereal Glass</span>
								{#if globalState.settings?.persistentUiState?.theme === 'ethereal-glass'}
									<span class="material-icons text-pink-500 text-sm">check_circle</span>
								{/if}
							</div>
						</button>

						<!-- Matrix Terminal -->
						<button
							class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
							style="background-color: #000000;"
							class:border-accent-primary={globalState.settings?.persistentUiState?.theme ===
								'matrix-terminal'}
							class:border-color={globalState.settings?.persistentUiState?.theme !==
								'matrix-terminal'}
							class:bg-accent={globalState.settings?.persistentUiState?.theme === 'matrix-terminal'}
							onclick={() => (globalState.settings!.persistentUiState.theme = 'matrix-terminal')}
						>
							<div
								class="w-full h-24 rounded-none bg-black relative border border-[#003b00] shadow-sm overflow-hidden"
								style="background-image: linear-gradient(rgba(0, 59, 0, 0.1) 1px, transparent 1px); background-size: 100% 3px;"
							>
								<div
									class="absolute top-0 left-0 w-full h-6 bg-black border-b border-[#003b00] flex items-center px-2"
								>
									<span class="text-[8px] text-[#00ff41] font-mono">root@system:~#</span>
								</div>
								<div class="absolute top-10 left-3 w-16 h-4 bg-[#00ff41] opacity-60"></div>
								<div class="absolute top-16 left-3 w-24 h-2 border border-[#00ff41]/30"></div>
							</div>
							<div class="flex items-center justify-between w-full">
								<span class="font-medium text-sm text-[#00ff41] font-mono">Matrix/Terminal</span>
								{#if globalState.settings?.persistentUiState?.theme === 'matrix-terminal'}
									<span class="material-icons text-[#00ff41] text-sm">check_circle</span>
								{/if}
							</div>
						</button>
					</div>
				</div>
			{:else if globalState.uiState.settingsTab === SettingsTab.ABOUT}
				<About />
			{/if}
		</div>
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-6 py-4 flex items-center justify-end gap-3">
		<button
			class="px-4 py-2 rounded-md text-sm text-thirdly hover:bg-accent transition-colors"
			onclick={() => resolve(false)}
		>
			Cancel
		</button>

		<button
			class="btn-accent px-5 py-2.5 text-sm font-medium rounded-md shadow-lg hover:scale-[1.02] transition-all duration-150"
			onclick={() => {
				Settings.save();
				resolve(true);
			}}
		>
			Apply and Close
		</button>
	</div>
</div>

<style>
	/* Override for the small icon color in sidebar */
	.material-icons.text-accent-secondary {
		color: var(--accent-primary);
	}

	@keyframes modalSlideIn {
		from {
			opacity: 0;
			transform: scale(0.98) translateY(-8px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.btn-accent:hover {
		box-shadow: 0 8px 30px rgba(17, 24, 39, 0.18);
	}
</style>
