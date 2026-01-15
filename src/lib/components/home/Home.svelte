<script lang="ts">
	import { fade } from 'svelte/transition';
	import InputWithIcon from '../misc/InputWithIcon.svelte';
	import Footer from './Footer.svelte';
	import Header from './Header.svelte';
	import CreateProjectModal from './modals/CreateProjectModal.svelte';
	import ProjectDetailCard from './ProjectDetailCard.svelte';
	import FilterMenu from './FilterMenu.svelte';
	import SortMenu from './SortMenu.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { Status } from '$lib/classes/Status';
	import type { ProjectDetail } from '$lib/classes/ProjectDetail.svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile, exists } from '@tauri-apps/plugin-fs';
	import ModalManager from '../modals/ModalManager';
	import { ProjectService } from '$lib/services/ProjectService';
	import { join, localDataDir } from '@tauri-apps/api/path';
	import MigrationFromV2Modal from './modals/MigrationFromV2Modal.svelte';
	import MigrationService from '$lib/services/MigrationService';
	import Settings from '$lib/classes/Settings.svelte';
	import NewUpdateModal from './modals/NewUpdateModal.svelte';
	import { VersionService } from '$lib/services/VersionService.svelte';

	let migrationFromV2ModalVisibility = $state(false);
	let createNewProjectModalVisible: boolean = $state(false);

	// États pour les menus de filtrage et tri
	let filterMenuVisible = $state(false);
	let sortMenuVisible = $state(false);

	/**
	 * Affiche le popup pour créer un nouveau projet.
	 */
	function newProjectButtonClick() {
		createNewProjectModalVisible = true;
	}

	/**
	 * Bascule l'affichage du menu de filtrage
	 */
	function toggleFilterMenu() {
		filterMenuVisible = !filterMenuVisible;
		sortMenuVisible = false; // Ferme l'autre menu
	}

	/**
	 * Bascule l'affichage du menu de tri
	 */
	function toggleSortMenu() {
		sortMenuVisible = !sortMenuVisible;
		filterMenuVisible = false; // Ferme l'autre menu
	}

	/**
	 * Applique le filtre sur les projets
	 */
	function handleFilter(statuses: Status[]) {
		globalState.uiState.selectedStatuses = statuses;
		applyFilterAndSort();
	}

	/**
	 * Applique le tri sur les projets
	 */
	function handleSort(property: keyof ProjectDetail, ascending: boolean) {
		globalState.uiState.filteredProjects.sort((a, b) => {
			let valueA = a[property];
			let valueB = b[property];

			// Gestion spéciale pour les dates et durées
			if (valueA instanceof Date && valueB instanceof Date) {
				valueA = valueA.getTime();
				valueB = valueB.getTime();
			} else if (typeof valueA === 'object' && valueA && 'ms' in valueA) {
				// Pour Duration
				valueA = (valueA as any).ms;
				valueB = (valueB as any).ms;
			} else if (typeof valueA === 'string' && typeof valueB === 'string') {
				valueA = valueA.toLowerCase();
				valueB = valueB.toLowerCase();
			}

			if (valueA < valueB) return ascending ? -1 : 1;
			if (valueA > valueB) return ascending ? 1 : -1;
			return 0;
		});
		globalState.uiState.filteredProjects = [...globalState.uiState.filteredProjects]; // Trigger reactivity
	}

	/**
	 * Applique le filtre et maintient le tri actuel
	 */
	function applyFilterAndSort() {
		if (globalState.uiState.selectedStatuses.length === 0) {
			globalState.uiState.filteredProjects = [];
		} else {
			globalState.uiState.filteredProjects = globalState.userProjectsDetails.filter((project) =>
				globalState.uiState.selectedStatuses.some(
					(status) => status.status === project.status.status
				)
			);
		}
	}

	let promise: Promise<any> | undefined = $state(undefined);

	onMount(async () => {
		await VersionService.init();

		// Vérifie les mises à jour
		if (VersionService.latestUpdate?.hasUpdate) {
			if (!globalState.settings) return;

			// Vérifie que ça fait pas plus de 24h qu'on a fermé le modal
			const lastClosed = new Date(
				globalState.settings!.persistentUiState.lastClosedUpdateModal || 0
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
			globalState.userProjectsDetails[0] = await ProjectService.loadDetail(
				globalState.userProjectsDetails[0].id
			);
		} else {
			promise = ProjectService.loadUserProjectsDetails();
		}

		// Initialise les projets filtrés
		applyFilterAndSort();

		if (promise)
			promise!.then(async () => {
				// Vérifie si des données de Quran Caption 2 sont présentes
				if (
					(await MigrationService.hasQCV2Data()) &&
					globalState.userProjectsDetails.length === 0
				) {
					migrationFromV2ModalVisibility = true;
				}
			});
	});

	$effect(() => {
		// Reapplique le filtre quand la liste des projets change
		if (globalState.userProjectsDetails.length >= 0) {
			applyFilterAndSort();
		}
	});

	async function importProject() {
		// Open a dialog
		const files = await open({
			multiple: true,
			directory: false
		});

		if (!files) return;

		for (let i = 0; i < files.length; i++) {
			try {
				const element = files[i];
				const json = JSON.parse((await readTextFile(element)).toString());

				ProjectService.importProject(json);
			} catch (error) {
				ModalManager.errorModal(
					'Error importing project',
					'Your project file is either invalid or corrupted.',
					JSON.stringify(error, Object.getOwnPropertyNames(error))
				);
			}
		}
	}
</script>

<div class="flex flex-col min-h-full overflow-x-hidden overflow-auto">
	<div class="flex-grow px-6 md:px-12 mt-8 xl:mt-14 mb-8">
		<div placeholder="Upper section" class="flex flex-row items-center">
			<section>
				<h2 class="text-4xl font-bold">Welcome Back!</h2>
				<h4 class="text-secondary">Let's create something amazing today.</h4>
			</section>
			<section class="ml-auto flex gap-x-4">
				<button class="btn-accent btn-icon h-12 px-4 xl:px-7" onclick={newProjectButtonClick}>
					<span class="material-icons-outlined mr-2">add_circle_outline</span> New Project
				</button>
				<button class="btn btn-icon h-12 px-4 xl:px-7" onclick={importProject}>
					<span class="material-icons-outlined mr-2">file_upload</span> Import Project
				</button>
			</section>
		</div>

		<div placeholder="Recent projects" class="mt-8 flex justify-between items-center">
			<h3 class="text-2xl font-semibold text-primary">Recent Projects</h3>

			<div class="flex items-center space-x-4">
				<InputWithIcon
					icon="search"
					placeholder="Search projects..."
					classes="w-64"
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
				<div class="relative">
					<button
						class="view-button btn text-sm p-2 btn-icon"
						onclick={() => {
							if (!globalState.settings) return;

							globalState.settings!.persistentUiState.projectCardView =
								globalState.settings!.persistentUiState.projectCardView === 'grid'
									? 'list'
									: 'grid';
							Settings.save();
						}}
					>
						<span class="material-icons-outlined">view_module</span>
					</button>
				</div>
			</div>
		</div>

		{#await promise}
			<div class="items-center justify-center absolute inset-0 flex flex-col gap-y-3">
				<div
					class="flex items-center flex-col px-30 rounded-4xl border-black/50 border-2 bg-black/30 py-10"
				>
					<span class="material-icons animate-spin text-4xl text-gray-400 text-[40px]!"
						>autorenew</span
					>

					<p class="text-xl">Please wait, we are currently loading your projects...</p>
				</div>
			</div>
		{:then}
			{#if globalState.uiState.filteredProjects.length === 0}
				{#if globalState.uiState.selectedStatuses.length === 0}
					<p class="mt-4">
						No projects match the current filter. Adjust your status filter to see projects.
					</p>
				{:else if globalState.userProjectsDetails.length === 0}
					<p class="mt-4">You don't have any projects yet. Click "New Project" to create one.</p>
				{:else}
					<p class="mt-4">
						No projects match the current filter. Try adjusting your status filter.
					</p>
				{/if}
			{:else}
				<div
					placeholder="Project cards"
					class={'mt-4  ' +
						(globalState.settings!.persistentUiState.projectCardView === 'list'
							? 'grid grid-cols-1 gap-3'
							: 'grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6')}
				>
					{#each globalState.uiState.filteredProjects as project, index}
						{#if globalState.uiState.searchQuery === '' || project.matchSearchQuery(globalState.uiState.searchQuery)}
							<ProjectDetailCard bind:projectDetail={globalState.uiState.filteredProjects[index]} />
						{/if}
					{/each}
				</div>
			{/if}
		{/await}
	</div>

	<Footer />
</div>

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
