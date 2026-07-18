<script lang="ts">
	import {
		PredefinedSubtitleClip,
		SubtitleClip,
		ProjectEditorTabs,
		type Track
	} from '$lib/classes';
	import { getClipPrimaryReviewIssueCategory, markClipAsVerified } from '$lib/classes/Clip.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { globalState, type QuickTimelineEditorMode } from '$lib/runes/main.svelte';
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';
	import ContextMenu, { Divider, Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import type { SubtitleTrack } from '$lib/classes/Track.svelte';
	import { onDestroy, tick } from 'svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import toast from 'svelte-5-french-toast';
	import {
		computeWbwTimestampsForClips,
		isWbwTimestampClip,
		scheduleWbwRealign,
		getAutoRealignStatus,
		AUTO_REALIGN_DRAG_THRESHOLD_MS
	} from '$lib/services/AutoSegmentation';
	import LL from '$lib/i18n/i18n-svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let {
		clip = $bindable(),
		track = $bindable(),
		nextIsSameVerse = false,
		previousIsSameVerse = false
	}: {
		clip: SubtitleClip | PredefinedSubtitleClip;
		track: Track;
		nextIsSameVerse?: boolean;
		previousIsSameVerse?: boolean;
	} = $props();

	let contextMenu: ContextMenu | undefined = $state(undefined); // Initialize context menu state

	// Vrai si ce sous-titre Quran n'a pas encore de timestamps mot à mot.
	let isMissingWbwTimestamps = $derived(
		isWbwTimestampClip(clip) && (clip.alignmentMetadata?.words.length ?? 0) === 0
	);

	let positionLeft = $derived(() => {
		return (clip.startTime / 1000) * track.getPixelPerSecond();
	});

	// Détecte s'il existe des overrides de style pour ce clip (utilise VideoStyle)
	const hasOverrides = $derived(() => {
		return globalState.getVideoStyle.hasAnyOverrideForClip(clip.id);
	});

	const visualMergeGroup = $derived(() => {
		if (!(clip instanceof SubtitleClip)) return null;
		return (track as SubtitleTrack).getVisualMergeGroupForClipId(clip.id);
	});

	const visualMergeLabel = $derived(() => {
		if (!visualMergeGroup()) return '';
		if (visualMergeGroup()!.mode === 'arabic') return $LL.editor.mergeGroupArabic();
		if (visualMergeGroup()!.mode === 'translation') return $LL.editor.mergeGroupTranslation();
		return $LL.editor.mergeGroupBoth();
	});

	const isFirstClipInVisualMergeGroup = $derived(() => {
		const group = visualMergeGroup();
		if (!group) return false;
		return group.clips[0]?.id === clip.id;
	});

	const isLastClipInVisualMergeGroup = $derived(() => {
		const group = visualMergeGroup();
		if (!group) return false;
		return group.clips[group.clips.length - 1]?.id === clip.id;
	});

	const hasVisualMergeOverrides = $derived(() => {
		const group = visualMergeGroup();
		if (!group) return false;
		return group.clips.some((groupClip) =>
			globalState.getVideoStyle.hasAnyOverrideForClip(groupClip.id)
		);
	});

	/**
	 * Affiche l'icône d'image sur les clips de sous-titres s'il en existe au moins un qui a une image associée
	 */
	const showImageIconOnAllSubtitleClips = $derived(() => {
		const clips = globalState.getSubtitleTrack?.clips ?? [];
		return clips.some(
			(c) =>
				(c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) && c.hasAssociatedImage()
		);
	});

	const isSelected = $derived(() => {
		return (
			globalState.getStylesState.isSelected(clip.id) ||
			globalState.getSubtitlesEditorState.editSubtitle?.id === clip.id
		);
	});

	const primaryReviewIssueCategory = $derived(
		clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip
			? getClipPrimaryReviewIssueCategory(clip)
			: null
	);

	const fullReviewClass = $derived(
		clip.hasBeenVerified === true
			? ''
			: primaryReviewIssueCategory === 'coverage'
				? ' ai-coverage-gap '
				: primaryReviewIssueCategory === 'low-confidence'
					? ' ai-low-confidence '
					: primaryReviewIssueCategory === 'long'
						? ' ai-too-long '
						: primaryReviewIssueCategory === 'wbw-timestamps'
							? ' ai-wbw-timestamps '
							: ''
	);

	const verifiedReviewBandClass = $derived(
		clip.hasBeenVerified === true
			? primaryReviewIssueCategory === 'coverage'
				? 'review-band review-band-coverage'
				: primaryReviewIssueCategory === 'low-confidence'
					? 'review-band review-band-low-confidence'
					: primaryReviewIssueCategory === 'long'
						? 'review-band review-band-long'
						: primaryReviewIssueCategory === 'wbw-timestamps'
							? 'review-band review-band-wbw-timestamps'
							: ''
			: ''
	);

	const canBookmarkWithQuran = $derived(() => quranAuthService.publicState.status === 'connected');

	/**
	 * Retourne le libellé à afficher pour un mot WBW sur la timeline.
	 * @param {{ location: string; word?: string }} word Mot WBW source.
	 * @returns {string} Texte lisible du mot.
	 */
	function getWordBoundaryLabel(word: { location: string; word?: string }): string {
		const directLabel = String(word.word ?? '').trim();
		if (directLabel) return directLabel;
		if (!(clip instanceof SubtitleClip)) return String(word.location ?? '').trim();

		const relativeWordIndex = Number(word.location.split(':')[2]) - clip.startWordIndex - 1;
		const clipWords = clip.text.split(/\s+/).filter(Boolean);
		const fallbackLabel = clipWords[relativeWordIndex];

		return String(fallbackLabel ?? word.location ?? '').trim();
	}

	const wordBoundaryMarkers = $derived(() => {
		if (!isWbwTimestampClip(clip)) return [];
		if ((clip.alignmentMetadata?.words.length ?? 0) === 0) return [];

		const clipDurationMs = Math.max(1, clip.endTime - clip.startTime);
		return (clip.alignmentMetadata?.words ?? [])
			.map((word, index) => {
				const startPercent = (word.start * 1000 * 100) / clipDurationMs;
				const endPercent = (word.end * 1000 * 100) / clipDurationMs;
				const leftPercent = Math.min(100, Math.max(0, startPercent));
				const rightPercent = Math.min(100, Math.max(leftPercent, endPercent));
				return {
					key: `${clip.id}-wbw-marker-${index}`,
					leftPercent,
					widthPercent: Math.max(0.8, rightPercent - leftPercent),
					label: getWordBoundaryLabel(word)
				};
			})
			.filter((marker) => marker.leftPercent < 100 && marker.widthPercent > 0);
	});

	let dragStartX: number | null = null;
	let didDrag = false;
	let suppressNextClick = false;

	// Animation de la barre de mots : vidée pendant le redimensionnement, spinner pendant le re-MFA.
	let isResizing = $state(false);
	let dragBoundaryStartMs: number | null = null;
	const realignStatus = $derived(
		clip instanceof SubtitleClip ? getAutoRealignStatus(clip.id) : 'idle'
	);

	function startLeftDragging(e: MouseEvent) {
		if (e.button === 0) {
			ProjectHistoryManager.begin('resize subtitle');
			// vient de cliquer sur le bord gauche du clip
			dragStartX = e.clientX;
			didDrag = false;
			if (clip instanceof SubtitleClip) {
				isResizing = true;
				dragBoundaryStartMs = clip.startTime;
			}
			globalState.getTimelineState.showCursor = false;
			document.addEventListener('mousemove', onLeftDragging);
			document.addEventListener('mouseup', stopLeftDragging);
		}
	}

	function onLeftDragging(_e: MouseEvent) {
		if (dragStartX === null) return;
		const cursorPosition = globalState.currentProject?.projectEditorState.timeline.cursorPosition;
		if (cursorPosition === undefined) return;
		clip.updateStartTime(cursorPosition);
		didDrag = true;
	}

	function stopLeftDragging() {
		dragStartX = null;
		document.removeEventListener('mousemove', onLeftDragging);
		document.removeEventListener('mouseup', stopLeftDragging);
		globalState.getTimelineState.showCursor = true;
		if (clip.type !== 'Silence' && !(clip instanceof SubtitleClip)) {
			clip.markAsManualEdit();
		}
		if (clip instanceof SubtitleClip) {
			isResizing = false;
			const movedMs =
				dragBoundaryStartMs === null ? 0 : Math.abs(clip.startTime - dragBoundaryStartMs);
			dragBoundaryStartMs = null;
			if (didDrag && movedMs > AUTO_REALIGN_DRAG_THRESHOLD_MS) {
				// Un drag à gauche déplace aussi la fin du clip précédent → réaligner les deux.
				const previous = (track as SubtitleTrack).getClipBefore(clip.id);
				const group = previous instanceof SubtitleClip ? [previous, clip] : [clip];
				scheduleWbwRealign(group, { reason: 'drag' });
			}
		}
		if (didDrag) {
			suppressNextClick = true;
		}
		ProjectHistoryManager.commit();
	}

	function startRightDragging(e: MouseEvent) {
		// vient de cliquer sur le bord droit du clip
		ProjectHistoryManager.begin('resize subtitle');
		dragStartX = e.clientX;
		didDrag = false;
		if (clip instanceof SubtitleClip) {
			isResizing = true;
			dragBoundaryStartMs = clip.endTime;
		}
		document.addEventListener('mousemove', onRightDragging);
		document.addEventListener('mouseup', stopRightDragging);
		globalState.getTimelineState.showCursor = false;
	}

	function onRightDragging(_e: MouseEvent) {
		if (dragStartX === null) return;
		const cursorPosition = globalState.currentProject?.projectEditorState.timeline.cursorPosition;
		if (cursorPosition === undefined) return;
		clip.updateEndTime(cursorPosition);
		didDrag = true;
	}

	function stopRightDragging() {
		dragStartX = null;
		document.removeEventListener('mousemove', onRightDragging);
		document.removeEventListener('mouseup', stopRightDragging);
		globalState.getTimelineState.showCursor = true;
		if (clip.type !== 'Silence' && !(clip instanceof SubtitleClip)) {
			clip.markAsManualEdit();
		}
		if (clip instanceof SubtitleClip) {
			isResizing = false;
			const movedMs =
				dragBoundaryStartMs === null ? 0 : Math.abs(clip.endTime - dragBoundaryStartMs);
			dragBoundaryStartMs = null;
			if (didDrag && movedMs > AUTO_REALIGN_DRAG_THRESHOLD_MS) {
				// Un drag à droite recale aussi le début du clip suivant → réaligner les deux.
				const next = (track as SubtitleTrack).getClipAfter(clip.id);
				const group = next instanceof SubtitleClip ? [clip, next] : [clip];
				scheduleWbwRealign(group, { reason: 'drag' });
			}
		}
		if (didDrag) {
			suppressNextClick = true;
		}
		ProjectHistoryManager.commit();
	}

	function addSilence(): void {
		// Add a silence clip on the left of the current subtitle clip.
		(track as SubtitleTrack).addSilence(clip.id);
	}

	function removeSubtitle(): void {
		// Supprime le clip de sous-titre
		// Le setTimeout est nécessaire sinon le contextmenu ne se ferme pas
		setTimeout(() => {
			// S'il était dans les clips sélectionnés, on le retire
			if (globalState.getStylesState.isSelected(clip.id)) {
				globalState.getStylesState.removeSelection(clip.id);
			}

			track.removeClip(clip.id, true);

			globalState.currentProject!.detail.updateVideoDetailAttributes();
		}, 0);
	}

	function editStyle(): void {
		clipClicked();
	}

	async function selectLinkedImage(event?: MouseEvent): Promise<void> {
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}

		const result = await open({
			multiple: false,
			directory: false,
			filters: [
				{
					name: 'Image Files',
					extensions: ['png', 'jpg', 'jpeg', 'gif']
				}
			]
		});

		if (!result || Array.isArray(result)) return;

		clip.setAssociatedImagePath(result);
		globalState.updateVideoPreviewUI();
	}

	async function selectLinkedImageFromContextMenu(): Promise<void> {
		currentMenu.set(null);
		await tick();
		await selectLinkedImage();
	}

	function removeLinkedImage(): void {
		clip.setAssociatedImagePath(null);
		globalState.updateVideoPreviewUI();
	}

	function clipClicked(event?: MouseEvent) {
		// Sélectionne le clip si on est dans la page de style
		if (globalState.currentProject!.projectEditorState.currentTab !== 'Style') return;
		if (!(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip)) return;

		ProjectHistoryManager.track('select subtitle style clip', () => {
			const isMultiSelect = Boolean(event?.ctrlKey || event?.metaKey);
			if (isMultiSelect) {
				globalState.getStylesState.toggleSelection(clip);
			} else {
				const selectionUnit = globalState.getStylesState.getSelectionUnitForSubtitle(clip);
				const selectedIds = new Set(
					globalState.getStylesState.selectedSubtitles.map((subtitle) => subtitle.id)
				);
				const allUnitSelected = selectionUnit.every((subtitle) => selectedIds.has(subtitle.id));
				const noExtraSelected =
					globalState.getStylesState.selectedSubtitles.length === selectionUnit.length;
				const alreadyOnlySelected = allUnitSelected && noExtraSelected;
				if (alreadyOnlySelected) {
					globalState.getStylesState.clearSelection();
				} else {
					globalState.getStylesState.selectOnly(clip);
				}
			}
		});
	}

	// Sur clic gauche, ouvre l'édition si l'on est dans Subtitles Editor sinon gère la sélection Style
	function handleClipClick(event: MouseEvent) {
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}

		if (globalState.getTimelineState.wasCursorDragged) {
			globalState.getTimelineState.wasCursorDragged = false;
			return;
		}

		markClipAsVerified(clip);

		const currentTab = globalState.currentProject!.projectEditorState.currentTab;
		if (currentTab === ProjectEditorTabs.SubtitlesEditor) {
			editSubtitle();
		} else {
			clipClicked(event);
		}
	}

	function editSubtitle(): void {
		ProjectHistoryManager.track('edit subtitle clip', () => {
			// Modifie le sous-titre
			if (globalState.getSubtitlesEditorState.editSubtitle?.id === clip.id) {
				// Si on est déjà en train de modifier ce sous-titre, on le quitte
				globalState.getSubtitlesEditorState.editSubtitle = null;
				return;
			}
			globalState.getSubtitlesEditorState.editSubtitle = clip;
		});
	}

	/**
	 * Ouvre l'éditeur rapide superposé à la timeline pour le clip courant.
	 * @param {QuickTimelineEditorMode} mode Mode d'ouverture demandé.
	 * @returns {Promise<void>}
	 */
	async function openQuickTimelineEditorFromContextMenu(
		mode: QuickTimelineEditorMode
	): Promise<void> {
		if (!(clip instanceof SubtitleClip)) return;

		// Ferme le menu avant d'afficher l'overlay pour éviter de garder le context menu ouvert.
		currentMenu.set(null);
		await tick();

		// Le mode "translation" force la saisie classique, le mode "wbw" active le word styling.
		globalState.openQuickTimelineEditor(clip.id, mode);
	}

	/**
	 * Ouvre l'éditeur rapide de traduction sur le clip courant.
	 * @returns {Promise<void>}
	 */
	async function editTranslationFromContextMenu(): Promise<void> {
		globalState.currentProject!.projectEditorState.translationsEditor.isTranslationWbwMappingMode = false;
		globalState.currentProject!.projectEditorState.translationsEditor.isInlineStyleMode = false;
		await openQuickTimelineEditorFromContextMenu('translation');
	}

	/**
	 * Ouvre l'editeur rapide de styles WBW sur le clip courant.
	 * @returns {Promise<void>}
	 */
	async function editWbwStyleFromContextMenu(): Promise<void> {
		await openQuickTimelineEditorFromContextMenu('wbw');
	}

	/**
	 * Ouvre l'editeur rapide de timestamps WBW sur le clip courant.
	 * @returns {Promise<void>}
	 */
	async function editWbwTimestampFromContextMenu(): Promise<void> {
		await openQuickTimelineEditorFromContextMenu('wbwTimestamp');
	}

	/**
	 * Calcule à la demande les timestamps WBW pour ce seul sous-titre via l'API du Universal Aligner.
	 * @returns {Promise<void>}
	 */
	async function generateWbwTimestampsFromContextMenu(): Promise<void> {
		if (!isWbwTimestampClip(clip)) return;

		currentMenu.set(null);
		await tick();

		const loadingToast = toast.loading('Computing WBW timestamps…');
		try {
			const { enriched } = await computeWbwTimestampsForClips([clip]);
			if (enriched > 0) {
				toast.success('WBW timestamps generated.', { id: loadingToast });
				globalState.currentProject?.detail.updateVideoDetailAttributes();
				globalState.updateVideoPreviewUI();
			} else {
				toast.error('Could not generate WBW timestamps.', { id: loadingToast });
			}
		} catch (error) {
			console.error('[WBW] Failed to generate timestamps for clip:', error);
			toast.error('Failed to generate WBW timestamps.', { id: loadingToast });
		}
	}

	/**
	 * Ouvre l'editeur rapide de sous-titre sur le clip courant.
	 * @returns {Promise<void>}
	 */
	async function editSubtitleFromQuickEditorContextMenu(): Promise<void> {
		await openQuickTimelineEditorFromContextMenu('subtitle');
	}

	async function bookmarkVerseFromContextMenu(): Promise<void> {
		if (!canBookmarkWithQuran()) return;
		if (!(clip instanceof SubtitleClip)) return;

		currentMenu.set(null);
		await tick();
		await ModalManager.bookmarkVerseModal(clip.surah, clip.verse);
	}

	/**
	 * Retire le merge visuel du groupe du clip courant.
	 * @returns {Promise<void>}
	 */
	async function unmergeVisualGroupFromContextMenu(): Promise<void> {
		if (!(clip instanceof SubtitleClip) || !clip.visualMergeGroupId) return;

		currentMenu.set(null);
		await tick();
		(track as SubtitleTrack).unmergeVisualGroup(clip.visualMergeGroupId);
	}

	/**
	 * Coupe le clip courant depuis le menu contextuel.
	 * Sans Ctrl, on prefere une coupe alignee sur les mots WBW.
	 * Avec Ctrl, on force la position exacte du curseur.
	 *
	 * @param {MouseEvent} event Evenement de clic du menu.
	 * @returns {Promise<void>}
	 */
	async function splitSubtitleFromContextMenu(event: MouseEvent): Promise<void> {
		if (!(clip instanceof SubtitleClip)) return;

		const didSplit = await (track as SubtitleTrack).splitSubtitle(clip.id, {
			forceExactCursor: Boolean(event.ctrlKey || event.metaKey)
		});
		if (!didSplit) return;

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	onDestroy(() => {
		currentMenu.set(null);
	});
</script>

<div
	class={'absolute inset-0 z-10 border border-[var(--timeline-subtitle-clip-border)] bg-[var(--timeline-subtitle-clip-color)] rounded-md group overflow-visible duration-200 ' +
		(isSelected()
			? visualMergeGroup()
				? ' bg-[var(--subtitle-selection-bg)]! '
				: ' bg-[var(--subtitle-selection-bg)]! border-[var(--subtitle-selection-border)]! '
			: '') +
		(visualMergeGroup() ? ' visual-merged ' : '') +
		(visualMergeGroup() && isFirstClipInVisualMergeGroup() ? ' visual-merged-first ' : '') +
		(visualMergeGroup() && isLastClipInVisualMergeGroup() ? ' visual-merged-last ' : '') +
		fullReviewClass +
		(globalState.currentProject!.projectEditorState.currentTab === 'Style' ||
		globalState.currentProject!.projectEditorState.currentTab === 'Video editor'
			? 'cursor-pointer'
			: '')}
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
	oncontextmenu={(e) => {
		e.preventDefault();
		contextMenu!.show(e);
	}}
	onclick={handleClipClick}
>
	{#if clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'}
		{#if !isResizing}
			{#if realignStatus === 'computing'}
				<div class="absolute inset-0 z-6 pointer-events-none overflow-hidden">
					<div class="wbw-bar-spinner">
						<div
							class="h-3 w-3 rounded-full border-2 border-white/70 border-t-transparent animate-spin"
						></div>
					</div>
				</div>
			{:else if wordBoundaryMarkers().length > 0}
				<div class="absolute inset-0 z-6 pointer-events-none overflow-hidden wbw-markers-fade">
					{#each wordBoundaryMarkers() as marker (marker.key)}
						<div
							class="wbw-word-marker"
							style={`left: ${marker.leftPercent}%; width: ${marker.widthPercent}%;`}
							title={marker.label}
						>
							<span class="arabic">{marker.label}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		<div class="absolute top-0.5 left-0.5 z-20 flex items-center gap-1">
			{#if (visualMergeGroup() && isFirstClipInVisualMergeGroup() && hasVisualMergeOverrides()) || (!visualMergeGroup() && hasOverrides())}
				<span
					class="material-icons-outlined text-[10px] opacity-80"
					title={$LL.editor.subtitleIndividualStyles()}
				>
					auto_fix_high
				</span>
			{/if}

			{#if visualMergeGroup() && isFirstClipInVisualMergeGroup()}
				<span
					class="material-icons-outlined text-[13px] opacity-90 text-emerald-100"
					title={visualMergeLabel()}
				>
					link
				</span>
			{/if}

			{#if showImageIconOnAllSubtitleClips()}
				<span
					class={'material-icons-outlined text-[17px]! cursor-pointer transition-opacity ' +
						(clip.hasAssociatedImage() ? 'opacity-90' : 'opacity-20 hover:opacity-90')}
					title={clip.hasAssociatedImage()
						? $LL.editor.linkedImageOnClip()
						: $LL.editor.linkedImageOnOtherClip()}
					onclick={selectLinkedImage}
				>
					image
				</span>
			{/if}
		</div>

		<div class="absolute inset-0 z-5 flex px-2 py-2">
			<div class="w-full h-full flex flex-col justify-center items-center gap-1">
				<p
					class="arabic truncate leading-tight text-center min-h-5 max-w-full overflow-hidden mt-1"
					class:text-[var(--text-primary)]={!isSelected()}
					class:text-[var(--text-on-selection)]={isSelected()}
					dir="rtl"
				>
					{clip.text}
				</p>

				{#if Object.keys(clip.translations).length > 0}
					<div class="w-full flex flex-col items-center gap-0.5 -mt-1">
						{#each Object.entries(clip.translations) as [lang, translation] (lang)}
							<p
								class="text-[11px] sm:text-[12px] truncate w-full font-medium mx-auto my-auto text-center italic"
								class:text-[var(--text-secondary)]={!isSelected()}
								class:text-[var(--text-on-selection)]={isSelected()}
								title={translation.text}
							>
								{translation.text}
							</p>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else if clip.type === 'Silence'}
		<div
			class="absolute inset-0 z-5 flex px-2 py-2"
			style="background: repeating-linear-gradient(45deg, transparent 0px, transparent 8px, var(--timeline-clip-color) 8px, var(--timeline-clip-color) 16px);"
		></div>
	{/if}

	{#if verifiedReviewBandClass}
		<div class={verifiedReviewBandClass}></div>
	{/if}

	<div
		class="h-full w-1 left-0 cursor-w-resize absolute top-0 bottom-0 z-10"
		onmousedown={startLeftDragging}
	></div>

	<div
		class="h-full w-1 right-0 cursor-w-resize absolute top-0 bottom-0 z-10"
		onmousedown={startRightDragging}
	></div>

	<!-- Indicateur de verset -->
	<div class="absolute -bottom-1 left-0 right-0 h-[20px] flex items-center">
		<!-- Début du verset (si le précédent n'est pas le même verset) -->
		{#if !previousIsSameVerse && clip.type !== 'Silence'}
			<div class="verse-indicator-start"></div>
		{/if}
		<!-- Ligne du milieu -->
		<div class="flex-1 -mx-0.5 mb-1 h-[4px] bg-black/40"></div>
		<!-- Fin du verset (si le suivant n'est pas le même verset) -->
		{#if !nextIsSameVerse && clip.type !== 'Silence'}
			<div class="verse-indicator-end"></div>
		{/if}
	</div>
</div>

<ContextMenu bind:this={contextMenu}>
	{#if globalState.currentProject!.projectEditorState.currentTab === 'Style' && (clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle')}
		<Item on:click={editStyle}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">auto_fix_high</span
				>{$LL.editor.editStyleContext()}
			</div></Item
		>
	{/if}
	{#if globalState.currentProject!.projectEditorState.currentTab === 'Subtitles editor' && clip.type !== 'Subtitle'}
		<Item on:click={editSubtitle}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">edit</span
				>{$LL.editor.editSubtitleContext()}
			</div></Item
		>
	{/if}
	<Item on:click={addSilence}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">space_bar</span
			>{$LL.editor.addSilenceLeft()}
		</div></Item
	>
	{#if clip.type === 'Subtitle'}
		<Item
			on:click={(event) => {
				void splitSubtitleFromContextMenu(event as MouseEvent);
			}}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">call_split</span
				>{$LL.editor.splitSubtitleContext()}
			</div></Item
		>
	{/if}
	{#if clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'}
		<Item on:click={selectLinkedImageFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">image</span>{clip.hasAssociatedImage()
					? $LL.editor.changeLinkedImage()
					: $LL.editor.linkImage()}
			</div></Item
		>
	{/if}
	{#if (clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle') && clip.hasAssociatedImage()}
		<Item on:click={removeLinkedImage}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">image_not_supported</span
				>{$LL.editor.removeLinkedImage()}
			</div></Item
		>
	{/if}
	{#if clip.type === 'Subtitle' && visualMergeGroup()}
		<Item on:click={unmergeVisualGroupFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">link_off</span
				>{$LL.editor.unmergeGroup()}
			</div></Item
		>
	{/if}
	<Item on:click={removeSubtitle}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">remove</span
			>{$LL.editor.removeSubtitleContext()}
		</div></Item
	>
	{#if clip.type === 'Subtitle' && canBookmarkWithQuran()}
		<Divider />
		<Item
			on:click={bookmarkVerseFromContextMenu}
			disabled={!canBookmarkWithQuran()}
			title={!canBookmarkWithQuran()
				? $LL.editor.connectQuranComFirst()
				: $LL.editor.addVerseToCollection()}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">bookmark_add</span
				>{$LL.editor.bookmarkContext()}
			</div></Item
		>
	{/if}
	{#if isMissingWbwTimestamps}
		<Divider />
		<Item on:click={generateWbwTimestampsFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">auto_awesome</span>Generate WBW
				timestamps
			</div></Item
		>
	{/if}
	{#if clip.type === 'Subtitle'}
		<Divider />
		<Item on:click={editSubtitleFromQuickEditorContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">subtitles</span
				>{$LL.editor.editSubtitleContext()}
			</div></Item
		>
		<Item on:click={editTranslationFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">translate</span
				>{$LL.editor.editTranslationContext()}
			</div></Item
		>
		<Item on:click={editWbwTimestampFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">timeline</span
				>{$LL.editor.editWbwTimestampContext()}
			</div></Item
		>
		<Item on:click={editWbwStyleFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">format_color_text</span
				>{$LL.editor.editWbwStyleContext()}
			</div></Item
		>
	{/if}
</ContextMenu>

<style>
	/* Formes pour l'indicateur de verset sans clip-path pour eviter les soucis de stacking */
	.verse-indicator-start {
		width: 0;
		height: 0;
		border-top: 6px solid transparent;
		border-bottom: 6px solid transparent;
		border-left: 12px solid rgba(0, 0, 0, 0.4);
		margin-bottom: 3px;
	}

	.verse-indicator-end {
		width: 0;
		height: 0;
		border-top: 6px solid transparent;
		border-bottom: 6px solid transparent;
		border-right: 12px solid rgba(0, 0, 0, 0.4);
		margin-bottom: 3px;
	}

	.ai-low-confidence {
		background-color: rgba(230, 195, 60, 0.35) !important;
		border-color: rgba(230, 195, 60, 0.6) !important;
	}

	.ai-coverage-gap {
		background-color: rgba(219, 128, 92, 0.35) !important;
		border-color: rgba(219, 92, 92, 0.7) !important;
	}

	.ai-wbw-timestamps {
		background-color: rgba(125, 211, 252, 0.35) !important;
		border-color: rgba(56, 189, 248, 0.7) !important;
	}

	.ai-too-long {
		background-color: rgba(244, 63, 94, 0.32) !important;
		border-color: rgba(251, 113, 133, 0.82) !important;
	}

	.visual-merged {
		border-radius: 0 !important;
		border-top-width: 2px !important;
		border-bottom-width: 2px !important;
		border-left-color: transparent !important;
		border-right-color: transparent !important;
		border-top-color: color-mix(
			in srgb,
			var(--timeline-subtitle-clip-border) 100%,
			black
		) !important;
		border-bottom-color: color-mix(
			in srgb,
			var(--timeline-subtitle-clip-border) 100%,
			black
		) !important;
		box-shadow: inset 0 -8px 0 rgba(16, 185, 129, 0.2);
	}

	.visual-merged-first {
		border-left-width: 2px !important;
		border-left-color: color-mix(
			in srgb,
			var(--timeline-subtitle-clip-border) 100%,
			black
		) !important;
		border-top-left-radius: 0.375rem !important;
		border-bottom-left-radius: 0.375rem !important;
	}

	.visual-merged-last {
		border-right-width: 2px !important;
		border-right-color: color-mix(
			in srgb,
			var(--timeline-subtitle-clip-border) 100%,
			black
		) !important;
		border-top-right-radius: 0.375rem !important;
		border-bottom-right-radius: 0.375rem !important;
	}

	.review-band {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 6px;
		z-index: 12;
		pointer-events: none;
	}

	.review-band-low-confidence {
		background-color: rgba(230, 195, 60, 0.88);
	}

	.review-band-coverage {
		background-color: rgba(219, 92, 92, 0.88);
	}

	.review-band-wbw-timestamps {
		background-color: rgba(56, 189, 248, 0.88);
	}

	.review-band-long {
		background-color: rgba(244, 63, 94, 0.88);
	}

	.wbw-bar-spinner {
		position: absolute;
		top: 0;
		left: 0;
		height: 16px;
		display: flex;
		align-items: center;
		padding-left: 4px;
	}

	.wbw-markers-fade {
		animation: wbwFadeIn 200ms ease-out;
	}

	@keyframes wbwFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.wbw-word-marker {
		position: absolute;
		top: 0px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.12);
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.18),
			0 0 0 1px rgba(0, 0, 0, 0.08);
		color: rgba(255, 255, 255, 0.92);
		font-size: 9px;
		line-height: 1;
		white-space: nowrap;
		text-overflow: clip;
	}

	.wbw-word-marker span {
		overflow: hidden;
		text-overflow: clip;
	}
</style>
