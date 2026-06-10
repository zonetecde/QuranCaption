<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { ProjectService } from '$lib/services/ProjectService';
	import type { ImportedProjectPayload } from '$lib/types/project';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let isExporting = $state(false);
	let isImporting = $state(false);
	let importSummary = $state('');

	async function exportAllProjectsBackup() {
		if (isExporting) return;

		isExporting = true;
		try {
			await Exporter.backupAllProjects();
			toast.success(get(LL).settings.backupExported());
		} catch (error) {
			console.error('Failed to export projects backup:', error);
			await ModalManager.errorModal(
				get(LL).settings.backupExportFailed(),
				get(LL).settings.unableToExportProjects(),
				JSON.stringify(error, Object.getOwnPropertyNames(error))
			);
		} finally {
			isExporting = false;
		}
	}

	async function importAllProjectsBackup() {
		if (isImporting) return;

		const file = await open({
			multiple: false,
			directory: false,
			filters: [{ name: 'JSON', extensions: ['json'] }]
		});

		if (!file || Array.isArray(file)) return;

		isImporting = true;
		importSummary = '';

		try {
			const rawContent = await readTextFile(file);
			const backupProjects = JSON.parse(rawContent.toString()) as ImportedProjectPayload[];
			const result = await ProjectService.importProjectsBackup(backupProjects);

			importSummary = `${result.imported} imported, ${result.skipped} skipped duplicates, ${result.invalid} invalid.`;

			if (result.imported > 0) {
				toast.success(get(LL).settings.importedProjects({ count: result.imported }));
			} else if (result.skipped > 0 && result.invalid === 0) {
				toast.success(get(LL).settings.backupLoadedAllPresent());
			} else {
				toast.success(get(LL).settings.backupImportFinished());
			}
		} catch (error) {
			console.error('Failed to import projects backup:', error);
			await ModalManager.errorModal(
				get(LL).settings.backupImportFailed(),
				get(LL).settings.backupFileInvalid(),
				JSON.stringify(error, Object.getOwnPropertyNames(error))
			);
		} finally {
			isImporting = false;
		}
	}

	async function openProjectsDirectory() {
		try {
			const projectsFolder = await ProjectService.getProjectsFolderPath();
			await invoke('open_directory', { directoryPath: projectsFolder });
		} catch (error) {
			console.error('Failed to open projects directory:', error);
			await ModalManager.errorModal(
				get(LL).settings.unableToOpenProjectsFolder(),
				get(LL).settings.couldNotOpenProjectsDir(),
				JSON.stringify(error, Object.getOwnPropertyNames(error))
			);
		}
	}
</script>

<div class="space-y-6">
	<div class="space-y-2">
		<h3 class="text-lg font-medium text-primary">{$LL.settings.projectBackup()}</h3>
		<p class="text-sm text-thirdly">
			{$LL.settings.backupDescription()}
		</p>
		<div class="pt-1">
			<button class="btn px-4 py-2 text-sm" onclick={() => void openProjectsDirectory()}>
				{$LL.settings.openProjectsFolder()}
			</button>
		</div>
	</div>

	<div class="grid gap-4 xl:grid-rows-2">
		<section class="rounded-xl border border-color bg-primary p-5">
			<div class="mb-4 flex items-start gap-3">
				<div class="space-y-1">
					<h4 class="text-base font-semibold text-primary">{$LL.settings.exportAllProjects()}</h4>
					<p class="text-sm text-thirdly">
						{$LL.settings.exportAllProjectsDescription()}
					</p>
				</div>

				<div
					class="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-primary"
				>
					<span class="material-icons px-10">ios_share</span>
				</div>
			</div>

			<div class="rounded-lg border border-color bg-accent/60 p-4 text-sm text-thirdly">
				{$LL.settings.useBeforeReinstalling()}
			</div>

			<div class="mt-5 flex items-center gap-3">
				<button
					class="btn-accent px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
					onclick={() => void exportAllProjectsBackup()}
					disabled={isExporting || isImporting}
				>
					{isExporting ? $LL.settings.exportingBackup() : $LL.settings.exportAllProjects()}
				</button>
			</div>
		</section>

		<section class="rounded-xl border border-color bg-primary p-5">
			<div class="mb-4 flex items-start gap-3">
				<div class="space-y-1">
					<h4 class="text-base font-semibold text-primary">{$LL.settings.importBackup()}</h4>
					<p class="text-sm text-thirdly">
						{$LL.settings.importBackupDescription()}
					</p>
				</div>

				<div
					class="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-primary"
				>
					<span class="material-icons px-10">system_update_alt</span>
				</div>
			</div>

			<div class="rounded-lg border border-color bg-accent/60 p-4 text-sm text-thirdly">
				{$LL.settings.importNonDestructive()}
			</div>

			<div class="mt-5 flex items-center gap-3">
				<button
					class="btn-accent px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
					onclick={() => void importAllProjectsBackup()}
					disabled={isImporting || isExporting}
				>
					{isImporting ? $LL.settings.importingBackup() : $LL.settings.importBackup()}
				</button>
			</div>

			{#if importSummary}
				<p class="mt-3 text-xs text-thirdly">{importSummary}</p>
			{/if}
		</section>
	</div>
</div>
