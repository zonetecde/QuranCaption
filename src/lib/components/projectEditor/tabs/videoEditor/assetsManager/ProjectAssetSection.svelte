<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { mount, onDestroy, onMount } from 'svelte';
	import AssetViewer from './AssetViewer.svelte';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import DropOverlay from './DropOverlay.svelte';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { AssetType, type Asset } from '$lib/classes';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import toast from 'svelte-5-french-toast';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';

	let unlisten: () => void;
	let dropZone: HTMLDivElement;
	let selectedTimelineContextMenu: ContextMenu | undefined = $state(undefined);
	let selectedTimelineContextMenuElement: HTMLElement | null = null;
	let wasSelectedTimelineContextMenuOpenOnPointerDown = false;
	let selectedAssetIds: number[] = $state([]);
	let selectedAssets = $derived(
		globalState.currentProject!.content.assets.filter((asset) =>
			selectedAssetIds.includes(asset.id)
		)
	);
	let areAllAssetsSelected = $derived(
		globalState.currentProject!.content.assets.length > 0 &&
			selectedAssetIds.length === globalState.currentProject!.content.assets.length
	);
	let hasVideoCompatibleSelection = $derived(
		selectedAssets.some((asset) => asset.type !== AssetType.Audio)
	);
	let hasAudioCompatibleSelection = $derived(
		selectedAssets.some((asset) => asset.type !== AssetType.Image)
	);

	onMount(async () => {
		unlisten = await getCurrentWebview().onDragDropEvent((event) => {
			if (event.payload.type === 'over') {
				if (!globalState.currentProject!.projectEditorState.showDropScreen)
					globalState.currentProject!.projectEditorState.showDropScreen = true;
			} else if (event.payload.type === 'drop') {
				if (globalState.currentProject!.projectEditorState.showDropScreen) {
					globalState.currentProject!.projectEditorState.showDropScreen = false;
					// Ajoute le(s) fichier(s) au projet
					for (const file of event.payload.paths) {
						globalState.currentProject?.content.addAsset(file);
					}
				}
			} else {
				if (globalState.currentProject!.projectEditorState.showDropScreen)
					globalState.currentProject!.projectEditorState.showDropScreen = false;
			}
		});
	});

	$effect(() => {
		if (globalState.currentProject!.projectEditorState.showDropScreen) {
			const container = document.createElement('div');
			container.id = 'drop-overlay-container';
			document.body.appendChild(container);

			// Monter le composant Svelte 5
			mount(DropOverlay, {
				target: container
			});

			return () => {
				container.remove();
			};
		}
	});

	$effect(() => {
		const assetIds = new Set(globalState.currentProject!.content.assets.map((asset) => asset.id));
		const validSelection = selectedAssetIds.filter((id) => assetIds.has(id));
		if (validSelection.length !== selectedAssetIds.length) selectedAssetIds = validSelection;
	});

	onDestroy(() => {
		if (unlisten) unlisten();
		currentMenu.set(null);
	});

	async function addAssetButtonClick() {
		// Open a dialog
		const files = await open({
			multiple: true,
			directory: false
		});

		if (!files) return;

		for (let i = 0; i < files.length; i++) {
			const element = files[i];
			globalState.currentProject?.content.addAsset(element);
		}
	}

	/**
	 * Ajoute ou retire un asset de la sélection multiple.
	 * @param {number} assetId Identifiant de l'asset à basculer.
	 * @returns {void}
	 */
	function toggleAssetSelection(assetId: number): void {
		selectedAssetIds = selectedAssetIds.includes(assetId)
			? selectedAssetIds.filter((id) => id !== assetId)
			: [...selectedAssetIds, assetId];
	}

	/**
	 * Sélectionne tous les assets ou vide la sélection courante.
	 * @returns {void}
	 */
	function toggleAllAssets(): void {
		selectedAssetIds = areAllAssetsSelected
			? []
			: globalState.currentProject!.content.assets.map((asset) => asset.id);
	}

	/**
	 * Ouvre ou ferme les modes d'ajout à la timeline pour la sélection courante.
	 * @param {MouseEvent} event Événement utilisé pour positionner le menu.
	 * @returns {void}
	 */
	function openSelectedTimelineContextMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		const shouldClose =
			wasSelectedTimelineContextMenuOpenOnPointerDown ||
			(selectedTimelineContextMenuElement !== null &&
				get(currentMenu) === selectedTimelineContextMenuElement);
		wasSelectedTimelineContextMenuOpenOnPointerDown = false;
		if (shouldClose) {
			currentMenu.set(null);
			return;
		}
		selectedTimelineContextMenu?.show(event);
		selectedTimelineContextMenuElement = get(currentMenu) as HTMLElement | null;
	}

	/**
	 * Vérifie qu'un asset média peut être ajouté à la timeline.
	 * @param {Asset} asset Asset à contrôler.
	 * @returns {Promise<boolean>} Vrai si l'asset est prêt pour l'ajout.
	 */
	async function isAssetReady(asset: Asset): Promise<boolean> {
		if (!asset.exists) return false;
		if (asset.type === AssetType.Image) return true;

		await asset.ensureDurationLoaded();
		if (asset.hasDurationLoadError()) {
			toast.error(asset.getDurationLoadErrorMessage() || get(LL).editor.unableToAnalyzeMedia());
			return false;
		}
		if (asset.duration.isNull()) {
			toast.error(get(LL).editor.unableToLoadDuration());
			return false;
		}
		return true;
	}

	/**
	 * Ajoute les assets sélectionnés dans les pistes compatibles avec le mode demandé.
	 * @param {boolean} video Ajouter les flux vidéo compatibles.
	 * @param {boolean} audio Ajouter les flux audio compatibles.
	 * @returns {Promise<void>}
	 */
	async function addSelectedAssets(video: boolean, audio: boolean): Promise<void> {
		ProjectHistoryManager.begin('add selected assets to timeline');
		try {
			for (const asset of selectedAssets) {
				const asVideo = video && asset.type !== AssetType.Audio;
				const asAudio = audio && asset.type !== AssetType.Image;
				if ((!asVideo && !asAudio) || !(await isAssetReady(asset))) continue;
				await asset.addToTimeline(asVideo, asAudio);
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}
</script>

<Section icon="folder_open" name={get(LL).editor.projectAssetsLabel()}>
	<div bind:this={dropZone}>
		<div class="mt-1 flex gap-1.5">
			<button
				class="btn-accent flex min-w-0 flex-1 items-center justify-center rounded-md px-2.5 py-1.5 text-sm"
				type="button"
				onclick={addAssetButtonClick}
			>
				<span class="material-icons mr-1.5 text-base">add</span>{get(LL).editor.addAssetLabel()}
			</button>
			{#if globalState.currentProject!.content.assets.length > 0}
				<button
					class={`btn flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${areAllAssetsSelected ? 'text-accent' : ''}`}
					type="button"
					title={areAllAssetsSelected ? get(LL).common.deselectAll() : get(LL).common.selectAll()}
					onclick={toggleAllAssets}
				>
					<span class="material-icons text-xl!"
						>{areAllAssetsSelected ? 'deselect' : 'select_all'}</span
					>
				</button>
			{/if}
		</div>

		{#if selectedAssets.length > 0}
			<div
				class="mt-2 rounded-md border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/5 p-2"
			>
				<div class="flex items-center justify-between gap-2">
					<span class="truncate text-xs font-medium text-primary">
						{get(LL).editor.selectedCount({ count: selectedAssets.length })}
					</span>
					<button
						class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-thirdly hover:bg-white/10 hover:text-primary focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
						type="button"
						title={get(LL).editor.clearSelection()}
						onclick={() => (selectedAssetIds = [])}
					>
						<span class="material-icons text-sm">close</span>
					</button>
				</div>
				<button
					class="btn mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium"
					type="button"
					onpointerdown={() =>
						(wasSelectedTimelineContextMenuOpenOnPointerDown =
							selectedTimelineContextMenuElement !== null &&
							get(currentMenu) === selectedTimelineContextMenuElement)}
					onclick={openSelectedTimelineContextMenu}
				>
					<span class="material-icons text-lg!">add_to_queue</span>
					{get(LL).editor.addToTimelineLabel()}
				</button>
			</div>
		{/if}

		<div class="mt-2 flex flex-col gap-1">
			{#each globalState.currentProject!.content.assets as asset (asset.id)}
				<AssetViewer
					{asset}
					selected={selectedAssetIds.includes(asset.id)}
					onToggleSelection={() => toggleAssetSelection(asset.id)}
				/>
			{/each}
		</div>
	</div>
</Section>

<ContextMenu bind:this={selectedTimelineContextMenu}>
	<li class="pointer-events-none px-2 py-1 text-xs font-medium text-thirdly" role="presentation">
		{get(LL).editor.addToTimelineLabel()}
	</li>
	<Item on:click={() => addSelectedAssets(true, true)}>
		<div class="btn-icon">
			<span class="material-icons-outlined mr-1 text-sm">video_library</span>
			{get(LL).editor.videoAndAudio()}
		</div>
	</Item>
	{#if hasVideoCompatibleSelection}
		<Item on:click={() => addSelectedAssets(true, false)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">videocam</span>
				{get(LL).editor.videoOnly()}
			</div>
		</Item>
	{/if}
	{#if hasAudioCompatibleSelection}
		<Item on:click={() => addSelectedAssets(false, true)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">music_note</span>
				{get(LL).editor.audioOnly()}
			</div>
		</Item>
	{/if}
</ContextMenu>
