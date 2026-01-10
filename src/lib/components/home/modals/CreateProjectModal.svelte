<script lang="ts">
	import { Project, ProjectContent, ProjectDetail, Utilities } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectService } from '$lib/services/ProjectService';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import type Reciter from '$lib/classes/Reciter';
	import RecitersManager from '$lib/classes/Reciter';
	import { discordService } from '$lib/services/DiscordService';
	import { AnalyticsService } from '$lib/services/AnalyticsService';

	let { close } = $props();

	let name: string = $state('');
	let reciter: string = $state('');

	async function createProjectButtonClick() {
		// Vérifie que le nom du projet n'est pas vide
		if (name.trim() === '') {
			toast.error('Project name cannot be empty.');
			return;
		}

		// Vérifie que ni le nom ni le récitateur contiennent des chars interdit
		// par windows pour les noms de fichiers
		if (Utilities.isPathNotSafe(name) || Utilities.isPathNotSafe(reciter)) {
			toast.error(
				'Project name and Reciter cannot contain the following characters: < > : " / \\ | ? *'
			);
			return;
		}

		let project = new Project(
			new ProjectDetail(name.trim(), reciter.trim()),
			await ProjectContent.getDefaultProjectContent()
		);

		AnalyticsService.trackProjectCreated(name.trim(), reciter.trim());

		// Sauvegarde le projet sur le disque
		await project.save();

		// Ouvre le projet
		globalState.currentProject = project;

		// Discord Rich Presence
		discordService.setEditingState();

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
