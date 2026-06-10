<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import { subdivideLongSubtitleSegments } from '$lib/services/AutoSegmentation';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);

	let hasWbwTimestamps = $derived(
		globalState.currentProject ? globalState.getSubtitleTrack.hasWordByWordTimestamps() : false
	);

	const SUBDIVIDE_MIN_LIMIT = 1;
	const SUBDIVIDE_MAX_LIMIT = 30;
	const SUBDIVIDE_DISABLED_SENTINEL = SUBDIVIDE_MAX_LIMIT + 1;
	let enableMaxWords = $state(
		globalState.getSubtitlesEditorState.subdivideMaxWordsPerSegment < SUBDIVIDE_MAX_LIMIT
	);
	let enableMaxDuration = $state(
		globalState.getSubtitlesEditorState.subdivideMaxDurationPerSegment < SUBDIVIDE_MAX_LIMIT
	);
	let lastEnabledMaxWords = $state(SUBDIVIDE_MAX_LIMIT);
	let lastEnabledMaxDuration = $state(SUBDIVIDE_MAX_LIMIT);

	/**
	 * Lance la subdivision automatique des segments longs selon les critères actifs.
	 */
	async function handleSubdivideLongSegments(): Promise<void> {
		if (!hasWbwTimestamps) {
			toast.error(LL_.editor.atLeastOneWbwRequired());
			return;
		}

		const splitCount = await subdivideLongSubtitleSegments();
		if (splitCount <= 0) {
			toast(LL_.editor.noSubtitlesMatchSplitRules());
			return;
		}

		toast.success(LL_.editor.splitApplied({ count: splitCount, plural: splitCount > 1 ? 's were' : ' was' }));
	}

	$effect(() => {
		const state = globalState.getSubtitlesEditorState;
		const currentValue = state.subdivideMaxWordsPerSegment;

		if (!enableMaxWords) {
			if (currentValue >= SUBDIVIDE_MIN_LIMIT && currentValue <= SUBDIVIDE_MAX_LIMIT) {
				lastEnabledMaxWords = currentValue;
			}
			state.subdivideMaxWordsPerSegment = SUBDIVIDE_DISABLED_SENTINEL;
			return;
		}

		const fallbackValue =
			lastEnabledMaxWords >= SUBDIVIDE_MIN_LIMIT && lastEnabledMaxWords <= SUBDIVIDE_MAX_LIMIT
				? lastEnabledMaxWords
				: SUBDIVIDE_MAX_LIMIT;
		const restoredValue =
			currentValue < SUBDIVIDE_MIN_LIMIT || currentValue > SUBDIVIDE_MAX_LIMIT
				? fallbackValue
				: currentValue;
		const clampedValue = Math.min(
			SUBDIVIDE_MAX_LIMIT,
			Math.max(SUBDIVIDE_MIN_LIMIT, restoredValue)
		);
		state.subdivideMaxWordsPerSegment = clampedValue;
		lastEnabledMaxWords = clampedValue;
	});

	$effect(() => {
		const state = globalState.getSubtitlesEditorState;
		const currentValue = state.subdivideMaxDurationPerSegment;

		if (!enableMaxDuration) {
			if (currentValue >= SUBDIVIDE_MIN_LIMIT && currentValue <= SUBDIVIDE_MAX_LIMIT) {
				lastEnabledMaxDuration = currentValue;
			}
			state.subdivideMaxDurationPerSegment = SUBDIVIDE_DISABLED_SENTINEL;
			return;
		}

		const fallbackValue =
			lastEnabledMaxDuration >= SUBDIVIDE_MIN_LIMIT && lastEnabledMaxDuration <= SUBDIVIDE_MAX_LIMIT
				? lastEnabledMaxDuration
				: SUBDIVIDE_MAX_LIMIT;
		const restoredValue =
			currentValue < SUBDIVIDE_MIN_LIMIT || currentValue > SUBDIVIDE_MAX_LIMIT
				? fallbackValue
				: currentValue;
		const clampedValue = Math.min(
			SUBDIVIDE_MAX_LIMIT,
			Math.max(SUBDIVIDE_MIN_LIMIT, restoredValue)
		);
		state.subdivideMaxDurationPerSegment = clampedValue;
		lastEnabledMaxDuration = clampedValue;
	});
</script>

{#if hasWbwTimestamps}
	<div class="bg-accent rounded-lg p-4 space-y-4">
		<p class="text-sm font-medium text-primary">{$LL.editor.splitLongSubtitlesLabel()}</p>
		<p class="text-xs text-secondary">
			{$LL.editor.splitWbwRequired()}
		</p>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs text-primary">{$LL.editor.maxWordsPerSegment()}</span>
				<div class="flex items-center gap-2">
					<label class="flex items-center gap-1.5 text-[11px] text-secondary">
						<input type="checkbox" bind:checked={enableMaxWords} class="w-4 h-4" />
						{$LL.common.on()}
					</label>
					{#if enableMaxWords}
						<input
							type="number"
							min={SUBDIVIDE_MIN_LIMIT}
							max={SUBDIVIDE_MAX_LIMIT}
							bind:value={globalState.getSubtitlesEditorState.subdivideMaxWordsPerSegment}
							class="w-16 rounded-md border border-color bg-secondary px-1.5 py-0.5 text-xs text-primary"
						/>
					{/if}
				</div>
			</div>
			{#if enableMaxWords}
				<input
					type="range"
					min={SUBDIVIDE_MIN_LIMIT}
					max={SUBDIVIDE_MAX_LIMIT}
					step="1"
					bind:value={globalState.getSubtitlesEditorState.subdivideMaxWordsPerSegment}
					class="w-full"
				/>
				<div class="flex items-center justify-between text-[10px] text-thirdly">
					<span>{SUBDIVIDE_MIN_LIMIT}</span>
					<span>{SUBDIVIDE_MAX_LIMIT}</span>
				</div>
			{/if}
		</div>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs text-primary">{$LL.editor.maxDurationPerSegment()}</span>
				<div class="flex items-center gap-2">
					<label class="flex items-center gap-1.5 text-[11px] text-secondary">
						<input type="checkbox" bind:checked={enableMaxDuration} class="w-4 h-4" />
						{$LL.common.on()}
					</label>
					{#if enableMaxDuration}
						<input
							type="number"
							min={SUBDIVIDE_MIN_LIMIT}
							max={SUBDIVIDE_MAX_LIMIT}
							bind:value={globalState.getSubtitlesEditorState.subdivideMaxDurationPerSegment}
							class="w-16 rounded-md border border-color bg-secondary py-0.5 text-xs text-primary"
						/>
					{/if}
				</div>
			</div>
			{#if enableMaxDuration}
				<input
					type="range"
					min={SUBDIVIDE_MIN_LIMIT}
					max={SUBDIVIDE_MAX_LIMIT}
					step="1"
					bind:value={globalState.getSubtitlesEditorState.subdivideMaxDurationPerSegment}
					class="w-full"
				/>
				<div class="flex items-center justify-between text-[10px] text-thirdly">
					<span>{SUBDIVIDE_MIN_LIMIT}</span>
					<span>{SUBDIVIDE_MAX_LIMIT}</span>
				</div>
			{/if}
		</div>

		<label class="flex items-start gap-2 cursor-pointer">
			<input
				type="checkbox"
				bind:checked={globalState.getSubtitlesEditorState.subdivideOnlySplitAtStopSigns}
				class="mt-0.5 w-4 h-4"
			/>
			<span class="space-y-1">
				<span class="block text-sm text-primary">{$LL.editor.onlySplitAtStopSigns()}</span>
				<span class="block text-xs text-thirdly">
					{$LL.editor.waqfDescription()}
				</span>
			</span>
		</label>

		<button
			class="btn-accent w-full px-3 py-2 rounded-md text-sm flex items-center justify-center gap-2"
			type="button"
			onclick={handleSubdivideLongSegments}
		>
			<span class="material-icons text-base">call_split</span>
			{$LL.editor.split()}
		</button>
	</div>
{/if}
