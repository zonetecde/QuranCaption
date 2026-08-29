<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		appendTimedOverlayRange,
		getTimedOverlayRanges,
		updateTimedOverlayRange,
		type TimedOverlayRange
	} from '$lib/services/TimedOverlayRanges';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';
	import { msToTimeValue } from './utils';

	let { value, onChange }: { value: StyleControlValue; onChange: ApplyStyleControlValue } =
		$props();

	const ranges = $derived(() => getTimedOverlayRanges(value, 0, 10000));

	/**
	 * Convertit la valeur d'un input temporel en millisecondes.
	 * @param {string} value Valeur au format HH:mm:ss.
	 * @returns {number} Temps en millisecondes.
	 */
	function parseTimeValue(value: string): number {
		const [hours, minutes, seconds] = value.split(':').map(Number);
		return (hours * 3600 + minutes * 60 + seconds) * 1000;
	}

	/**
	 * Applique une borne en conservant la durée minimale de la plage.
	 * @param {number} index Index de la plage modifiée.
	 * @param {'startTime' | 'endTime'} field Borne modifiée.
	 * @param {number} value Nouvelle valeur en millisecondes.
	 * @returns {void}
	 */
	function applyRangeValue(index: number, field: 'startTime' | 'endTime', value: number): void {
		onChange(updateTimedOverlayRange(ranges(), index, field, value));
	}

	/**
	 * Applique le temps courant du curseur à une borne.
	 * @param {number} index Index de la plage modifiée.
	 * @param {'startTime' | 'endTime'} field Borne modifiée.
	 * @returns {void}
	 */
	function applyPreviewCursor(index: number, field: 'startTime' | 'endTime'): void {
		applyRangeValue(index, field, globalState.getTimelineState.cursorPosition);
	}

	/**
	 * Supprime une apparition tout en conservant au moins une plage éditable.
	 * @param {number} index Index de la plage à supprimer.
	 * @returns {void}
	 */
	function removeRange(index: number): void {
		if (ranges().length <= 1) return;
		onChange(ranges().filter((_range, rangeIndex) => rangeIndex !== index));
	}

	/**
	 * Ajoute une nouvelle apparition après la dernière plage.
	 * @returns {void}
	 */
	function addRange(): void {
		onChange(appendTimedOverlayRange(ranges()));
	}
</script>

<div class="flex flex-col gap-2">
	{#each ranges() as range, index (index)}
		<div class="rounded-md border border-[var(--border-color)]/60 bg-[var(--bg-accent)]/30 p-2">
			<div class="mb-2 flex items-center justify-between">
				<span class="text-xs font-semibold text-secondary">#{index + 1}</span>
				{#if ranges().length > 1}
					<button
						type="button"
						class="grid size-6 place-items-center rounded text-secondary hover:bg-[var(--bg-accent)] hover:text-danger-color"
						title={$LL.common.remove()}
						aria-label={$LL.common.remove()}
						onclick={() => removeRange(index)}
					>
						<span class="material-icons-outlined text-[15px]!">delete_outline</span>
					</button>
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-2">
				{#each [['startTime', $LL.editor.startTimeLabel()], ['endTime', $LL.editor.endTimeLabel()]] as [field, label]}
					{@const inputId = `timed-range-${index}-${field}`}
					<div class="flex min-w-0 flex-col gap-1">
						<label for={inputId} class="text-[11px] text-secondary">{label}</label>
						<div class="flex items-center gap-1">
							<input
								id={inputId}
								type="time"
								class="min-w-0 w-full"
								value={msToTimeValue(range[field as keyof TimedOverlayRange] as number)}
								oninput={(event) =>
									applyRangeValue(
										index,
										field as 'startTime' | 'endTime',
										parseTimeValue((event.target as HTMLInputElement).value)
									)}
							/>
							<button
								type="button"
								class="grid size-7 shrink-0 place-items-center rounded text-secondary hover:bg-[var(--bg-accent)] hover:text-primary"
								title={$LL.editor.usePreviewCursorTime()}
								aria-label={$LL.editor.usePreviewCursorTime()}
								onclick={() => applyPreviewCursor(index, field as 'startTime' | 'endTime')}
							>
								<span class="material-icons-outlined text-[16px]!">my_location</span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}

	<button
		type="button"
		class="btn-accent flex items-center justify-center gap-1 py-1.5 text-xs"
		onclick={addRange}
	>
		<span class="material-icons-outlined text-[16px]!">add</span>
		{$LL.translations.add()}
	</button>
</div>
