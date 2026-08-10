<script lang="ts">
	import { ProjectDetail } from '$lib/classes';
	import { ProjectService } from '$lib/services/ProjectService';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { getStatusLabel } from '$lib/i18n/statusMapper';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { showContextMenuInViewport } from '$lib/services/ContextMenuService';
	import { globalState } from '$lib/runes/main.svelte';
	import EditableText from '../misc/EditableText.svelte';
	import ModalManager from '../modals/ModalManager';
	import ProjectTypeSelector from './ProjectTypeSelector.svelte';
	import { Status } from '$lib/classes/Status';
	import { slide } from 'svelte/transition';
	import { onDestroy } from 'svelte';
	import Exporter from '$lib/classes/Exporter';
	import toast from 'svelte-5-french-toast';
	import { Project, TrackType, Utilities } from '$lib/classes';
	import { AnalyticsService } from '$lib/services/AnalyticsService';

	let contextMenu: ContextMenu | undefined = $state(undefined); // Initialize context menu state

	let {
		projectDetail = $bindable(),
		isListView = true,
		isTutorial = false
	}: {
		projectDetail: ProjectDetail;
		isListView?: boolean;
		isTutorial?: boolean;
	} = $props();

	async function deleteProjectButtonClick(e: MouseEvent) {
		if (e.button !== 0) return; // Only handle left click
		if (
			await ModalManager.confirmModal(
				get(LL).home.deleteProjectConfirm({ name: projectDetail.name })
			)
		) {
			await ProjectService.delete(projectDetail.id); // Supprime le projet
		} else {
			currentMenu.set(null);
		}
	}

	async function exportProjectButtonClick(e: MouseEvent) {
		if (e.button !== 0) return; // Only handle left click
		await Exporter.exportProjectData(await ProjectService.load(projectDetail.id));
	}

	async function duplicateProjectButtonClick(e: MouseEvent) {
		if (e.button !== 0) return; // Only handle left click
		const loadingToast = toast.loading(get(LL).home.duplicatingProject());
		try {
			const duplicatedProject = await ProjectService.duplicate(projectDetail.id);

			// Add to UI
			globalState.userProjectsDetails = [
				duplicatedProject.detail,
				...globalState.userProjectsDetails
			];
			AnalyticsService.trackProjectDuplicated(duplicatedProject.detail.projectType);

			toast.success(get(LL).home.projectDuplicated(), { id: loadingToast });
		} catch (error) {
			console.error(error);
			toast.error(get(LL).home.failedToDuplicate(), { id: loadingToast });
		}
	}

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', handleWindowClick);
		}
		currentMenu.set(null);
	});

	async function openProjectButtonClick() {
		// Ouvre le projet
		const project = await ProjectService.load(projectDetail.id);
		globalState.currentProject = project;
		AnalyticsService.trackProjectOpened(
			project.detail.projectType,
			project.content.assets.length,
			project.content.timeline.getFirstTrack(TrackType.Subtitle).clips.length,
			Object.keys(project.detail.translations).length
		);
	}

	// Gestion du menu de statut
	let showStatusMenu = $state(false);
	const statuses: Status[] = Object.values(Status).filter((v) => v instanceof Status) as Status[];

	async function selectStatus(s: Status) {
		projectDetail.status = s;
		showStatusMenu = false;
		await ProjectService.saveDetail(projectDetail, false);
	}

	function toggleStatusMenu(e: MouseEvent) {
		e.stopPropagation();
		showStatusMenu = !showStatusMenu;
	}

	function handleWindowClick() {
		showStatusMenu = false;
	}

	// Fermer en cliquant dehors
	if (typeof window !== 'undefined') {
		window.addEventListener('click', handleWindowClick);
	}

	// Gestion de l'affichage des détails du projet
	let showProjectDetails = $state(false);

	function toggleProjectDetails(e: MouseEvent) {
		e.stopPropagation();
		showProjectDetails = !showProjectDetails;
	}
</script>

<div
	class="relative bg-secondary backdrop-blur-[10px] border border-[var(--border-color)] rounded-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] flex flex-col justify-between transition-all duration-300 hover:shadow-2xl"
	data-tour-id={isTutorial ? 'tutorial-project-card' : undefined}
	data-project-card={projectDetail.id}
>
	<div>
		{#if !isListView}
			<section class="relative h-40 w-full rounded-t-lg bg-white/80 object-cover">
				<div class="absolute right-3 top-3">
					<ProjectTypeSelector
						{projectDetail}
						variant="badge"
						onBeforeOpen={() => (showStatusMenu = false)}
					/>
				</div>
			</section>
		{/if}
		<div class="relative mt-4 px-4 pb-4">
			<div class="flex justify-between items-start mb-2">
				<EditableText
					text={$LL.home.projectNamePlaceholder()}
					bind:value={projectDetail.name}
					maxLength={ProjectDetail.NAME_MAX_LENGTH}
					placeholder={projectDetail.name}
					parentClasses="text-accent max-w-[80%]"
					textClasses="text-lg font-semibold truncate"
					action={async () => {
						await ProjectService.saveDetail(projectDetail); // Sauvegarde le projet
					}}
				/>

				<div class="relative">
					<button
						class="bg-transparent cursor-pointer text-xs group hover:-translate-x-3 flex items-center mr-0 duration-300 relative"
						onclick={toggleStatusMenu}
						type="button"
					>
						<span
							class="w-3 h-3 rounded-full inline-block mr-2 duration-300"
							style={`background-color: ${projectDetail.status.color}`}
						></span>
						{getStatusLabel(projectDetail.status, get(LL))}
						<span
							class="material-icons-outlined text-[10px] w-10 duration-300 absolute left-full top-1/2 -translate-y-1/2 scale-75 pointer-events-none opacity-0 group-hover:opacity-60 group-hover:scale-100 group-hover:-translate-x-2"
							aria-hidden="true">arrow_drop_down</span
						>
					</button>
					{#if showStatusMenu}
						<ul
							class="absolute top-full right-0 mt-1 w-40 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl py-1 z-20 backdrop-blur-sm"
						>
							{#each statuses as s (s.status)}
								<li
									class={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none transition-colors hover:bg-white/5 rounded-sm ${s === projectDetail.status ? 'bg-white/10' : ''}`}
									onclick={() => selectStatus(s)}
								>
									<span class="w-3 h-3 rounded-full" style={`background-color: ${s.color}`}
									></span>{getStatusLabel(s, get(LL))}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-x-1 text-xs text-[var(--text-secondary)] -mb-1.5">
				{$LL.home.reciterLabel()}
				<EditableText
					text={$LL.home.projectReciterPlaceholder()}
					bind:value={projectDetail.reciter}
					maxLength={ProjectDetail.RECITER_MAX_LENGTH}
					placeholder={projectDetail.reciter}
					textClasses="font-semibold"
					action={async () => {
						await ProjectService.saveDetail(projectDetail); // Sauvegarde le projet
					}}
					inputType="reciters"
				/>
			</div>

			<p class="text-xs text-[var(--text-secondary)] my-1">
				{$LL.home.durationLabel()}
				{projectDetail.duration.getFormattedTime(false)}
			</p>
			<p class="text-xs text-[var(--text-secondary)] mb-3 verserange">
				{$LL.home.versesLabel()}
				<span class="font-medium text-[var(--text-primary)]"
					>{projectDetail.verseRange.toString()}</span
				>
			</p>

			<!-- Bouton discret pour basculer les détails -->
			<button
				class={'absolute bottom-0 right-0 p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] opacity-60 hover:opacity-100 transition-all duration-200  cursor-pointer ' +
					(showProjectDetails ? ' translate-y-2' : '')}
				onclick={toggleProjectDetails}
				type="button"
				title={showProjectDetails ? $LL.home.hideDetails() : $LL.home.showDetails()}
			>
				<span
					class={'material-icons-outlined text-sm transition-transform duration-200 ' +
						(showProjectDetails ? '-rotate-180' : '')}
				>
					expand_more
				</span>
			</button>

			{#if showProjectDetails}
				<div
					class="project-details space-y-2 mt-3 pb-3 pt-3 border-t border-[var(--border-color)]"
					transition:slide={{ duration: 300 }}
				>
					<div>
						<div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
							<span>{$LL.home.captioning()}</span>
							<span class="font-medium text-[var(--text-primary)]"
								>{projectDetail.percentageCaptioned}%</span
							>
						</div>
						<div class="bg-[var(--border-color)] rounded h-2 overflow-hidden">
							<div
								class="bg-[var(--accent-primary)] h-full rounded transition-all duration-300 ease-in-out"
								style="width: {projectDetail.percentageCaptioned}%;"
							></div>
						</div>
					</div>
					<div class="space-y-2">
						{#each Object.entries(projectDetail.translations) as [language, percentage] (language)}
							<div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
								<span>{$LL.home.translationProgress({ language })} </span>
								<span class="font-medium text-[var(--text-primary)]">{percentage}%</span>
							</div>
							<div class="bg-[var(--border-color)] rounded h-2 overflow-hidden">
								<div
									class="bg-[var(--accent-primary)] h-full rounded transition-all duration-300 ease-in-out"
									style="width: {percentage}%;"
								></div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
	<div class="mt-auto pt-3 border-t border-[var(--border-color)] px-4 pb-4">
		<div class="flex justify-between items-center text-xs text-[var(--text-secondary)] mb-2">
			<span>{$LL.home.createdLabel()} {projectDetail.createdAt.toLocaleDateString()}</span>
			<span>{$LL.home.updatedLabel()} {projectDetail.updatedAt.toLocaleDateString()}</span>
		</div>

		<div class={`flex items-center gap-x-2 ${isListView ? 'justify-end' : ''}`}>
			<button
				class={`btn-accent text-xs py-2 ${isListView ? 'flex-1 h-full' : 'flex-grow'}`}
				onclick={openProjectButtonClick}
			>
				{$LL.home.openProject()}
			</button>
			<button
				class="btn btn-secondary btn-sm p-1.5 flex items-center"
				onclick={(event) => void showContextMenuInViewport(contextMenu, event)}
			>
				<span class="material-icons-outlined text-sm">more_horiz</span>
			</button>
		</div>
	</div>
</div>

<ContextMenu bind:this={contextMenu}>
	<Item on:click={exportProjectButtonClick}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">file_download</span
			>{$LL.home.exportProject()}
		</div></Item
	>
	<Item on:click={duplicateProjectButtonClick}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">content_copy</span
			>{$LL.home.duplicateProject()}
		</div></Item
	>
	<Item on:click={deleteProjectButtonClick}
		><div class="btn-icon danger-color">
			<span class="material-icons-outlined text-sm mr-1">delete</span>{$LL.home.deleteProject()}
		</div></Item
	>
</ContextMenu>

<style>
	.rotate-180 {
		transform: rotate(180deg);
	}

	.verserange {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
