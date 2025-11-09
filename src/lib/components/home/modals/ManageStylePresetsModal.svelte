<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import toast from 'svelte-5-french-toast';
	import ModalManager from '$lib/components/modals/ModalManager';

	const { resolve } = $props<{ resolve: () => void }>();

	const presets = $derived(() => globalState.settings?.stylePresets ?? []);

	function closeModal() {
		resolve();
	}

	async function save(message?: string) {
		await Settings.save();
		if (message) {
			toast.success(message);
		}
	}

	async function handleDelete(index: number) {
		const preset = presets()[index];
		if (!preset) return;
		const confirmed = await ModalManager.confirmModal(
			`Delete the style preset "${preset.name}"? This action cannot be undone.`
		);
		if (!confirmed) return;

		const settings = globalState.settings;
		if (!settings) return;

		const updated = settings.stylePresets.filter((_, i) => i !== index);
		settings.stylePresets = updated;

		if (settings.lastUsedStylePresetId === preset.id.toString()) {
			settings.lastUsedStylePresetId = null;
		}

		await save('Style preset deleted.');
	}

	function movePreset(index: number, direction: -1 | 1) {
		const targetIndex = index + direction;
		const settings = globalState.settings;
		if (!settings) return;

		if (targetIndex < 0 || targetIndex >= settings.stylePresets.length) return;

		const reordered = [...settings.stylePresets];
		const [item] = reordered.splice(index, 1);
		reordered.splice(targetIndex, 0, item);
		settings.stylePresets = reordered;

		void save();
	}
</script>

<div
	class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1200] px-4"
	onclick={closeModal}
>
	<div
		class="bg-secondary border border-color rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
		onclick={(event) => event.stopPropagation()}
	>
		<div class="border-b border-color px-6 py-4 flex items-center justify-between">
			<div>
				<h2 class="text-xl font-semibold text-primary">Manage Style Presets</h2>
				<p class="text-sm text-thirdly">
					Reorder or remove style presets saved in your preferences.
				</p>
			</div>
			<button
				class="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-secondary hover:text-primary"
				type="button"
				onclick={closeModal}
			>
				<span class="material-icons text-base">close</span>
			</button>
		</div>

		{#if presets().length === 0}
			<div class="px-6 py-8 text-center text-thirdly text-sm">
				You have not saved any style presets yet.
			</div>
		{:else}
			<div class="px-6 py-4 space-y-3 overflow-y-auto">
				{#each presets() as preset, index}
					<div
						class="border border-color rounded-xl px-4 py-3 flex items-center justify-between gap-4"
					>
						<div>
							<p class="text-primary font-semibold">{preset.name}</p>
							<p class="text-xs text-thirdly">
								{preset.sourceProjectId
									? `Copied from project #${preset.sourceProjectId}`
									: 'Custom preset'}
							</p>
							<p class="text-xs text-thirdly">
								Created on {new Date(preset.createdAt).toLocaleDateString()}
							</p>
						</div>

						<div class="flex items-center gap-2">
							<button
								class="icon-button"
								type="button"
								aria-label="Move up"
								disabled={index === 0}
								onclick={() => movePreset(index, -1)}
							>
								<span class="material-icons text-base">arrow_upward</span>
							</button>
							<button
								class="icon-button"
								type="button"
								aria-label="Move down"
								disabled={index === presets().length - 1}
								onclick={() => movePreset(index, 1)}
							>
								<span class="material-icons text-base">arrow_downward</span>
							</button>
							<button
								class="icon-button text-red-400 hover:text-red-200"
								type="button"
								aria-label="Delete"
								onclick={() => handleDelete(index)}
							>
								<span class="material-icons text-base">delete</span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<div
			class="border-t border-color px-6 py-4 flex items-center justify-end bg-primary rounded-b-2xl"
		>
			<button
				class="px-5 py-2 rounded-lg border border-color text-sm font-medium text-primary hover:bg-secondary/40"
				type="button"
				onclick={closeModal}
			>
				Close
			</button>
		</div>
	</div>
</div>

<style>
	.icon-button {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		border: 1px solid var(--border-color);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		transition:
			color 0.2s ease,
			border-color 0.2s ease;
	}

	.icon-button:hover:not(:disabled) {
		color: var(--primary);
		border-color: var(--accent-primary);
	}

	.icon-button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
</style>
