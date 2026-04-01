<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { ProjectService } from '$lib/services/ProjectService';
	import type { ImportedProjectPayload } from '$lib/types/project';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import toast from 'svelte-5-french-toast';

	let isExporting = $state(false);
	let isImporting = $state(false);
	let importSummary = $state('');

	async function exportAllProjectsBackup() {
		if (isExporting) return;

		isExporting = true;
		try {
			await Exporter.backupAllProjects();
			toast.success('Backup exported successfully.');
		} catch (error) {
			console.error('Failed to export projects backup:', error);
			await ModalManager.errorModal(
				'Backup export failed',
				'Unable to export all projects.',
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
				toast.success(`Imported ${result.imported} projects from backup.`);
			} else if (result.skipped > 0 && result.invalid === 0) {
				toast.success('Backup loaded. All projects were already present.');
			} else {
				toast.success('Backup import finished.');
			}
		} catch (error) {
			console.error('Failed to import projects backup:', error);
			await ModalManager.errorModal(
				'Backup import failed',
				'The selected backup file is invalid or corrupted.',
				JSON.stringify(error, Object.getOwnPropertyNames(error))
			);
		} finally {
			isImporting = false;
		}
	}
</script>

<div class="space-y-6">
	<div class="space-y-2">
		<h3 class="text-lg font-medium text-primary">Project Backup</h3>
		<p class="text-sm text-thirdly">
			Export all projects into one backup file, or import a full backup later. Existing projects
			with the same IDs are kept and skipped automatically during import.
		</p>
	</div>

	<div class="grid gap-4 xl:grid-rows-2">
		<section class="rounded-xl border border-color bg-primary p-5">
			<div class="mb-4 flex items-start gap-3">
				<div class="space-y-1">
					<h4 class="text-base font-semibold text-primary">Export all projects</h4>
					<p class="text-sm text-thirdly">
						Create one JSON backup containing every project currently stored in the app.
					</p>
				</div>

				<div
					class="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-primary"
				>
					<span class="material-icons px-10">ios_share</span>
				</div>
			</div>

			<div class="rounded-lg border border-color bg-accent/60 p-4 text-sm text-thirdly">
				Use this before reinstalling the app, changing machine, or keeping a full offline copy of
				your project library.
			</div>

			<div class="mt-5 flex items-center gap-3">
				<button
					class="btn-accent px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
					onclick={() => void exportAllProjectsBackup()}
					disabled={isExporting || isImporting}
				>
					{isExporting ? 'Exporting backup...' : 'Export all projects'}
				</button>
			</div>
		</section>

		<section class="rounded-xl border border-color bg-primary p-5">
			<div class="mb-4 flex items-start gap-3">
				<div class="space-y-1">
					<h4 class="text-base font-semibold text-primary">Import a backup</h4>
					<p class="text-sm text-thirdly">
						Load every project from a backup JSON file and ignore projects already present with the
						same IDs.
					</p>
				</div>

				<div
					class="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-primary"
				>
					<span class="material-icons px-10">system_update_alt</span>
				</div>
			</div>

			<div class="rounded-lg border border-color bg-accent/60 p-4 text-sm text-thirdly">
				Import is non-destructive: existing projects are not overwritten. Duplicate IDs are skipped
				automatically.
			</div>

			<div class="mt-5 flex items-center gap-3">
				<button
					class="btn-accent px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
					onclick={() => void importAllProjectsBackup()}
					disabled={isImporting || isExporting}
				>
					{isImporting ? 'Importing backup...' : 'Import backup'}
				</button>
			</div>

			{#if importSummary}
				<p class="mt-3 text-xs text-thirdly">{importSummary}</p>
			{/if}
		</section>
	</div>
</div>
