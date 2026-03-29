<script lang="ts">
	import { ProjectService } from '$lib/services/ProjectService';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import MigrationService from '$lib/services/MigrationService';
	import { readDir } from '@tauri-apps/plugin-fs';

	let { close } = $props();

	let numberOfV2Projects: number = $state(0);
	let isImporting: boolean = $state(false);
	let importProgress: number = $state(0);
	let currentProjectName: string = $state('');
	let importComplete: boolean = $state(false);
	let successfulImports: number = $state(0);
	let failedImports: number = $state(0);
	let failedProjects: string[] = $state([]);

	onMount(async () => {
		numberOfV2Projects = await MigrationService.getQCV2NumberOfFiles();
		// Subtract 1 if projects.json exists as it's not a project file
		if (numberOfV2Projects > 0) numberOfV2Projects = numberOfV2Projects - 1;
	});

	async function startMigration() {
		isImporting = true;
		importProgress = 0;
		successfulImports = 0;
		failedImports = 0;
		failedProjects = [];

		try {
			const qc2Dir = await MigrationService.getQCV2Dir();
			if (!qc2Dir) {
				toast.error('Could not find Quran Caption V2 data directory');
				isImporting = false;
				return;
			}

			const files = await readDir(qc2Dir);
			const projectFiles = files.filter(
				(file) => file.name.endsWith('.json') && file.name !== 'projects.json'
			);

			for (let i = 0; i < projectFiles.length; i++) {
				const file = projectFiles[i];
				currentProjectName = file.name.replace('.json', '');

				try {
					// Import individual project with error handling
					await importSingleProject(qc2Dir, file.name);
					successfulImports++;
				} catch (error) {
					console.error(`Failed to import ${file.name}:`, error);
					failedImports++;
					failedProjects.push(currentProjectName);
					toast.error(`Failed to import: ${currentProjectName}`);
				}

				importProgress = ((i + 1) / projectFiles.length) * 100;
			}

			// Reload projects after import
			await ProjectService.loadUserProjectsDetails();

			importComplete = true;
		} catch (error) {
			console.error('Migration failed:', error);
			toast.error('Migration process failed. Please try again.');
			isImporting = false;
		}
	}

	async function importSingleProject(qc2Dir: string, fileName: string) {
		// Use the service method to import the project
		await MigrationService.importSingleProjectFromV2(qc2Dir, fileName);
	}

	function closeModal() {
		if (!isImporting) {
			close();
		}
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[800px] 2xl:max-h-screen max-h-[700px] overflow-auto shadow-2xl shadow-black flex flex-col relative"
>
	<!-- Header with gradient background -->
	<div
		class="bg-gradient-to-r from-accent to-bg-accent rounded-t-2xl px-6 py-6 border-b border-color"
	>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<div
					class="w-12 h-12 bg-accent-primary rounded-full flex items-center justify-center shadow-lg"
				>
					{#if importComplete}
						<span class="material-icons text-black text-xl">check_circle</span>
					{:else if isImporting}
						<div
							class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"
						></div>
					{:else}
						<span class="material-icons text-black text-xl">upgrade</span>
					{/if}
				</div>
				<div>
					<h2 class="text-2xl font-bold text-primary">
						{#if importComplete}
							Migration Complete!
						{:else if isImporting}
							Migrating Projects...
						{:else}
							Quran Caption V3 Migration
						{/if}
					</h2>
					<p class="text-sm text-thirdly">
						{#if importComplete}
							Your projects have been imported
						{:else if isImporting}
							Please wait while we import your projects
						{:else}
							Import your V2 projects to V3
						{/if}
					</p>
				</div>
			</div>

			<!-- Close button -->
			<button
				class="w-10 h-10 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary group cursor-pointer {isImporting
					? 'opacity-50 cursor-not-allowed'
					: ''}"
				onclick={closeModal}
				disabled={isImporting}
			>
				<span class="material-icons text-lg group-hover:rotate-90 transition-transform duration-200"
					>close</span
				>
			</button>
		</div>
	</div>

	<!-- Content -->
	<div class="p-8">
		{#if !isImporting && !importComplete}
			<!-- Pre-import information -->
			<div class="space-y-6">
				<!-- Project count display -->
				<div class="bg-accent rounded-lg p-6 border border-color">
					<div class="flex items-center gap-4">
						<div class="w-16 h-16 bg-accent-primary rounded-full flex items-center justify-center">
							<span class="material-icons text-black text-2xl">folder</span>
						</div>
						<div>
							<h3 class="text-xl font-bold text-primary">
								{numberOfV2Projects} Projects Found
							</h3>
							<p class="text-thirdly">Ready to be imported from Quran Caption V2</p>
						</div>
					</div>
				</div>

				<!-- Important information -->
				<div class="bg-secondary rounded-lg p-6 border border-color">
					<h4 class="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
						<span class="material-icons text-accent-primary">info</span>
						What will be imported
					</h4>
					<div class="space-y-3">
						<div class="flex items-start gap-3">
							<div class="w-2 h-2 bg-green-400 rounded-full mt-2 flex-shrink-0"></div>
							<div>
								<span class="text-secondary text-sm font-medium">Project assets and timeline</span>
								<p class="text-thirdly text-xs mt-1">
									All your audio/video files and subtitle timing
								</p>
							</div>
						</div>
						<div class="flex items-start gap-3">
							<div class="w-2 h-2 bg-green-400 rounded-full mt-2 flex-shrink-0"></div>
							<div>
								<span class="text-secondary text-sm font-medium">Translations</span>
								<p class="text-thirdly text-xs mt-1">Your selected translation editions</p>
							</div>
						</div>
						<div class="flex items-start gap-3">
							<div class="w-2 h-2 bg-yellow-400 rounded-full mt-2 flex-shrink-0"></div>
							<div>
								<span class="text-secondary text-sm font-medium">Style limitations</span>
								<p class="text-thirdly text-xs mt-1">
									Video styles will be reset to default settings
								</p>
							</div>
						</div>
						<div class="flex items-start gap-3">
							<div class="w-2 h-2 bg-red-400 rounded-full mt-2 flex-shrink-0"></div>
							<div>
								<span class="text-secondary text-sm font-medium">Custom texts</span>
								<p class="text-thirdly text-xs mt-1">Will be replaced with silence clips</p>
							</div>
						</div>
					</div>
				</div>

				<!-- Requirements -->
				<div
					class="bg-accent rounded-lg p-4 border border-color border-l-4 border-l-accent-primary"
				>
					<div class="flex items-center gap-2 mb-2">
						<span class="material-icons text-accent-primary text-lg">wifi</span>
						<span class="text-secondary font-medium text-sm">Internet Connection Required</span>
					</div>
					<p class="text-thirdly text-xs">
						An active internet connection is needed to download translation data during the import
						process.
					</p>
				</div>
			</div>
		{:else if isImporting}
			<!-- Progress display -->
			<div class="space-y-6">
				<!-- Progress bar -->
				<div class="bg-accent rounded-lg p-6 border border-color">
					<div class="flex items-center justify-between mb-4">
						<h3 class="text-lg font-semibold text-primary">Import Progress</h3>
						<span class="text-secondary text-sm">{Math.round(importProgress)}%</span>
					</div>

					<div class="w-full bg-secondary rounded-full h-3 mb-4 overflow-hidden">
						<div
							class="bg-accent-primary h-3 rounded-full transition-all duration-300 ease-out"
							style="width: {importProgress}%"
						></div>
					</div>

					<div class="flex items-center justify-between text-sm">
						<span class="text-thirdly">
							Processing: <span class="text-secondary font-medium">{currentProjectName}</span>
						</span>
						<span class="text-secondary">
							{successfulImports + failedImports} / {numberOfV2Projects}
						</span>
					</div>
				</div>

				<!-- Status -->
				<div class="grid grid-cols-2 gap-4">
					<div class="bg-secondary rounded-lg p-4 border border-color">
						<div class="flex items-center gap-3">
							<div
								class="w-10 h-10 bg-green-500 bg-opacity-20 rounded-full flex items-center justify-center"
							>
								<span class="material-icons text-green-400 text-lg">check</span>
							</div>
							<div>
								<div class="text-green-400 font-semibold">{successfulImports}</div>
								<div class="text-thirdly text-xs">Successful</div>
							</div>
						</div>
					</div>
					<div class="bg-secondary rounded-lg p-4 border border-color">
						<div class="flex items-center gap-3">
							<div
								class="w-10 h-10 bg-red-500 bg-opacity-20 rounded-full flex items-center justify-center"
							>
								<span class="material-icons text-red-400 text-lg">error</span>
							</div>
							<div>
								<div class="text-red-400 font-semibold">{failedImports}</div>
								<div class="text-thirdly text-xs">Failed</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		{:else if importComplete}
			<!-- Completion summary -->
			<div class="space-y-6">
				<div class="text-center py-6">
					<div
						class="w-16 h-16 bg-accent-primary rounded-full flex items-center justify-center mx-auto mb-4"
					>
						<span class="material-icons text-black text-2xl">check_circle</span>
					</div>
					<h3 class="text-2xl font-bold text-primary mb-2">Migration Complete!</h3>
					<div
						class="bg-accent-primary bg-opacity-10 rounded-lg p-4 border border-accent-primary border-opacity-30 mb-4"
					>
						<p class="text-accent-primary font-semibold text-lg">
							🎉 {successfulImports} projects imported successfully!
						</p>
						{#if failedImports > 0}
							<p class="text-red-400 text-sm mt-2">
								{failedImports} projects failed to import
							</p>
						{/if}
					</div>
					<p class="text-thirdly">
						Your projects have been successfully imported to Quran Caption V3
					</p>
				</div>

				<!-- Results summary -->
				<div class="bg-accent rounded-lg p-6 border border-color">
					<h4 class="text-lg font-semibold text-primary mb-4">Import Results</h4>
					<div class="grid grid-cols-2 gap-4">
						<div class="text-center p-4 bg-secondary rounded-lg">
							<div class="text-2xl font-bold text-green-400">{successfulImports}</div>
							<div class="text-thirdly text-sm">Successfully Imported</div>
						</div>
						<div class="text-center p-4 bg-secondary rounded-lg">
							<div class="text-2xl font-bold text-red-400">{failedImports}</div>
							<div class="text-thirdly text-sm">Failed to Import</div>
						</div>
					</div>
				</div>

				{#if failedProjects.length > 0}
					<div
						class="bg-red-900 bg-opacity-20 rounded-lg p-4 border border-red-500 border-opacity-30"
					>
						<h5 class="text-red-400 font-medium mb-2 flex items-center gap-2">
							<span class="material-icons text-sm">warning</span>
							Failed Projects
						</h5>
						<div class="space-y-1">
							{#each failedProjects as projectName (projectName)}
								<div class="text-red-300 text-sm">• {projectName}</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-8 py-6 rounded-b-2xl">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 text-sm text-thirdly">
				<span class="material-icons text-accent-secondary">info</span>
				{#if importComplete}
					<span>You can now start using your imported projects</span>
				{:else if isImporting}
					<span>Migration in progress... Please don't close this window</span>
				{:else}
					<span>This will import all your V2 projects to V3 format</span>
				{/if}
			</div>

			<div class="flex gap-3">
				{#if !isImporting}
					<button
						class="px-6 py-2.5 font-medium text-primary border border-color rounded-lg hover:bg-accent hover:border-accent-primary transition-all duration-200 cursor-pointer"
						onclick={close}
					>
						{importComplete ? 'Close' : 'Cancel'}
					</button>
				{/if}

				{#if !isImporting && !importComplete}
					<button
						class="px-8 py-2.5 font-medium bg-accent-primary text-black rounded-lg hover:bg-blue-400 transition-all duration-200 flex items-center gap-2 shadow-lg cursor-pointer"
						onclick={startMigration}
					>
						<span class="material-icons text-lg">download</span>
						Start Migration
					</button>
				{:else if importComplete}
					<button
						class="px-8 py-2.5 font-medium bg-accent-primary text-black rounded-lg hover:bg-blue-400 transition-all duration-200 flex items-center gap-2 shadow-lg cursor-pointer"
						onclick={close}
					>
						<span class="material-icons text-lg">done</span>
						Continue
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	/* Enhanced gradient backgrounds */
	.bg-gradient-to-r.from-accent.to-bg-accent {
		background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%);
	}

	/* Smooth button hover effects */
	button:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	/* Primary button special effects */
	button.bg-accent-primary:hover {
		box-shadow: 0 4px 16px rgba(88, 166, 255, 0.4);
	}

	/* Disabled button override */
	button:disabled {
		transform: none !important;
		box-shadow: none !important;
	}

	/* Loading spinner */
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.animate-spin {
		animation: spin 1s linear infinite;
	}

	/* Modal entrance animation */
	div[class*='bg-secondary border-color'] {
		animation: modalSlideIn 0.3s ease-out;
	}

	@keyframes modalSlideIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-20px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	/* Progress bar animation */
	.bg-accent-primary {
		transition: width 0.3s ease-out;
	}

	/* Icon rotation on close button hover */
	.group:hover .material-icons {
		transition: transform 0.2s ease;
	}

	/* Status cards hover effect */
	.grid > div:hover {
		transform: translateY(-2px);
		transition: transform 0.2s ease;
	}
</style>
