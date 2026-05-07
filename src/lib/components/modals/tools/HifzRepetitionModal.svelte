<script lang="ts">
	import { slide } from 'svelte/transition';
	import toast from 'svelte-5-french-toast';
	import ModalManager from '../ModalManager';
	import {
		applyHifzRepetitionToProject,
		getHifzToolSummary,
		type HifzRepeatTarget
	} from '$lib/services/AutoSegmentation';

	let { close } = $props<{ close: () => void }>();

	let repeatCount = $state(3);
	let repeatTarget = $state<HifzRepeatTarget>('verse');
	let isRunning = $state(false);
	let errorMessage = $state<string | null>(null);

	const summary = $derived(getHifzToolSummary());
	const canApply = $derived(
		summary.subtitleCount > 0 && summary.audioClipCount > 0 && !isRunning
	);

	/**
	 * Normalise le nombre de répétitions Hifz.
	 *
	 * @param {number} value Valeur saisie dans la modale.
	 * @returns {number} Nombre entier utilisable.
	 */
	function normalizeRepeatCount(value: number): number {
		return Math.max(2, Math.round(Number.isFinite(value) ? value : 2));
	}

	/**
	 * Met à jour le nombre de répétitions affiché par la modale.
	 *
	 * @param {number} value Valeur saisie par l'utilisateur.
	 * @returns {void}
	 */
	function setRepeatCount(value: number): void {
		repeatCount = normalizeRepeatCount(value);
	}

	/**
	 * Applique la génération Hifz après confirmation utilisateur.
	 *
	 * @returns {Promise<void>} Résolution lorsque l'action est terminée.
	 */
	async function applyHifzRepetition(): Promise<void> {
		if (!canApply) return;

		const safeRepeatCount = normalizeRepeatCount(repeatCount);
		const confirmed = await ModalManager.confirmModal(
			`This will replace the current subtitle track and audio track with a Hifz repetition (${safeRepeatCount}x per ${repeatTarget}). Continue?`,
			true
		);
		if (!confirmed) return;

		isRunning = true;
		errorMessage = null;
		const result = await applyHifzRepetitionToProject(safeRepeatCount, repeatTarget);
		isRunning = false;

		if (result.status === 'failed') {
			errorMessage = result.message;
			toast.error(result.message);
			return;
		}

		toast.success(`Hifz track generated with ${result.subtitleCount} subtitles.`);
		close();
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[540px] max-w-[90vw] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">repeat</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">Hifz Repetition</h2>
					<p class="text-sm text-thirdly">Repeat existing subtitles and generate matching audio</p>
				</div>
			</div>

			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>

	<div class="px-6 py-5 space-y-5">
		<p class="text-sm text-secondary leading-relaxed">
			Generate a memorization timeline from the subtitles already in the project. The current
			audio track will be replaced by a generated repeated audio file.
		</p>

		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200 cursor-pointer {repeatTarget ===
				'verse'
					? 'bg-accent-primary text-black border-accent-primary shadow-lg shadow-accent-primary/20'
					: 'bg-accent border-color text-secondary hover:bg-secondary/60'}"
				onclick={() => (repeatTarget = 'verse')}
			>
				<span class="material-icons">menu_book</span>
				<span class="text-sm font-medium">Repeat each verse</span>
			</button>
			<button
				type="button"
				class="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200 cursor-pointer {repeatTarget ===
				'subtitle'
					? 'bg-accent-primary text-black border-accent-primary shadow-lg shadow-accent-primary/20'
					: 'bg-accent border-color text-secondary hover:bg-secondary/60'}"
				onclick={() => (repeatTarget = 'subtitle')}
			>
				<span class="material-icons">subtitles</span>
				<span class="text-sm font-medium">Repeat each subtitle</span>
			</button>
		</div>

		<div class="space-y-2">
			<label for="hifz-repeat-count" class="text-sm font-medium text-primary block">
				Repeat count
			</label>
			<input
				id="hifz-repeat-count"
				type="number"
				min="2"
				max="50"
				step="1"
				value={repeatCount}
				oninput={(event) => setRepeatCount(Number((event.currentTarget as HTMLInputElement).value))}
				class="w-full bg-accent border border-color rounded-lg px-3 py-2 text-primary focus:border-accent-primary focus:outline-none transition-colors"
			/>
		</div>

		<div
			class="bg-accent/50 rounded-xl p-4 text-xs text-secondary flex gap-3 items-start border border-color/50"
		>
			<span class="material-icons text-sm text-accent-primary mt-0.5">info</span>
			<div class="leading-relaxed space-y-1">
				<div>
					Source: <strong class="text-primary">{summary.subtitleCount}</strong> subtitles,
					<strong class="text-primary">{summary.audioClipCount}</strong> audio clip(s)
					{#if summary.sourceAudioFileName}
						from <strong class="text-primary">{summary.sourceAudioFileName}</strong>
					{/if}
				</div>
				{#if summary.currentAudioUsesGeneratedSource}
					<div>The original audio stored in the generated Hifz asset will be used.</div>
				{/if}
				<div>This operation replaces the current subtitle and audio tracks.</div>
			</div>
		</div>

		{#if errorMessage}
			<div class="rounded-xl border border-danger-color bg-danger-color/10 px-4 py-3 text-sm text-danger-color">
				{errorMessage}
			</div>
		{/if}
	</div>

	<div class="border-t border-color bg-primary px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="text-xs text-thirdly">
				{#if summary.subtitleCount === 0}
					Add subtitles before generating a Hifz track.
				{:else if summary.audioClipCount === 0}
					Add audio before generating a Hifz track.
				{:else}
					Ready to generate.
				{/if}
			</div>
			<div class="flex gap-3">
				<button class="btn px-5 py-2 text-sm" onclick={close} disabled={isRunning}>Cancel</button>
				<button
					class="btn-accent px-5 py-2 text-sm flex items-center gap-2"
					onclick={applyHifzRepetition}
					disabled={!canApply}
				>
					<span class="material-icons text-base">{isRunning ? 'hourglass_empty' : 'done'}</span>
					{isRunning ? 'Generating...' : 'Generate Hifz'}
				</button>
			</div>
		</div>
	</div>
</div>
