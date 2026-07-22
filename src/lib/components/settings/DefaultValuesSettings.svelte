<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import { DEFAULT_EXPORT_FILE_NAME_FORMAT } from '$lib/constants/export';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';

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
		}
	);

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
</script>

<div class="space-y-5">
	<div class="space-y-2">
		<h3 class="text-lg font-medium text-primary">{copy.defaultValues()}</h3>
		<p class="text-sm text-thirdly">{copy.defaultValuesDescription()}</p>
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
</div>
