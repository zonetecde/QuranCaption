<script lang="ts">
	import type { Batch, BatchMediaStatus } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { BatchService } from '$lib/services/BatchService';
	import { discordService } from '$lib/services/DiscordService';
	import { ProjectService } from '$lib/services/ProjectService';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';

	let batch = $state<Batch | null>(null);
	let error = $state('');

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
			batch = await BatchService.load(globalState.currentBatchId);
		} catch (loadError) {
			error = get(LL).batch.loadFailed({ error: String(loadError) });
		}
	});
</script>

<div class="min-h-full px-4 py-8 xl:px-12 xl:py-12">
	<div class="mx-auto max-w-7xl space-y-7">
		<header class="flex flex-wrap items-center gap-4">
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
		</header>

		{#if error}
			<p class="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-red-300">{error}</p>
		{:else if !batch}
			<p class="text-[var(--text-secondary)]">{$LL.batch.loadingBatch()}</p>
		{:else}
			<section
				class="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl"
			>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="bg-[var(--bg-accent)] text-[var(--text-secondary)]">
							<tr>
								<th class="px-4 py-3">#</th>
								<th class="px-4 py-3">{$LL.batch.project()}</th>
								<th class="px-4 py-3">{$LL.batch.reciter()}</th>
								<th class="px-4 py-3">{$LL.batch.source()}</th>
								<th class="min-w-48 px-4 py-3">{$LL.batch.media()}</th>
								<th class="px-4 py-3">{$LL.batch.actions()}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-color)]">
							{#each batch.projects as project (project.projectId)}
								<tr>
									<td class="px-4 py-4 text-[var(--text-thirdly)]">{project.order}</td>
									<td class="px-4 py-4 font-medium text-[var(--text-primary)]"
										>{project.projectName}</td
									>
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
											<span>{getMediaLabel(project.media.status)}</span>
											<span>{project.media.progress}%</span>
										</div>
										<div class="mt-2 h-2 overflow-hidden rounded bg-[var(--border-color)]">
											<div
												class="h-full rounded bg-[var(--accent-primary)]"
												style={`width: ${project.media.progress}%`}
											></div>
										</div>
									</td>
									<td class="px-4 py-4">
										<button
											class="btn btn-icon h-9 px-3"
											type="button"
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
