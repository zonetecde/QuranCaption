<script lang="ts">
	import { Batch } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { BatchService } from '$lib/services/BatchService';
	import { open } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { get } from 'svelte/store';
	import {
		parseBatchCsv,
		validateBatchName,
		validateBatchRows,
		type BatchCsvError,
		type BatchCsvErrorCode,
		type ValidatedBatchRow
	} from './batchCsv';

	let batchName = $state('');
	let fileName = $state('');
	let rows = $state<ValidatedBatchRow[]>([]);
	let errors = $state<BatchCsvError[]>([]);
	let isReading = $state(false);
	let isCreating = $state(false);
	let creationError = $state('');
	let batchNameError = $derived(validateBatchName(batchName));
	let canCreate = $derived(
		fileName !== '' && rows.length > 0 && errors.length === 0 && !batchNameError && !isCreating
	);

	/**
	 * Retourne à la homepage sans modifier les données importées.
	 * @returns {void}
	 */
	function backToHome(): void {
		globalState.currentPage = 'home';
	}

	/**
	 * Traduit un code d'erreur CSV en explication utilisateur.
	 * @param {BatchCsvErrorCode} code Code d'erreur à traduire.
	 * @returns {string} Message localisé.
	 */
	function getErrorMessage(code: BatchCsvErrorCode): string {
		const messages = get(LL).batch;
		switch (code) {
			case 'invalid-header':
				return messages.errorInvalidHeader();
			case 'missing-column':
				return messages.errorMissingColumn();
			case 'too-many-columns':
				return messages.errorTooManyColumns();
			case 'malformed-csv':
				return messages.errorMalformedCsv();
			case 'project-name-empty':
				return messages.errorProjectNameEmpty();
			case 'reciter-empty':
				return messages.errorReciterEmpty();
			case 'source-empty':
				return messages.errorSourceEmpty();
			case 'project-name-too-long':
				return messages.errorProjectNameTooLong();
			case 'reciter-too-long':
				return messages.errorReciterTooLong();
			case 'project-name-unsafe':
				return messages.errorProjectNameUnsafe();
			case 'reciter-unsafe':
				return messages.errorReciterUnsafe();
			case 'invalid-url':
				return messages.errorInvalidUrl();
			case 'file-not-found':
				return messages.errorFileNotFound();
			case 'unsupported-media':
				return messages.errorUnsupportedMedia();
		}
	}

	/**
	 * Ouvre, parse puis valide intégralement un fichier CSV de batch.
	 * @returns {Promise<void>} Promesse résolue après la prévisualisation.
	 */
	async function selectCsv(): Promise<void> {
		const selected = await open({
			multiple: false,
			directory: false,
			filters: [{ name: get(LL).batch.csvFile(), extensions: ['csv'] }]
		});
		if (!selected) return;

		isReading = true;
		creationError = '';
		try {
			const filePath = Array.isArray(selected) ? selected[0] : selected;
			fileName = filePath.split(/[\\/]/).at(-1) ?? filePath;
			batchName = fileName.replace(/\.csv$/i, '');
			const parsed = parseBatchCsv(await readTextFile(filePath));
			const validated = await validateBatchRows(parsed.rows);
			rows = validated.rows;
			errors = [...parsed.errors, ...validated.errors];
		} catch (error) {
			rows = [];
			errors = [];
			creationError = get(LL).batch.readFailed({ error: String(error) });
		} finally {
			isReading = false;
		}
	}

	/**
	 * Crée le batch et ses projets après une validation sans erreur.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture du workspace.
	 */
	async function createBatch(): Promise<void> {
		if (!canCreate) return;
		isCreating = true;
		creationError = '';
		try {
			const batch = await BatchService.createBatch(batchName, rows);
			globalState.currentBatchId = batch.id;
			globalState.currentPage = 'batch-workspace';
		} catch (error) {
			creationError = get(LL).batch.createFailed({ error: String(error) });
		} finally {
			isCreating = false;
		}
	}
</script>

<div class="min-h-full px-4 py-8 xl:px-12 xl:py-12">
	<div class="mx-auto max-w-7xl space-y-7">
		<header class="flex flex-wrap items-center gap-4">
			<button class="btn btn-icon h-10 px-4" type="button" onclick={backToHome}>
				<span class="material-icons-outlined mr-2">arrow_back</span>
				{$LL.batch.backToHome()}
			</button>
			<div>
				<h1 class="text-3xl font-bold text-[var(--text-primary)]">{$LL.batch.importTitle()}</h1>
				<p class="mt-1 text-[var(--text-secondary)]">{$LL.batch.importDescription()}</p>
			</div>
		</header>

		<section
			class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-xl"
		>
			<div class="grid gap-6 lg:grid-cols-2">
				<div class="space-y-2">
					<label for="batch-name" class="text-sm font-semibold text-[var(--text-primary)]">
						{$LL.batch.batchName()}
					</label>
					<input
						id="batch-name"
						type="text"
						class="w-full"
						bind:value={batchName}
						maxlength={Batch.NAME_MAX_LENGTH}
						placeholder={$LL.batch.batchNamePlaceholder()}
					/>
					{#if fileName && batchNameError}
						<p class="text-sm text-red-400">
							{batchNameError === 'empty'
								? $LL.batch.errorBatchNameEmpty()
								: batchNameError === 'too-long'
									? $LL.batch.errorBatchNameTooLong()
									: $LL.batch.errorBatchNameUnsafe()}
						</p>
					{/if}
				</div>

				<div class="space-y-2">
					<p class="text-sm font-semibold text-[var(--text-primary)]">{$LL.batch.csvFile()}</p>
					<button
						class="btn btn-icon h-11 px-5"
						type="button"
						onclick={selectCsv}
						disabled={isReading}
					>
						<span class="material-icons-outlined mr-2">upload_file</span>
						{isReading ? $LL.batch.readingCsv() : $LL.batch.selectCsv()}
					</button>
					<p class="truncate text-sm text-[var(--text-secondary)]">
						{fileName || $LL.batch.noCsvSelected()}
					</p>
				</div>
			</div>
			<p class="mt-5 rounded-xl bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
				{$LL.batch.csvFormatHelp()}
			</p>
		</section>

		{#if creationError}
			<p class="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-300">
				{creationError}
			</p>
		{/if}

		{#if errors.length > 0}
			<section class="rounded-2xl border border-red-400/40 bg-red-400/10 p-5">
				<h2 class="font-semibold text-red-300">{$LL.batch.validationErrors()}</h2>
				<ul class="mt-3 space-y-1 text-sm text-red-200">
					{#each errors as error, index (`${error.line}-${error.code}-${index}`)}
						<li>
							{$LL.batch.lineError({ line: error.line, message: getErrorMessage(error.code) })}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if fileName}
			<section
				class="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]"
			>
				<div
					class="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4"
				>
					<h2 class="text-xl font-semibold text-[var(--text-primary)]">{$LL.batch.preview()}</h2>
					<span class="text-sm text-[var(--text-secondary)]">
						{$LL.batch.projectsCount({ count: rows.length })}
					</span>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="bg-[var(--bg-accent)] text-[var(--text-secondary)]">
							<tr>
								<th class="px-4 py-3">#</th>
								<th class="px-4 py-3">{$LL.batch.project()}</th>
								<th class="px-4 py-3">{$LL.batch.reciter()}</th>
								<th class="px-4 py-3">{$LL.batch.sourceType()}</th>
								<th class="px-4 py-3">{$LL.batch.source()}</th>
								<th class="px-4 py-3">{$LL.batch.validationStatus()}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-color)]">
							{#each rows as row (row.order)}
								<tr>
									<td class="px-4 py-3 text-[var(--text-thirdly)]">{row.order}</td>
									<td class="px-4 py-3 text-[var(--text-primary)]">{row.projectName}</td>
									<td class="px-4 py-3 text-[var(--text-secondary)]">{row.reciter}</td>
									<td class="px-4 py-3 text-[var(--text-secondary)]">
										{row.batchSource.kind === 'url'
											? $LL.batch.urlSource()
											: $LL.batch.localFileSource()}
									</td>
									<td
										class="max-w-96 truncate px-4 py-3 text-[var(--text-secondary)]"
										title={row.source}
									>
										{row.source}
									</td>
									<td class="px-4 py-3">
										<span class={row.errors.length ? 'text-red-400' : 'text-green-400'}>
											{row.errors.length ? $LL.batch.invalid() : $LL.batch.valid()}
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<div class="flex justify-end">
			<button
				class="btn-accent btn-icon h-12 px-7"
				type="button"
				onclick={createBatch}
				disabled={!canCreate}
			>
				<span class="material-icons-outlined mr-2">dynamic_feed</span>
				{isCreating ? $LL.batch.creatingBatch() : $LL.batch.createBatch()}
			</button>
		</div>
	</div>
</div>
