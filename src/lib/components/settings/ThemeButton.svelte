<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import Settings from '$lib/classes/Settings.svelte';


	export type ThemeId =
		| 'default'
		| 'emerald-forest'
		| 'polar-ice'
		| 'desert-gold'
		| 'vintage-paper'
		| 'oled-stealth'
		| 'ethereal-glass'
		| 'minimal-zen'
		| 'inverted-minimal-zen';

	export type ThemeConfig = {
		id: ThemeId;
		name: string;
		mockBg: string;
		mockTitlebar?: string;
		mockAccent: string;
		mockDots?: string;
		mockText?: string;
		specialStyle?: string;
	};

	let { theme }: { theme: ThemeConfig } = $props();

	const isSelected = $derived(globalState.settings?.persistentUiState?.theme === theme.id);

	async function selectTheme() {
		if (globalState.settings) {
			globalState.settings.persistentUiState.theme = theme.id;
			await Settings.save();
		}
	}
</script>

<button
	class="flex flex-col gap-2 p-3 rounded-xl border-2 transition-all relative overflow-hidden group"
	class:border-accent-primary={isSelected}
	class:border-color={!isSelected}
	class:bg-accent={isSelected}
	onclick={selectTheme}
>
	<div
		class="w-full h-24 rounded-lg relative border border-white/10 shadow-sm overflow-hidden"
		style="background: {theme.mockBg}; {theme.specialStyle || ''}"
	>
		<!-- Mock Title Bar -->
		<div
			class="absolute top-0 left-0 w-full h-6 border-b border-white/5 flex items-center px-2 gap-1"
			style="background: {theme.mockTitlebar || theme.mockBg};"
		>
			<div
				class="w-2 h-2 rounded-full"
				style="background: {theme.mockDots ||
					(theme.mockBg.includes('#f') ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)')}"
			></div>
			<div
				class="w-2 h-2 rounded-full"
				style="background: {theme.mockDots ||
					(theme.mockBg.includes('#f') ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)')}"
			></div>
		</div>

		<!-- Mock Accent Button -->
		<div
			class="absolute top-10 left-3 w-16 h-4 rounded opacity-80"
			style="background: {theme.mockAccent}"
		></div>

		<!-- Mock Text Line -->
		<div
			class="absolute top-16 left-3 w-24 h-2 rounded"
			style="background: {theme.mockText ||
				(theme.mockBg.includes('#f') ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)')}"
		></div>
	</div>

	<div class="flex items-center justify-between w-full">
		<span class="font-medium text-sm">{theme.name}</span>
		{#if isSelected}
			<span class="material-icons text-accent-primary text-sm">check_circle</span>
		{/if}
	</div>
</button>
