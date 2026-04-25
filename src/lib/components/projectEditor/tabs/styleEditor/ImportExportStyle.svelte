<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import ExportFileService from '$lib/services/ExportFileService';
	import ModalManager from '$lib/components/modals/ModalManager';
	import Settings, { type SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
	import type { VideoStyleFileData } from '$lib/classes/VideoStyle.svelte';
	import StylePresetSaveExportModal from './StylePresetSaveExportModal.svelte';
	import { slide } from 'svelte/transition';
	import toast from 'svelte-5-french-toast';

	interface Props {
		isVisible: boolean;
	}

	type ModalMode = 'save' | 'export';
	type DimensionValue = { width: number; height: number };

	let { isVisible = $bindable() }: Props = $props();
	let menuElement: HTMLDivElement | undefined = $state();
	let searchQuery = $state('');
	let modalMode: ModalMode | null = $state(null);

	let presets = $derived(() => globalState.settings?.savedVideoStylePresets ?? []);
	let filteredPresets = $derived(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return presets();
		return presets().filter((preset) => preset.name.toLowerCase().includes(query));
	});

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Element;
		if (
			!target.closest('.import-export-menu') &&
			!target.closest('.import-export-button') &&
			!target.closest('.style-preset-modal')
		) {
			isVisible = false;
		}
	}

	function openStylePresetModal(mode: ModalMode) {
		modalMode = mode;
	}

	function closeStylePresetModal() {
		modalMode = null;
	}

	function calculatePosition() {
		const button = document.querySelector('.import-export-button') as HTMLElement;
		if (!button || !menuElement) return;

		const buttonRect = button.getBoundingClientRect();
		const padding = 11.5;
		const verticalOffset = 16;

		menuElement.style.left = `${buttonRect.right + padding}px`;
		menuElement.style.top = `${Math.max(padding, buttonRect.top - verticalOffset)}px`;
	}

	$effect(() => {
		if (isVisible && menuElement) {
			setTimeout(calculatePosition, 0);
		}
	});

	function getCurrentResolution(): DimensionValue {
		const value = globalState.getStyle('global', 'video-dimension')?.value;
		if (
			typeof value === 'object' &&
			value !== null &&
			'width' in value &&
			'height' in value &&
			typeof (value as DimensionValue).width === 'number' &&
			typeof (value as DimensionValue).height === 'number'
		) {
			return value as DimensionValue;
		}

		return { width: 1920, height: 1080 };
	}

	function getResolutionLabel(resolution: DimensionValue): string {
		const { width, height } = resolution;
		const minDimension = Math.min(width, height);
		const orientation = width >= height ? 'Landscape' : 'Portrait';
		const standardQualities: Record<number, string> = {
			720: '720p',
			1080: '1080p',
			1440: '1440p',
			2160: '2160p'
		};

		if (standardQualities[minDimension]) {
			return `${standardQualities[minDimension]} ${orientation}`;
		}

		return `${width}x${height}`;
	}

	function buildStyleData(includedClipIds: Set<number>): VideoStyleFileData {
		return globalState.getVideoStyle.exportStylesData(includedClipIds);
	}

	function buildPreset(name: string, includedClipIds: Set<number>): SavedVideoStylePreset {
		const now = new Date().toISOString();
		return {
			id: Date.now() + Math.floor(Math.random() * 1000),
			name,
			createdAt: now,
			updatedAt: now,
			resolution: getCurrentResolution(),
			data: buildStyleData(includedClipIds)
		};
	}

	function getDefaultPresetName(): string {
		const projectName = ExportFileService.getProjectNameForFile();
		return projectName ? `${projectName} style` : 'Video style';
	}

	function getExportFileName(name: string): string {
		const safeName = name
			.trim()
			.replace(/[<>:"/\\|?*]+/g, '-')
			.replace(/\s+/g, '_');
		return `exported_styles_${safeName || ExportFileService.getProjectNameForFile()}.json`;
	}

	async function savePreset(name: string, includedClipIds: Set<number>) {
		const settings = globalState.settings ?? new Settings();
		if (!globalState.settings) globalState.settings = settings;

		const existingIndex = settings.savedVideoStylePresets.findIndex(
			(preset) => preset.name.trim().toLowerCase() === name.trim().toLowerCase()
		);
		const nextPreset = buildPreset(name.trim(), includedClipIds);
		const nextPresets = [...settings.savedVideoStylePresets];

		if (existingIndex !== -1) {
			const confirmed = await ModalManager.confirmModal(
				`A preset named "${name}" already exists. Replace it?`,
				false
			);
			if (!confirmed) return;

			const existing = nextPresets[existingIndex];
			nextPresets.splice(existingIndex, 1, {
				...nextPreset,
				id: existing.id,
				createdAt: existing.createdAt
			});
		} else {
			nextPresets.unshift(nextPreset);
		}

		settings.savedVideoStylePresets = nextPresets;
		await Settings.save();
		closeStylePresetModal();
		toast.success('Style preset saved.');
	}

	async function exportJson(name: string, includedClipIds: Set<number>) {
		const json = JSON.stringify(buildStyleData(includedClipIds), null, 2);
		await ExportFileService.saveTextFile(getExportFileName(name), json, 'Styles');
		closeStylePresetModal();
		toast.success('Style JSON exported.');
	}

	async function applyPreset(preset: SavedVideoStylePreset) {
		const confirmed = await ModalManager.confirmModal(
			`Your current styles will be overwritten by "${preset.name}".`,
			false
		);
		if (!confirmed) return;

		await globalState.getVideoStyle.importStyles(preset.data);
		isVisible = false;
		toast.success('Style preset applied.');
	}

	async function deletePreset(preset: SavedVideoStylePreset) {
		const confirmed = await ModalManager.confirmModal(`Delete "${preset.name}"?`, false);
		if (!confirmed || !globalState.settings) return;

		globalState.settings.savedVideoStylePresets =
			globalState.settings.savedVideoStylePresets.filter((item) => item.id !== preset.id);
		await Settings.save();
		toast.success('Style preset deleted.');
	}
</script>

<svelte:window on:click={handleClickOutside} />

{#if isVisible}
	<div
		bind:this={menuElement}
		class="import-export-menu fixed z-50 w-80 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 shadow-2xl shadow-black"
		transition:slide={{ duration: 200 }}
	>
		<div class="mb-3 flex items-center justify-between gap-2">
			<div class="flex min-w-0 items-center gap-2">
				<span class="material-icons-outlined text-base text-accent-primary">style</span>
				<span class="truncate text-sm font-semibold text-[var(--text-primary)]">Styles</span>
			</div>
			<span class="text-[11px] text-thirdly">{presets().length}</span>
		</div>

		<label class="relative mb-3 block">
			<span
				class="material-icons-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-thirdly"
			>
				search
			</span>
			<input
				bind:value={searchQuery}
				class="h-8 w-full rounded-md border border-color bg-primary py-1 pl-8 pr-2 text-xs text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
				type="search"
				placeholder="Search presets"
			/>
		</label>

		<div class="max-h-60 overflow-y-auto rounded-lg border border-color bg-primary/40 p-1">
			{#if filteredPresets().length === 0}
				<div class="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
					<span class="material-icons-outlined text-xl text-thirdly">folder_open</span>
					<p class="text-xs text-thirdly">
						{presets().length === 0 ? 'No saved presets' : 'No presets found'}
					</p>
				</div>
			{:else}
				<div class="space-y-1">
					{#each filteredPresets() as preset (preset.id)}
						<div
							class="group flex min-h-10 w-full items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-black/30"
						>
							<button
								class="flex min-w-0 flex-1 items-center gap-2 rounded pr-1 py-1 text-left focus:outline-none"
								type="button"
								onclick={() => applyPreset(preset)}
								title={preset.name}
							>
								<span
									class="material-icons-outlined shrink-0 text-base! text-secondary group-hover:text-primary"
								>
									description
								</span>
								<span class="min-w-0 flex-1 truncate text-xs font-medium text-primary">
									{preset.name}
								</span>
								<span
									class="shrink-0 rounded border border-color bg-accent px-1.5 py-0.5 text-[10px] leading-4 text-secondary"
								>
									{getResolutionLabel(preset.resolution)}
								</span>
							</button>
							<button
								class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-thirdly opacity-70 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
								type="button"
								title="Delete preset"
								onclick={() => deletePreset(preset)}
							>
								<span class="material-icons-outlined text-sm">delete</span>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="mt-3">
			<button
				class="btn-accent flex h-9 w-full items-center justify-center gap-2 px-3 text-sm font-medium"
				type="button"
				onclick={() => openStylePresetModal('save')}
			>
				<span class="material-icons-outlined text-base">add</span>
				Save preset
			</button>
		</div>

		<div class="mt-3 flex items-center justify-center gap-3 border-t border-color pt-2 text-[11px]">
			<button
				class="text-thirdly underline underline-offset-2 transition-colors hover:text-primary"
				type="button"
				onclick={() => globalState.getVideoStyle.importStylesFromFile()}
			>
				Choose file
			</button>
			<span class="text-thirdly">/</span>
			<button
				class="text-thirdly underline underline-offset-2 transition-colors hover:text-primary"
				type="button"
				onclick={() => openStylePresetModal('export')}
			>
				Export file
			</button>
			<span class="text-thirdly">/</span>
			<button
				class="text-thirdly underline underline-offset-2 transition-colors hover:text-primary"
				type="button"
				onclick={async () => {
					await globalState.getVideoStyle.resetStyles();
					isVisible = false;
				}}
			>
				Reset Styles
			</button>
		</div>
	</div>
{/if}

{#if modalMode}
	<div
		class="style-preset-modal modal-wrapper"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) closeStylePresetModal();
		}}
	>
		<StylePresetSaveExportModal
			mode={modalMode}
			defaultName={getDefaultPresetName()}
			close={closeStylePresetModal}
			onSavePreset={savePreset}
			onExportJson={exportJson}
		/>
	</div>
{/if}
