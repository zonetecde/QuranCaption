<script lang="ts">
	import { fade } from 'svelte/transition';
	import FolderCard from './FolderCard.svelte';
	import type { FolderDetail } from '$lib/types/folder';
	import type { ProjectDetail } from '$lib/classes';
	import CreateFolderModal from './modals/CreateFolderModal.svelte';
	import { FOLDER_COLOR_PALETTE } from '$lib/types/folder';

	let {
		folders,
		projects,
		activeFolderId,
		onFolderClick,
		onBack
	}: {
		folders: FolderDetail[];
		projects: ProjectDetail[];
		activeFolderId: number | null;
		onFolderClick: (id: number) => void;
		onBack: () => void;
	} = $props();

	let createFolderModalVisible = $state(false);
	let renamingFolder: FolderDetail | null = $state(null);

	function getProjectCount(folderId: number): number {
		return projects.filter((p) => p.folderId === folderId).length;
	}

	const activeFolder = $derived(
		activeFolderId !== null ? folders.find((f) => f.id === activeFolderId) ?? null : null
	);
</script>

{#if activeFolderId !== null && activeFolder}
	<!-- Folder view header -->
	<div class="flex items-center gap-3 mt-6 mb-1" transition:fade={{ duration: 150 }}>
		<button
			class="flex items-center gap-1 text-secondary hover:text-primary transition-colors cursor-pointer group"
			onclick={onBack}
		>
			<span
				class="material-icons text-xl group-hover:-translate-x-0.5 transition-transform duration-150"
			>
				arrow_back
			</span>
			<span class="text-sm font-medium">All Projects</span>
		</button>
		<span class="text-thirdly">/</span>
		<div class="flex items-center gap-2">
			<span class="material-icons text-lg" style="color: {activeFolder.color};">folder</span>
			<h3 class="text-xl font-semibold text-primary">{activeFolder.name}</h3>
		</div>
	</div>
{:else if folders.length > 0 || true}
	<!-- Folders section on root -->
	<div class="mt-6" transition:fade={{ duration: 150 }}>
		<div class="flex items-center justify-between mb-3">
			<h3 class="text-lg font-semibold text-primary flex items-center gap-2">
				<span class="material-icons text-accent-primary text-lg">folder_open</span>
				Folders
			</h3>
			<button
				class="flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary border border-color rounded-lg px-3 py-1.5 hover:bg-accent transition-all duration-200 cursor-pointer"
				onclick={() => (createFolderModalVisible = true)}
			>
				<span class="material-icons text-sm">create_new_folder</span>
				New Folder
			</button>
		</div>

		{#if folders.length === 0}
			<p class="text-sm text-thirdly italic">No folders yet. Create one to organize your projects.</p>
		{:else}
			<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-9 gap-4">
				{#each folders as folder (folder.id)}
					<FolderCard
						{folder}
						projectCount={getProjectCount(folder.id)}
						onclick={() => onFolderClick(folder.id)}
						onRename={(f) => (renamingFolder = f)}
					/>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- Create folder modal -->
{#if createFolderModalVisible}
	<div class="modal-wrapper" transition:fade>
		<CreateFolderModal close={() => (createFolderModalVisible = false)} />
	</div>
{/if}

<!-- Rename folder modal -->
{#if renamingFolder}
	<div class="modal-wrapper" transition:fade>
		<CreateFolderModal
			close={() => (renamingFolder = null)}
			editFolderId={renamingFolder.id}
			initialName={renamingFolder.name}
			initialColor={renamingFolder.color}
		/>
	</div>
{/if}
