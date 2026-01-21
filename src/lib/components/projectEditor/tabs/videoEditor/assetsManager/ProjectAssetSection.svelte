<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { mount, onDestroy, onMount } from 'svelte';
	import AssetViewer from './AssetViewer.svelte';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import DropOverlay from './DropOverlay.svelte';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { open } from '@tauri-apps/plugin-dialog';

	let unlisten: () => void;
	let dropZone: HTMLDivElement;

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
			const input = mount(DropOverlay, {
				target: container
			});

			return () => {
				container.remove();
			};
		}
	});

	onDestroy(() => {
		if (unlisten) unlisten();
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
</script>

<Section icon="folder_open" name="Project Assets">
	<div bind:this={dropZone}>
		<button
			class="btn-accent w-full flex items-center justify-center py-2 px-3 rounded-md text-sm mt-2 cursor-pointer transition-colors duration-200"
			type="button"
			onclick={addAssetButtonClick}
		>
			<span class="material-icons mr-2 text-base">add_circle_outline</span>Add Asset
		</button>

		<div class="flex flex-col gap-2 mt-2">
			{#each globalState.currentProject!.content.assets as asset, i}
				<AssetViewer bind:asset={globalState.currentProject!.content.assets[i]} />
			{/each}
		</div>

		<div class="text-center text-xs text-gray-500 pt-2 mt-2">Drag and drop files here</div>
	</div>
</Section>
