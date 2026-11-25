<script lang="ts">
	import { slide } from 'svelte/transition';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { Edition } from '$lib/classes';
	import type { VisualMergeMode } from '$lib/classes/Clip.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import {
		matchSrtCuesToClips,
		parseSrtTranslation
	} from '$lib/services/SrtTranslationImportService';
	import ModalManager from './modals/ModalManager';
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	let showToolsPopover = $state(false);
	let mergeAcrossVerses = $state(false);
	const mergeModes = ['arabic', 'translation', 'both'] as const;
	let audioEffectsLabel = $derived((Reflect.get(get(LL).tools, 'audioEffects') as () => string)());
	let mediaSpeedLabel = $derived((Reflect.get(get(LL).tools, 'mediaSpeed') as () => string)());
	let mergeLabels = $derived({
		arabic: $LL.editor.mergeArabic(),
		translation: $LL.editor.mergeTranslation(),
		both: $LL.editor.mergeBoth()
	});

	function handleClickOutside(event: Event) {
		if (!showToolsPopover) return;

		const toolsButton = document.getElementById('tools-popover-button');
		const toolsPopover = document.getElementById('tools-popover');

		if (
			toolsButton &&
			toolsPopover &&
			!toolsButton.contains(event.target as Node) &&
			!toolsPopover.contains(event.target as Node)
		) {
			showToolsPopover = false;
		}
	}

	function runAction(action: () => void) {
		showToolsPopover = false;
		action();
	}

	/**
	 * Ferme le menu et lance la fusion visuelle des sous-titres sur la timeline.
	 * @param {VisualMergeMode} mode Mode de fusion choisi.
	 * @returns {void}
	 */
	function mergeAllSubtitles(mode: VisualMergeMode): void {
		runAction(() => globalState.getSubtitleTrack.applyVisualMergeToAll(mode, mergeAcrossVerses));
	}

	/**
	 * Importe une traduction SRT et l'associe aux sous-titres du projet par timecodes.
	 * @returns {Promise<void>} Promise résolue après l'import ou l'annulation.
	 */
	async function importSrtTranslation(): Promise<void> {
		const project = globalState.currentProject;
		if (!project) return;

		try {
			const selection = await open({
				multiple: false,
				directory: false,
				filters: [{ name: get(LL).tools.srtFileFilter(), extensions: ['srt'] }]
			});

			if (!selection || Array.isArray(selection)) return;

			const fileName = selection.split(/[\\/]/).pop() || 'SRT';
			const cues = parseSrtTranslation(await readTextFile(selection));
			const subtitles = globalState.getSubtitleClips;
			if (subtitles.length === 0) {
				toast.error(get(LL).tools.srtNoSubtitles());
				return;
			}

			const matches = matchSrtCuesToClips(cues, subtitles);
			if (matches.length === 0) {
				toast.error(get(LL).tools.srtNoMatches());
				return;
			}

			const projectTranslation = project.content.projectTranslation;
			let editionName = fileName;
			let duplicateIndex = 2;
			while (
				projectTranslation.addedTranslationEditions.some((item) => item.name === editionName)
			) {
				editionName = `${fileName} (${duplicateIndex})`;
				duplicateIndex += 1;
			}

			const availableLanguages = Object.keys(globalState.availableTranslations);
			const language = availableLanguages.includes('English')
				? 'English'
				: (availableLanguages[0] ?? 'English');
			const direction =
				globalState.availableTranslations[language]?.translations?.[0]?.direction || 'ltr';
			const edition = new Edition(
				`srt-${Date.now()}`,
				editionName,
				editionName,
				language,
				direction,
				'srt-import',
				get(LL).tools.importSrtTranslation(),
				'',
				''
			);

			await ProjectHistoryManager.trackAsync(get(LL).tools.importSrtTranslation(), async () => {
				projectTranslation.addedTranslationEditions.push(edition);
				for (const match of matches) {
					const subtitle = subtitles.find((item) => item.id === match.clipId);
					if (subtitle) {
						subtitle.translations[edition.name] = new VerseTranslation(match.text, 'fetched');
					}
				}

				await project.content.videoStyle.addStylesForEdition(edition.name);
				project.detail.updatePercentageTranslated(edition);
				await project.save();
			});

			globalState.updateVideoPreviewUI();
			toast.success(
				get(LL).tools.srtImportSuccess({ count: matches.length, fileName: edition.name })
			);
		} catch (error) {
			console.error('Error importing SRT translation:', error);
			toast.error(get(LL).tools.srtImportError());
		}
	}

	async function removeAllSubtitles() {
		if (!globalState.currentProject) return;

		const subtitleCount = globalState.getSubtitleTrack.clips.length;
		if (subtitleCount === 0) {
			await ModalManager.errorModal(
				get(LL).editor.noSubtitlesToRemove(),
				get(LL).editor.noSubtitlesError()
			);
			return;
		}

		const confirmed = await ModalManager.confirmModal(
			get(LL).editor.removeAllSubtitlesConfirm({ count: subtitleCount }),
			true
		);

		if (!confirmed) return;

		globalState.getSubtitleTrack.clips = [];
		globalState.getStylesState.clearSelection();
		globalState.getSubtitlesEditorState.editSubtitle = null;
		globalState.updateVideoPreviewUI();
	}
</script>

<svelte:window on:click={handleClickOutside} />

<div class="relative">
	<button
		id="tools-popover-button"
		class="w-10 cursor-pointer rounded-full hover:bg-gray-700"
		type="button"
		disabled={globalState.uiState.isTourActive}
		onclick={(event) => {
			event.stopPropagation();
			showToolsPopover = !showToolsPopover;
		}}
		aria-haspopup="dialog"
		aria-expanded={showToolsPopover}
	>
		<span class="material-icons pt-2">construction</span>
	</button>
	{#if showToolsPopover}
		<div
			id="tools-popover"
			class="absolute end-0 top-full z-50 mt-2 max-h-[calc(100dvh-3rem)] w-56 overflow-y-auto rounded-lg border border-color bg-primary py-2 shadow-xl"
			transition:slide
		>
			<div class="px-4 py-2">
				<div class="mb-2 flex items-center gap-3 text-start text-sm text-secondary">
					<span class="material-icons text-lg text-accent">speed</span>
					{$LL.editor.playbackSpeed()}
				</div>
				<div class="grid grid-cols-5 gap-1">
					{#each [0.75, 1, 1.5, 1.75, 2] as speed (speed)}
						<button
							class="rounded py-1 text-xs transition-colors {globalState.getVideoPreviewState
								.playbackSpeed === speed
								? 'bg-accent-primary text-black'
								: 'bg-secondary text-secondary hover:bg-accent'}"
							onclick={(event) => {
								event.stopPropagation();
								globalState.getVideoPreviewState.playbackSpeed = speed;
								globalState.getSubtitlesEditorState.playbackSpeed = speed;
							}}
						>
							{speed}x
						</button>
					{/each}
				</div>
			</div>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.shiftSubtitlesModal());
				}}
			>
				<span class="material-icons text-lg text-accent">move_down</span>
				{$LL.editor.shiftAllSubtitles()}
			</button>
			<details>
				<summary
					class="flex cursor-pointer items-center gap-3 px-4 py-2 text-start text-sm text-secondary"
				>
					<span class="material-icons text-lg text-accent" aria-hidden="true">merge_type</span>
					{$LL.tools.mergeAllSubtitles()}
					<span class="material-icons ms-auto text-base" aria-hidden="true">expand_more</span>
				</summary>
				<div class="space-y-1 px-4 pb-2">
					<select
						class="w-full rounded border border-color bg-secondary px-2 py-1 text-xs text-secondary"
						aria-label={$LL.tools.mergeVerseScope()}
						bind:value={mergeAcrossVerses}
					>
						<option value={false}>{$LL.tools.mergeSameVerse()}</option>
						<option value={true}>{$LL.tools.mergeAcrossVerses()}</option>
					</select>
					{#each mergeModes as mode (mode)}
						<button
							type="button"
							class="w-full rounded px-2 py-1 text-start text-sm text-secondary hover:bg-accent"
							onclick={() => mergeAllSubtitles(mode)}
						>
							{mergeLabels[mode]}
						</button>
					{/each}
				</div>
			</details>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => {
						void importSrtTranslation();
					});
				}}
			>
				<span class="material-icons text-lg text-accent">subtitles</span>
				{$LL.tools.importSrtTranslation()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.hifzRepetitionModal());
				}}
			>
				<span class="material-icons text-lg text-accent">repeat</span>
				{$LL.editor.hifzRepetition()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.audioCutterModal());
				}}
			>
				<span class="material-icons text-lg text-accent">content_cut</span>
				{$LL.editor.assetTrimmer()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.mediaSpeedModal());
				}}
			>
				<span class="material-icons text-lg text-accent">speed</span>
				{mediaSpeedLabel}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.audioEffectsModal());
				}}
			>
				<span class="material-icons text-lg text-accent">spatial_audio</span>
				{audioEffectsLabel}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.verseRangeCropModal());
				}}
			>
				<span class="material-icons text-lg text-accent">crop</span>
				{$LL.tools.selectAyahRange()}
			</button>

			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => WaveformService.clearAllCache());
				}}
			>
				<span class="material-icons text-lg text-accent">graphic_eq</span>
				{$LL.editor.regenerateWaveforms()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-red-300 transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => {
						void removeAllSubtitles();
					});
				}}
			>
				<span class="material-icons text-lg text-red-400">delete_sweep</span>
				{$LL.editor.removeAllSubtitles()}
			</button>
		</div>
	{/if}
</div>
