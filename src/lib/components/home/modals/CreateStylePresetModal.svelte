<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import Settings from '$lib/classes/Settings.svelte';
	import { ProjectService } from '$lib/services/ProjectService';
	import { StylePreset } from '$lib/classes/StylePreset.svelte';
	import { extractStyleSnapshotFromProject } from '$lib/services/StylePresetService';
	import { fade } from 'svelte/transition';

	let { resolve } = $props<{ resolve: (result: StylePreset | null) => void }>();

	let presetName: string = $state('');
	let selectedProjectId: string = $state('');
	let isSaving: boolean = $state(false);
	let isLoadingProjects: boolean = $state(false);

	const userProjects = $derived(() => globalState.userProjectsDetails);

	onMount(async () => {
		if (!globalState.settings) {
			await Settings.load();
		}

		if (userProjects().length === 0) {
			isLoadingProjects = true;
			try {
				await ProjectService.loadUserProjectsDetails();
			} finally {
				isLoadingProjects = false;
			}
		}

		if (!selectedProjectId && userProjects().length > 0) {
			selectedProjectId = userProjects()[0].id.toString();
		}
	});

	$effect(() => {
		if (
			selectedProjectId &&
			!userProjects().some((project) => project.id.toString() === selectedProjectId)
		) {
			selectedProjectId = userProjects().length > 0 ? userProjects()[0].id.toString() : '';
		}
	});

	function closeModal() {
		resolve(null);
	}

	async function handleSave() {
		if (!presetName.trim()) {
			toast.error('Please enter a style name.');
			return;
		}

		const projectId = Number(selectedProjectId);
		if (!projectId) {
			toast.error('Select a project to copy from.');
			return;
		}

		if (!globalState.settings) {
			await Settings.load();
		}

		isSaving = true;
		try {
			const project = await ProjectService.load(projectId);
			const snapshot = extractStyleSnapshotFromProject(project);
			const preset = new StylePreset(presetName.trim(), projectId, snapshot);
			globalState.settings!.stylePresets.push(preset);
			await Settings.save();
			toast.success('Style preset saved.');
			resolve(preset);
		} catch (error) {
			console.error(error);
			toast.error('Unable to create the style preset. Please try again.');
		} finally {
			isSaving = false;
		}
	}
</script>

<div
	class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1200] px-4"
	onclick={closeModal}
	transition:fade
>
	<div
		class="bg-secondary border border-color rounded-2xl shadow-xl w-full max-w-xl"
		onclick={(event) => event.stopPropagation()}
	>
		<div class="border-b border-color px-6 py-4 flex items-center justify-between">
			<div>
				<h2 class="text-xl font-semibold text-primary">Create Style Preset</h2>
				<p class="text-sm text-thirdly">Save styles from an existing project for quick reuse.</p>
			</div>
			<button
				class="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-secondary hover:text-primary"
				type="button"
				onclick={closeModal}
			>
				<span class="material-icons text-base">close</span>
			</button>
		</div>

		<div class="px-6 py-6 space-y-5">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-primary flex items-center gap-2">
					<span class="material-icons text-base text-accent-primary">folder_copy</span>
					Project to copy styles from
				</label>
				{#if isLoadingProjects}
					<div class="text-sm text-thirdly">Loading your projects...</div>
				{:else if userProjects().length === 0}
					<div class="text-sm text-thirdly border border-dashed border-color rounded-lg px-4 py-3">
						You do not have any projects yet. Create a project first to save its styles.
					</div>
				{:else}
					<select
						class="w-full bg-accent border border-color rounded-lg px-3 py-2 text-sm text-primary"
						bind:value={selectedProjectId}
					>
						{#each userProjects() as project}
							<option value={project.id.toString()}>
								{project.name} · {new Date(project.updatedAt).toLocaleDateString()}
							</option>
						{/each}
					</select>
				{/if}
			</div>

			<div class="space-y-2">
				<label class="text-sm font-semibold text-primary flex items-center gap-2">
					<span class="material-icons text-base text-accent-primary">style</span>
					Style name
				</label>
				<input
					type="text"
					class="w-full"
					placeholder="e.g. Ramadan vertical subtitles"
					bind:value={presetName}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							handleSave();
						}
					}}
				/>
			</div>
		</div>

		<div
			class="border-t border-color px-6 py-4 flex items-center justify-end gap-3 bg-primary rounded-b-2xl"
		>
			<button
				class="px-5 py-2 rounded-lg border border-color text-sm font-medium text-primary hover:bg-secondary/40"
				type="button"
				onclick={closeModal}
				disabled={isSaving}
			>
				Cancel
			</button>
			<button
				class="px-5 py-2 rounded-lg bg-accent-primary text-sm font-semibold text-black hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
				type="button"
				onclick={handleSave}
				disabled={isSaving || isLoadingProjects || userProjects().length === 0}
			>
				{#if isSaving}
					<span class="material-icons animate-spin text-base">sync</span>
					Saving...
				{:else}
					<span class="material-icons text-base">save</span>
					Save Preset
				{/if}
			</button>
		</div>
	</div>
</div>
