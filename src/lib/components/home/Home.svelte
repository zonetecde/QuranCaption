<script lang="ts">
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';

	import type { ProjectDetail } from '$lib/classes/ProjectDetail.svelte';
	import type { DurationWithMs } from '$lib/types/common';
	import { globalState } from '$lib/runes/main.svelte';
	import { Status } from '$lib/classes/Status';
	import Settings from '$lib/classes/Settings.svelte';
	import TourManager from '$lib/components/tour/TourManager';
	import { setupTutorialProject } from '$lib/services/TutorialService';
	import { VersionService } from '$lib/services/VersionService.svelte';
	import { ProjectService } from '$lib/services/ProjectService';
	import MigrationService from '$lib/services/MigrationService';

	import InputWithIcon from '../misc/InputWithIcon.svelte';
	import ModalManager from '../modals/ModalManager';
	import Footer from './Footer.svelte';
	import FilterMenu from './FilterMenu.svelte';
	import SortMenu from './SortMenu.svelte';
	import ProjectDetailCard from './ProjectDetailCard.svelte';
	import ProjectDetailCardSkeleton from './ProjectDetailCardSkeleton.svelte';
	import ProjectExplorerSidebar from './ProjectExplorerSidebar.svelte';
	import CreateProjectModal from './modals/CreateProjectModal.svelte';
	import MigrationFromV2Modal from './modals/MigrationFromV2Modal.svelte';
	import {
		ALL_PROJECTS_SELECTION,
		buildProjectExplorerTree,
		filterProjectsForSelection,
		resolveDropTargetUpdate,
		type ExplorerSelection
	} from './homeExplorer';
	import {
		getDragPointerPosition,
		getExplorerNodeIdFromElement,
		getExplorerSelectionFromElement,
		type DragPointer
	} from './dragUtils';

	let migrationFromV2ModalVisibility = $state(false);
	let createNewProjectModalVisible = $state(false);

	// Etats pour les menus de filtrage et tri
	let filterMenuVisible = $state(false);
	let sortMenuVisible = $state(false);
	let mobileExplorerOpen = $state(false);

	// Etat du drag interne homepage -> explorateur
	let draggingProjectId = $state<number | null>(null);
	let draggingProject = $state<ProjectDetail | null>(null);
	let activeDropNodeId = $state<string | null>(null);
	let dragPointer = $state<DragPointer>({ x: 0, y: 0 });

	// Pagination locale de la liste visible
	let currentPage = $state(1);
	let windowWidth = $state(typeof window === 'undefined' ? 1536 : window.innerWidth);
	let explorerSelection = $state<ExplorerSelection>(ALL_PROJECTS_SELECTION);
	let currentSortProperty = $state<keyof ProjectDetail>('updatedAt');
	let isSortAscending = $state(false);

	let promise: Promise<void | ProjectDetail[]> | undefined = $state(undefined);
	type SelectionBreadcrumbItem = {
		label: string;
		target?: ExplorerSelection;
	};

	/**
	 * Affiche le popup pour créer un nouveau projet.
	 */
	function newProjectButtonClick() {
		createNewProjectModalVisible = true;
	}

	/**
	 * Bascule l'affichage du menu de filtrage.
	 */
	function toggleFilterMenu() {
		filterMenuVisible = !filterMenuVisible;
		sortMenuVisible = false;
	}

	/**
	 * Bascule l'affichage du menu de tri.
	 */
	function toggleSortMenu() {
		sortMenuVisible = !sortMenuVisible;
		filterMenuVisible = false;
	}

	/**
	 * Applique le filtre de statut global.
	 */
	function handleFilter(statuses: Status[]) {
		globalState.uiState.selectedStatuses = statuses;
	}

	/**
	 * Narrow helper used by the sort routine for custom duration objects.
	 */
	function hasDurationMs(value: unknown): value is DurationWithMs {
		return (
			typeof value === 'object' &&
			value !== null &&
			'ms' in value &&
			typeof (value as DurationWithMs).ms === 'number'
		);
	}

	function sortProjects(projects: ProjectDetail[]): ProjectDetail[] {
		return [...projects].sort((a, b) => {
			let valueA = a[currentSortProperty];
			let valueB = b[currentSortProperty];

			if (valueA instanceof Date && valueB instanceof Date) {
				valueA = valueA.getTime();
				valueB = valueB.getTime();
			} else if (hasDurationMs(valueA) && hasDurationMs(valueB)) {
				valueA = valueA.ms;
				valueB = valueB.ms;
			} else if (typeof valueA === 'string' && typeof valueB === 'string') {
				valueA = valueA.toLowerCase();
				valueB = valueB.toLowerCase();
			}

			if (valueA < valueB) return isSortAscending ? -1 : 1;
			if (valueA > valueB) return isSortAscending ? 1 : -1;
			return 0;
		});
	}

	function handleSort(property: keyof ProjectDetail, ascending: boolean) {
		currentSortProperty = property;
		isSortAscending = ascending;
	}

	/**
	 * Base project set used by the explorer tree and the right pane.
	 */
	function getStatusFilteredProjects(): ProjectDetail[] {
		if (globalState.uiState.selectedStatuses.length === 0) {
			return [];
		}

		return globalState.userProjectsDetails.filter((project) =>
			globalState.uiState.selectedStatuses.some((status) => status.status === project.status.status)
		);
	}

	function isSelectionAvailable(selection: ExplorerSelection, projects: ProjectDetail[]): boolean {
		if (selection.kind === 'all') return true;
		if (selection.kind === 'reciter') {
			return projects.some((project) => project.reciter === selection.reciter);
		}

		// Type folders always exist under a visible reciter node, even when their project count is 0.
		if (selection.kind === 'type') {
			return projects.some((project) => project.reciter === selection.reciter);
		}

		// Year nodes only exist when at least one project matches that year bucket.
		return filterProjectsForSelection(projects, selection).length > 0;
	}

	function getSelectionLabel(selection: ExplorerSelection): string {
		switch (selection.kind) {
			case 'all':
				return 'All Projects';
			case 'reciter':
				return selection.reciter;
			case 'type':
				return `${selection.reciter} / ${selection.projectType}`;
			case 'year':
				return `${selection.reciter} / ${selection.projectType} / ${selection.year}`;
		}
	}

	function getSelectionDescription(selection: ExplorerSelection, count: number): string {
		if (selection.kind === 'all') {
			return `${count} project${count === 1 ? '' : 's'} across every reciter folder`;
		}

		if (selection.kind === 'reciter') {
			return `${count} project${count === 1 ? '' : 's'} for this reciter`;
		}

		if (selection.kind === 'year') {
			return `${count} project${count === 1 ? '' : 's'} for year ${selection.year}`;
		}

		return `${count} project${count === 1 ? '' : 's'} in this subfolder`;
	}

	function getSelectionBreadcrumb(selection: ExplorerSelection): SelectionBreadcrumbItem[] {
		switch (selection.kind) {
			case 'all':
				return [{ label: 'All Projects' }];
			case 'reciter':
				return [
					{ label: 'All', target: ALL_PROJECTS_SELECTION },
					{ label: selection.reciter }
				];
			case 'type':
				return [
					{ label: 'All', target: ALL_PROJECTS_SELECTION },
					{
						label: selection.reciter,
						target: { kind: 'reciter', reciter: selection.reciter }
					},
					{ label: selection.projectType }
				];
			case 'year':
				return [
					{ label: 'All', target: ALL_PROJECTS_SELECTION },
					{
						label: selection.reciter,
						target: { kind: 'reciter', reciter: selection.reciter }
					},
					{
						label: selection.projectType,
						target: {
							kind: 'type',
							reciter: selection.reciter,
							projectType: selection.projectType
						}
					},
					{ label: selection.year }
				];
		}
	}

	/**
	 * Centralizes explorer navigation so desktop and mobile stay in sync.
	 */
	function selectExplorerNode(selection: ExplorerSelection) {
		explorerSelection = selection;
		mobileExplorerOpen = false;
		currentPage = 1;
	}

	/**
	 * Keeps the "5 rows max" rule consistent between list and responsive grid layouts.
	 */
	function getProjectsPerPage(): number {
		if ((globalState.settings?.persistentUiState.projectCardView ?? 'grid') === 'list') {
			return 5;
		}

		if (windowWidth >= 1536) return 16;
		if (windowWidth >= 1280) return 15;
		if (windowWidth >= 768) return 8;
		return 5;
	}

	function clearDragState() {
		draggingProjectId = null;
		draggingProject = null;
		activeDropNodeId = null;
	}

	/**
	 * Tracks the pointer-driven drag preview and the explorer node currently hovered.
	 */
	function handlePointerMove(event: PointerEvent) {
		if (!draggingProject) return;

		dragPointer = getDragPointerPosition(event);

		const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY);
		activeDropNodeId = getExplorerNodeIdFromElement(elementUnderPointer);
	}

	/**
	 * Resolves the hovered explorer node on pointer release and applies the move if possible.
	 */
	async function handlePointerUp(event: PointerEvent) {
		if (!draggingProject) return;

		const targetSelection = getExplorerSelectionFromElement(
			document.elementFromPoint(event.clientX, event.clientY)
		);

		if (targetSelection) {
			await handleProjectDrop(targetSelection);
		} else {
			clearDragState();
		}
	}

	/**
	 * Initializes the ephemeral drag state shared by the card list and the explorer sidebar.
	 */
	function startProjectDrag(project: ProjectDetail, event: PointerEvent) {
		draggingProjectId = project.id;
		draggingProject = project;
		dragPointer = getDragPointerPosition(event);
		activeDropNodeId = null;
		mobileExplorerOpen = false;
	}

	/**
	 * Persists reciter/type changes after a folder drop and clears the transient drag state.
	 */
	async function handleProjectDrop(target: ExplorerSelection) {
		if (draggingProjectId === null) return;

		const project = globalState.userProjectsDetails.find(
			(projectDetail) => projectDetail.id === draggingProjectId
		);
		if (!project) {
			clearDragState();
			return;
		}

		const update = resolveDropTargetUpdate(target);
		if (
			update &&
			(project.reciter !== update.reciter || project.projectType !== update.projectType)
		) {
			project.reciter = update.reciter;
			project.projectType = update.projectType;
			await ProjectService.saveDetail(project);
		}

		clearDragState();
	}

	// 1. Status filter -> 2. explorer selection -> 3. sort/search -> 4. page slice
	let statusFilteredProjects = $derived.by(() => getStatusFilteredProjects());
	let explorerTree = $derived.by(() => buildProjectExplorerTree(statusFilteredProjects));
	let selectedProjects = $derived.by(() => {
		if (!isSelectionAvailable(explorerSelection, statusFilteredProjects)) {
			return statusFilteredProjects;
		}

		return filterProjectsForSelection(statusFilteredProjects, explorerSelection);
	});
	let sortedSelectedProjects = $derived.by(() => sortProjects(selectedProjects));
	let searchedProjects = $derived.by(() => {
		if (globalState.uiState.searchQuery === '') {
			return sortedSelectedProjects;
		}

		return sortedSelectedProjects.filter((project) =>
			project.matchSearchQuery(globalState.uiState.searchQuery)
		);
	});
	let projectsPerPage = $derived.by(() => getProjectsPerPage());
	let totalPages = $derived.by(() =>
		Math.max(1, Math.ceil(searchedProjects.length / projectsPerPage))
	);
	let paginatedProjects = $derived.by(() => {
		const startIndex = (currentPage - 1) * projectsPerPage;
		return searchedProjects.slice(startIndex, startIndex + projectsPerPage);
	});
	let selectionBreadcrumb = $derived.by(() => getSelectionBreadcrumb(explorerSelection));

	$effect(() => {
		// Replie la sélection vers "All" si le dossier actif n'existe plus avec le filtre courant.
		if (!isSelectionAvailable(explorerSelection, statusFilteredProjects)) {
			explorerSelection = ALL_PROJECTS_SELECTION;
		}
	});

	$effect(() => {
		// Toute modification de recherche ou de mode d'affichage repart de la première page.
		globalState.uiState.searchQuery;
		globalState.settings?.persistentUiState.projectCardView;
		currentPage = 1;
	});

	$effect(() => {
		// Empêche une page courante invalide après filtre, recherche ou resize.
		if (currentPage > totalPages) {
			currentPage = totalPages;
		}
	});

	onMount(() => {
		function handleResize() {
			windowWidth = window.innerWidth;
		}

		handleResize();
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('resize', handleResize);

		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('resize', handleResize);
		};
	});

	onMount(async () => {
		await VersionService.init();

		// Verifie les mises a jour
		if (VersionService.latestUpdate?.hasUpdate) {
			if (!globalState.settings) return;

			// Vérifie que ça fait pas plus de 24h qu'on a fermé le modal
			const lastClosed = new Date(
				globalState.settings.persistentUiState.lastClosedUpdateModal || 0
			);
			if (Date.now() - lastClosed.getTime() > 24 * 60 * 60 * 1000) {
				ModalManager.newUpdateModal(VersionService.latestUpdate);
			}
		}

		if (globalState.userProjectsDetails.length > 0) {
			// Retrie juste dans l'ordre de updatetime
			globalState.userProjectsDetails = globalState.userProjectsDetails.sort(
				(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
			);

			// Re-récupère les détails du projet le plus récent
			// Nécessaire car quand on les modifies dans le projet ça le modifie pas dans `globalState.userProjectsDetails`
			globalState.userProjectsDetails[0] = (
				await ProjectService.load(globalState.userProjectsDetails[0].id, true)
			).detail;
		} else {
			promise = ProjectService.loadUserProjectsDetails();
		}

		if (promise) {
			promise.then(async () => {
				// Vérifie si des données de Quran Caption 2 sont présentes
				if (
					(await MigrationService.hasQCV2Data()) &&
					globalState.userProjectsDetails.length === 0
				) {
					migrationFromV2ModalVisibility = true;
				}
			});
		}

		if (globalState.settings && !globalState.settings.persistentUiState.hasSeenTour) {
			if (promise) await promise;
			try {
				await setupTutorialProject();
			} catch (error) {
				console.warn('Tutorial project setup failed:', error);
			}
			setTimeout(() => TourManager.start(), 600);
		}
	});

	async function importProject() {
		// Open a dialog
		const files = await open({
			multiple: true,
			directory: false
		});

		if (!files) return;

		for (let index = 0; index < files.length; index++) {
			try {
				const filePath = files[index];
				const json = JSON.parse((await readTextFile(filePath)).toString());
				await ProjectService.importProject(json);
			} catch (error) {
				ModalManager.errorModal(
					'Error importing project',
					'Your project file is either invalid or corrupted.',
					JSON.stringify(error, Object.getOwnPropertyNames(error))
				);
			}
		}

		await ProjectService.loadUserProjectsDetails();
	}
</script>

<div class="flex min-h-full flex-col overflow-auto overflow-x-hidden">
	<div class="mb-8 mt-8 flex-grow px-4 xl:px-12 xl:mt-14">
		<div placeholder="Upper section" class="flex gap-4 flex-row items-center">
			<section>
				<h2 class="text-4xl font-bold">Welcome Back!</h2>
				<h4 class="text-secondary">Let's create something amazing today.</h4>
			</section>
			<section class="ml-auto flex flex-wrap gap-3 xl:gap-x-4">
				<button
					class="btn h-12 px-4 lg:hidden"
					type="button"
					onclick={() => (mobileExplorerOpen = true)}
				>
					<span class="material-icons-outlined mr-2">folder_open</span> Explorer
				</button>
				<button
					data-tour-id="new-project-button"
					class="btn-accent btn-icon h-12 px-4 xl:px-7"
					onclick={newProjectButtonClick}
				>
					<span class="material-icons-outlined mr-2">add_circle_outline</span> New Project
				</button>
				<button class="btn btn-icon h-12 px-4 xl:px-7" onclick={importProject}>
					<span class="material-icons-outlined mr-2">file_upload</span> Import Project
				</button>
			</section>
		</div>

		<div
			class="mt-8 grid items-start gap-8 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]"
		>
			<div class="hidden lg:block">
				<ProjectExplorerSidebar
					tree={explorerTree}
					selection={explorerSelection}
					{activeDropNodeId}
					onSelectionChange={selectExplorerNode}
				/>
			</div>

			<section class="min-w-0">
				<div
					placeholder="Recent projects"
					class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"
				>
					<div>
						<h3 class="flex items-center gap-2 text-2xl font-semibold text-primary">
							{#each selectionBreadcrumb as item, index (item.label + index)}
								{#if item.target}
									<button
										type="button"
										class="cursor-pointer text-left hover:underline"
										onclick={() => selectExplorerNode(item.target!)}
									>
										{item.label}
									</button>
								{:else}
									<span>{item.label}</span>
								{/if}
								{#if index < selectionBreadcrumb.length - 1}
									<span class="text-[var(--text-secondary)]">/</span>
								{/if}
							{/each}
						</h3>
						<p class="mt-1 text-sm text-[var(--text-secondary)]">
							{getSelectionDescription(explorerSelection, sortedSelectedProjects.length)}
						</p>
					</div>

					<div class="flex flex-wrap items-center gap-3 xl:justify-end">
						{#if totalPages > 1}
							<div
								class="flex h-10 items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 text-sm text-[var(--text-secondary)]"
							>
								<button
									class="btn-icon flex h-8 w-8 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
									type="button"
									disabled={currentPage === 1}
									onclick={() => (currentPage = Math.max(1, currentPage - 1))}
									title="Previous page"
								>
									<span class="material-icons-outlined text-base">chevron_left</span>
								</button>
								<span class="min-w-16 text-center text-[var(--text-primary)]">
									{currentPage} / {totalPages}
								</span>
								<button
									class="btn-icon flex h-8 w-8 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
									type="button"
									disabled={currentPage === totalPages}
									onclick={() => (currentPage = Math.min(totalPages, currentPage + 1))}
									title="Next page"
								>
									<span class="material-icons-outlined text-base">chevron_right</span>
								</button>
							</div>
						{/if}

						<InputWithIcon
							icon="search"
							placeholder="Search projects..."
							classes="w-full md:w-64"
							bind:value={globalState.uiState.searchQuery}
						/>

						<div class="relative">
							<button class="filter-button btn text-sm p-2 btn-icon" onclick={toggleFilterMenu}>
								<span class="material-icons-outlined">filter_list</span>
							</button>
							<FilterMenu
								bind:isVisible={filterMenuVisible}
								bind:selectedStatuses={globalState.uiState.selectedStatuses}
								onFilter={handleFilter}
							/>
						</div>

						<div class="relative">
							<button class="sort-button btn text-sm p-2 btn-icon" onclick={toggleSortMenu}>
								<span class="material-icons-outlined">import_export</span>
							</button>
							<SortMenu bind:isVisible={sortMenuVisible} onSort={handleSort} />
						</div>

						<!-- bouton pour changer affichage grid/list -->
						<button
							class="view-button btn text-sm p-2 btn-icon"
							type="button"
							onclick={() => {
								if (!globalState.settings) return;

								globalState.settings.persistentUiState.projectCardView =
									globalState.settings.persistentUiState.projectCardView === 'grid'
										? 'list'
										: 'grid';
								Settings.save();
							}}
						>
							<span class="material-icons-outlined">
								{globalState.settings?.persistentUiState.projectCardView === 'list'
									? 'view_agenda'
									: 'view_module'}
							</span>
						</button>
					</div>
				</div>

				{#if draggingProjectId !== null}
					<p class="mt-3 text-sm text-[var(--accent-primary)]">
						Drop the card onto a folder on the left to move it.
					</p>
				{:else if globalState.uiState.searchQuery}
					<p class="mt-3 text-sm text-[var(--text-secondary)]">
						Showing {searchedProjects.length} result{searchedProjects.length === 1 ? '' : 's'} for "{globalState
							.uiState.searchQuery}".
					</p>
				{/if}

				{#await promise}
					<div class="mt-6">
						<ProjectDetailCardSkeleton
							isListView={(globalState.settings?.persistentUiState.projectCardView ?? 'grid') ===
								'list'}
							count={8}
						/>
					</div>
				{:then}
					{#if sortedSelectedProjects.length === 0}
						{#if globalState.uiState.selectedStatuses.length === 0}
							<p class="mt-4">
								No projects match the current filter. Adjust your status filter to see projects.
							</p>
						{:else if globalState.userProjectsDetails.length === 0}
							<p class="mt-4">
								You don't have any projects yet. Click "New Project" to create one.
							</p>
						{:else}
							<p class="mt-4">
								No projects exist in the current folder. Try another reciter or status filter.
							</p>
						{/if}
					{:else if searchedProjects.length === 0}
						<p class="mt-4">
							No projects match "{globalState.uiState.searchQuery}". Try another search term.
						</p>
					{:else}
						<div
							placeholder="Project cards"
							class={'mt-4 ' +
								((globalState.settings?.persistentUiState.projectCardView ?? 'grid') === 'list'
									? 'grid grid-cols-1 gap-3'
									: 'grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4')}
						>
							{#each paginatedProjects as project (project.id)}
								<ProjectDetailCard
									projectDetail={project}
									isTutorial={project.name === 'Tutorial Project'}
									draggable={true}
									isActiveDrag={draggingProjectId === project.id}
									onProjectDragStart={startProjectDrag}
									onProjectDragEnd={clearDragState}
								/>
							{/each}
						</div>
					{/if}
				{/await}
			</section>
		</div>
	</div>

	<Footer />
</div>

{#if mobileExplorerOpen}
	<div
		class="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
		transition:fade
		onclick={() => (mobileExplorerOpen = false)}
	>
		<div
			class="absolute inset-y-0 left-0 w-[min(92vw,340px)] bg-[var(--bg-primary)] px-4 py-6 shadow-2xl"
			onclick={(event) => event.stopPropagation()}
		>
			<div class="mb-4 flex justify-end">
				<button
					class="btn h-11 w-11 p-0"
					type="button"
					onclick={() => (mobileExplorerOpen = false)}
				>
					<span class="material-icons-outlined">close</span>
				</button>
			</div>
			<ProjectExplorerSidebar
				tree={explorerTree}
				selection={explorerSelection}
				{activeDropNodeId}
				onSelectionChange={selectExplorerNode}
			/>
		</div>
	</div>
{/if}

{#if draggingProject}
	<div
		class="pointer-events-none fixed left-0 top-0 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 px-3 py-2 shadow-2xl backdrop-blur-md"
		style={`transform: translate(${dragPointer.x}px, ${dragPointer.y}px) translate(-50%, -50%);`}
	>
		<p class="max-w-56 truncate text-sm font-semibold text-[var(--text-primary)]">
			{draggingProject.name}
		</p>
		<p class="mt-1 text-xs text-[var(--text-secondary)]">
			{draggingProject.reciter} • {draggingProject.projectType}
		</p>
	</div>
{/if}

{#if createNewProjectModalVisible}
	<div class="modal-wrapper" transition:fade>
		<CreateProjectModal close={() => (createNewProjectModalVisible = false)} />
	</div>
{/if}

{#if migrationFromV2ModalVisibility}
	<div class="modal-wrapper" transition:fade>
		<MigrationFromV2Modal close={() => (migrationFromV2ModalVisibility = false)} />
	</div>
{/if}
