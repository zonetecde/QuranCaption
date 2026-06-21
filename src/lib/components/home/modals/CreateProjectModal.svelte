<script lang="ts">
	import { Project, ProjectContent, ProjectDetail, Utilities } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import RecitersManager from '$lib/classes/Reciter';
	import { discordService } from '$lib/services/DiscordService';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import {
		DEFAULT_PROJECT_TYPE,
		PROJECT_TYPE_OPTIONS,
		type ProjectType
	} from '$lib/types/projectType';

	let { close } = $props();

	let name: string = $state('');
	let reciter: string = $state('');
	let projectType: ProjectType = $state(DEFAULT_PROJECT_TYPE);

	async function createProjectButtonClick() {
		// Vérifie que le nom du projet n'est pas vide
		if (name.trim() === '') {
			toast.error(get(LL).home.projectNameCannotBeEmpty());
			return;
		}

		// Vérifie que ni le nom ni le récitateur contiennent des chars interdit
		// par windows pour les noms de fichiers
		if (Utilities.isPathNotSafe(name) || Utilities.isPathNotSafe(reciter)) {
			toast.error(get(LL).home.projectNameInvalidCharacters());
			return;
		}

		let project = new Project(
			new ProjectDetail(name.trim(), reciter.trim(), undefined, undefined, projectType),
			await ProjectContent.getDefaultProjectContent()
		);

		AnalyticsService.trackProjectCreated(name.trim(), reciter.trim(), projectType);

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
	class="create-project-modal relative flex max-h-[min(92vh,48rem)] w-[min(100%-1.5rem,42rem)] flex-col overflow-hidden rounded-2xl border border-color bg-secondary shadow-2xl shadow-black"
>
	<div
		class="rounded-t-2xl border-b border-color bg-gradient-to-r from-accent to-bg-accent px-4 py-4 sm:px-6 sm:py-5"
	>
		<div class="flex items-center justify-between">
			<div class="flex min-w-0 items-center gap-3 sm:gap-4">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-primary shadow-lg sm:h-12 sm:w-12"
				>
					<span class="material-icons text-lg text-black sm:text-xl">add_circle</span>
				</div>
				<div class="min-w-0">
					<h2 class="text-xl font-bold text-primary sm:text-2xl">{$LL.home.createNewProject()}</h2>
					<p class="text-xs text-thirdly sm:text-sm">{$LL.home.startYourProject()}</p>
				</div>
			</div>

			<!-- Close button -->
			<button
				class="group flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary transition-all duration-200 hover:bg-[rgba(255,255,255,0.1)] hover:text-primary"
				onclick={close}
			>
				<span class="material-icons text-lg group-hover:rotate-90 transition-transform duration-200"
					>close</span
				>
			</button>
		</div>
	</div>
	<!-- Content -->
	<div class="flex-1 space-y-5 overflow-y-auto p-4 sm:space-y-6 sm:p-6">
		<!-- Project Name Field -->
		<div class="space-y-2">
			<label for="name" class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">edit</span>
				{$LL.home.projectName()}
			</label>
			<div class="relative">
				<input
					bind:value={name}
					name="name"
					type="text"
					maxlength={ProjectDetail.NAME_MAX_LENGTH}
					class="w-full pr-20"
					placeholder={$LL.home.taraweehExample()}
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
				suggestions={RecitersManager.getRecitersWithCustomOnes()}
				showEverything={true}
				placeholder={$LL.home.searchReciters()}
				maxlength={ProjectDetail.RECITER_MAX_LENGTH}
				icon="person"
				labelIcon="record_voice_over"
				label={$LL.home.reciter()}
				useModalSuggestions={true}
				onEnterPress={createProjectButtonClick}
			/>
		</div>

		<!-- <div class="space-y-2">
			<label for="project-type" class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">folder_special</span>
				{$LL.home.type()}
			</label>
			<div class="relative">
				<select
					id="project-type"
					bind:value={projectType}
					class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary shadow-inner"
				>
					{#each PROJECT_TYPE_OPTIONS as option (option)}
						<option value={option}>{option}</option>
					{/each}
				</select>
				<span
					class="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 material-icons text-thirdly"
				>
					expand_more
				</span>
			</div>
		</div> -->
	</div>

	<!-- Footer -->
	<div class="rounded-b-2xl border-t border-color bg-primary px-4 py-4 sm:px-6 sm:py-5">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-2 text-sm text-thirdly">
				<span class="material-icons text-accent-secondary">info</span>
				<span>{$LL.home.fillInDetails()}</span>
			</div>

			<div class="flex flex-col-reverse gap-3 sm:flex-row">
				<button
					class="w-full rounded-lg border border-color px-6 py-2.5 font-medium text-primary transition-all duration-200 hover:bg-accent hover:border-accent-primary sm:w-auto"
					onclick={close}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-primary px-8 py-2.5 font-medium text-black shadow-lg transition-all duration-200 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
					onclick={createProjectButtonClick}
					disabled={name.trim() === ''}
				>
					<span class="material-icons text-lg">add</span>
					{$LL.home.createProject()}
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
	.create-project-modal {
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
