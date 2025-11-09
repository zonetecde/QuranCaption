<script lang="ts">
	import { CustomTextClip, StylePreset } from '$lib/classes';
	import { CustomClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import Settings from '$lib/classes/Settings.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import toast from 'svelte-5-french-toast';
	import { extractStyleSnapshotFromProject } from '$lib/services/StylePresetService';

	interface Props {
		isVisible: boolean;
	}

	let { isVisible = $bindable() }: Props = $props();
	let menuElement: HTMLDivElement | undefined = $state();

	// Fermer le menu en cliquant à l'extérieur
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Element;
		if (!target.closest('.import-export-menu') && !target.closest('.import-export-button')) {
			isVisible = false;
		}
	}

	// Calculer la position du menu
	function calculatePosition() {
		const button = document.querySelector('.import-export-button') as HTMLElement;
		if (!button || !menuElement) return;

		const buttonRect = button.getBoundingClientRect();
		const menuWidth = 320; // w-80 = 320px
		const padding = 11.5; // ml-2 = 8px

		// Positionner à droite du bouton
		menuElement.style.left = `${buttonRect.right + padding}px`;
		menuElement.style.top = `${buttonRect.top}px`;
	}

	// Recalculer la position quand le menu devient visible
	$effect(() => {
		if (isVisible && menuElement) {
			setTimeout(calculatePosition, 0);
		}
	});

	let includedExportClips = new Set<number>();

	async function saveCurrentStylesAsPreset() {
		if (!globalState.currentProject) {
			toast.error('Open a project before saving a style preset.');
			return;
		}

		if (!globalState.settings) {
			await Settings.load();
		}

		const presetName = await ModalManager.inputModal(
			'Choose a name for this style preset',
			globalState.currentProject.detail.name,
			80,
			'Preset name'
		);

		const trimmedName = presetName.trim();
		if (!trimmedName) {
			toast.error('Preset name cannot be empty.');
			return;
		}

		const snapshot = extractStyleSnapshotFromProject(globalState.currentProject);
		const preset = new StylePreset(trimmedName, globalState.currentProject.detail.id, snapshot);

		globalState.settings!.stylePresets.unshift(preset);
		globalState.settings!.lastUsedStylePresetId = preset.id.toString();

		await Settings.save();

		toast.success('Style preset saved for future projects.');
	}
</script>

<svelte:window on:click={handleClickOutside} />

{#if isVisible}
	<div
		bind:this={menuElement}
		class="import-export-menu shadow-2xl shadow-black bg-[var(--bg-secondary)] fixed w-80 border border-[var(--border-color)] rounded-lg z-50 p-4"
		transition:slide={{ duration: 200 }}
	>
		<!-- En-tête -->
		<div class="mb-4">
			<span class="text-sm font-medium text-[var(--text-primary)]">Import/Export Styles</span>
		</div>

		<div class="flex mb-4 items-center justify-center">
			<button
				class="btn px-3 py-2"
				onclick={async () => await globalState.getVideoStyle.resetStyles()}
			>
				Reset Project Styles
			</button>
		</div>

		<!-- Section Save Preset -->
		<div class="border border-[var(--border-color)] rounded-lg p-3">
			<h3 class="text-sm font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
				<span class="material-icons-outlined text-base">bookmark_add</span>
				Save Style Preset
			</h3>
			<p class="text-xs text-[var(--text-secondary)] mb-3">
				Store the current project styles as a reusable preset for future projects.
			</p>
			<button
				class="btn-accent w-full bg-[var(--accent-primary)] text-white px-3 py-2 rounded transition-colors text-sm"
				onclick={saveCurrentStylesAsPreset}
			>
				Save Preset
			</button>
		</div>

		<!-- Contenu du menu Import/Export -->
		<div class="space-y-4">
			<!-- Section Import -->
			<div class="border border-[var(--border-color)] rounded-lg p-3">
				<h3 class="text-sm font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
					<span class="material-icons-outlined text-base">file_download</span>
					Import Styles
				</h3>
				<p class="text-xs text-[var(--text-secondary)] mb-3">Load styles from a JSON file</p>
				<button
					class="btn-accent w-full bg-[var(--accent-primary)] text-white px-3 py-2 rounded transition-colors text-sm"
					onclick={() => globalState.getVideoStyle.importStylesFromFile()}
				>
					Choose File
				</button>
			</div>

			<!-- Section Export -->
			<div class="border border-[var(--border-color)] rounded-lg p-3 group">
				<h3 class="text-sm font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
					<span class="material-icons-outlined text-base">file_upload</span>
					Export Styles
				</h3>
				<p class="text-xs text-[var(--text-secondary)] mb-3">Save current styles to JSON file</p>

				<div
					class="opacity-0 max-h-0 overflow-hidden group-hover:opacity-100 group-hover:max-h-screen transition-all duration-300"
				>
					<div class="text-xs text-[var(--text-secondary)] mb-3">
						<p class="mb-2">
							The exported JSON will include all styles used in this video: the global style, the
							Arabic text style, and all translation styles.
						</p>

						{#if globalState.getCustomClipTrack.clips.length > 0}
							<p class="mb-2">
								You can optionally include custom text clips in the export. Select the clips you
								want to include below:
							</p>

							<div class="flex flex-col gap-2 px-2">
								{#each globalState.getCustomClipTrack.clips as customClip}
									{#if customClip instanceof CustomClip}
										<label class="flex items-center gap-x-2 cursor-pointer">
											<input
												type="checkbox"
												onchange={() => {
													if (includedExportClips.has(customClip.id)) {
														includedExportClips.delete(customClip.id);
													} else {
														includedExportClips.add(customClip.id);
													}
												}}
											/>
											{customClip.type === 'Custom Text'
												? customClip.category!.getStyle('text')?.value
												: customClip
														.category!.getStyle('filepath')
														?.value.toString()
														.split('\\')
														.pop()}
										</label>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<button
					class="btn w-full bg-black/20! text-[var(--text-primary)] px-3 py-2 rounded transition-colors hover:bg-[#30363d] border border-[var(--border-color)] text-sm"
					onclick={() => {
						const json = globalState.getVideoStyle.exportStyles(includedExportClips);
						// Télécharger le fichier JSON
						const blob = new Blob([json], { type: 'application/json' });
						const url = URL.createObjectURL(blob);
						const a = document.createElement('a');
						a.href = url;
						a.download = `exported_styles_${globalState.currentProject!.detail.name}.json`;
						a.click();
						URL.revokeObjectURL(url);
					}}
				>
					Export to File
				</button>
			</div>
		</div>
	</div>
{/if}
