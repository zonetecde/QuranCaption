<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { CustomClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';

	type ModalMode = 'save' | 'export';

	let {
		mode,
		defaultName,
		close,
		onSavePreset,
		onExportJson
	}: {
		mode: ModalMode;
		defaultName: string;
		close: () => void;
		onSavePreset: (name: string, includedClipIds: Set<number>) => Promise<void>;
		onExportJson: (name: string, includedClipIds: Set<number>) => Promise<void>;
	} = $props();

	let input: HTMLInputElement | undefined = $state(undefined);
	let presetName = $state('');
	let includedClipIds = $state(new Set<number>());
	let isBusy = $state(false);

	let customClips = $derived(() =>
		globalState.getCustomClipTrack.clips.filter(
			(clip): clip is CustomClip => clip instanceof CustomClip
		)
	);
	let canSubmit = $derived(() => presetName.trim().length > 0 && !isBusy);
	let primaryLabel = $derived(() => (mode === 'save' ? 'Save preset' : 'Export JSON'));
	let secondaryLabel = $derived(() => (mode === 'save' ? 'Export JSON' : 'Save preset'));

	onMount(() => {
		presetName = defaultName;
		input?.focus();
		input?.select();
	});

	function toggleClip(clipId: number) {
		const next = new Set(includedClipIds);
		if (next.has(clipId)) {
			next.delete(clipId);
		} else {
			next.add(clipId);
		}
		includedClipIds = next;
	}

	function getClipLabel(clip: CustomClip): string {
		if (clip.type === 'Custom Text') {
			return String(clip.category?.getStyle('text')?.value || 'Custom text');
		}

		const filePath = String(clip.category?.getStyle('filepath')?.value || '');
		return filePath.split(/[\\/]/).pop() || 'Custom image';
	}

	async function submit(action: ModalMode) {
		if (!canSubmit()) return;

		isBusy = true;
		try {
			const name = presetName.trim();
			const selectedIds = new Set(includedClipIds);
			if (action === 'save') {
				await onSavePreset(name, selectedIds);
			} else {
				await onExportJson(name, selectedIds);
			}
		} finally {
			isBusy = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close();
		} else if (event.key === 'Enter' && event.ctrlKey) {
			void submit(mode);
		}
	}
</script>

<div
	class="w-[520px] max-w-[92vw] overflow-hidden rounded-2xl border border-color bg-secondary shadow-2xl shadow-black/60"
	transition:slide={{ duration: 180 }}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onkeydown={handleKeydown}
>
	<div class="flex items-center justify-between gap-4 border-b border-color bg-primary px-5 py-4">
		<div class="flex min-w-0 items-center gap-3">
			<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
				<span class="material-icons-outlined text-lg text-accent-primary">style</span>
			</div>
			<div class="min-w-0">
				<h2 class="truncate text-base font-semibold text-primary">Style preset</h2>
				<p class="text-xs text-secondary">
					{mode === 'save' ? 'Save current video styles' : 'Export current video styles'}
				</p>
			</div>
		</div>
		<button
			class="flex h-8 w-8 items-center justify-center rounded-md text-secondary transition-colors hover:bg-secondary hover:text-primary"
			type="button"
			onclick={close}
			aria-label="Close"
		>
			<span class="material-icons-outlined text-lg">close</span>
		</button>
	</div>

	<div class="space-y-4 px-5 py-4">
		<label class="block space-y-2">
			<span class="text-xs font-medium uppercase text-thirdly">Name</span>
			<input
				bind:this={input}
				bind:value={presetName}
				class="w-full"
				type="text"
				maxlength="80"
				placeholder="Preset name"
				autocomplete="off"
			/>
		</label>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-3">
				<span class="text-xs font-medium uppercase text-thirdly">Custom clips</span>
				<span class="text-[11px] text-thirdly">{includedClipIds.size}/{customClips().length}</span>
			</div>

			<div class="max-h-48 overflow-y-auto rounded-lg border border-color bg-primary/40 p-2">
				{#if customClips().length === 0}
					<div class="px-2 py-5 text-center text-xs text-thirdly">No custom clips in project</div>
				{:else}
					<div class="space-y-1">
						{#each customClips() as customClip (customClip.id)}
							<label
								class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary transition-colors hover:bg-secondary hover:text-primary"
							>
								<input
									type="checkbox"
									checked={includedClipIds.has(customClip.id)}
									onchange={() => toggleClip(customClip.id)}
								/>
								<span class="material-icons-outlined text-base">
									{customClip.type === 'Custom Text' ? 'title' : 'image'}
								</span>
								<span class="min-w-0 flex-1 truncate">{getClipLabel(customClip)}</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="flex items-center justify-between gap-3 border-t border-color bg-primary px-5 py-4">
		<button class="btn px-4 py-2 text-sm" type="button" onclick={close} disabled={isBusy}>
			Cancel
		</button>

		<div class="flex items-center gap-2">
			<button
				class="btn px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
				type="button"
				onclick={() => submit(mode === 'save' ? 'export' : 'save')}
				disabled={!canSubmit()}
			>
				{secondaryLabel()}
			</button>
			<button
				class="btn-accent px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
				type="button"
				onclick={() => submit(mode)}
				disabled={!canSubmit()}
			>
				{isBusy ? 'Working...' : primaryLabel()}
			</button>
		</div>
	</div>
</div>
