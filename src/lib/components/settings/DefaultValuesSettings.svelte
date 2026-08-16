<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import { Utilities } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';

	let copy = $derived(
		$LL.settings as unknown as {
			defaultValues: () => string;
			defaultValuesDescription: () => string;
			projectCategories: () => string;
			projectCategoriesDescription: () => string;
			newProjectCategory: () => string;
			addCategory: () => string;
			deleteCategory: () => string;
			categoryCannotBeEmpty: () => string;
			categoryAlreadyExists: () => string;
			categoryInvalidCharacters: () => string;
			showTimelineVideoThumbnails: () => string;
			showTimelineVideoThumbnailsDescription: () => string;
		}
	);
	let newProjectCategory = $state('');

	/**
	 * Ajoute une catégorie de projet unique aux choix proposés.
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
	 * Retire une catégorie sans supprimer le dernier choix disponible.
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

	<label
		class="flex items-center justify-between gap-4 rounded-xl border border-color bg-primary p-4"
	>
		<div>
			<p class="text-sm font-medium text-primary">{copy.showTimelineVideoThumbnails()}</p>
			<p class="mt-1 text-xs text-thirdly">{copy.showTimelineVideoThumbnailsDescription()}</p>
		</div>
		<input
			type="checkbox"
			class="h-5 w-5 shrink-0 accent-accent-primary"
			bind:checked={globalState.settings!.defaultValuesSettings.showTimelineVideoThumbnails}
			onchange={() => Settings.save()}
		/>
	</label>

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
</div>
