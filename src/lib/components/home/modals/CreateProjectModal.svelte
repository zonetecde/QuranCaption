<script lang="ts">
	import {
		applyProjectCreationPreset,
		getProjectVideoDimensions,
		type ProjectVideoQuality
	} from '$lib/services/ProjectService';
	type VideoFormat = 'landscape' | 'portrait' | 'square' | 'custom';
	import { Project, ProjectContent, ProjectDetail, Utilities } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import { discordService } from '$lib/services/DiscordService';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { getProjectTypeLabel } from '$lib/i18n/statusMapper';
	import {
		DEFAULT_PROJECT_TYPE,
		PROJECT_TYPE_OPTIONS,
		type ProjectType
	} from '$lib/types/projectType';

	let { close } = $props();

	let name: string = $state('');
	let speaker: string = $state('');
	let selectedVideoFormat = $state<VideoFormat>('landscape');
	let selectedVideoQuality = $state<ProjectVideoQuality>('1080p');
	let customVideoDimensions = $state({ width: 1920, height: 1080 });
	let videoDimensions = $derived(
		selectedVideoFormat === 'custom'
			? customVideoDimensions
			: getProjectVideoDimensions(selectedVideoFormat, selectedVideoQuality)
	);
	let videoFormats = $derived([
		{
			value: 'landscape' as const,
			ratio: '16:9',
			icon: 'crop_landscape',
			label: $LL.style.orientationLandscape()
		},
		{
			value: 'portrait' as const,
			ratio: '9:16',
			icon: 'crop_portrait',
			label: $LL.style.orientationPortrait()
		},
		{
			value: 'square' as const,
			ratio: '1:1',
			icon: 'crop_square',
			label: $LL.style.orientationSquare()
		},
		{
			value: 'custom' as const,
			ratio: 'W×H',
			icon: 'tune',
			label: $LL.export.customDimensions()
		}
	]);
	const videoQualities: Array<{ value: ProjectVideoQuality; label: string }> = [
		{ value: '720p', label: '720p' },
		{ value: '1080p', label: '1080p' },
		{ value: '1440p', label: '1440p (2K)' },
		{ value: '2160p', label: '2160p (4K)' }
	];

	let projectType: ProjectType = $state(DEFAULT_PROJECT_TYPE);
	let projectTypeOptions: readonly ProjectType[] = $derived(
		globalState.settings?.defaultValuesSettings.projectCategories ?? PROJECT_TYPE_OPTIONS
	);

	$effect(() => {
		if (!projectTypeOptions.includes(projectType)) {
			projectType = projectTypeOptions[0] ?? DEFAULT_PROJECT_TYPE;
		}
	});
	let speakerSuggestions = $derived(
		Array.from(
			new Set(
				globalState.userProjectsDetails
					.map((project) => project.speaker.trim())
					.filter(
						(projectSpeaker) => projectSpeaker.length > 0 && projectSpeaker !== 'Unknown speaker'
					)
			)
		)
	);

	async function createProjectButtonClick() {
		// Vérifie que le nom du projet n'est pas vide
		if (name.trim() === '') {
			toast.error(get(LL).home.projectNameCannotBeEmpty());
			return;
		}

		// Vérifie que le nom du projet et celui de l'intervenant sont sûrs pour un nom de fichier.
		if (Utilities.isPathNotSafe(name) || Utilities.isPathNotSafe(speaker)) {
			toast.error(get(LL).home.projectNameInvalidCharacters());
			return;
		}

		let project = new Project(
			new ProjectDetail(name.trim(), speaker.trim(), undefined, undefined, projectType),
			await ProjectContent.getDefaultProjectContent()
		);

		applyProjectCreationPreset(project.content, videoDimensions);

		AnalyticsService.trackProjectCreated(name.trim(), speaker.trim(), projectType);

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
	class="bg-secondary border-color border rounded-2xl w-[700px] max-h-[90vh] shadow-2xl shadow-black flex flex-col relative"
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
					<h2 class="text-2xl font-bold text-primary">{$LL.home.createNewProject()}</h2>
					<p class="text-sm text-thirdly">{$LL.home.startYourProject()}</p>
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
	<div class="p-8 space-y-6 overflow-y-auto">
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
					class="w-full"
					placeholder={$LL.home.taraweehExample()}
					autocomplete="off"
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							createProjectButtonClick();
						}
					}}
				/>
				<div class="absolute end-3 top-1/2 transform -translate-y-1/2">
					<span class="text-xs text-thirdly bg-bg-secondary px-2 py-1 rounded-md">
						{name.length}/{ProjectDetail.NAME_MAX_LENGTH}
					</span>
				</div>
			</div>
		</div>
		<!-- Speaker Field with Autocomplete -->
		<div style="position: relative; z-index: 1000;">
			<AutocompleteInput
				bind:value={speaker}
				suggestions={speakerSuggestions}
				placeholder={$LL.home.searchSpeakers()}
				maxlength={ProjectDetail.SPEAKER_MAX_LENGTH}
				icon="person"
				labelIcon="record_voice_over"
				label={$LL.home.speaker()}
				onEnterPress={createProjectButtonClick}
			/>
		</div>

		<div class="space-y-3 rounded-xl border border-color bg-bg-secondary p-3">
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2 text-sm font-semibold text-primary">
					<span class="material-icons text-accent-primary text-base">screen_rotation</span>
					{$LL.export.videoQualityOrientation()}
				</div>
				<p class="text-xs whitespace-nowrap text-thirdly">
					{videoDimensions.width} × {videoDimensions.height}
				</p>
			</div>

			<div class="grid grid-cols-4 gap-2">
				{#each videoFormats as format (format.value)}
					<button
						type="button"
						aria-pressed={selectedVideoFormat === format.value}
						class="flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-2 transition-all {selectedVideoFormat ===
						format.value
							? 'border-accent-primary bg-accent text-accent-primary shadow-md'
							: 'border-color bg-primary text-secondary hover:border-accent-primary hover:text-primary'}"
						onclick={() => (selectedVideoFormat = format.value)}
					>
						<span class="material-icons text-2xl">{format.icon}</span>
						<span class="text-xs font-semibold text-primary">{format.ratio}</span>
						<span class="text-xs">{format.label}</span>
					</button>
				{/each}
			</div>

			{#if selectedVideoFormat === 'custom'}
				<div class="flex items-center gap-3">
					<input
						type="number"
						bind:value={customVideoDimensions.width}
						min="256"
						max="7680"
						class="w-full"
					/>
					<span class="text-thirdly">×</span>
					<input
						type="number"
						bind:value={customVideoDimensions.height}
						min="144"
						max="4320"
						class="w-full"
					/>
				</div>
			{:else}
				<div class="space-y-1.5">
					<p class="text-xs font-medium text-thirdly">{$LL.export.quality()}</p>
					<div class="grid grid-cols-4 gap-2">
						{#each videoQualities as quality (quality.value)}
							<button
								type="button"
								aria-pressed={selectedVideoQuality === quality.value}
								class="rounded-lg border px-2 py-1.5 text-xs font-medium transition-all {selectedVideoQuality ===
								quality.value
									? 'border-accent-primary bg-accent text-accent-primary'
									: 'border-color text-secondary hover:border-accent-primary hover:text-primary'}"
								onclick={() => (selectedVideoQuality = quality.value)}
							>
								{quality.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<div class="space-y-2">
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
					{#each projectTypeOptions as option (option)}
						<option value={option}>{getProjectTypeLabel(option, get(LL))}</option>
					{/each}
				</select>
				<span
					class="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 material-icons text-thirdly"
				>
					expand_more
				</span>
			</div>
		</div>
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-8 py-6 rounded-b-2xl">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 text-sm text-thirdly">
				<span class="material-icons text-accent-secondary">info</span>
				<span>{$LL.home.fillInDetails()}</span>
			</div>

			<div class="flex gap-3">
				<button
					class="px-6 py-2.5 font-medium text-primary border border-color rounded-lg hover:bg-accent hover:border-accent-primary transition-all duration-200 cursor-pointer"
					onclick={close}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="px-8 py-2.5 font-medium bg-accent-primary text-black rounded-lg hover:bg-blue-400 transition-all duration-200 flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
