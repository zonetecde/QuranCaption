<script lang="ts">
	import {
		PredefinedSubtitleClip,
		SubtitleClip,
		TrackType,
		ProjectEditorTabs,
		type AssetClip,
		type Clip,
		type Track
	} from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { fade, slide } from 'svelte/transition';
	import ContextMenu, { Item, Divider, Settings } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import type { SubtitleTrack } from '$lib/classes/Track.svelte';
	import { onDestroy } from 'svelte';

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

	let positionLeft = $derived(() => {
		return (clip.startTime / 1000) * track.getPixelPerSecond();
	});

	// Détecte s'il existe des overrides de style pour ce clip (utilise VideoStyle)
	const hasOverrides = $derived(() => {
		return globalState.getVideoStyle.hasAnyOverrideForClip(clip.id);
	});

	const isSelected = $derived(() => {
		return (
			globalState.getStylesState.isSelected(clip.id) ||
			globalState.getSubtitlesEditorState.editSubtitle?.id === clip.id
		);
	});

	const isLowConfidence = $derived(() => {
		return clip.comeFromIA && clip.confidence !== null && clip.confidence <= 0.75;
	});

	const isCoverageGap = $derived(() => {
		return clip.needsCoverageReview === true;
	});

	let dragStartX: number | null = null;

	function startLeftDragging(e: MouseEvent) {
		if (e.button === 0) {
			// vient de cliquer sur le bord gauche du clip
			dragStartX = e.clientX;
			globalState.getTimelineState.showCursor = false;
			document.addEventListener('mousemove', onLeftDragging);
			document.addEventListener('mouseup', stopLeftDragging);
		}
	}

	function onLeftDragging(e: MouseEvent) {
		if (dragStartX === null) return;

		clip.updateStartTime(globalState.currentProject?.projectEditorState.timeline.cursorPosition!);
	}

	function stopLeftDragging() {
		dragStartX = null;
		document.removeEventListener('mousemove', onLeftDragging);
		document.removeEventListener('mouseup', stopLeftDragging);
		globalState.getTimelineState.showCursor = true;
		if (clip.type !== 'Silence') {
			clip.markAsManualEdit();
		}
	}

	function startRightDragging(e: MouseEvent) {
		// vient de cliquer sur le bord droit du clip
		dragStartX = e.clientX;
		document.addEventListener('mousemove', onRightDragging);
		document.addEventListener('mouseup', stopRightDragging);
		globalState.getTimelineState.showCursor = false;
	}

	function onRightDragging(e: MouseEvent) {
		if (dragStartX === null) return;

		clip.updateEndTime(globalState.currentProject?.projectEditorState.timeline.cursorPosition!);
	}

	function stopRightDragging() {
		dragStartX = null;
		document.removeEventListener('mousemove', onRightDragging);
		document.removeEventListener('mouseup', stopRightDragging);
		globalState.getTimelineState.showCursor = true;
		if (clip.type !== 'Silence') {
			clip.markAsManualEdit();
		}
	}

	function addSilence(): void {
		// Ajoute un silence à gauche du clip
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

	function editStyle(e: MouseEvent): void {
		clipClicked();
	}

	function clipClicked() {
		// Sélectionne le clip si on est dans la page de style
		if (globalState.currentProject!.projectEditorState.currentTab === 'Style') {
			if (clip instanceof SubtitleClip) {
				globalState.getStylesState.toggleSelection(clip);
			}
		}
	}

	// Sur clic gauche, ouvre l'édition si l'on est dans Subtitles Editor sinon gère la sélection Style
	function handleClipClick() {
		const currentTab = globalState.currentProject!.projectEditorState.currentTab;
		if (currentTab === ProjectEditorTabs.SubtitlesEditor) {
			editSubtitle();
		} else {
			clipClicked();
		}
	}

	function editSubtitle(): void {
		// Modifie le sous-titre
		if (globalState.getSubtitlesEditorState.editSubtitle?.id === clip.id) {
			// Si on est déjà en train de modifier ce sous-titre, on le quitte
			globalState.getSubtitlesEditorState.editSubtitle = null;
			return;
		}
		if (clip.type !== 'Silence') {
			clip.markAsManualEdit();
		}
		globalState.getSubtitlesEditorState.editSubtitle = clip;
	}

	onDestroy(() => {
		currentMenu.set(null);
	});
</script>

<div
	class={'absolute inset-0 z-10 border border-[var(--timeline-subtitle-clip-border)] bg-[var(--timeline-subtitle-clip-color)] rounded-md group overflow-hidden duration-200 ' +
		(isSelected()
			? ' bg-[var(--subtitle-selection-bg)]! border-[var(--subtitle-selection-border)]! '
			: '') +
		(isCoverageGap() && !isSelected() ? ' ai-coverage-gap ' : '') +
		(!isCoverageGap() && isLowConfidence() && !isSelected() ? ' ai-low-confidence ' : '') +
		(globalState.currentProject!.projectEditorState.currentTab === 'Style' ||
		globalState.currentProject!.projectEditorState.currentTab === 'Video editor'
			? 'cursor-pointer'
			: '')}
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
	transition:slide={{ duration: 500, axis: 'x' }}
	oncontextmenu={(e) => {
		e.preventDefault();
		contextMenu!.show(e);
	}}
	onclick={handleClipClick}
>
	{#if clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'}
		<!-- Icône override (haut gauche) -->
		{#if hasOverrides()}
			<span
				class="material-icons-outlined text-[10px] absolute top-0.5 left-0.5 opacity-80"
				title="Styles individuels appliqués"
			>
				auto_fix_high
			</span>
		{/if}

		<div class="absolute inset-0 z-5 flex px-2 py-2">
			<div class="w-full h-full flex flex-col justify-center items-center gap-1">
				<p
					class="arabic truncate leading-tight text-center min-h-5 max-w-full overflow-hidden"
					class:text-[var(--text-primary)]={!isSelected()}
					class:text-[var(--text-on-selection)]={isSelected()}
					dir="rtl"
				>
					{clip.text}
				</p>

				{#if Object.keys(clip.translations).length > 0}
					<div class="w-full flex flex-col items-center gap-0.5 mt-1">
						{#each Object.entries(clip.translations) as [lang, translation]}
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
			<div class="w-3 h-full bg-black/40 clip-path-start"></div>
		{/if}
		<!-- Ligne du milieu -->
		<div class="flex-1 -mx-3 mb-1 h-[4px] bg-black/40"></div>
		<!-- Fin du verset (si le suivant n'est pas le même verset) -->
		{#if !nextIsSameVerse && clip.type !== 'Silence'}
			<div class="w-3 h-full bg-black/40 clip-path-end"></div>
		{/if}
	</div>
</div>

<ContextMenu bind:this={contextMenu}>
	{#if globalState.currentProject!.projectEditorState.currentTab === 'Style' && clip.type === 'Subtitle'}
		<Item on:click={editStyle}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">auto_fix_high</span>Edit style
			</div></Item
		>
	{/if}
	{#if globalState.currentProject!.projectEditorState.currentTab === 'Subtitles editor'}
		<Item on:click={editSubtitle}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">edit</span>Edit subtitle
			</div></Item
		>
	{/if}
	<Item on:click={addSilence}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">space_bar</span>Add silence (on the left)
		</div></Item
	>
	{#if clip.type === 'Subtitle'}
		<Item
			on:click={() => {
				(track as SubtitleTrack).splitSubtitle(clip.id);
			}}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">call_split</span>Split subtitle
			</div></Item
		>
	{/if}
	<Item on:click={removeSubtitle}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">remove</span>Remove subtitle
		</div></Item
	>
</ContextMenu>

<style>
	/* Formes pour l'indicateur de verset */
	.clip-path-start {
		clip-path: polygon(0% 40%, 100% 50%, 0% 100%);
	}

	.clip-path-end {
		clip-path: polygon(0% 50%, 100% 40%, 100% 100%);
	}

	.ai-low-confidence {
		background-color: rgba(230, 195, 60, 0.35) !important;
		border-color: rgba(230, 195, 60, 0.6) !important;
	}

	.ai-coverage-gap {
		background-color: rgba(219, 128, 92, 0.35) !important;
		border-color: rgba(219, 92, 92, 0.7) !important;
	}
</style>
