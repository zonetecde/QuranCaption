<script lang="ts">
	import toast from 'svelte-5-french-toast';
	import { join } from '@tauri-apps/api/path';
	import { onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	import { SourceType } from '$lib/classes';
	import type { Project } from '$lib/classes';
	import { Quran } from '$lib/classes/Quran';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { globalState } from '$lib/runes/main.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { runNativeSegmentation } from '$lib/services/AutoSegmentation';
	import { bytesToMb, downloadFileWithProgress } from '$lib/services/DownloadWithProgress';
	import {
		getAudioDownload,
		runAudioDownload,
		type AudioDownloadContext,
		type AudioDownloadDone
	} from '$lib/services/AudioDownloadStore.svelte';
	import {
		Mp3QuranService,
		type Mp3QuranReciter,
		type TimingReciter
	} from '$lib/services/Mp3QuranService';
	import { ProjectService } from '$lib/services/ProjectService';
	import { QdcRecitationService, type QdcRecitation } from '$lib/services/QdcRecitationService';
	import QuranSourceTabs from './QuranSourceTabs.svelte';
	import DownloadButton from './DownloadButton.svelte';

	type DownloadOption = {
		source: 'mp3quran' | 'qdc';
		sourceLabel: 'MP3Quran' | 'QDC';
		label: string;
		reciterName: string;
		surahList: Set<number> | null;
		supportsNativeTiming: boolean;
		mp3Server?: string;
		mp3ReciterId?: number;
		mp3MoshafId?: number;
		qdcRecitationId?: number;
	};

	// Données brutes des deux catalogues de récitations.
	let mp3Reciters: Mp3QuranReciter[] = $state([]);
	let qdcRecitations: QdcRecitation[] = $state([]);
	let timingReciters: TimingReciter[] = $state([]);
	// IDs MP3Quran qui exposent un timing officiel.
	let supportedMp3ReadIds: Set<number> = $state(new Set());
	let downloadOptions: DownloadOption[] = $state([]);
	let selectedOptionIndex = $state(-1);
	let selectedSurahId = $state(-1);
	let isLoadingReciters = $state(true);

	// État de téléchargement hébergé hors composant (store de module) : survit au
	// démontage du Video Editor lors d'une bascule d'onglet/fenêtre dans QC.
	const projectId = $derived(globalState.currentProject?.detail.id ?? -1);
	const download = $derived(getAudioDownload(projectId, 'quranSource'));
	const isDownloading = $derived(download.busy);
	// Quran.com est l'onglet par défaut comme demandé.
	let selectedSource = $state<'qdc' | 'mp3quran'>('qdc');

	// Liste visible dans la combobox selon l'onglet source sélectionné.
	const filteredDownloadOptions = $derived(
		downloadOptions.filter((option) => option.source === selectedSource)
	);

	/**
	 * Construit la liste des sourates disponibles pour l'option choisie.
	 * MP3Quran expose une liste de sourates supportées par moshaf.
	 * QDC est traité ici comme disponible pour toutes les sourates.
	 */
	const availableSurahs = $derived.by(() => {
		const selectedOption =
			selectedOptionIndex === -1 ? null : filteredDownloadOptions[selectedOptionIndex];

		return Quran.getSurahs().map((surah) => ({
			id: surah.id,
			name: `${surah.id}. ${surah.name} (${surah.translation})`,
			supported: selectedOption
				? selectedOption.surahList
					? selectedOption.surahList.has(surah.id)
					: true
				: false
		}));
	});

	/**
	 * Aplatit les données MP3Quran et QDC dans un format unique pour l'UI.
	 * Cela évite de dupliquer toute la logique de sélection et de téléchargement.
	 */
	function buildDownloadOptions(
		reciters: Mp3QuranReciter[],
		qdcItems: QdcRecitation[]
	): DownloadOption[] {
		const options: DownloadOption[] = [];

		for (const reciter of reciters) {
			for (const moshaf of reciter.moshaf) {
				const supportsNativeTiming = supportedMp3ReadIds.has(moshaf.id);
				options.push({
					source: 'mp3quran',
					sourceLabel: 'MP3Quran',
					label: `${reciter.name} - ${moshaf.name}`,
					reciterName: reciter.name,
					surahList: new Set(moshaf.surah_list.split(',').map(Number)),
					supportsNativeTiming,
					mp3Server: moshaf.server,
					mp3ReciterId: reciter.id,
					mp3MoshafId: moshaf.id
				});
			}
		}

		for (const recitation of qdcItems) {
			const detailParts = [
				recitation.style?.trim(),
				recitation.translated_name?.name?.trim()
			].filter(Boolean);
			options.push({
				source: 'qdc',
				sourceLabel: 'QDC',
				label: `${recitation.reciter_name}${detailParts.length > 0 ? ` - ${detailParts.join(' - ')}` : ''}`,
				reciterName: recitation.reciter_name,
				surahList: null,
				supportsNativeTiming: true,
				qdcRecitationId: recitation.id
			});
		}

		return options.sort((a, b) => a.label.localeCompare(b.label));
	}

	onMount(async () => {
		try {
			// Sert à alimenter immédiatement la liste des sourates et leurs labels.
			await Quran.load();

			const [loadedMp3Reciters, loadedTimingReciters, loadedQdcRecitations] = await Promise.all([
				Mp3QuranService.getReciters(),
				Mp3QuranService.getTimingReciters(),
				QdcRecitationService.getRecitations()
			]);

			mp3Reciters = loadedMp3Reciters;
			timingReciters = loadedTimingReciters;
			qdcRecitations = loadedQdcRecitations;
			supportedMp3ReadIds = new Set(timingReciters.map((reciter) => reciter.id));
			downloadOptions = buildDownloadOptions(mp3Reciters, qdcRecitations);
		} catch (error) {
			console.error('Error fetching reciters:', error);
			toast.error(get(LL).editor.failedToLoadReciters());
		} finally {
			isLoadingReciters = false;
		}
	});

	// Quand on change d'onglet source, on repart sur une sélection propre.
	$effect(() => {
		selectedSource;
		selectedOptionIndex = -1;
		selectedSurahId = -1;
	});

	/** Sélection figée au lancement du téléchargement (détachée des `$state` réactifs). */
	type QuranSourceSelection = {
		option: DownloadOption;
		surahId: number;
		surahName: string;
		fileName: string;
		formattedSurahId: string;
	};

	/**
	 * Télécharge l'audio depuis la source active vers le dossier du projet ciblé, ajoute
	 * l'asset, puis propose de charger les timings natifs si la source les fournit.
	 *
	 * `project` est capturé au lancement : le travail est détaché du composant, donc on
	 * ne relit jamais `globalState.currentProject`.
	 */
	async function runQuranSourceDownload(
		project: Project,
		ctx: AudioDownloadContext,
		sel: QuranSourceSelection
	): Promise<AudioDownloadDone> {
		const { option, surahId, surahName, fileName, formattedSurahId } = sel;
		const downloadPath = await ProjectService.getAssetFolderForProject(project.detail.id);
		const fullPath = await join(downloadPath, fileName);

		let audioUrl = '';
		let sourceType = SourceType.Mp3Quran;
		let metadata: Record<string, unknown> = {};

		if (option.source === 'mp3quran') {
			// MP3Quran expose directement l'URL finale du mp3 par convention de dossier.
			audioUrl = `${option.mp3Server}${formattedSurahId}.mp3`;
			sourceType = SourceType.Mp3Quran;
			if (option.supportsNativeTiming) {
				metadata = {
					mp3Quran: {
						reciterId: option.mp3ReciterId,
						moshafId: option.mp3MoshafId,
						surahId
					},
					nativeTiming: {
						provider: 'mp3quran',
						reciterId: option.mp3ReciterId,
						moshafId: option.mp3MoshafId,
						surahId
					}
				};
			}
		} else {
			// Pour QDC, on passe d'abord par le proxy Quran Caption pour ne pas exposer les clés.
			const chapterAudio = await QdcRecitationService.getChapterAudio(
				option.qdcRecitationId!,
				surahId
			);
			if (!chapterAudio?.audio_url) {
				throw new Error('Unable to fetch Quran.com audio URL for this recitation.');
			}
			// Certains audios QDC sont listés mais absents côté CDN. On le vérifie avant download.
			const isAudioAvailable = await QdcRecitationService.isAudioUrlAvailable(
				chapterAudio.audio_url
			);
			if (!isAudioAvailable) {
				throw new Error(
					'This Quran.com recitation is listed, but the source audio file is unavailable upstream for this surah.'
				);
			}
			audioUrl = chapterAudio.audio_url;
			sourceType = SourceType.QuranFoundation;
			metadata = {
				nativeTiming: {
					provider: 'qdc',
					recitationId: option.qdcRecitationId,
					surahId
				}
			};
		}

		const downloadedBytes = await downloadFileWithProgress(audioUrl, fullPath, ctx.report);
		ctx.report(null);

		const projectContent = project.content;
		projectContent.addAsset(fullPath, audioUrl, sourceType, metadata);

		// Timings natifs optionnels : on ne les propose/applique que si le projet ciblé
		// est toujours ouvert (la confirmation + segmentation lisent l'état global).
		if (
			option.supportsNativeTiming &&
			globalState.currentProject?.detail.id === project.detail.id
		) {
			const normalizedFullPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
			const addedAsset = projectContent.assets.find(
				(asset) => asset.filePath === normalizedFullPath
			);

			if (addedAsset) {
				const confirmTimingLoad = await ModalManager.confirmModal(
					get(LL).editor.nativeTimingsConfirm(),
					true
				);

				if (confirmTimingLoad) {
					await addedAsset.addToTimeline(false, true);
					await runNativeSegmentation(addedAsset.id);
				}
			}
		}

		if (option.source === 'mp3quran') {
			AnalyticsService.downloadFromMP3Quran(option.reciterName, surahName, fileName);
		}
		AnalyticsService.downloadRecitationAudio(
			option.sourceLabel,
			option.reciterName,
			surahName,
			fileName
		);

		return {
			title: get(LL).editor.downloadSuccessful(),
			body: `${surahName} · ${bytesToMb(downloadedBytes)} MB`
		};
	}

	/**
	 * Point d'entrée du bouton. Fige la sélection et le projet ciblé, puis délègue au
	 * store de téléchargement (détaché du composant) : la bascule d'onglet/fenêtre dans
	 * QC n'interrompt plus le téléchargement, et une notification annonce la fin.
	 */
	function onDownload(): void {
		const project = globalState.currentProject;
		if (!project || selectedOptionIndex === -1 || selectedSurahId === -1 || isDownloading) return;

		const option = filteredDownloadOptions[selectedOptionIndex];
		const formattedSurahId = selectedSurahId.toString().padStart(3, '0');
		const surahName =
			availableSurahs.find((surah) => surah.id === selectedSurahId)?.name.split(' (')[0] ??
			`Surah ${formattedSurahId}`;
		const rawBaseName = `${option.reciterName} - ${surahName}`;
		let sanitizedBaseName = rawBaseName.replace(/[<>:"/\\|?*]/g, '').trim();
		if (!sanitizedBaseName) {
			sanitizedBaseName = `surah-${formattedSurahId}`;
		}
		const fileName = `${sanitizedBaseName}.mp3`;

		const sel: QuranSourceSelection = {
			option,
			surahId: selectedSurahId,
			surahName,
			fileName,
			formattedSurahId
		};

		void runAudioDownload({
			projectId: project.detail.id,
			section: 'quranSource',
			label: get(LL).editor.downloadingSurah({
				surah: surahName.split('.')[1]?.trim() ?? surahName,
				reciter: option.reciterName
			}),
			errorTitle: get(LL).editor.downloadFailed(),
			run: (ctx) => runQuranSourceDownload(project, ctx, sel)
		});
	}
</script>

<Section icon="mosque" name={get(LL).editor.downloadQuranRecitation()}>
	<div class="space-y-2">
		<div class="space-y-2">
			<p class="text-sm font-medium text-secondary">{get(LL).editor.sourceLabel()}</p>
			<QuranSourceTabs bind:selectedSource />
		</div>

		<div class="space-y-2">
			<label for="reciter-select" class="text-sm font-medium text-secondary"
				>{get(LL).editor.reciterLabel()}</label
			>

			<select
				id="reciter-select"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent"
				bind:value={selectedOptionIndex}
				disabled={isLoadingReciters}
				onchange={() => (selectedSurahId = -1)}
			>
				{#if isLoadingReciters}
					<option value={-1}>{get(LL).editor.loadingReciters()}</option>
				{:else}
					<option value={-1}>{get(LL).editor.selectReciter()}</option>
					{#each filteredDownloadOptions as option, index (`${option.source}-${option.mp3MoshafId ?? option.qdcRecitationId}`)}
						<option value={index}
							>{option.supportsNativeTiming ? `★ ${option.label}` : option.label}</option
						>
					{/each}
				{/if}
			</select>

			<div
				class="flex items-start gap-2 px-3 py-2 bg-green-500/5 border border-green-500/10 rounded-lg"
			>
				<p class="text-[11px] text-secondary/80 leading-relaxed">
					{get(LL).editor.nativeTimingHint()}
				</p>
			</div>
		</div>

		<div class="space-y-2">
			<label for="surah-select" class="text-sm font-medium text-secondary"
				>{get(LL).editor.surah()}</label
			>
			<select
				id="surah-select"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
				bind:value={selectedSurahId}
				disabled={selectedOptionIndex === -1}
			>
				<option value={-1}>{get(LL).editor.selectSurah()}</option>
				{#each availableSurahs as surah (surah.id)}
					<option value={surah.id} disabled={!surah.supported}>
						{surah.name}
					</option>
				{/each}
			</select>
		</div>

		<DownloadButton
			idleLabel={get(LL).editor.downloadAudio()}
			busyLabel={download.label || get(LL).editor.downloadingLabel()}
			busy={isDownloading}
			disabled={selectedOptionIndex === -1 || selectedSurahId === -1 || isDownloading}
			progress={download.progress}
			onclick={onDownload}
		/>
	</div>
</Section>
