<script lang="ts">
	import { ProjectDetail } from '$lib/classes';
	import { ProjectService } from '$lib/services/ProjectService';
	import ContextMenu, { Item, Divider, Settings } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { globalState } from '$lib/runes/main.svelte';
	import EditableText from '../misc/EditableText.svelte';
	import ModalManager from '../modals/ModalManager';
	import { Status } from '$lib/classes/Status';
	import { slide } from 'svelte/transition';
	import MigrationService from '$lib/services/MigrationService';
	import { discordService } from '$lib/services/DiscordService';
	import { onDestroy } from 'svelte';

	let contextMenu: ContextMenu | undefined = $state(undefined); // Initialize context menu state

	let {
		projectDetail = $bindable()
	}: {
		projectDetail: ProjectDetail;
	} = $props();

	async function deleteProjectButtonClick(e: MouseEvent) {
		if (e.button !== 0) return; // Only handle left click
		if (
			await ModalManager.confirmModal(
				`Are you sure you want to delete the project "${projectDetail.name}"?`
			)
		) {
			await ProjectService.delete(projectDetail.id); // Supprime le projet
		} else {
			currentMenu.set(null);
		}
	}

	onDestroy(() => {
		currentMenu.set(null);
	});

	async function openProjectButtonClick() {
		// Ouvre le projet
		globalState.currentProject = await ProjectService.load(projectDetail.id);

		// Migration si besoin
		MigrationService.FromQC313ToQC314();
		MigrationService.FromQC326ToQC327();

		// Discord Rich Presence
		discordService.setEditingState();
	}

	// Gestion du menu de statut
	let showStatusMenu = $state(false);
	const statuses: Status[] = Object.values(Status).filter((v) => v instanceof Status) as Status[];

	async function selectStatus(s: Status) {
		projectDetail.status = s;
		showStatusMenu = false;
		await ProjectService.saveDetail(projectDetail);
	}

	function toggleStatusMenu(e: MouseEvent) {
		e.stopPropagation();
		showStatusMenu = !showStatusMenu;
	}

	// Fermer en cliquant dehors
	if (typeof window !== 'undefined') {
		window.addEventListener('click', () => (showStatusMenu = false));
	}

	// Gestion de l'affichage des détails du projet
	let showProjectDetails = $state(false);

	function toggleProjectDetails(e: MouseEvent) {
		e.stopPropagation();
		showProjectDetails = !showProjectDetails;
	}
</script>

<div
	class="bg-secondary backdrop-blur-[10px] border border-[var(--border-color)] rounded-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] flex flex-col justify-between hover:shadow-2xl transition-all duration-300"
>
	<div>
		{#if globalState.settings!.persistentUiState.projectCardView === 'grid'}
			<section class="w-full h-40 object-cover rounded-t-lg bg-white/80"></section>
		{/if}
		<div class="px-4 pb-4 relative mt-4">
			<div class="flex justify-between items-start mb-2">
				<EditableText
					text="Enter project name"
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
						{projectDetail.status.status}
						<span
							class="material-icons-outlined text-[10px] w-10 duration-300 absolute left-full top-1/2 -translate-y-1/2 scale-75 pointer-events-none opacity-0 group-hover:opacity-60 group-hover:scale-100 group-hover:-translate-x-2"
							aria-hidden="true">arrow_drop_down</span
						>
					</button>
					{#if showStatusMenu}
						<ul
							class="absolute top-full right-0 mt-1 w-40 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl py-1 z-20 backdrop-blur-sm"
						>
							{#each statuses as s}
								<li
									class={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none transition-colors hover:bg-white/5 rounded-sm ${s === projectDetail.status ? 'bg-white/10' : ''}`}
									onclick={() => selectStatus(s)}
								>
									<span class="w-3 h-3 rounded-full" style={`background-color: ${s.color}`}
									></span>{s.status}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-x-1 text-xs text-[var(--text-secondary)] -mb-0.5">
				Reciter: <EditableText
					text="Enter project reciter"
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
			<p class="text-xs text-[var(--text-secondary)] mb-1">
				Duration: {projectDetail.duration.getFormattedTime(false)}
			</p>
			<p class="text-xs text-[var(--text-secondary)] mb-3 verserange">
				Verses: <span class="font-medium text-[var(--text-primary)]"
					>{projectDetail.verseRange.toString()}</span
				>
			</p>

			<!-- Bouton discret pour basculer les détails -->
			<button
				class={'absolute bottom-0 right-0 p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] opacity-60 hover:opacity-100 transition-all duration-200  cursor-pointer ' +
					(showProjectDetails ? ' translate-y-2' : '')}
				onclick={toggleProjectDetails}
				type="button"
				title={showProjectDetails ? 'Hide details' : 'Show details'}
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
							<span>Captioning</span>
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
						{#each Object.entries(projectDetail.translations) as [language, percentage]}
							<div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
								<span>Translation ({language}) </span>
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
			<span>Created: {projectDetail.createdAt.toLocaleDateString()}</span>
			<span>Updated: {projectDetail.updatedAt.toLocaleDateString()}</span>
		</div>

		<div class="flex space-x-2">
			<button class="btn-accent flex-grow text-xs py-1" onclick={openProjectButtonClick}
				>Open</button
			>
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
	<Item on:click={deleteProjectButtonClick}
		><div class="btn-icon danger-color">
			<span class="material-icons-outlined text-sm mr-1">delete</span>Delete project
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
