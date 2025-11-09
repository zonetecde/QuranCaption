<script lang="ts">
	import { Project, ProjectContent, ProjectDetail } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import RecitersManager from '$lib/classes/Reciter';
	import { telemetry } from '$lib/services/Telemetry';
	import { discordService } from '$lib/services/DiscordService';
	import Settings from '$lib/classes/Settings.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { applyStyleSnapshotToProject } from '$lib/services/StylePresetService';

	let { close } = $props();

	let name: string = $state('');
	let reciter: string = $state('');

	const STYLE_NONE_VALUE = 'none';
	const STYLE_CREATE_VALUE = 'create';

	let selectedStylePresetId: string = $state(STYLE_NONE_VALUE);
	let stylePresets = $derived(() => globalState.settings?.stylePresets ?? []);

onMount(async () => {
	if (!globalState.settings) {
		await Settings.load();
	}

	const storedPresetId = globalState.settings?.lastUsedStylePresetId;
	if (storedPresetId) {
		selectedStylePresetId = storedPresetId;
	}
});

$effect(() => {
	if (
		selectedStylePresetId !== STYLE_NONE_VALUE &&
		selectedStylePresetId !== STYLE_CREATE_VALUE &&
		!stylePresets().some((preset) => preset.id.toString() === selectedStylePresetId)
	) {
		selectedStylePresetId = STYLE_NONE_VALUE;
		persistSelectedPreset(STYLE_NONE_VALUE);
	}
});

function getSelectedStylePreset() {
	return stylePresets().find((preset) => preset.id.toString() === selectedStylePresetId);
}

function persistSelectedPreset(value: string) {
	if (!globalState.settings) return;
	const storedValue =
		value === STYLE_NONE_VALUE || value === STYLE_CREATE_VALUE ? null : value;
	globalState.settings.lastUsedStylePresetId = storedValue;
	void Settings.save();
}

async function handleStylePresetChange(event: Event) {
	const value = (event.target as HTMLSelectElement).value;
	if (value === STYLE_CREATE_VALUE) {
		const newPreset = await ModalManager.createStylePresetModal();
		if (newPreset) {
			selectedStylePresetId = newPreset.id.toString();
			persistSelectedPreset(selectedStylePresetId);
		} else {
			const storedPreset = globalState.settings?.lastUsedStylePresetId;
			selectedStylePresetId = storedPreset ?? STYLE_NONE_VALUE;
		}
		return;
	}

	selectedStylePresetId = value;
	persistSelectedPreset(value);
}

async function openManageStylePresets() {
	await ModalManager.manageStylePresetsModal();
	const storedPreset = globalState.settings?.lastUsedStylePresetId;
	if (
		storedPreset &&
		stylePresets().some((preset) => preset.id.toString() === storedPreset)
	) {
		selectedStylePresetId = storedPreset;
	} else if (
		!stylePresets().some((preset) => preset.id.toString() === selectedStylePresetId)
	) {
		selectedStylePresetId = STYLE_NONE_VALUE;
		persistSelectedPreset(STYLE_NONE_VALUE);
	}
}

	async function createProjectButtonClick() {
		// Vérifie que le nom du projet n'est pas vide
		if (name.trim() === '') {
			toast.error('Project name cannot be empty.');
			return;
		}

		let project = new Project(
			new ProjectDetail(name.trim(), reciter.trim()),
			await ProjectContent.getDefaultProjectContent()
		);

		const presetToApply =
			selectedStylePresetId !== STYLE_NONE_VALUE ? getSelectedStylePreset() : null;

		if (presetToApply) {
			await applyStyleSnapshotToProject(project, presetToApply.data);
		}

		globalState.currentProject = project;
		discordService.setEditingState();

		try {
			await telemetry(
				'QC3 | New Project Created with Name "' +
					name.trim() +
					'" and Reciter "' +
					reciter.trim() +
					'"'
			);
		} catch (err) {
			console.warn('Telemetry failed', err);
		}

		// Sauvegarde le projet sur le disque
		await project.save();

		close();
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[700px] shadow-2xl shadow-black flex flex-col relative"
>
	<div
		class="bg-gradient-to-r from-accent to-bg-accent rounded-t-2xl px-6 py-6 border-b border-color"
	>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<div
					class="w-12 h-12 bg-accent-primary rounded-full flex items-center justify-center shadow-lg"
				>
					<span class="material-icons text-black text-xl">add_circle</span>
				</div>
				<div>
					<h2 class="text-2xl font-bold text-primary">Create New Project</h2>
					<p class="text-sm text-thirdly">Start your Quran caption project</p>
				</div>
			</div>

			<!-- Close button -->
			<button
				class="w-10 h-10 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary group cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg group-hover:rotate-90 transition-transform duration-200"
					>close</span
				>
			</button>
		</div>
	</div>
	<!-- Content -->
	<div class="p-8 space-y-6">
		<!-- Project Name Field -->
		<div class="space-y-2">
			<label for="name" class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">edit</span>
				Project Name
			</label>
			<div class="relative">
				<input
					bind:value={name}
					name="name"
					type="text"
					maxlength={ProjectDetail.NAME_MAX_LENGTH}
					class="w-full"
					placeholder="Taraweeh 27th night"
					autocomplete="off"
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							createProjectButtonClick();
						}
					}}
				/>
				<div class="absolute right-3 top-1/2 transform -translate-y-1/2">
					<span class="text-xs text-thirdly bg-bg-secondary px-2 py-1 rounded-md">
						{name.length}/{ProjectDetail.NAME_MAX_LENGTH}
					</span>
				</div>
			</div>
		</div>
		<!-- Reciter Field with Autocomplete -->
		<div style="position: relative; z-index: 1000;">
			<AutocompleteInput
				bind:value={reciter}
				suggestions={RecitersManager.reciters.map((r) => r.latin)}
				placeholder="Start typing to search reciters..."
				maxlength={ProjectDetail.RECITER_MAX_LENGTH}
				icon="Person"
				labelIcon="record_voice_over"
				label="Reciter"
				onEnterPress={createProjectButtonClick}
			/>
		</div>

		<div class="space-y-2">
			<label class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">palette</span>
				Copy Styles From
			</label>
			<div class="flex gap-2 items-start">
				<select
					class="w-full bg-accent border border-color rounded-lg px-3 py-2 text-sm text-primary"
					bind:value={selectedStylePresetId}
					onchange={handleStylePresetChange}
				>
					<option value={STYLE_NONE_VALUE}>Use default Quran Caption style</option>
					{#each stylePresets() as preset}
						<option value={preset.id.toString()}>{preset.name}</option>
					{/each}
					<option value={STYLE_CREATE_VALUE}>Create a new style preset...</option>
				</select>
				<button
					type="button"
					class="px-3 py-2 rounded-lg border border-color text-xs font-medium text-primary hover:bg-secondary/40 whitespace-nowrap"
					onclick={openManageStylePresets}
				>
					Manage
				</button>
			</div>
			{#if stylePresets().length === 0}
				<p class="text-xs text-thirdly">
					No saved styles yet. Choose "Create a new style preset..." to store your favorite look.
				</p>
			{:else}
				<p class="text-xs text-thirdly">
					The selected style preset will be applied automatically after the project is created.
				</p>
			{/if}
		</div>
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-8 py-6 rounded-b-2xl">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 text-sm text-thirdly">
				<span class="material-icons text-accent-secondary">info</span>
				<span>Fill in the details to create your project</span>
			</div>

			<div class="flex gap-3">
				<button
					class="px-6 py-2.5 font-medium text-primary border border-color rounded-lg hover:bg-accent hover:border-accent-primary transition-all duration-200 cursor-pointer"
					onclick={close}
				>
					Cancel
				</button>
				<button
					class="px-8 py-2.5 font-medium bg-accent-primary text-black rounded-lg hover:bg-blue-400 transition-all duration-200 flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
					onclick={createProjectButtonClick}
					disabled={name.trim() === ''}
				>
					<span class="material-icons text-lg">add</span>
					Create Project
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Enhanced gradient backgrounds */
	.bg-gradient-to-r.from-accent.to-bg-accent {
		background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%);
	}

	/* Smooth button hover effects */
	button:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	/* Primary button special effects */
	button.bg-accent-primary:hover {
		box-shadow: 0 4px 16px rgba(88, 166, 255, 0.4);
	}

	/* Disabled button override */
	button:disabled {
		transform: none !important;
		box-shadow: none !important;
	}

	/* Character counter styling */
	.absolute span {
		backdrop-filter: blur(4px);
	}

	/* Modal entrance animation */
	div[class*='bg-secondary border-color'] {
		animation: modalSlideIn 0.3s ease-out;
	}

	@keyframes modalSlideIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-20px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	/* Icon rotation on close button hover */
	.group:hover .material-icons {
		transition: transform 0.2s ease;
	}
</style>
