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
	import SearchableSelect from '$lib/components/misc/SearchableSelect.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { applyPreloadSegmentsToProject } from '$lib/services/AutoSegmentation';
	import { ProjectService } from '$lib/services/ProjectService';
	import {
		QuranicUniversalAudioService,
		type QuaRecitation
	} from '$lib/services/QuranicUniversalAudioService';

	let { compact = false }: { compact?: boolean } = $props();

	const CONTRIBUTE_URL = 'https://huggingface.co/spaces/hetchyy/quranic-universal-audio';

	/** Mode de la source : audio pré-aligné (segments) ou audio seul (catalogue étendu). */
	type QuaMode = 'audio_segments' | 'audio_only';

	let mode = $state<QuaMode>('audio_segments');
	let recitations: QuaRecitation[] = $state([]);
	let surahsList: Surah[] = $state([]);
	let selectedSlug = $state('');
	// La clé string pilote le SearchableSelect ; l'id numérique en est dérivé.
	let selectedSurahKey = $state('');
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

	// Options du select de récitation (recherche par label dans le catalogue).
	const recitationOptions = $derived(
		recitations.map((recitation) => ({ value: recitation.slug, label: recitation.label }))
	);

	// Sourate sélectionnée : id numérique dérivé de la clé string du select.
	const selectedSurahId = $derived(selectedSurahKey ? Number.parseInt(selectedSurahKey, 10) : -1);

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

	// Options du select de sourate (recherche par nom).
	const surahSelectOptions = $derived(
		availableSurahs.map((surah) => ({ value: String(surah.id), label: surah.name }))
	);

	// Nombre de versets de la sourate sélectionnée (borne max des compteurs AYA).
	const maxAyah = $derived(selectedSurahId > 0 ? Quran.getVerseCount(selectedSurahId) : 1);

	onMount(async () => {
		await Quran.load();
		surahsList = Quran.getSurahs();
		await loadRecitations();
	});

	/**
	 * Charge le catalogue correspondant au mode courant : récitations publiées
	 * (audio + segments) ou catalogue audio-only (récitateurs non publiés).
	 */
	async function loadRecitations(): Promise<void> {
		isLoadingRecitations = true;
		try {
			recitations =
				mode === 'audio_only'
					? await QuranicUniversalAudioService.getAudioRecitations()
					: await QuranicUniversalAudioService.getRecitations();
		} catch (error) {
			console.error('Error fetching Quranic Universal Audio recitations:', error);
			toast.error(get(LL).editor.failedToLoadReciters());
			recitations = [];
		} finally {
			isLoadingRecitations = false;
		}
	}

	/** Bascule de mode : réinitialise la sélection puis recharge le catalogue. */
	function setMode(next: QuaMode): void {
		if (mode === next || isDownloading) return;
		mode = next;
		selectedSlug = '';
		selectedSurahKey = '';
		ayahFrom = 1;
		ayahTo = 1;
		void loadRecitations();
	}

	/** Réinitialise la sélection de sourate/versets quand la récitation change. */
	function onRecitationChange(): void {
		selectedSurahKey = '';
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

	/** Noms d'affichage (récitateur + sourate) de la sélection courante. */
	function currentNames(): { reciterName: string; surahName: string } {
		const surah = availableSurahs.find((item) => item.id === selectedSurahId);
		const surahName = surah?.name.split('. ')[1]?.split(' (')[0] ?? `Surah ${selectedSurahId}`;
		const reciterName =
			selectedRecitation?.reciter?.name_en ?? selectedRecitation?.label ?? 'Reciter';
		return { reciterName, surahName };
	}

	/**
	 * Télécharge le mp3 du chapitre complet, l'ajoute comme asset puis le pose sur
	 * la piste audio. Gère les toasts de progression ; relance l'erreur au caller.
	 */
	async function importChapterAudio(
		audioUrl: string,
		reciterName: string,
		surahName: string,
		assetMeta: Record<string, unknown>
	): Promise<void> {
		const toastId = toast.loading(
			get(LL).editor.downloadingSurah({ surah: surahName, reciter: reciterName })
		);
		try {
			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);
			const rawBaseName = `${reciterName} - ${surahName}`;
			let sanitizedBaseName = rawBaseName.replace(/[<>:"/\\|?*]/g, '').trim();
			if (!sanitizedBaseName) sanitizedBaseName = `surah-${selectedSurahId}`;
			const fullPath = await join(downloadPath, `${sanitizedBaseName}.mp3`);

			await invoke('download_file', { url: audioUrl, path: fullPath });

			const asset = globalState.currentProject!.content.addAsset(
				fullPath,
				audioUrl,
				SourceType.QuranicUniversalAudio,
				assetMeta
			);
			if (!asset) {
				throw new Error('Unable to add the downloaded audio as a project asset.');
			}
			await asset.ensureDurationLoaded();
			await asset.addToTimeline(false, true);

			toast.success(get(LL).editor.downloadSuccessful(), { id: toastId });
		} catch (error) {
			toast.dismiss(toastId);
			throw error;
		}
	}

	/** Audio + segments : télécharge le chapitre et applique les segments pré-alignés. */
	async function downloadAndApply(): Promise<void> {
		clampAyahRange();
		const { reciterName, surahName } = currentNames();

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

		await importChapterAudio(audioUrl, reciterName, surahName, {
			quranicUniversalAudio: {
				recitation: selectedSlug,
				surah: selectedSurahId,
				verseFrom: ayahFrom,
				verseTo: ayahTo
			}
		});

		// Segments pré-alignés (sans ré-enrichissement MFA).
		await applyPreloadSegmentsToProject(payload, {
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs
		});
	}

	/** Audio seul : télécharge le chapitre complet, sans aucun segment. */
	async function downloadAudioOnly(): Promise<void> {
		const { reciterName, surahName } = currentNames();

		const payload = await QuranicUniversalAudioService.getAudioUrl(selectedSlug, selectedSurahId);
		const audioUrl = payload.audio_url ?? '';
		if (!audioUrl) {
			throw new Error('No audio is available for this recitation/chapter.');
		}

		await importChapterAudio(audioUrl, reciterName, surahName, {
			quranicUniversalAudio: {
				recitation: selectedSlug,
				surah: selectedSurahId
			}
		});
	}

	/** Point d'entrée du bouton de téléchargement (route selon le mode courant). */
	async function onDownload(): Promise<void> {
		if (!selectedSlug || selectedSurahId === -1 || isDownloading) return;
		isDownloading = true;
		try {
			if (mode === 'audio_only') {
				await downloadAudioOnly();
			} else {
				await downloadAndApply();
			}
		} catch (error) {
			console.error('Quranic Universal Audio error:', error);
			toast.error(get(LL).editor.errorDownloading({ error: String(error) }), { duration: 5000 });
		} finally {
			isDownloading = false;
		}
	}
</script>

<Section
	icon="verified"
	name="Quranic Universal Audio"
	hideHeader={compact}
	forceOpen={compact}
	saveState={!compact}
>
	<div class="space-y-3">
		<!-- Bascule de mode : audio + segments (défaut) vs audio seul. -->
		<div class="grid grid-cols-2 gap-1 rounded-lg border border-color bg-secondary p-1">
			<button
				type="button"
				class="rounded-md px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 {mode ===
				'audio_segments'
					? 'bg-[var(--accent-primary)] text-white shadow'
					: 'text-secondary hover:text-primary'}"
				onclick={() => setMode('audio_segments')}
				disabled={isDownloading}
			>
				{get(LL).editor.quaModeAudioSegments()}
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 {mode ===
				'audio_only'
					? 'bg-[var(--accent-primary)] text-white shadow'
					: 'text-secondary hover:text-primary'}"
				onclick={() => setMode('audio_only')}
				disabled={isDownloading}
			>
				{get(LL).editor.quaModeAudioOnly()}
			</button>
		</div>

		<!-- Callout : message dépendant du mode + lien de contribution. -->
		{#if mode === 'audio_only'}
			<div
				class="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"
			>
				<span class="material-icons text-base text-blue-500">public</span>
				<p class="text-[11px] leading-relaxed text-secondary/90">
					{get(LL).editor.quaCalloutAudioOnly()}
					<button
						type="button"
						class="font-semibold text-[var(--accent-primary)] underline hover:opacity-80"
						onclick={() => void openUrl(CONTRIBUTE_URL)}
					>
						{get(LL).editor.quaContribute()}
					</button>
				</p>
			</div>
		{:else}
			<div
				class="flex items-start gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"
			>
				<span class="material-icons text-base text-green-500">verified</span>
				<p class="text-[11px] leading-relaxed text-secondary/90">
					{get(LL).editor.quaCalloutSegments()}
					<button
						type="button"
						class="font-semibold text-[var(--accent-primary)] underline hover:opacity-80"
						onclick={() => void openUrl(CONTRIBUTE_URL)}
					>
						{get(LL).editor.quaContribute()}
					</button>
				</p>
			</div>
		{/if}

		<div class="space-y-2">
			<label for="qua-recitation-select" class="text-sm font-medium text-secondary">
				Recitation
			</label>
			<SearchableSelect
				id="qua-recitation-select"
				bind:value={selectedSlug}
				options={recitationOptions}
				placeholder={isLoadingRecitations
					? get(LL).editor.loadingReciters()
					: get(LL).editor.selectReciter()}
				searchPlaceholder={get(LL).aiVideo.searchRecitersPlaceholder()}
				emptyMessage={get(LL).aiVideo.noRecitersFound()}
				maxHeightClass="max-h-72"
				disabled={isLoadingRecitations}
				onChange={onRecitationChange}
			/>
		</div>

		<div class="space-y-2">
			<label for="qua-surah-select" class="text-sm font-medium text-secondary">
				{get(LL).editor.surah()}
			</label>
			<SearchableSelect
				id="qua-surah-select"
				bind:value={selectedSurahKey}
				options={surahSelectOptions}
				placeholder={get(LL).editor.selectSurah()}
				searchPlaceholder={get(LL).aiVideo.searchSurahPlaceholder()}
				emptyMessage={get(LL).aiVideo.noSurahFound()}
				maxHeightClass="max-h-72"
				disabled={!selectedRecitation}
				onChange={onSurahChange}
			/>
		</div>

		{#if mode === 'audio_segments'}
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
		{/if}

		<button
			class="btn-accent relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
			type="button"
			onclick={onDownload}
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
