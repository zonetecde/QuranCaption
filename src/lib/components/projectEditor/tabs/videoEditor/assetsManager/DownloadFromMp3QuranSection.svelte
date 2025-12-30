<script lang="ts">
	import toast from 'svelte-5-french-toast';
	import { invoke } from '@tauri-apps/api/core';
	import { ProjectService } from '$lib/services/ProjectService';
	import { globalState } from '$lib/runes/main.svelte';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { Quran } from '$lib/classes/Quran';
	import { onMount } from 'svelte';
	import { join } from '@tauri-apps/api/path';

	// Types for MP3Quran API
	type Reciter = {
		id: number;
		name: string;
		letter: string;
		moshaf: Moshaf[];
	};

	type Moshaf = {
		id: number;
		name: string;
		server: string;
		surah_total: number;
		moshaf_type: number;
		surah_list: string;
	};

	let reciters: Reciter[] = $state([]);
	let selectedReciterId: number | null = $state(null);
	let selectedSurahId: number | null = $state(null);
	let isDownloading: boolean = $state(false);
	let isLoadingReciters: boolean = $state(true);

	// Derived state
	let flattenedOptions = $derived.by(() => {
		const options: {
			reciterId: number;
			moshafId: number;
			label: string;
			server: string;
			surah_list: string;
		}[] = [];
		for (const r of reciters) {
			for (const m of r.moshaf) {
				options.push({
					reciterId: r.id,
					moshafId: m.id,
					label: `${r.name} - ${m.name}`,
					server: m.server,
					surah_list: m.surah_list
				});
			}
		}
		return options.sort((a, b) => a.label.localeCompare(b.label));
	});

	let selectedOptionIndex: number = $state(-1); // Index in flattenedOptions

	let availableSurahs = $derived.by(() => {
		if (selectedOptionIndex === -1) return [];
		const option = flattenedOptions[selectedOptionIndex];
		const surahIds = option.surah_list.split(',').map(Number);

		// Map surah IDs to names using the Quran class
		return surahIds.map((id) => {
			const surah = Quran.getSurahs().find((s) => s.id === id);
			return {
				id: id,
				name: surah ? `${id}. ${surah.name} (${surah.translation})` : `Surah ${id}`
			};
		});
	});

	onMount(async () => {
		try {
			// Ensure Quran data is loaded for Surah names
			await Quran.load();

			const response = await fetch('https://mp3quran.net/api/v3/reciters?language=eng');
			if (!response.ok) throw new Error('Failed to fetch reciters');
			const data = await response.json();
			reciters = data.reciters;
		} catch (error) {
			console.error('Error fetching reciters:', error);
			toast.error('Failed to load reciters list.');
		} finally {
			isLoadingReciters = false;
		}
	});

	async function downloadAsset() {
		if (selectedOptionIndex === -1 || !selectedSurahId) return;

		isDownloading = true;
		const option = flattenedOptions[selectedOptionIndex];

		// Format surah ID to 3 digits (e.g. 001, 012, 114)
		const formattedSurahId = selectedSurahId.toString().padStart(3, '0');
		const url = `${option.server}${formattedSurahId}.mp3`;
		const surahName =
			availableSurahs.find((s) => s.id === selectedSurahId)?.name.split(' (')[0] ??
			`Surah ${formattedSurahId}`;
		const fileName = `${option.label.split(' - ')[0]} - ${surahName}.mp3`.replace(
			/[<>:"/\\|?*]/g,
			''
		);

		let toastId: string | undefined;
		try {
			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);

			toastId = toast.loading(`Downloading ${surahName}...`);

			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

			const buffer = await response.arrayBuffer();
			const uint8Array = new Uint8Array(buffer);

			const fullPath = await join(downloadPath, fileName);

			await invoke('save_binary_file', {
				path: fullPath,
				content: uint8Array
			});

			globalState.currentProject!.content.addAsset(fullPath, url);

			toast.success('Download successful!', { id: toastId });
		} catch (error) {
			console.error('Download error:', error);
			toast.error(`Error downloading: ${error}`, { id: toastId, duration: 5000 });
		} finally {
			isDownloading = false;
		}
	}
</script>

<Section icon="mosque" name="Download from MP3Quran" classes="mt-7">
	<div class="mt-4 space-y-4">
		<!-- Reciter Selection -->
		<div class="space-y-2">
			<label for="reciter-select" class="text-sm font-medium text-secondary"
				>Reciter (Recitation)</label
			>
			<select
				id="reciter-select"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary
				       focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent"
				bind:value={selectedOptionIndex}
				disabled={isLoadingReciters}
			>
				{#if isLoadingReciters}
					<option value={-1}>Loading reciters...</option>
				{:else}
					<option value={-1}>Select a reciter</option>
					{#each flattenedOptions as option, index}
						<option value={index}>{option.label}</option>
					{/each}
				{/if}
			</select>
		</div>

		<!-- Surah Selection -->
		<div class="space-y-2">
			<label for="surah-select" class="text-sm font-medium text-secondary">Surah</label>
			<select
				id="surah-select"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary
				       focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent
					   disabled:opacity-50 disabled:cursor-not-allowed"
				bind:value={selectedSurahId}
				disabled={selectedOptionIndex === -1}
			>
				<option value={null}>Select a Surah</option>
				{#each availableSurahs as surah}
					<option value={surah.id}>{surah.name}</option>
				{/each}
			</select>
		</div>

		<!-- Download Button -->
		<button
			class="w-full btn-accent flex items-center justify-center gap-2 py-3 px-4 rounded-lg
			       text-sm font-medium transition-all duration-200 hover:scale-[1.02]
			       disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
			       shadow-lg hover:shadow-xl relative overflow-hidden"
			type="button"
			onclick={downloadAsset}
			disabled={selectedOptionIndex === -1 || !selectedSurahId || isDownloading}
		>
			{#if isDownloading}
				<span class="material-icons animate-spin text-lg">sync</span>
				<span>Downloading...</span>
			{:else}
				<span class="material-icons text-lg">download</span>
				<span>Download MP3</span>
			{/if}
		</button>

		<!-- Info hint -->
		<div class="flex items-start gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
			<span class="material-icons text-sm text-green-400 mt-0.5">verified</span>
			<p class="text-xs text-green-300 leading-relaxed">
				High quality MP3s provided by mp3quran.net API.
			</p>
		</div>
	</div>
</Section>
