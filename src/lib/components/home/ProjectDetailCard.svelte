<script lang="ts">
	import { ProjectDetail } from '$lib/classes';
	import { ProjectService } from '$lib/services/ProjectService';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { getStatusLabel } from '$lib/i18n/statusMapper';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { globalState } from '$lib/runes/main.svelte';
	import EditableText from '../misc/EditableText.svelte';
	import ModalManager from '../modals/ModalManager';
	import ProjectTypeSelector from './ProjectTypeSelector.svelte';
	import { Status } from '$lib/classes/Status';
	import { slide } from 'svelte/transition';
	import MigrationService from '$lib/services/MigrationService';
	import { discordService } from '$lib/services/DiscordService';
	import { onDestroy } from 'svelte';
	import Exporter from '$lib/classes/Exporter';
	import toast from 'svelte-5-french-toast';
	import { Project, Utilities } from '$lib/classes';
	import { AnalyticsService } from '$lib/services/AnalyticsService';

	let contextMenu: ContextMenu | undefined = $state(undefined); // Initialize context menu state

	let {
		projectDetail = $bindable(),
		draggable = false,
		isActiveDrag = false,
		onProjectDragStart,
		onProjectDragEnd
	}: {
		projectDetail: ProjectDetail;
		draggable?: boolean;
		isActiveDrag?: boolean;
		onProjectDragStart?: (projectDetail: ProjectDetail, event: PointerEvent) => void;
		onProjectDragEnd?: () => void;
	} = $props();

	let isDragging = $state(false);
	let isListView = $derived(
		(globalState.settings?.persistentUiState.projectCardView ?? 'grid') === 'list'
	);
	const projectThumbnailCount = 11;
	let prominentSurahId = $derived(projectDetail.getProminentSurah());
	const thumbnailUrl = `/thumbnails/${(Math.abs(projectDetail.id - 1) % projectThumbnailCount) + 1}.jpg`;

	$effect(() => {
		// Keep the local visual state aligned with the homepage drag lifecycle.
		if (!isActiveDrag && isDragging) {
			isDragging = false;
		}
	});

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

	/**
	 * Exporte le projet sélectionné avec tous ses assets.
	 * @param {MouseEvent} e Événement du menu contextuel.
	 * @returns {Promise<void>} Promesse résolue après l'export.
	 */
	async function exportProjectPackageButtonClick(e: MouseEvent): Promise<void> {
		if (e.button !== 0) return; // Only handle left click
		await Exporter.exportProjectPackage(await ProjectService.load(projectDetail.id));
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
			AnalyticsService.trackProjectDuplicated();

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
		await MigrationService.HydrateStyleEditorUiMetadata(project);
		globalState.currentProject = project;

		// Migration si besoin
		MigrationService.FromQC313ToQC314();
		MigrationService.FromQC326ToQC327();
		MigrationService.FromQC334ToQC335_2();
		await MigrationService.FromQC3710ToQC3711();

		// Discord Rich Presence
		discordService.setEditingState();
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

	/**
	 * Starts the custom pointer-driven drag used by the homepage explorer.
	 */
	function handlePointerDragStart(event: PointerEvent) {
		if (event.button !== 0 || !draggable) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest('[data-no-drag], button, input, textarea, select, a, [contenteditable="true"]')
		) {
			return;
		}
		event.stopPropagation();
		event.preventDefault();
		isDragging = true;
		onProjectDragStart?.(projectDetail, event);
	}

	function handleDragHandlePointerDown(event: PointerEvent) {
		if (event.button !== 0 || !draggable) return;
		event.stopPropagation();
		event.preventDefault();
		isDragging = true;
		onProjectDragStart?.(projectDetail, event);
	}

	function handlePointerDragEnd() {
		if (!draggable) return;
		isDragging = false;
		onProjectDragEnd?.();
	}
</script>

<div
	class={`group relative bg-secondary backdrop-blur-[10px] border border-[var(--border-color)] rounded-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] flex flex-col justify-between transition-all duration-300 ${
		draggable ? 'hover:-translate-y-1 hover:shadow-2xl' : 'hover:shadow-2xl'
	} ${isDragging ? 'scale-[0.98] opacity-70 cursor-grabbing' : ''}`}
	data-project-card={projectDetail.id}
>
	<div>
		{#if globalState.settings!.persistentUiState.projectCardView === 'grid'}
			<section
				class={`relative h-40 w-full rounded-t-lg bg-cover bg-center object-cover ${
					draggable ? 'cursor-grab active:cursor-grabbing' : ''
				}`}
				style={`background-image: url('${thumbnailUrl}')`}
				onpointerdown={handlePointerDragStart}
			>
				<div
					class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10 transition-all duration-300 group-hover:backdrop-blur-[3px]"
				></div>
				<div class="relative flex h-full items-center justify-center text-white">
					{#if prominentSurahId}
						<span
							class="surahs-font text-7xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
							aria-hidden="true"
						>
							{prominentSurahId.toString().padStart(3, '0')}
						</span>
					{/if}
					{#if projectDetail.reciter !== 'not set'}
						<span
							class="absolute bottom-3 left-1/2 max-w-[70%] -translate-x-1/2 truncate text-center text-sm font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
						>
							{projectDetail.reciter}
						</span>
					{/if}
					<span
						class="absolute bottom-1.5 left-1.5 text-xs font-medium drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] bg-black/60 rounded-md px-1"
					>
						{projectDetail.duration.getFormattedTime(false)}
					</span>
				</div>
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
							data-no-drag
							onpointerdown={(event) => event.stopPropagation()}
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
			{#if globalState.settings!.persistentUiState.projectCardView === 'list'}
				<ProjectTypeSelector {projectDetail} onBeforeOpen={() => (showStatusMenu = false)} />
			{/if}

			<p class="text-xs text-[var(--text-secondary)] mb-1">
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
			{#if isListView && draggable}
				<button
					class="h-8 w-8 pt-1 rounded-[4px] border border-[var(--border-color)] bg-[var(--bg-primary)]/40 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)]/70 hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing"
					type="button"
					title={$LL.home.dragCard()}
					onpointerdown={handleDragHandlePointerDown}
				>
					<span class="material-icons-outlined text-[14px] leading-none">drag_indicator</span>
				</button>
			{/if}
			<button
				class={`btn-accent text-xs py-2 ${isListView ? 'flex-1 h-full' : 'flex-grow'}`}
				onclick={openProjectButtonClick}
			>
				{$LL.home.openProject()}
			</button>
			<button
				class="btn btn-secondary btn-sm p-1.5 flex items-center"
				onclick={contextMenu!.createHandler()}
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
	<Item on:click={exportProjectPackageButtonClick}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">archive</span>{$LL.home.exportProject()} ({$LL.editor.assets()})
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
