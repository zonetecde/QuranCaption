<script lang="ts">
	import toast from 'svelte-5-french-toast';
	import { exists, stat } from '@tauri-apps/plugin-fs';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	import { SourceType } from '$lib/classes';
	import { Quran, type Surah } from '$lib/classes/Quran';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import SearchableSelect from '$lib/components/misc/SearchableSelect.svelte';
	import DownloadButton from './DownloadButton.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import type { Project } from '$lib/classes';
	import { applyPreloadSegmentsToProject } from '$lib/services/AutoSegmentation';
	import { bytesToMb, downloadFileWithProgress } from '$lib/services/DownloadWithProgress';
	import {
		getAudioDownload,
		runAudioDownload,
		type AudioDownloadContext,
		type AudioDownloadDone
	} from '$lib/services/AudioDownloadStore.svelte';
	import { quaCacheRelKey, resolveQuaCachePath } from '$lib/services/QuaAudioCache';
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

	// État de téléchargement hébergé hors composant (store de module) : survit au
	// démontage du Video Editor lors d'une bascule d'onglet/fenêtre dans QC, donc
	// le bouton retrouve sa progression et son état occupé au remontage.
	const projectId = $derived(globalState.currentProject?.detail.id ?? -1);
	const download = $derived(getAudioDownload(projectId, 'qua'));
	const isDownloading = $derived(download.busy);

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
	 * Télécharge le mp3 du chapitre (ou le réutilise depuis le cache partagé QUA),
	 * l'ajoute comme asset du projet ciblé puis le pose sur la piste audio. `cacheKey`
	 * identifie de façon déterministe l'audio (récitateur + sourate + plage) : un
	 * fichier déjà présent est réutilisé tel quel, sans re-téléchargement ni copie par
	 * projet — l'`Asset.filePath` pointe directement sur le fichier du cache.
	 *
	 * `project` est capturé au lancement : le travail est détaché du composant, donc on
	 * ne relit jamais `globalState.currentProject` (l'utilisateur peut avoir changé de
	 * projet entre-temps).
	 */
	async function importChapterAudio(
		project: Project,
		report: AudioDownloadContext['report'],
		audioUrl: string,
		assetMeta: Record<string, unknown>,
		cacheKey: string,
		downloadUrl: string = audioUrl
	): Promise<{ bytes: number; fromCache: boolean }> {
		const cachePath = await resolveQuaCachePath(cacheKey);

		// Cache hit → aucun HTTP : on lit juste la taille. Sinon on télécharge la
		// fenêtre audio choisie (`downloadUrl`), en gardant l'URL serveur d'origine
		// (`audioUrl`) comme provenance de l'asset.
		let bytes: number;
		let fromCache = false;
		if (await exists(cachePath)) {
			fromCache = true;
			bytes = (await stat(cachePath)).size;
		} else {
			bytes = await downloadFileWithProgress(downloadUrl, cachePath, report);
		}
		report(null);

		const asset = project.content.addAsset(
			cachePath,
			audioUrl,
			SourceType.QuranicUniversalAudio,
			assetMeta
		);
		if (!asset) {
			throw new Error('Unable to add the downloaded audio as a project asset.');
		}
		await asset.ensureDurationLoaded();
		await asset.addToTimeline(false, true);

		return { bytes, fromCache };
	}

	/** Sélection figée au lancement du téléchargement (détachée des `$state` réactifs). */
	type QuaSelection = {
		slug: string;
		surahId: number;
		surahName: string;
		from: number;
		to: number;
		max: number;
		fillBySilence: boolean;
		extendBeforeSilence: boolean;
		extendBeforeSilenceMs: number;
	};

	/** Construit le résumé de fin (titre + taille téléchargée) pour la notification. */
	function downloadDone(surahName: string, bytes: number, fromCache: boolean): AudioDownloadDone {
		return {
			title: get(LL).editor.downloadSuccessful(),
			body: `${surahName} · ${bytesToMb(bytes)} MB${fromCache ? ' (cached)' : ''}`
		};
	}

	/** Audio + segments : télécharge le chapitre et applique les segments pré-alignés. */
	async function downloadAndApply(
		project: Project,
		ctx: AudioDownloadContext,
		sel: QuaSelection
	): Promise<AudioDownloadDone> {
		const payload = await QuranicUniversalAudioService.getSegments(
			sel.slug,
			sel.surahId,
			sel.from,
			sel.to
		);
		const audioUrl = payload.audio_url ?? '';
		if (!audioUrl) {
			throw new Error('No audio is available for this recitation/chapter.');
		}
		if (!payload.segments || payload.segments.length === 0) {
			throw new Error('No pre-aligned segments are available for this selection.');
		}

		// Les timestamps Preload sont RELATIFS au début de la fenêtre de clip
		// (0 = start_ms). Plutôt que jeter l'audio hors de la plage, on élargit la
		// fenêtre téléchargée aux frontières « spéciales » de la sourate — isti'adha
		// /basmala de tête quand le verset 1 est inclus, clôture de fin quand le
		// dernier verset l'est — puis on réaligne les sous-titres via un décalage.
		const window = computeAudioWindow(audioUrl, sel);

		const { bytes, fromCache } = await importChapterAudio(
			project,
			ctx.report,
			audioUrl,
			{
				quranicUniversalAudio: {
					recitation: sel.slug,
					surah: sel.surahId,
					verseFrom: sel.from,
					verseTo: sel.to
				}
			},
			window.cacheKey,
			window.downloadUrl
		);

		// Segments pré-alignés (sans ré-enrichissement MFA). L'application lit
		// `globalState.currentProject` en interne : on ne l'applique que si le projet
		// ciblé est toujours ouvert (sinon l'audio est ajouté, sans écraser un autre
		// projet). Sur une longue sourate l'application prend plusieurs secondes : le
		// bouton passe en état « Applying… » indéterminé.
		if (globalState.currentProject?.detail.id === project.detail.id) {
			ctx.setLabel('Applying segments to the timeline…');
			await applyPreloadSegmentsToProject(payload, {
				fillBySilence: sel.fillBySilence,
				extendBeforeSilence: sel.extendBeforeSilence,
				extendBeforeSilenceMs: sel.extendBeforeSilenceMs,
				timeOffsetMs: window.timeOffsetMs
			});
		}

		return downloadDone(sel.surahName, bytes, fromCache);
	}

	/** Borne haute « fin de fichier » : ffmpeg tronque à l'EOF réel (24 h en ms). */
	const AUDIO_END_SENTINEL_MS = 24 * 60 * 60 * 1000;

	/**
	 * Élargit la fenêtre de clip Preload aux frontières de sourate demandées, sans
	 * jamais tronquer l'audio « spécial » : garde l'intro (isti'adha/basmala) quand
	 * le verset 1 est dans la plage, et la clôture quand le dernier verset l'est.
	 *
	 * @param audioUrl URL de clip renvoyée par le serveur (`?start_ms=&end_ms=`).
	 * @returns URL à télécharger, clé de cache et décalage temporel des sous-titres.
	 */
	function computeAudioWindow(
		audioUrl: string,
		sel: QuaSelection
	): {
		downloadUrl: string;
		cacheKey: string;
		timeOffsetMs: number;
	} {
		const base = audioUrl.split('?')[0];
		const params = new URL(audioUrl).searchParams;
		const origStart = Number.parseInt(params.get('start_ms') ?? '0', 10) || 0;
		const origEnd = Number.parseInt(params.get('end_ms') ?? '0', 10) || 0;

		const keepIntro = sel.from === 1; // le verset 1 amène l'isti'adha/basmala de tête.
		const keepOutro = sel.to === sel.max; // le dernier verset amène la clôture de fin.
		const audioStart = keepIntro ? 0 : origStart;
		const isFullSurah = keepIntro && keepOutro;

		// Sourate entière → fichier chapitre complet non tronqué (mêmes octets que le
		// mode audio seul → clé partagée `<slug>/<surah>.mp3`).
		const downloadUrl = isFullSurah
			? base
			: `${base}?start_ms=${audioStart}&end_ms=${keepOutro ? AUDIO_END_SENTINEL_MS : origEnd}`;

		const cacheKey = isFullSurah
			? quaCacheRelKey({ slug: sel.slug, surah: sel.surahId })
			: quaCacheRelKey({
					slug: sel.slug,
					surah: sel.surahId,
					verseFrom: sel.from,
					verseTo: sel.to
				});

		// Position d'un segment dans la fenêtre = temps relatif + (origStart − audioStart).
		return { downloadUrl, cacheKey, timeOffsetMs: origStart - audioStart };
	}

	/** Audio seul : télécharge le chapitre complet, sans aucun segment. */
	async function downloadAudioOnly(
		project: Project,
		ctx: AudioDownloadContext,
		sel: QuaSelection
	): Promise<AudioDownloadDone> {
		const payload = await QuranicUniversalAudioService.getAudioUrl(sel.slug, sel.surahId);
		const audioUrl = payload.audio_url ?? '';
		if (!audioUrl) {
			throw new Error('No audio is available for this recitation/chapter.');
		}

		const { bytes, fromCache } = await importChapterAudio(
			project,
			ctx.report,
			audioUrl,
			{
				quranicUniversalAudio: {
					recitation: sel.slug,
					surah: sel.surahId
				}
			},
			// Fichier chapitre complet : clé sans plage de versets.
			quaCacheRelKey({ slug: sel.slug, surah: sel.surahId })
		);

		return downloadDone(sel.surahName, bytes, fromCache);
	}

	/**
	 * Point d'entrée du bouton. Fige la sélection et le projet ciblé, puis délègue au
	 * store de téléchargement (détaché du composant) : la bascule d'onglet/fenêtre dans
	 * QC n'interrompt plus le téléchargement, et une notification annonce la fin.
	 */
	function onDownload(): void {
		const project = globalState.currentProject;
		if (!project || !selectedSlug || selectedSurahId === -1 || isDownloading) return;

		clampAyahRange();
		const { reciterName, surahName } = currentNames();
		const currentMode = mode;
		const sel: QuaSelection = {
			slug: selectedSlug,
			surahId: selectedSurahId,
			surahName,
			from: ayahFrom,
			to: ayahTo,
			max: maxAyah,
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs
		};

		void runAudioDownload({
			projectId: project.detail.id,
			section: 'qua',
			label: get(LL).editor.downloadingSurah({ surah: surahName, reciter: reciterName }),
			errorTitle: get(LL).editor.downloadFailed(),
			run: (ctx) =>
				currentMode === 'audio_only'
					? downloadAudioOnly(project, ctx, sel)
					: downloadAndApply(project, ctx, sel)
		});
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
		<!-- Callout : message dépendant du mode + lien de contribution. -->
		{#if mode === 'audio_only'}
			<div
				class="flex items-start gap-1.5 rounded-md border border-blue-500/15 bg-blue-500/5 px-2.5 py-1.5"
			>
				<span class="material-icons text-[13px] text-blue-500">public</span>
				<p class="text-[10px] leading-snug text-secondary/80">
					{get(LL).editor.quaCalloutAudioOnly()}
					<button
						type="button"
						class="font-medium text-[var(--accent-primary)] underline hover:opacity-80"
						onclick={() => void openUrl(CONTRIBUTE_URL)}
					>
						{get(LL).editor.quaContribute()}
					</button>
				</p>
			</div>
		{:else}
			<div
				class="flex items-start gap-1.5 rounded-md border border-green-500/15 bg-green-500/5 px-2.5 py-1.5"
			>
				<p class="text-[10px] leading-snug text-secondary/80">
					{get(LL).editor.quaCalloutSegments()}
					<button
						type="button"
						class="font-medium text-[var(--accent-primary)] underline hover:opacity-80"
						onclick={() => void openUrl(CONTRIBUTE_URL)}
					>
						{get(LL).editor.quaContribute()}
					</button>
				</p>
			</div>
		{/if}

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

		<DownloadButton
			idleLabel={get(LL).editor.downloadAudio()}
			busyLabel={download.label || get(LL).editor.downloadingLabel()}
			busy={isDownloading}
			disabled={!selectedSlug || selectedSurahId === -1 || isDownloading}
			progress={download.progress}
			onclick={onDownload}
		/>
	</div>
</Section>
