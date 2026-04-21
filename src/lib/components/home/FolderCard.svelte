<script lang="ts">
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import ModalManager from '../modals/ModalManager';
	import { FolderService } from '$lib/services/FolderService';
	import type { FolderDetail } from '$lib/types/folder';

	let contextMenu: ContextMenu | undefined = $state(undefined);

	let {
		folder,
		projectCount,
		onclick,
		onRename
	}: {
		folder: FolderDetail;
		projectCount: number;
		onclick: () => void;
		onRename: (folder: FolderDetail) => void;
	} = $props();

	async function deleteFolder(e: MouseEvent) {
		if (e.button !== 0) return;
		if (
			await ModalManager.confirmModal(
				`Are you sure you want to delete the folder "${folder.name}"? Projects inside will be moved back to the main view.`
			)
		) {
			await FolderService.deleteFolder(folder.id);
		} else {
			currentMenu.set(null);
		}
	}

	function renameFolder(e: MouseEvent) {
		if (e.button !== 0) return;
		currentMenu.set(null);
		onRename(folder);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="folder-card group relative flex flex-col items-center gap-2 cursor-pointer select-none"
	onclick={onclick}
	oncontextmenu={(e) => {
		e.preventDefault();
		e.stopPropagation();
		contextMenu?.open(e);
	}}
>
	<div
		class="w-full aspect-[4/3] rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-[1.03] group-hover:shadow-lg shadow-md"
		style="background: {folder.color}22; border: 2px solid {folder.color}55;"
	>
		<span
			class="material-icons text-5xl transition-transform duration-200 group-hover:scale-110"
			style="color: {folder.color};"
		>
			folder
		</span>
	</div>

	<div class="w-full text-center px-1">
		<p class="text-sm font-semibold text-primary truncate leading-tight">{folder.name}</p>
		<p class="text-xs text-thirdly mt-0.5">
			{projectCount}
			{projectCount === 1 ? 'project' : 'projects'}
		</p>
	</div>

	<ContextMenu bind:this={contextMenu}>
		<Item on:click={renameFolder}>
			<span class="material-icons text-sm mr-2">edit</span> Rename
		</Item>
		<Item on:click={deleteFolder}>
			<span class="material-icons text-sm mr-2 text-red-400">delete</span>
			<span class="text-red-400">Delete</span>
		</Item>
	</ContextMenu>
</div>

<style>
	.folder-card {
		min-width: 0;
	}
</style>
