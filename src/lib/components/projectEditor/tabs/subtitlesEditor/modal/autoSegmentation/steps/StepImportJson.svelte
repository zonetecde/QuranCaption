<script lang="ts">
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { open } from '@tauri-apps/plugin-dialog';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onDestroy, onMount } from 'svelte';
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
	let isDragOver = $state(false);
	let unlistenDrop: (() => void) | null = null;

	/** Opens the official Hugging Face space page. */
	async function openHuggingFaceSpace(): Promise<void> {
		await openUrl('https://huggingface.co/spaces/hetchyy/Quran-multi-aligner');
	}

	/** Reads a dropped JSON file path and stores its content in the wizard state. */
	async function loadJsonFilePath(filePath: string): Promise<void> {
		const rawContent = await readTextFile(filePath);
		await wizard.loadImportedJsonPath(filePath, rawContent);
	}

	/** Opens a JSON picker and loads the selected file content. */
	async function browseJsonFile(): Promise<void> {
		const selection = await open({
			multiple: false,
			directory: false,
			filters: [{ name: 'JSON', extensions: ['json'] }]
		});
		if (!selection || Array.isArray(selection)) return;
		await loadJsonFilePath(selection);
	}

	/** Binds desktop drag-and-drop events through the Tauri webview API. */
	async function setupDragDrop(): Promise<void> {
		unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
			if (event.payload.type === 'over') {
				isDragOver = true;
				return;
			}
			if (event.payload.type === 'drop') {
				isDragOver = false;
				const [firstPath] = event.payload.paths ?? [];
				if (firstPath) void loadJsonFilePath(firstPath);
				return;
			}
			isDragOver = false;
		});
	}

	/** Removes drag-and-drop listener on component disposal. */
	function cleanupDragDrop(): void {
		unlistenDrop?.();
		unlistenDrop = null;
	}

	onMount(() => void setupDragDrop());
	onDestroy(cleanupDragDrop);
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">3. Import Hugging Face JSON</h3>
		<p class="text-sm text-thirdly">
			Drop the downloaded JSON file or paste its content, then click Add subtitles.
		</p>
	</div>

	<div class="space-y-3 rounded-xl border border-color bg-accent/50 p-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="text-sm font-semibold text-primary">Quran Multi-Aligner export</div>
			<button
				type="button"
				class="btn inline-flex items-center gap-1 px-3 py-1.5 text-xs"
				onclick={() => void openHuggingFaceSpace()}
			>
				<span class="material-icons text-sm">open_in_new</span>
				Open Hugging Face Space
			</button>
		</div>

		<div
			class="rounded-lg border border-dashed p-4 text-center text-sm transition-colors"
			class:border-accent-primary={isDragOver}
			class:bg-accent={isDragOver}
			class:border-color={!isDragOver}
		>
			<p class="text-secondary">Drag and drop your `.json` file in the app window</p>
			<button
				type="button"
				class="btn mt-3 px-3 py-1.5 text-xs"
				onclick={() => void browseJsonFile()}
			>
				Browse JSON file
			</button>
			{#if wizard.importedJsonFileName}
				<p class="mt-2 text-xs text-thirdly">Loaded file: {wizard.importedJsonFileName}</p>
			{/if}
		</div>

		<div class="space-y-2">
			<label for="hf-json-raw" class="text-xs uppercase tracking-wide text-thirdly"
				>Raw JSON content</label
			>
			<textarea
				id="hf-json-raw"
				class="h-48 w-full rounded-lg border border-color bg-primary p-3 text-xs text-secondary"
				placeholder="Paste JSON export content here"
				value={wizard.importedJsonRaw}
				oninput={(event) =>
					wizard.setImportedJsonRaw((event.currentTarget as HTMLTextAreaElement).value)}
			></textarea>
		</div>

		<div class="rounded-lg border border-color bg-primary/40 p-3 space-y-2">
			<label class="flex items-center gap-2 text-sm text-secondary"
				><input
					type="checkbox"
					checked={wizard.fillBySilence}
					onchange={(e) => wizard.setFillBySilence((e.currentTarget as HTMLInputElement).checked)}
					class="accent-accent-primary"
				/> Fill gaps with silence clips</label
			>
			{#if wizard.fillBySilence}
				<div class="flex items-center gap-2 text-sm text-secondary">
					<label for="import-extend-before-silence-ms" class="flex items-center gap-2"
						><input
							type="checkbox"
							checked={wizard.extendBeforeSilence}
							onchange={(e) =>
								wizard.setExtendBeforeSilence((e.currentTarget as HTMLInputElement).checked)}
							class="accent-accent-primary"
						/> Extend subtitle before silence by</label
					>
					<input
						id="import-extend-before-silence-ms"
						type="number"
						min="0"
						max="2000"
						step="10"
						value={wizard.extendBeforeSilenceMs}
						oninput={(e) =>
							wizard.setExtendBeforeSilenceMs(Number((e.currentTarget as HTMLInputElement).value))}
						disabled={!wizard.extendBeforeSilence}
						class="w-24 rounded border border-color bg-primary px-2 py-1 text-xs text-primary"
					/>
					<span>ms</span>
				</div>
			{/if}
		</div>

		{#if wizard.importedJsonParseError}
			<div
				class="rounded-lg border border-danger-color bg-danger-color/10 px-3 py-2 text-xs text-danger-color"
			>
				{wizard.importedJsonParseError}
			</div>
		{/if}
	</div>
</section>
