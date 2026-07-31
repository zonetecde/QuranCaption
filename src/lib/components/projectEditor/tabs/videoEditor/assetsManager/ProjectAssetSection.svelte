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
	import AndroidMediaService from '$lib/services/AndroidMediaService';

	let {
		compact = false,
		buttonOnly = false,
		plainList = false
	}: {
		compact?: boolean;
		buttonOnly?: boolean;
		plainList?: boolean;
	} = $props();

	let unlisten: () => void;
	let dropZone = $state<HTMLDivElement | undefined>(undefined);

	onMount(async () => {
		// La liste du projet reste montée derrière la feuille et porte déjà l'écouteur global.
		if (buttonOnly) return;

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
			const element = await AndroidMediaService.materializeSelectedFile(
				files[i],
				globalState.currentProject?.detail.id ?? 0
			);
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
		<button class="project-assets-file-picker" type="button" onclick={addAssetButtonClick}>
			<span class="project-assets-file-picker-icon material-icons-outlined">folder_open</span>
			<span class="min-w-0 flex-1 text-left">
				<strong class="block truncate text-sm text-primary">
					{(get(LL).editor as unknown as { selectFromFile: () => string }).selectFromFile()}
				</strong>
			</span>
			<span class="material-icons text-[20px] text-thirdly">chevron_right</span>
		</button>
	</div>
{:else if plainList}
	<div bind:this={dropZone}>
		{#if globalState.currentProject!.content.assets.length === 0}
			<div class="project-assets-empty">
				<span class="material-icons-outlined text-2xl text-thirdly">perm_media</span>
				<p class="text-sm font-semibold text-primary">{get(LL).editor.projectAssetsLabel()}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each globalState.currentProject!.content.assets as asset (asset.id)}
					<AssetViewer {asset} />
				{/each}
			</div>
		{/if}
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

	.project-assets-file-picker {
		display: flex;
		min-height: 5rem;
		width: 100%;
		align-items: center;
		gap: 0.75rem;
		border: 1px dashed color-mix(in srgb, var(--accent-primary) 55%, var(--border-color));
		border-radius: 0.8rem;
		padding: 0.8rem;
		background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary));
	}

	.project-assets-file-picker-icon {
		display: inline-flex;
		height: 2.75rem;
		width: 2.75rem;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		border-radius: 0.75rem;
		background: var(--accent-primary);
		color: #fff;
		font-size: 1.4rem;
	}

	.project-assets-empty {
		display: flex;
		min-height: 7rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		border: 1px dashed var(--border-color);
		border-radius: 0.75rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
		text-align: center;
	}
</style>
