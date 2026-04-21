<script lang="ts">
	import { FolderService } from '$lib/services/FolderService';
	import { FOLDER_COLOR_PALETTE } from '$lib/types/folder';
	import toast from 'svelte-5-french-toast';

	let {
		close,
		initialName = '',
		initialColor = FOLDER_COLOR_PALETTE[4],
		editFolderId = undefined as number | undefined,
		onCreated = undefined as ((folderId: number) => void) | undefined
	} = $props();

	let name: string = $state(initialName);
	let selectedColor: string = $state(initialColor);

	async function confirm() {
		if (name.trim() === '') {
			toast.error('Folder name cannot be empty.');
			return;
		}

		if (editFolderId !== undefined) {
			await FolderService.renameFolder(editFolderId, name.trim());
			toast.success('Folder renamed.');
		} else {
			const folder = await FolderService.createFolder(name.trim(), selectedColor);
			onCreated?.(folder.id);
		}

		close();
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[480px] shadow-2xl shadow-black flex flex-col relative"
>
	<!-- Header -->
	<div
		class="rounded-t-2xl px-6 py-5 border-b border-color"
		style="background: linear-gradient(135deg, {selectedColor}22 0%, var(--bg-secondary) 100%);"
	>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div
					class="w-10 h-10 rounded-full flex items-center justify-center shadow-md"
					style="background: {selectedColor}33;"
				>
					<span class="material-icons text-lg" style="color: {selectedColor};">folder</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">
						{editFolderId !== undefined ? 'Rename Folder' : 'New Folder'}
					</h2>
					<p class="text-xs text-thirdly">
						{editFolderId !== undefined ? 'Enter a new name' : 'Organize your projects'}
					</p>
				</div>
			</div>
			<button
				class="w-9 h-9 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-base">close</span>
			</button>
		</div>
	</div>

	<!-- Content -->
	<div class="p-6 space-y-5">
		<!-- Name -->
		<div class="space-y-2">
			<label class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-sm" style="color: {selectedColor};">edit</span>
				Folder Name
			</label>
			<input
				bind:value={name}
				type="text"
				maxlength={40}
				class="w-full"
				placeholder="e.g. Ramadan 2025"
				autocomplete="off"
				onkeydown={(e) => e.key === 'Enter' && confirm()}
			/>
		</div>

		<!-- Color picker (hidden when renaming) -->
		{#if editFolderId === undefined}
			<div class="space-y-2">
				<label class="flex items-center gap-2 text-sm font-semibold text-primary">
					<span class="material-icons text-sm" style="color: {selectedColor};">palette</span>
					Color
				</label>
				<div class="flex gap-2 flex-wrap">
					{#each FOLDER_COLOR_PALETTE as color}
						<button
							class="w-8 h-8 rounded-full transition-all duration-150 cursor-pointer flex items-center justify-center"
							style="background: {color};"
							onclick={() => (selectedColor = color)}
							title={color}
						>
							{#if selectedColor === color}
								<span class="material-icons text-white text-sm drop-shadow">check</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-6 py-4 rounded-b-2xl flex justify-end gap-3">
		<button
			class="px-5 py-2 font-medium text-primary border border-color rounded-lg hover:bg-accent hover:border-accent-primary transition-all duration-200 cursor-pointer"
			onclick={close}
		>
			Cancel
		</button>
		<button
			class="px-6 py-2 font-medium rounded-lg text-white transition-all duration-200 flex items-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
			style="background: {selectedColor}; box-shadow: 0 4px 12px {selectedColor}55;"
			onclick={confirm}
			disabled={name.trim() === ''}
		>
			<span class="material-icons text-base">{editFolderId !== undefined ? 'check' : 'create_new_folder'}</span>
			{editFolderId !== undefined ? 'Rename' : 'Create Folder'}
		</button>
	</div>
</div>

<style>
	button:hover:not(:disabled) {
		transform: translateY(-1px);
	}
	button:disabled {
		transform: none !important;
	}
</style>
