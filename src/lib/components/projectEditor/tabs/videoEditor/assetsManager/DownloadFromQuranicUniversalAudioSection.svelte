<script lang="ts">
	import toast from 'svelte-5-french-toast';
	import { invoke } from '@tauri-apps/api/core';
	import { join } from '@tauri-apps/api/path';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	import { SourceType } from '$lib/classes';
	import { Quran, type Surah } from '$lib/classes/Quran';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { applyPreloadSegmentsToProject } from '$lib/services/AutoSegmentation';
	import { ProjectService } from '$lib/services/ProjectService';
	import {
		QuranicUniversalAudioService,
		type QuaRecitation
	} from '$lib/services/QuranicUniversalAudioService';

	const CONTRIBUTE_URL = 'https://huggingface.co/spaces/hetchyy/quranic-universal-audio';

	let recitations: QuaRecitation[] = $state([]);
	let surahsList: Surah[] = $state([]);
	let selectedSlug = $state('');
	let selectedSurahId = $state(-1);
	let ayahFrom = $state(1);
	let ayahTo = $state(1);
	let isLoadingRecitations = $state(true);
	let isDownloading = $state(false);

	// Options de segmentation (reprend les défauts de l'assistant auto-segmentation).
	// Les timestamps mot à mot sont toujours fournis par le Preload → case forcée/désactivée.
	const segDefaults = globalState.settings?.autoSegmentationSettings;
	let fillBySilence = $state(segDefaults?.fillBySilence ?? true);
	let extendBeforeSilence = $state(segDefaults?.extendBeforeSilence ?? false);
	let extendBeforeSilenceMs = $state(segDefaults?.extendBeforeSilenceMs ?? 50);

	// Récitation choisie et ses chapitres disponibles.
	const selectedRecitation = $derived(
		selectedSlug ? (recitations.find((item) => item.slug === selectedSlug) ?? null) : null
	);
	const availableChapters = $derived<number[]>(selectedRecitation?.chapters ?? []);

	// Sourates proposées = uniquement celles couvertes par la récitation choisie.
	const availableSurahs = $derived(
		surahsList
			.filter((surah) => availableChapters.includes(surah.id))
			.map((surah) => ({
				id: surah.id,
				name: `${surah.id}. ${surah.name} (${surah.translation})`,
				totalAyah: surah.totalAyah
			}))
	);

	// Nombre de versets de la sourate sélectionnée (borne max des compteurs AYA).
	const maxAyah = $derived(selectedSurahId > 0 ? Quran.getVerseCount(selectedSurahId) : 1);

	onMount(async () => {
		try {
			await Quran.load();
			surahsList = Quran.getSurahs();
			recitations = await QuranicUniversalAudioService.getRecitations();
		} catch (error) {
			console.error('Error fetching Quranic Universal Audio recitations:', error);
			toast.error(get(LL).editor.failedToLoadReciters());
		} finally {
			isLoadingRecitations = false;
		}
	});

	/** Réinitialise la sélection de sourate/versets quand la récitation change. */
	function onRecitationChange(): void {
		selectedSurahId = -1;
		ayahFrom = 1;
		ayahTo = 1;
	}

	/** Cale la plage de versets sur 1 → dernier verset de la sourate choisie. */
	function onSurahChange(): void {
		if (selectedSurahId > 0) {
			ayahFrom = 1;
			ayahTo = Quran.getVerseCount(selectedSurahId);
		} else {
			ayahFrom = 1;
			ayahTo = 1;
		}
	}

	/** Borne les compteurs AYA dans [1, maxAyah] et garde from ≤ to. */
	function clampAyahRange(): void {
		const max = maxAyah;
		ayahFrom = Math.min(Math.max(1, Math.round(ayahFrom || 1)), max);
		ayahTo = Math.min(Math.max(1, Math.round(ayahTo || 1)), max);
		if (ayahFrom > ayahTo) {
			[ayahFrom, ayahTo] = [ayahTo, ayahFrom];
		}
	}

	/**
	 * Télécharge l'audio du chapitre, l'ajoute comme asset + à la timeline, puis applique
	 * les segments pré-alignés (avec timestamps mot à mot) via le chemin auto-segmentation.
	 */
	async function downloadAndApply(): Promise<void> {
		if (!selectedSlug || selectedSurahId === -1 || isDownloading) return;
		clampAyahRange();

		isDownloading = true;
		const recitation = selectedRecitation;
		const surah = availableSurahs.find((item) => item.id === selectedSurahId);
		const surahName = surah?.name.split('. ')[1]?.split(' (')[0] ?? `Surah ${selectedSurahId}`;
		const reciterName = recitation?.reciter?.name_en ?? recitation?.label ?? 'Reciter';

		let toastId: string | undefined;
		try {
			// 1. Récupère les segments + l'URL audio directe du chapitre.
			const payload = await QuranicUniversalAudioService.getSegments(
				selectedSlug,
				selectedSurahId,
				ayahFrom,
				ayahTo
			);
			const audioUrl = payload.audio_url ?? '';
			if (!audioUrl) {
				throw new Error('No audio is available for this recitation/chapter.');
			}
			if (!payload.segments || payload.segments.length === 0) {
				throw new Error('No pre-aligned segments are available for this selection.');
			}

			toastId = toast.loading(
				get(LL).editor.downloadingSurah({ surah: surahName, reciter: reciterName })
			);

			// 2. Télécharge le mp3 du chapitre complet dans le dossier d'assets du projet.
			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);
			const rawBaseName = `${reciterName} - ${surahName}`;
			let sanitizedBaseName = rawBaseName.replace(/[<>:"/\\|?*]/g, '').trim();
			if (!sanitizedBaseName) sanitizedBaseName = `surah-${selectedSurahId}`;
			const fileName = `${sanitizedBaseName}.mp3`;
			const fullPath = await join(downloadPath, fileName);

			await invoke('download_file', { url: audioUrl, path: fullPath });

			// 3. Ajoute l'asset et le pose sur la piste audio (mp3 du chapitre complet).
			const projectContent = globalState.currentProject!.content;
			const asset = projectContent.addAsset(fullPath, audioUrl, SourceType.QuranicUniversalAudio, {
				quranicUniversalAudio: {
					recitation: selectedSlug,
					surah: selectedSurahId,
					verseFrom: ayahFrom,
					verseTo: ayahTo
				}
			});
			if (!asset) {
				throw new Error('Unable to add the downloaded audio as a project asset.');
			}
			await asset.ensureDurationLoaded();
			await asset.addToTimeline(false, true);

			toast.success(get(LL).editor.downloadSuccessful(), { id: toastId });
			toastId = undefined;

			// 4. Applique les segments pré-alignés (sans ré-enrichissement MFA).
			await applyPreloadSegmentsToProject(payload, {
				fillBySilence,
				extendBeforeSilence,
				extendBeforeSilenceMs
			});
		} catch (error) {
			console.error('Quranic Universal Audio error:', error);
			toast.error(get(LL).editor.errorDownloading({ error: String(error) }), {
				id: toastId,
				duration: 5000
			});
		} finally {
			isDownloading = false;
		}
	}
</script>

<Section icon="verified" name="Quranic Universal Audio">
	<div class="space-y-3">
		<!-- Callout : données révisées à la main + lien de contribution. -->
		<div
			class="flex items-start gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"
		>
			<span class="material-icons text-base text-green-500">verified</span>
			<p class="text-[11px] leading-relaxed text-secondary/90">
				Human reviewed pre-computed segments with wbw timestamps.
				<button
					type="button"
					class="font-semibold text-[var(--accent-primary)] underline hover:opacity-80"
					onclick={() => void openUrl(CONTRIBUTE_URL)}
				>
					Help contribute more reciters
				</button>
			</p>
		</div>

		<div class="space-y-2">
			<label for="qua-recitation-select" class="text-sm font-medium text-secondary">
				Recitation
			</label>
			<select
				id="qua-recitation-select"
				class="w-full rounded-lg border border-color bg-secondary px-4 py-3 text-sm text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
				bind:value={selectedSlug}
				disabled={isLoadingRecitations}
				onchange={onRecitationChange}
			>
				{#if isLoadingRecitations}
					<option value="">{get(LL).editor.loadingReciters()}</option>
				{:else}
					<option value="">{get(LL).editor.selectReciter()}</option>
					{#each recitations as recitation (recitation.slug)}
						<option value={recitation.slug}>{recitation.label}</option>
					{/each}
				{/if}
			</select>
		</div>

		<div class="space-y-2">
			<label for="qua-surah-select" class="text-sm font-medium text-secondary">
				{get(LL).editor.surah()}
			</label>
			<select
				id="qua-surah-select"
				class="w-full rounded-lg border border-color bg-secondary px-4 py-3 text-sm text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
				bind:value={selectedSurahId}
				disabled={!selectedRecitation}
				onchange={onSurahChange}
			>
				<option value={-1}>{get(LL).editor.selectSurah()}</option>
				{#each availableSurahs as surah (surah.id)}
					<option value={surah.id}>{surah.name}</option>
				{/each}
			</select>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<div class="space-y-2">
				<label for="qua-ayah-from" class="text-sm font-medium text-secondary">Ayah from</label>
				<input
					id="qua-ayah-from"
					type="number"
					min="1"
					max={maxAyah}
					step="1"
					class="w-full rounded-lg border border-color bg-secondary px-3 py-3 text-sm text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
					bind:value={ayahFrom}
					disabled={selectedSurahId === -1}
					onchange={clampAyahRange}
				/>
			</div>
			<div class="space-y-2">
				<label for="qua-ayah-to" class="text-sm font-medium text-secondary">Ayah to</label>
				<input
					id="qua-ayah-to"
					type="number"
					min="1"
					max={maxAyah}
					step="1"
					class="w-full rounded-lg border border-color bg-secondary px-3 py-3 text-sm text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
					bind:value={ayahTo}
					disabled={selectedSurahId === -1}
					onchange={clampAyahRange}
				/>
			</div>
		</div>

		<!-- Options sous-titres (compactes — panneau latéral étroit). -->
		<div class="space-y-2 rounded-lg border border-color px-3 py-2.5 text-xs">
			<label class="flex items-start gap-2 text-secondary">
				<input
					type="checkbox"
					checked
					disabled
					class="mt-0.5 accent-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60"
				/>
				<span class="leading-snug">
					<span class="font-medium text-primary">Include wbw timestamps</span>
					<span class="block text-[11px] text-thirdly">
						Always on here — per-word timings for finer splitting/editing.
					</span>
				</span>
			</label>

			<label class="flex items-center gap-2 text-secondary">
				<input
					type="checkbox"
					bind:checked={fillBySilence}
					class="accent-[var(--accent-primary)]"
				/>
				<span class="text-primary">Fill gaps with silence clips</span>
			</label>

			{#if fillBySilence}
				<div class="flex items-center gap-2 pl-6 text-secondary">
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							bind:checked={extendBeforeSilence}
							class="accent-[var(--accent-primary)]"
						/>
						<span class="text-primary">Extend before silence</span>
					</label>
					<input
						type="number"
						min="0"
						max="2000"
						step="10"
						bind:value={extendBeforeSilenceMs}
						disabled={!extendBeforeSilence}
						class="w-16 rounded border border-color bg-primary px-2 py-1 text-xs text-primary disabled:cursor-not-allowed disabled:opacity-50"
					/>
					<span class="text-thirdly">ms</span>
				</div>
			{/if}
		</div>

		<button
			class="btn-accent relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
			type="button"
			onclick={downloadAndApply}
			disabled={!selectedSlug || selectedSurahId === -1 || isDownloading}
		>
			{#if isDownloading}
				<span class="material-icons animate-spin text-lg">sync</span>
				<span>{get(LL).editor.downloadingLabel()}</span>
			{:else}
				<span class="material-icons text-lg">download</span>
				<span>{get(LL).editor.downloadAudio()}</span>
			{/if}
		</button>
	</div>
</Section>
