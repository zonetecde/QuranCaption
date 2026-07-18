<script lang="ts">
	import type { Batch, BatchMediaMode, BatchMediaStatus, BatchProjectItem } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		BatchMediaService,
		isBatchMediaModeCompatible,
		type BatchMediaActivity,
		type BatchMediaQueueProgress
	} from '$lib/services/BatchMediaService';
	import { BatchService } from '$lib/services/BatchService';
	import { discordService } from '$lib/services/DiscordService';
	import { ProjectService } from '$lib/services/ProjectService';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';

	let batch = $state<Batch | null>(null);
	let error = $state('');
	let queueError = $state('');
	let selectedIds = $state<Set<number>>(new Set());
	let showMediaModal = $state(false);
	let selectedMode = $state<BatchMediaMode>('audio_only');
	let queueActive = $state(false);
	let revision = $state(0);
	let activities = $state<Map<number, BatchMediaActivity>>(new Map());
	let queueProgress = $state<BatchMediaQueueProgress>({
		active: 0,
		completed: 0,
		failed: 0,
		remaining: 0,
		progress: 0
	});

	let projects = $derived.by(() => {
		revision;
		return batch?.projects ?? [];
	});
	let selectedProjects = $derived(projects.filter((project) => selectedIds.has(project.projectId)));
	let eligibleSelected = $derived(
		selectedProjects.filter((project) => project.media.status !== 'completed')
	);
	let completedSelected = $derived(
		selectedProjects.filter((project) => project.media.status === 'completed')
	);
	let incompatibleProjects = $derived(
		eligibleSelected.filter((project) => !isBatchMediaModeCompatible(project, selectedMode))
	);
	let allSelected = $derived(
		projects.length > 0 && projects.every((project) => selectedIds.has(project.projectId))
	);

	/**
	 * Résout une nouvelle traduction Batch sans dépendre des types générés au pre-commit.
	 * @param {string} key Clé du message Batch.
	 * @param {Record<string, string | number>} params Paramètres éventuels du message.
	 * @returns {string} Message localisé.
	 */
	function batchMessage(key: string, params: Record<string, string | number> = {}): string {
		const translator = Reflect.get(get(LL).batch, key) as
			| ((values?: Record<string, string | number>) => string)
			| undefined;
		return translator?.(params) ?? key;
	}

	/**
	 * Retourne à la homepage en fermant le workspace actif.
	 * @returns {void}
	 */
	function backToHome(): void {
		globalState.currentBatchId = null;
		globalState.currentPage = 'home';
	}

	/**
	 * Traduit l'état média persistant d'un projet du batch.
	 * @param {BatchMediaStatus} status État média à afficher.
	 * @returns {string} Libellé localisé.
	 */
	function getMediaLabel(status: BatchMediaStatus): string {
		const messages = get(LL).batch;
		switch (status) {
			case 'pending':
				return messages.notImported();
			case 'queued':
				return messages.queued();
			case 'processing':
				return messages.processing();
			case 'completed':
				return messages.completed();
			case 'failed':
				return messages.failed();
		}
	}

	/**
	 * Traduit l'activité temps réel d'une ligne en cours.
	 * @param {BatchProjectItem} project Projet affiché.
	 * @returns {string} Libellé de progression.
	 */
	function getActivityLabel(project: BatchProjectItem): string {
		const activity = activities.get(project.projectId);
		if (project.media.status !== 'processing' || !activity) {
			return getMediaLabel(project.media.status);
		}
		switch (activity) {
			case 'downloading':
				return batchMessage('downloading');
			case 'copying':
				return batchMessage('copyingLocal');
			case 'finalizing':
				return batchMessage('addingTimeline');
			case 'saving':
				return batchMessage('savingProject');
			default:
				return getMediaLabel(project.media.status);
		}
	}

	/**
	 * Traduit le mode média persistant d'une ligne.
	 * @param {BatchMediaMode | null} mode Mode à afficher.
	 * @returns {string} Libellé localisé ou chaîne vide.
	 */
	function getModeLabel(mode: BatchMediaMode | null): string {
		if (!mode) return '';
		return batchMessage(mode === 'audio_only' ? 'audioOnly' : 'audioVideo');
	}

	/**
	 * Ajoute ou retire un projet de la sélection UI.
	 * @param {number} projectId Identifiant du projet.
	 * @returns {void}
	 */
	function toggleProject(projectId: number): void {
		const next = new Set(selectedIds);
		if (next.has(projectId)) next.delete(projectId);
		else next.add(projectId);
		selectedIds = next;
	}

	/**
	 * Sélectionne ou désélectionne toutes les lignes consultables.
	 * @returns {void}
	 */
	function toggleAll(): void {
		selectedIds = allSelected
			? new Set()
			: new Set(
					projects
						.filter((project) => project.media.status !== 'processing')
						.map((project) => project.projectId)
				);
	}

	/**
	 * Ouvre le choix de mode pour les projets éligibles sélectionnés.
	 * @returns {void}
	 */
	function openMediaModal(): void {
		if (eligibleSelected.length === 0 || queueActive) return;
		selectedMode = 'audio_only';
		showMediaModal = true;
	}

	/**
	 * Lance le pool média puis rafraîchit les détails légers de la homepage.
	 * @returns {Promise<void>} Promesse résolue lorsque les trois workers sont arrêtés.
	 */
	async function startMediaImport(): Promise<void> {
		if (!batch || incompatibleProjects.length > 0 || eligibleSelected.length === 0) return;
		showMediaModal = false;
		queueActive = true;
		queueError = '';
		queueProgress = {
			active: 0,
			completed: 0,
			failed: 0,
			remaining: eligibleSelected.length,
			progress: 0
		};
		const service = new BatchMediaService({
			onUpdate: (project, activity, progress) => {
				activities = new Map(activities).set(project.projectId, activity);
				queueProgress = progress;
				revision++;
			}
		});
		try {
			await service.run(batch, [...eligibleSelected], selectedMode);
			selectedIds = new Set(
				batch.projects
					.filter((project) => project.media.status === 'failed')
					.map((project) => project.projectId)
			);
		} catch (importError) {
			queueError = String(importError);
		} finally {
			queueActive = false;
			revision++;
			await BatchService.loadUserBatchesDetails();
		}
	}

	/**
	 * Charge un projet enfant sans perdre l'identifiant du batch actif.
	 * @param {number} projectId Identifiant du projet à ouvrir.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture.
	 */
	async function openProject(projectId: number): Promise<void> {
		globalState.currentProject = await ProjectService.load(projectId);
		discordService.setEditingState();
	}

	onMount(async () => {
		if (globalState.currentBatchId === null) {
			error = get(LL).batch.noBatchSelected();
			return;
		}
		try {
			batch = await BatchService.load(globalState.currentBatchId, batchMessage('mediaInterrupted'));
			selectedIds = new Set(
				batch.projects
					.filter(
						(project) => project.media.status === 'pending' || project.media.status === 'failed'
					)
					.map((project) => project.projectId)
			);
		} catch (loadError) {
			error = get(LL).batch.loadFailed({ error: String(loadError) });
		}
	});
</script>

<div class="min-h-full px-4 py-8 xl:px-12 xl:py-12">
	<div class="mx-auto max-w-7xl space-y-7">
		<header class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex min-w-0 flex-wrap items-center gap-4">
				<button class="btn btn-icon h-10 px-4" type="button" onclick={backToHome}>
					<span class="material-icons-outlined mr-2">arrow_back</span>
					{$LL.batch.backToHome()}
				</button>
				{#if batch}
					<div class="min-w-0">
						<div class="flex items-center gap-3">
							<h1 class="truncate text-3xl font-bold text-[var(--text-primary)]">{batch.name}</h1>
							<span
								class="rounded-full border border-[var(--accent-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary)]"
							>
								{$LL.batch.batch()}
							</span>
						</div>
						<p class="mt-1 text-[var(--text-secondary)]">
							{$LL.batch.projectsCount({ count: batch.projects.length })}
						</p>
					</div>
				{/if}
			</div>
			{#if batch}
				<div class="flex items-center gap-3">
					<span class="text-sm text-[var(--text-secondary)]">
						{batchMessage('selectedProjects', { count: selectedProjects.length })}
					</span>
					<button
						class="btn-accent inline-flex h-11 items-center justify-center gap-2 px-5"
						type="button"
						disabled={eligibleSelected.length === 0 || queueActive}
						onclick={openMediaModal}
					>
						<span class="material-icons-outlined leading-none">download</span>
						<span class="leading-none">{batchMessage('importMedia')}</span>
					</button>
				</div>
			{/if}
		</header>

		{#if error}
			<p class="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-red-300">{error}</p>
		{:else if !batch}
			<p class="text-[var(--text-secondary)]">{$LL.batch.loadingBatch()}</p>
		{:else}
			{#if queueError}
				<p class="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-red-300">
					{queueError}
				</p>
			{/if}
			{#if queueActive}
				<section
					class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4"
				>
					<div class="flex flex-wrap justify-between gap-2 text-sm text-[var(--text-secondary)]">
						<span
							>{batchMessage('queueSummary', {
								active: queueProgress.active,
								completed: queueProgress.completed,
								failed: queueProgress.failed,
								remaining: queueProgress.remaining
							})}</span
						>
						<span>{batchMessage('globalProgress', { progress: queueProgress.progress })}</span>
					</div>
					<div class="mt-3 h-2 overflow-hidden rounded bg-[var(--border-color)]">
						<div
							class="h-full rounded bg-[var(--accent-primary)] transition-[width]"
							style={`width: ${queueProgress.progress}%`}
						></div>
					</div>
				</section>
			{/if}

			<section
				class="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl"
			>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="bg-[var(--bg-accent)] text-[var(--text-secondary)]">
							<tr>
								<th class="px-4 py-3">
									<input
										type="checkbox"
										class="rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-primary)]"
										checked={allSelected}
										aria-label={batchMessage('selectProject')}
										onchange={toggleAll}
									/>
								</th>
								<th class="px-4 py-3">#</th>
								<th class="px-4 py-3">{$LL.batch.project()}</th>
								<th class="px-4 py-3">{$LL.batch.reciter()}</th>
								<th class="px-4 py-3">{$LL.batch.source()}</th>
								<th class="min-w-56 px-4 py-3">{$LL.batch.media()}</th>
								<th class="px-4 py-3">{$LL.batch.actions()}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-color)]">
							{#each projects as project (project.projectId)}
								<tr>
									<td class="px-4 py-4">
										<input
											type="checkbox"
											class="rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-primary)]"
											checked={selectedIds.has(project.projectId)}
											disabled={project.media.status === 'processing'}
											aria-label={batchMessage('selectProject')}
											onchange={() => toggleProject(project.projectId)}
										/>
									</td>
									<td class="px-4 py-4 text-[var(--text-thirdly)]">{project.order}</td>
									<td class="px-4 py-4 font-medium text-[var(--text-primary)]">
										{project.projectName}
									</td>
									<td class="px-4 py-4 text-[var(--text-secondary)]">{project.reciter}</td>
									<td class="max-w-96 px-4 py-4 text-[var(--text-secondary)]">
										<div class="flex items-center gap-2" title={project.source.value}>
											<span class="material-icons-outlined text-base text-[var(--accent-primary)]">
												{project.source.kind === 'url' ? 'link' : 'insert_drive_file'}
											</span>
											<span class="truncate">{project.source.value}</span>
										</div>
									</td>
									<td class="px-4 py-4">
										<div class="flex justify-between text-xs text-[var(--text-secondary)]">
											<span>{getActivityLabel(project)}</span>
											<span>{project.media.progress}%</span>
										</div>
										<div class="mt-2 h-2 overflow-hidden rounded bg-[var(--border-color)]">
											<div
												class="h-full rounded bg-[var(--accent-primary)] transition-[width]"
												style={`width: ${project.media.progress}%`}
											></div>
										</div>
										{#if project.media.mode}
											<p class="mt-2 text-xs text-[var(--text-thirdly)]">
												{batchMessage('mediaMode', { mode: getModeLabel(project.media.mode) })}
											</p>
										{/if}
										{#if project.media.error}
											<p class="mt-2 max-w-80 break-words text-xs text-red-300">
												{project.media.error}
											</p>
										{/if}
									</td>
									<td class="px-4 py-4">
										<button
											class="btn btn-icon h-9 px-3"
											type="button"
											disabled={project.media.status === 'processing'}
											onclick={() => openProject(project.projectId)}
										>
											<span class="material-icons-outlined mr-2 text-base">open_in_new</span>
											{$LL.batch.openProject()}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	</div>
</div>

{#if showMediaModal}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
		<div
			class="w-full max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-media-title"
		>
			<h2 id="batch-media-title" class="text-xl font-semibold text-[var(--text-primary)]">
				{batchMessage('importMediaTitle')}
			</h2>
			<p class="mt-2 text-sm text-[var(--text-secondary)]">
				{batchMessage('selectedForImport', { count: eligibleSelected.length })}
			</p>
			{#if completedSelected.length > 0}
				<p class="mt-1 text-sm text-[var(--text-thirdly)]">
					{batchMessage('completedIgnored', { count: completedSelected.length })}
				</p>
			{/if}

			<div class="mt-5 space-y-3">
				<label
					class="flex cursor-pointer gap-3 rounded-xl border border-[var(--border-color)] p-4 hover:border-[var(--accent-primary)]"
				>
					<input
						type="radio"
						name="batch-media-mode"
						value="audio_only"
						bind:group={selectedMode}
					/>
					<span>
						<span class="font-medium text-[var(--text-primary)]">{batchMessage('audioOnly')}</span>
						<span class="mt-1 block text-sm text-[var(--text-secondary)]">
							{batchMessage('audioOnlyDescription')}
						</span>
					</span>
				</label>
				<label
					class="flex cursor-pointer gap-3 rounded-xl border border-[var(--border-color)] p-4 hover:border-[var(--accent-primary)]"
				>
					<input
						type="radio"
						name="batch-media-mode"
						value="audio_video"
						bind:group={selectedMode}
					/>
					<span>
						<span class="font-medium text-[var(--text-primary)]">{batchMessage('audioVideo')}</span>
						<span class="mt-1 block text-sm text-[var(--text-secondary)]">
							{batchMessage('audioVideoDescription')}
						</span>
					</span>
				</label>
			</div>

			<p class="mt-4 rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
				{batchMessage(selectedMode === 'audio_only' ? 'audioOnlySummary' : 'audioVideoSummary')}
			</p>
			{#if incompatibleProjects.length > 0}
				<div
					class="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-300"
				>
					<p class="font-medium">{batchMessage('incompatibleAudioTitle')}</p>
					<ul class="mt-2 list-inside list-disc">
						{#each incompatibleProjects as project (project.projectId)}
							<li>{project.projectName}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="mt-6 flex justify-end gap-3">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showMediaModal = false)}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="btn btn-primary h-10 px-5"
					type="button"
					disabled={incompatibleProjects.length > 0 || queueActive}
					onclick={startMediaImport}
				>
					<span class="material-icons-outlined mr-2">download</span>
					{batchMessage('startImport')}
				</button>
			</div>
		</div>
	</div>
{/if}
