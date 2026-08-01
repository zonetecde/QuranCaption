<script lang="ts">
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';

	import type { ProjectDetail } from '$lib/classes/ProjectDetail.svelte';
	import type { DurationWithMs } from '$lib/types/common';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { Status } from '$lib/classes/Status';
	import Settings from '$lib/classes/Settings.svelte';
	import TourManager from '$lib/components/tour/TourManager';
	import { setupTutorialProject } from '$lib/services/TutorialService';
	import { ProjectService } from '$lib/services/ProjectService';
	import AndroidMediaService from '$lib/services/AndroidMediaService';
	import { VersionService } from '$lib/services/VersionService.svelte';

	import InputWithIcon from '../misc/InputWithIcon.svelte';
	import ModalManager from '../modals/ModalManager';
	import Footer from './Footer.svelte';
	import FilterMenu from './FilterMenu.svelte';
	import SortMenu from './SortMenu.svelte';
	import ProjectDetailCard from './ProjectDetailCard.svelte';
	import ProjectDetailCardSkeleton from './ProjectDetailCardSkeleton.svelte';
	import CreateProjectModal from './modals/CreateProjectModal.svelte';
	import FirstLaunchLanguageModal from './modals/FirstLaunchLanguageModal.svelte';

	const SIMULATE_FIRST_LAUNCH = false;

	let createNewProjectModalVisible = $state(false);
	let firstLaunchLanguageModalVisible = $state(false);
	let firstLaunchSimulationApplied = false;

	// Etats pour les menus de filtrage et tri
	let filterMenuVisible = $state(false);
	let sortMenuVisible = $state(false);
	let panelScale = $derived(
		1 + (globalState.settings?.persistentUiState.editorPanelScalePercent ?? -15) / 100
	);

	// Pagination locale de la liste visible
	let currentPage = $state(1);
	let currentSortProperty = $state<keyof ProjectDetail>('updatedAt');
	let isSortAscending = $state(false);
	let homePreferencesInitialized = $state(false);

	let promise: Promise<void | ProjectDetail[]> | undefined = $state(undefined);
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
			if (valueA === null && valueB === null) return 0;
			if (valueA === null) return isSortAscending ? -1 : 1;
			if (valueB === null) return isSortAscending ? 1 : -1;

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
	 * Sauvegarde les préférences de tri dans les settings pour les réappliquer au prochain chargement de la page
	 */
	function persistHomePreferences() {
		if (!globalState.settings || !homePreferencesInitialized) return;

		globalState.settings.persistentUiState.homeSortProperty = currentSortProperty;
		globalState.settings.persistentUiState.homeSortAscending = isSortAscending;
		Settings.save();
	}

	/**
	 * Returns the projects matching the active status filter.
	 */
	function getStatusFilteredProjects(): ProjectDetail[] {
		if (globalState.uiState.selectedStatuses.length === 0) {
			return [];
		}

		return globalState.userProjectsDetails.filter((project) =>
			globalState.uiState.selectedStatuses.some((status) => status.status === project.status.status)
		);
	}

	/**
	 * Keeps the "5 rows max" rule consistent between list and responsive grid layouts.
	 */
	function getProjectsPerPage(): number {
		return 5;
	}

	// 1. Status filter -> 2. sort/search -> 3. page slice
	let statusFilteredProjects = $derived.by(() => getStatusFilteredProjects());
	let sortedProjects = $derived.by(() => sortProjects(statusFilteredProjects));
	let searchedProjects = $derived.by(() => {
		if (globalState.uiState.searchQuery === '') {
			return sortedProjects;
		}

		return sortedProjects.filter((project) =>
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
	$effect(() => {
		const settings = globalState.settings;
		if (!settings || homePreferencesInitialized) return;

		// Set les préférences de l'utilisateur ou ceux par défaut si premier lancement
		currentSortProperty = settings.persistentUiState.homeSortProperty ?? 'updatedAt';
		isSortAscending = settings.persistentUiState.homeSortAscending ?? false;
		homePreferencesInitialized = true;
	});

	$effect(() => {
		// Toute modification de recherche repart de la première page.
		globalState.uiState.searchQuery;
		currentPage = 1;
	});

	$effect(() => {
		// Empêche une page courante invalide après filtre, recherche ou resize.
		if (currentPage > totalPages) {
			currentPage = totalPages;
		}
	});

	$effect(() => {
		currentSortProperty;
		isSortAscending;
		persistHomePreferences();
	});

	$effect(() => {
		const settings = globalState.settings;
		if (!SIMULATE_FIRST_LAUNCH || !settings || firstLaunchSimulationApplied) return;

		firstLaunchSimulationApplied = true;
		settings.persistentUiState.language = 'en';
		settings.persistentUiState.hasSelectedLanguage = false;
		settings.persistentUiState.hasSeenTour = false;
		settings.persistentUiState.lastClosedDonationBanner = new Date(0).toISOString();
	});

	onMount(async () => {
		await VersionService.init();
		if (VersionService.latestUpdate?.hasUpdate && globalState.settings) {
			const lastClosed = new Date(
				globalState.settings.persistentUiState.lastClosedUpdateModal || 0
			);
			if (Date.now() - lastClosed.getTime() > 24 * 60 * 60 * 1000) {
				void ModalManager.newUpdateModal(VersionService.latestUpdate);
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

		if (globalState.settings && !globalState.settings.persistentUiState.hasSeenTour) {
			if (promise) await promise;
			try {
				await setupTutorialProject();
			} catch (error) {
				console.warn('Tutorial project setup failed:', error);
			}
			if (!globalState.settings.persistentUiState.hasSelectedLanguage) {
				firstLaunchLanguageModalVisible = true;
				return;
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
				const filePath = await AndroidMediaService.materializeSelectedFile(files[index], 0);
				const json = JSON.parse((await readTextFile(filePath)).toString());
				await ProjectService.importProject(json);
			} catch (error) {
				ModalManager.errorModal(
					get(LL).home.errorImportingProject(),
					get(LL).home.projectFileInvalid(),
					JSON.stringify(error, Object.getOwnPropertyNames(error))
				);
			}
		}

		await ProjectService.loadUserProjectsDetails();
	}
</script>

<div class="home-page flex min-h-full flex-col overflow-auto overflow-x-hidden">
	<div
		class="home-ui-scale mb-8 mt-6 flex-grow px-4 sm:px-5 lg:px-8 xl:mt-14 xl:px-12"
		style={`--editor-panel-scale: ${panelScale};`}
	>
		<div
			placeholder="Upper section"
			class="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-center"
		>
			<section class="min-w-0">
				<h2 class="text-3xl font-bold sm:text-4xl">{$LL.home.welcomeBack()}</h2>
				<h4 class="text-secondary">{$LL.home.letsCreate()}</h4>
			</section>
			<section class="flex w-full gap-3 sm:w-auto lg:ml-auto xl:gap-x-4">
				<button
					data-tour-id="new-project-button"
					class="btn-accent btn-icon h-12 min-w-0 flex-1 justify-center px-4 sm:flex-none sm:px-5 xl:px-7"
					onclick={newProjectButtonClick}
				>
					<span class="material-icons-outlined mr-2">add_circle_outline</span>
					{$LL.home.newProject()}
				</button>
				<!-- <button class="btn btn-icon h-12 px-4 xl:px-7">
					<span class="material-icons-outlined mr-2">auto_awesome</span> {$LL.home.aiVideo()}
				</button> -->
				<button
					class="btn btn-icon h-12 w-12 shrink-0 justify-center px-0"
					type="button"
					aria-label={$LL.home.importProject()}
					title={$LL.home.importProject()}
					onclick={importProject}
				>
					<span class="material-icons-outlined">file_upload</span>
				</button>
			</section>
		</div>

		<div class="mt-6">
			<section class="min-w-0">
				<div
					placeholder="Recent projects"
					class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"
				>
					<div>
						<h3 class="flex items-center gap-2 text-2xl font-semibold text-primary">
							{$LL.home.allProjects()}
						</h3>
					</div>

					<div class="flex flex-col gap-3 xl:justify-end">
						{#if totalPages > 1}
							<div
								class="flex h-10 items-center gap-1 self-start rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 text-sm text-[var(--text-secondary)]"
							>
								<button
									class="btn-icon flex h-8 w-8 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
									type="button"
									disabled={currentPage === 1}
									onclick={() => (currentPage = Math.max(1, currentPage - 1))}
									title={$LL.home.previousPage()}
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
									title={$LL.home.nextPage()}
								>
									<span class="material-icons-outlined text-base">chevron_right</span>
								</button>
							</div>
						{/if}

						<div class="flex w-full min-w-0 items-center gap-2 xl:w-auto">
							<div class="min-w-0 flex-1">
								<InputWithIcon
									icon="search"
									placeholder={$LL.home.searchProjects()}
									classes="w-full min-w-0"
									bind:value={globalState.uiState.searchQuery}
								/>
							</div>

							<div class="relative h-10 w-10 shrink-0">
								<button
									class="filter-button btn btn-icon h-10 w-10 p-0 flex justify-center"
									onclick={toggleFilterMenu}
								>
									<span class="material-icons-outlined">filter_list</span>
								</button>
								<FilterMenu
									bind:isVisible={filterMenuVisible}
									bind:selectedStatuses={globalState.uiState.selectedStatuses}
									onFilter={handleFilter}
								/>
							</div>

							<div class="relative h-10 w-10 shrink-0">
								<button
									class="sort-button btn btn-icon h-10 w-10 p-0 flex justify-center"
									onclick={toggleSortMenu}
								>
									<span class="material-icons-outlined">import_export</span>
								</button>
								<SortMenu
									bind:isVisible={sortMenuVisible}
									currentProperty={currentSortProperty}
									ascending={isSortAscending}
									onSort={handleSort}
								/>
							</div>
						</div>
					</div>
				</div>

				{#if globalState.uiState.searchQuery}
					<p class="mt-3 text-sm text-[var(--text-secondary)]">
						{$LL.home.showingResultsFor({
							count: searchedProjects.length,
							query: globalState.uiState.searchQuery
						})}
					</p>
				{/if}

				{#await promise}
					<div class="mt-6">
						<ProjectDetailCardSkeleton isListView={true} count={8} />
					</div>
				{:then}
					{#if searchedProjects.length === 0}
						{#if globalState.uiState.searchQuery}
							<p class="mt-4">
								{$LL.home.noProjectsMatchSearch({ query: globalState.uiState.searchQuery })}
							</p>
						{:else if globalState.uiState.selectedStatuses.length === 0}
							<p class="mt-4">
								{$LL.home.noProjectsMatchFilter()}
							</p>
						{:else if globalState.userProjectsDetails.length === 0}
							<p class="mt-4">
								{$LL.home.noProjectsYet()}
							</p>
						{:else}
							<p class="mt-4">
								{$LL.home.noProjectsMatchFilter()}
							</p>
						{/if}
					{:else}
						<div placeholder="Project cards" class="mt-4 grid grid-cols-1 gap-3">
							{#each paginatedProjects as project (project.id)}
								<ProjectDetailCard
									projectDetail={project}
									isListView={true}
									isTutorial={project.name === 'Tutorial Project'}
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

{#if createNewProjectModalVisible}
	<div class="modal-wrapper" transition:fade>
		<CreateProjectModal close={() => (createNewProjectModalVisible = false)} />
	</div>
{/if}

{#if firstLaunchLanguageModalVisible}
	<FirstLaunchLanguageModal
		confirm={() => {
			firstLaunchLanguageModalVisible = false;
			setTimeout(() => TourManager.start(), 200);
		}}
	/>
{/if}

<style>
	.home-ui-scale {
		min-width: 0;
		max-width: 100%;
		zoom: var(--editor-panel-scale);
	}
</style>
