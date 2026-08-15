<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import { Utilities } from '$lib/classes';
	import { DEFAULT_EXPORT_FILE_NAME_FORMAT } from '$lib/constants/export';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';

	let copy = $derived(
		$LL.settings as unknown as {
			defaultValues: () => string;
			defaultValuesDescription: () => string;
			defaultExportFileName: () => string;
			defaultExportFileNameDescription: () => string;
			fileNamePlaceholders: () => string;
			placeholderProjectName: () => string;
			placeholderReciter: () => string;
			placeholderVerseRange: () => string;
			placeholderSurah: () => string;
			placeholderSurahNumber: () => string;
			defaultYouTubeMetadata: () => string;
			defaultYouTubeMetadataDescription: () => string;
			defaultYouTubeTitle: () => string;
			defaultYouTubeDescription: () => string;
			projectCategories: () => string;
			projectCategoriesDescription: () => string;
			newProjectCategory: () => string;
			addCategory: () => string;
			deleteCategory: () => string;
			categoryCannotBeEmpty: () => string;
			categoryAlreadyExists: () => string;
			categoryInvalidCharacters: () => string;
		}
	);
	let newProjectCategory = $state('');

	const placeholders = [
		{ token: '{project_name}', description: 'placeholderProjectName' },
		{ token: '{reciter}', description: 'placeholderReciter' },
		{ token: '{verse_range}', description: 'placeholderVerseRange' },
		{ token: '{surah}', description: 'placeholderSurah' },
		{ token: '{surah_number}', description: 'placeholderSurahNumber' }
	] as const;

	/**
	 * Sauvegarde le format de nom d'export, ou restaure le format par défaut s'il est vide.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde des paramètres.
	 */
	async function saveExportFileNameFormat(): Promise<void> {
		const settings = globalState.settings;
		if (!settings) return;
		if (!settings.defaultValuesSettings.exportFileNameFormat.trim()) {
			settings.defaultValuesSettings.exportFileNameFormat = DEFAULT_EXPORT_FILE_NAME_FORMAT;
		}
		await Settings.save();
	}

	/**
	 * Sauvegarde les métadonnées YouTube utilisées lors de l'ouverture du modal.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde des paramètres.
	 */
	async function saveYouTubeMetadataDefaults(): Promise<void> {
		await Settings.save();
	}

	/**
	 * Ajoute une catégorie de projet unique aux valeurs par défaut.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde éventuelle.
	 */
	async function addProjectCategory(): Promise<void> {
		const settings = globalState.settings;
		if (!settings) return;
		const category = newProjectCategory.trim();
		if (!category) {
			toast.error(copy.categoryCannotBeEmpty());
			return;
		}
		if (Utilities.isPathNotSafe(category)) {
			toast.error(copy.categoryInvalidCharacters());
			return;
		}
		if (
			settings.defaultValuesSettings.projectCategories.some(
				(existing) => existing.toLocaleLowerCase() === category.toLocaleLowerCase()
			)
		) {
			toast.error(copy.categoryAlreadyExists());
			return;
		}

		settings.defaultValuesSettings.projectCategories.push(category);
		newProjectCategory = '';
		await Settings.save();
	}

	/**
	 * Retire une catégorie des choix proposés aux projets.
	 * @param {string} category Catégorie à retirer.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde.
	 */
	async function deleteProjectCategory(category: string): Promise<void> {
		const settings = globalState.settings;
		if (!settings || settings.defaultValuesSettings.projectCategories.length === 1) return;
		settings.defaultValuesSettings.projectCategories =
			settings.defaultValuesSettings.projectCategories.filter((item) => item !== category);
		await Settings.save();
	}
</script>

<div class="space-y-5">
	<div class="space-y-2">
		<h3 class="text-lg font-medium text-primary">{copy.defaultValues()}</h3>
		<p class="text-sm text-thirdly">{copy.defaultValuesDescription()}</p>
	</div>

	<div class="space-y-4 rounded-2xl border border-color bg-primary p-5">
		<div class="space-y-2">
			<h4 class="text-sm font-semibold text-primary">{copy.projectCategories()}</h4>
			<p class="text-sm text-thirdly">{copy.projectCategoriesDescription()}</p>
		</div>

		<div class="flex gap-2">
			<input
				type="text"
				maxlength="50"
				class="input min-w-0 flex-1"
				placeholder={copy.newProjectCategory()}
				bind:value={newProjectCategory}
				onkeydown={(event) => event.key === 'Enter' && addProjectCategory()}
			/>
			<button
				type="button"
				class="rounded-lg bg-accent-primary px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
				disabled={!newProjectCategory.trim()}
				onclick={addProjectCategory}
			>
				{copy.addCategory()}
			</button>
		</div>

		<div class="grid gap-2">
			{#each globalState.settings!.defaultValuesSettings.projectCategories as category (category)}
				<div class="flex items-center justify-between gap-3 rounded-lg bg-accent px-3 py-2">
					<span class="min-w-0 truncate text-sm text-primary">{category}</span>
					<button
						type="button"
						class="material-icons text-base text-thirdly hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
						disabled={globalState.settings!.defaultValuesSettings.projectCategories.length === 1}
						title={copy.deleteCategory()}
						onclick={() => deleteProjectCategory(category)}
					>
						delete
					</button>
				</div>
			{/each}
		</div>
	</div>

	<div class="space-y-4 rounded-2xl border border-color bg-primary p-5">
		<div class="space-y-2">
			<label for="default-export-file-name" class="text-sm font-semibold text-primary">
				{copy.defaultExportFileName()}
			</label>
			<p class="text-sm text-thirdly">{copy.defaultExportFileNameDescription()}</p>
			<input
				id="default-export-file-name"
				type="text"
				class="input w-full"
				bind:value={globalState.settings!.defaultValuesSettings.exportFileNameFormat}
				onchange={saveExportFileNameFormat}
			/>
		</div>

		<div class="space-y-2">
			<p class="text-xs font-semibold uppercase tracking-wider text-thirdly">
				{copy.fileNamePlaceholders()}
			</p>
			<div class="grid gap-2">
				{#each placeholders as placeholder (placeholder.token)}
					<div class="flex items-center gap-3 text-sm">
						<code class="rounded bg-accent px-2 py-1 text-accent-secondary">
							{placeholder.token}
						</code>
						<span class="text-thirdly">{copy[placeholder.description]()}</span>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="space-y-4 rounded-2xl border border-color bg-primary p-5">
		<div class="space-y-2">
			<h4 class="text-sm font-semibold text-primary">{copy.defaultYouTubeMetadata()}</h4>
			<p class="text-sm text-thirdly">{copy.defaultYouTubeMetadataDescription()}</p>
		</div>

		<label class="block space-y-2">
			<span class="text-sm font-semibold text-primary">{copy.defaultYouTubeTitle()}</span>
			<input
				type="text"
				maxlength="100"
				class="input w-full"
				bind:value={globalState.settings!.defaultValuesSettings.youtubeVideoTitle}
				onchange={saveYouTubeMetadataDefaults}
			/>
		</label>

		<label class="block space-y-2">
			<span class="text-sm font-semibold text-primary">{copy.defaultYouTubeDescription()}</span>
			<textarea
				maxlength="5000"
				rows="5"
				class="min-h-28 w-full resize-y rounded-lg border border-color bg-accent px-3 py-2 text-sm text-primary outline-none focus:border-accent-primary"
				bind:value={globalState.settings!.defaultValuesSettings.youtubeVideoDescription}
				onchange={saveYouTubeMetadataDefaults}
			></textarea>
		</label>
	</div>
</div>
