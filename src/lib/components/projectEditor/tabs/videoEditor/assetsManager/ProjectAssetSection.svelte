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

	let {
		compact = false,
		buttonOnly = false,
		plainList = false,
		onRevealSources
	}: {
		compact?: boolean;
		buttonOnly?: boolean;
		plainList?: boolean;
		onRevealSources?: (() => void) | undefined;
	} = $props();

	let unlisten: () => void;
	let dropZone = $state<HTMLDivElement | undefined>(undefined);

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

{#if compact}
	<div
		bind:this={dropZone}
		class="flex items-center gap-2 overflow-x-auto overflow-y-hidden pb-1 project-assets-compact-bar"
	>
		{#each globalState.currentProject!.content.assets as asset (asset.id)}
			<div class="project-assets-compact-chip" title={asset.fileName}>
				<span class="material-icons text-[14px]">
					{asset.type === 'video'
						? 'video_library'
						: asset.type === 'audio'
							? 'music_note'
							: 'image'}
				</span>
				<span class="truncate">{asset.fileName}</span>
			</div>
		{/each}
	</div>
{:else if buttonOnly}
	<div bind:this={dropZone}>
		<button
			class="btn-accent w-full flex items-center justify-center py-2 px-3 rounded-md text-sm cursor-pointer transition-colors duration-200"
			type="button"
			onclick={addAssetButtonClick}
		>
			<span class="material-icons mr-2 text-base">upload_file</span>{get(LL).editor.uploadFile()}
		</button>
	</div>
{:else if plainList}
	<div bind:this={dropZone} class="project-assets-plain-list">
		<div class="flex flex-col gap-2">
			{#each globalState.currentProject!.content.assets as asset (asset.id)}
				<AssetViewer {asset} />
			{/each}
		</div>

		<button
			class="project-assets-floating-add px-6"
			type="button"
			aria-label={get(LL).editor.addAssetLabel()}
			title={get(LL).editor.addAssetLabel()}
			onclick={() => onRevealSources?.()}
		>
			<span class="material-icons text-[18px]">add</span>
			{get(LL).editor.addAssetLabel()}
		</button>
	</div>
{:else}
	<Section icon="folder_open" name={get(LL).editor.projectAssetsLabel()}>
		<div bind:this={dropZone}>
			<button
				class="btn-accent w-full flex items-center justify-center py-2 px-3 rounded-md text-sm mt-2 cursor-pointer transition-colors duration-200"
				type="button"
				onclick={addAssetButtonClick}
			>
				<span class="material-icons mr-2 text-base">add_circle_outline</span>{get(
					LL
				).editor.addAssetLabel()}
			</button>

			<div class="flex flex-col gap-2 mt-2">
				{#each globalState.currentProject!.content.assets as asset (asset.id)}
					<AssetViewer {asset} />
				{/each}
			</div>
		</div>
	</Section>
{/if}

<style>
	.project-assets-compact-bar::-webkit-scrollbar {
		display: none;
	}

	.project-assets-compact-chip {
		display: inline-flex;
		height: 30px;
		flex-shrink: 0;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 0.75rem;
	}

	.project-assets-compact-chip {
		max-width: 180px;
		padding: 0 0.7rem;
	}

	.project-assets-plain-list {
		position: relative;
		padding-bottom: 3rem;
	}

	.project-assets-floating-add {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: 0;
		display: inline-flex;
		height: 2.25rem;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--accent);
		border-radius: 9999px;
		background: var(--bg-accent);
		color: var(--text-primary);
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24);
	}
</style>
