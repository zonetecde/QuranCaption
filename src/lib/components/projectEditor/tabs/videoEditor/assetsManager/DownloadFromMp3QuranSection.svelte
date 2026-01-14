<script lang="ts">
	import toast from 'svelte-5-french-toast';
	import { invoke } from '@tauri-apps/api/core';
	import { ProjectService } from '$lib/services/ProjectService';
	import { globalState } from '$lib/runes/main.svelte';
	import { SourceType } from '$lib/classes';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { Quran } from '$lib/classes/Quran';
	import { onMount } from 'svelte';
	import { join } from '@tauri-apps/api/path';
	import { Mp3QuranService, type TimingReciter } from '$lib/services/Mp3QuranService';
	import { AnalyticsService } from '$lib/services/AnalyticsService';

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
	let timingReciters: TimingReciter[] = $state([]);
	let supportedTimingReciterIds: Set<number> = $state(new Set());
	let selectedSurahId: number = $state(-1);
	let isDownloading: boolean = $state(false);
	let isLoadingReciters: boolean = $state(true);

	// Derived state
	type FlattenedOption = {
		reciterId: number;
		moshafId: number;
		label: string;
		server: string;
		surah_list: string;
	};

	let sortedOptions: FlattenedOption[] = $state([]);

	function buildSortedOptions(recitersList: Reciter[]): FlattenedOption[] {
		const options: FlattenedOption[] = [];
		for (const r of recitersList) {
			const isSupported = supportedTimingReciterIds.has(r.id);
			const prefix = isSupported ? '✨ ' : '';
			for (const m of r.moshaf) {
				options.push({
					reciterId: r.id,
					moshafId: m.id,
					label: `${prefix}${r.name} - (${m.name})`,
					server: m.server,
					surah_list: m.surah_list
				});
			}
		}
		// Sort by the label but ignore the "✨ " prefix for the sort comparison
		return options.sort((a, b) => {
			const labelA = a.label.startsWith('✨ ') ? a.label.substring(2) : a.label;
			const labelB = b.label.startsWith('✨ ') ? b.label.substring(2) : b.label;
			return labelA.localeCompare(labelB);
		});
	}

	let selectedOptionIndex: number = $state(-1); // Index in flattenedOptions

	let availableSurahs = $derived.by(() => {
		const option = selectedOptionIndex === -1 ? null : sortedOptions[selectedOptionIndex];
		const surahIds = option ? new Set(option.surah_list.split(',').map(Number)) : new Set<number>();

		return Quran.getSurahs().map((surah) => ({
			id: surah.id,
			name: `${surah.id}. ${surah.name} (${surah.translation})`,
			supported: surahIds.has(surah.id)
		}));
	});

	onMount(async () => {
		try {
			// Ensure Quran data is loaded for Surah names
			await Quran.load();

			const [recitersData, timingRecitersData] = await Promise.all([
				Mp3QuranService.getReciters(),
				Mp3QuranService.getTimingReciters()
			]);

			reciters = recitersData;
			timingReciters = timingRecitersData;
			supportedTimingReciterIds = new Set(timingReciters.map((r) => r.id));

			sortedOptions = buildSortedOptions(reciters);
		} catch (error) {
			console.error('Error fetching reciters:', error);
			toast.error('Failed to load reciters list.');
		} finally {
			isLoadingReciters = false;
		}
	});

	async function downloadAsset() {
		if (selectedOptionIndex === -1 || selectedSurahId === -1) return;

		isDownloading = true;
		const option = sortedOptions[selectedOptionIndex];

		// Format surah ID to 3 digits (e.g. 001, 012, 114)
		const formattedSurahId = selectedSurahId.toString().padStart(3, '0');
		const url = `${option.server}${formattedSurahId}.mp3`;
		const surahName =
			availableSurahs.find((s) => s.id === selectedSurahId)?.name.split(' (')[0] ??
			`Surah ${formattedSurahId}`;

		// Clean up the label to remove the icon for the filename
		const cleanLabel = option.label.replace('✨ ', '');
		const rawBaseName = `${cleanLabel.split(' - ')[0]} - ${surahName}`;
		let sanitizedBaseName = rawBaseName.replace(/[<>:"/\\|?*]/g, '').trim();
		if (!sanitizedBaseName) {
			sanitizedBaseName = `surah-${formattedSurahId}`;
		}
		const fileName = `${sanitizedBaseName}.mp3`;

		let toastId: string | undefined;
		try {
			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);

			toastId = toast.loading(
				`Downloading Surah ${surahName.split('.')[1].trim()} by ${cleanLabel.split(' - ')[0]}...`
			);

			const fullPath = await join(downloadPath, fileName);

			await invoke('download_file', {
				url,
				path: fullPath
			});

			// Check if this reciter matches a timing reciter
			// Note: We use the reciter ID. Sometimes Mp3Quran 'reads' ID matches 'reciters' ID.
			// We trust the ID mapping for now as per plan.
			const supportsTiming = supportedTimingReciterIds.has(option.reciterId);

			const metadata = supportsTiming
				? { mp3Quran: { reciterId: option.reciterId, surahId: selectedSurahId } }
				: {};

			globalState.currentProject!.content.addAsset(fullPath, url, SourceType.Mp3Quran, metadata);

			toast.success('Download successful!', { id: toastId });

			if (supportsTiming) {
				// Show a persistent/longer toast strictly explaining the next step
				toast.custom(
					(t: any) => `
					<div class="bg-secondary border border-[var(--accent-primary)] rounded-lg shadow-lg p-4 flex items-start cursor-pointer hover:bg-black/20" onclick="toast.dismiss('${t.id}')">
						<span class="material-icons text-[var(--accent-primary)] text-xl mr-3 mt-0.5">auto_awesome</span>
						<div class="flex-1">
							<h3 class="text-sm font-bold text-primary">Native Auto-Segmentation Available</h3>
							<p class="text-xs text-secondary mt-1">
								This Surah has official timing data! Add it to the timeline, then look for the 
								<span class="text-[var(--accent-primary)]">Mp3Quran Auto-Segment</span> option in the Subtitles Editor.
							</p>
						</div>
						<button class="ml-2 text-secondary hover:text-primary"><span class="material-icons text-sm">close</span></button>
					</div>
				`,
					{ duration: 8000 }
				);
			}

			// Telemetry
			AnalyticsService.downloadFromMP3Quran(cleanLabel.split(' - ')[0], surahName, fileName);
		} catch (error) {
			console.error('Download error:', error);
			toast.error(`Error downloading: ${error}`, { id: toastId, duration: 5000 });
		} finally {
			isDownloading = false;
		}
	}
</script>

<Section icon="mosque" name="Download from MP3Quran">
	<div class="mt-4 space-y-4">
		<!-- Reciter Selection -->
		<div class="space-y-2">
			<label for="reciter-select" class="text-sm font-medium text-secondary">Reciter</label>
			<select
				id="reciter-select"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary
				       focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent"
				bind:value={selectedOptionIndex}
				disabled={isLoadingReciters}
				onchange={() => (selectedSurahId = -1)}
			>
				{#if isLoadingReciters}
					<option value={-1}>Loading reciters...</option>
				{:else}
					<option value={-1}>Select a reciter</option>
					{#each sortedOptions as option, index}
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
				<option value={-1}>Select a Surah</option>
				{#each availableSurahs as surah}
					<option value={surah.id} disabled={!surah.supported}>
						{surah.name}
					</option>
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
			disabled={selectedOptionIndex === -1 || selectedSurahId === -1 || isDownloading}
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
				Reciters marked with <strong>✨</strong> supports
				<span class="font-bold">Native Auto-Segmentation</span> (Official Timing).
			</p>
		</div>
	</div>
</Section>
