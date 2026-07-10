<script lang="ts">
	import type { FadeValue } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import LL from '$lib/i18n/i18n-svelte';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';
	import { asFadeValue, hasFadeEnabled } from './utils';

	let { value, onChange }: { value: StyleControlValue; onChange: ApplyStyleControlValue } =
		$props();
	const fadeValue = $derived(asFadeValue(value));

	/**
	 * Applique une modification partielle à la configuration de fondu.
	 * @param {Partial<FadeValue>} partial Champs à remplacer.
	 * @returns {void}
	 */
	function updateFadeValue(partial: Partial<FadeValue>): void {
		onChange({ ...fadeValue, ...partial });
	}
</script>

<div class="flex flex-col gap-4">
	<div class="rounded-md bg-gray-100 p-2 dark:bg-gray-800">
		<p class="text-sm text-gray-700 dark:text-gray-300">
			Note: Fade effects are applied only to exported videos and will not appear in the preview.
		</p>
	</div>

	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium">Fade In:</p>
		<div class="flex gap-4">
			<label class="flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					class="accent-accent"
					checked={fadeValue.videoFadeInEnabled}
					onchange={(event) =>
						updateFadeValue({ videoFadeInEnabled: (event.target as HTMLInputElement).checked })}
				/>
				<span class="material-icons-outlined text-[18px]! text-secondary">movie</span>
				<span class="text-sm">{$LL.editor.videoFadeLabel()}</span>
			</label>
			<label class="flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					class="accent-accent"
					checked={fadeValue.audioFadeInEnabled}
					onchange={(event) =>
						updateFadeValue({ audioFadeInEnabled: (event.target as HTMLInputElement).checked })}
				/>
				<span class="material-icons-outlined text-[18px]! text-secondary">graphic_eq</span>
				<span class="text-sm">{$LL.editor.audioFadeLabel()}</span>
			</label>
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium">Fade Out:</p>
		<div class="flex gap-4">
			<label class="flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					class="accent-accent"
					checked={fadeValue.videoFadeOutEnabled}
					onchange={(event) =>
						updateFadeValue({ videoFadeOutEnabled: (event.target as HTMLInputElement).checked })}
				/>
				<span class="material-icons-outlined text-[18px]! text-secondary">movie</span>
				<span class="text-sm">{$LL.editor.videoFadeLabel()}</span>
			</label>
			<label class="flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					class="accent-accent"
					checked={fadeValue.audioFadeOutEnabled}
					onchange={(event) =>
						updateFadeValue({ audioFadeOutEnabled: (event.target as HTMLInputElement).checked })}
				/>
				<span class="material-icons-outlined text-[18px]! text-secondary">graphic_eq</span>
				<span class="text-sm">{$LL.editor.audioFadeLabel()}</span>
			</label>
		</div>
	</div>

	{#if hasFadeEnabled(fadeValue)}
		<div class="flex flex-col gap-2">
			<p class="text-sm font-medium">Fade Duration:</p>
			<input
				type="number"
				class="w-full"
				min="0"
				max="10000"
				step="100"
				value={fadeValue.fadeDurationMs}
				oninput={(event) =>
					updateFadeValue({
						fadeDurationMs: Math.max(
							0,
							parseInt((event.target as HTMLInputElement).value || '0', 10)
						)
					})}
			/>
		</div>
	{/if}
</div>
