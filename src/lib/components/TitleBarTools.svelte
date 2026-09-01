<script lang="ts">
	import { slide } from 'svelte/transition';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { Edition } from '$lib/classes';
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

<button
	id="tools-popover-button"
	class="w-10 cursor-pointer rounded-full hover:bg-gray-700 relative"
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
	{#if showToolsPopover}
		<div
			id="tools-popover"
			class="absolute right-0 mt-2 w-56 bg-primary border border-color rounded-lg shadow-xl py-2 z-50 overflow-hidden"
			transition:slide
		>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.shiftSubtitlesModal());
				}}
			>
				<span class="material-icons text-lg text-accent">move_down</span>
				{$LL.editor.shiftAllSubtitles()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
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
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
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
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
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
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
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
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
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
				class="w-full text-left px-4 py-2 text-sm text-red-300 transition-colors flex items-center gap-3"
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
</button>
