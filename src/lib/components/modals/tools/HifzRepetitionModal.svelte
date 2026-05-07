<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { slide } from 'svelte/transition';
	import toast from 'svelte-5-french-toast';
	import ModalManager from '../ModalManager';
	import {
		applyHifzRepetitionToProject,
		getHifzToolSummary,
		normalizeSilenceBetweenRepetitionsMultiplier,
		type HifzRepeatTarget
	} from '$lib/services/HifzHelper';

	type HifzGenerationProgressEvent = {
		progress?: number;
		currentTime?: number;
		totalTime?: number;
		message?: string;
	};

	let { close } = $props<{ close: () => void }>();

	let repeatCount = $state(3);
	let repeatTarget = $state<HifzRepeatTarget>('verse');
	let preserveVisualMerges = $state(true);
	let silenceBetweenRepetitionsMultiplier = $state(0);
	let showSubtitlesDuringPause = $state(true);
	let extendCompleteSubtitlesAcrossRepetitions = $state(true);
	let isRunning = $state(false);
	let errorMessage = $state<string | null>(null);
	let hifzProgress = $state(0);
	let hifzProgressMessage = $state('');
	let hifzCurrentTime = $state(0);
	let hifzTotalTime = $state(0);

	const summary = $derived(getHifzToolSummary());
	const canApply = $derived(summary.subtitleCount > 0 && !isRunning);

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
	 * Met à jour le multiplicateur de silence entre répétitions.
	 *
	 * @param {number} value Valeur saisie par l'utilisateur.
	 * @returns {void}
	 */
	function setSilenceBetweenRepetitionsMultiplier(value: number): void {
		silenceBetweenRepetitionsMultiplier = normalizeSilenceBetweenRepetitionsMultiplier(value);
		if (silenceBetweenRepetitionsMultiplier > 0 && !showSubtitlesDuringPause) {
			extendCompleteSubtitlesAcrossRepetitions = false;
		}
	}

	/**
	 * Met à jour l'affichage des sous-titres pendant les pauses.
	 *
	 * @param {boolean} value Etat coche demande.
	 * @returns {void}
	 */
	function setShowSubtitlesDuringPause(value: boolean): void {
		showSubtitlesDuringPause = value;
		if (!showSubtitlesDuringPause && silenceBetweenRepetitionsMultiplier > 0) {
			extendCompleteSubtitlesAcrossRepetitions = false;
		}
	}

	/**
	 * Contraint une progression dans l'intervalle affichable.
	 *
	 * @param {number} value Progression brute envoyée par ffmpeg.
	 * @returns {number} Progression bornée entre 0 et 100.
	 */
	function clampProgress(value: number): number {
		return Math.max(0, Math.min(100, value));
	}

	/**
	 * Formate une durée en secondes pour l'affichage de progression.
	 *
	 * @param {number} seconds Durée en secondes.
	 * @returns {string} Durée formatée en minutes et secondes.
	 */
	function formatProgressTime(seconds: number): string {
		const safeSeconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
		const minutes = Math.floor(safeSeconds / 60);
		const remainingSeconds = safeSeconds % 60;
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
	}

	/**
	 * Ecoute la progression ffmpeg de génération Hifz.
	 *
	 * @returns {Promise<UnlistenFn>} Fonction de désabonnement de l'évènement Tauri.
	 */
	async function listenHifzProgress(): Promise<UnlistenFn> {
		return listen<HifzGenerationProgressEvent>('hifz-generation-progress', (event) => {
			if (typeof event.payload.progress === 'number') {
				hifzProgress = clampProgress(event.payload.progress);
			}
			if (typeof event.payload.currentTime === 'number') {
				hifzCurrentTime = Math.max(0, event.payload.currentTime);
			}
			if (typeof event.payload.totalTime === 'number') {
				hifzTotalTime = Math.max(0, event.payload.totalTime);
			}
			if (typeof event.payload.message === 'string') {
				hifzProgressMessage = event.payload.message;
			}
		});
	}

	/**
	 * Applique la génération Hifz après confirmation utilisateur.
	 *
	 * @returns {Promise<void>} Résolution lorsque l'action est terminée.
	 */
	async function applyHifzRepetition(): Promise<void> {
		if (!canApply) return;

		const safeRepeatCount = normalizeRepeatCount(repeatCount);
		const safeSilenceMultiplier = normalizeSilenceBetweenRepetitionsMultiplier(
			silenceBetweenRepetitionsMultiplier
		);
		const effectiveExtendCompleteSubtitlesAcrossRepetitions =
			safeSilenceMultiplier > 0 && !showSubtitlesDuringPause
				? false
				: extendCompleteSubtitlesAcrossRepetitions;
		const mergeSuffix = preserveVisualMerges ? ' and keep valid visual merges' : '';
		const silenceSuffix =
			safeSilenceMultiplier > 0 ? ` with ${safeSilenceMultiplier}x silence gaps` : '';
		const pauseDisplaySuffix =
			safeSilenceMultiplier > 0
				? showSubtitlesDuringPause
					? ' and subtitles shown during pause'
					: ' and silence clips inserted between repetitions'
				: '';
		const extendSuffix = effectiveExtendCompleteSubtitlesAcrossRepetitions
			? ' and complete subtitles extended across repetitions when possible'
			: '';
		const confirmed = await ModalManager.confirmModal(
			`This will replace the current subtitle track and audio track with a Hifz repetition (${safeRepeatCount}x per ${repeatTarget}${mergeSuffix}${silenceSuffix}${pauseDisplaySuffix}${extendSuffix}). Continue?`,
			true
		);
		if (!confirmed) return;

		isRunning = true;
		errorMessage = null;
		hifzProgress = 0;
		hifzCurrentTime = 0;
		hifzTotalTime = 0;
		hifzProgressMessage = 'Preparing Hifz generation...';
		const unlistenProgress = await listenHifzProgress();
		const result = await applyHifzRepetitionToProject(
			safeRepeatCount,
			repeatTarget,
			preserveVisualMerges,
			safeSilenceMultiplier,
			showSubtitlesDuringPause,
			effectiveExtendCompleteSubtitlesAcrossRepetitions
		).finally(() => {
			unlistenProgress();
			isRunning = false;
		});

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
	class="bg-secondary border-color border rounded-2xl w-[540px] max-w-[90vw] max-h-[710px] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color shrink-0">
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

	<div class="px-6 py-5 space-y-5 overflow-y-auto min-h-0">
		<p class="text-sm text-secondary leading-relaxed">
			Turn your existing subtitles into a Hifz-ready repetition track. The current audio will be
			replaced with a newly generated repeated version.
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

		{#if isRunning}
			<div class="rounded-xl border border-color bg-accent/50 p-4 space-y-3">
				<div class="flex items-center justify-between gap-3 text-xs">
					<span class="text-secondary">{hifzProgressMessage || 'Generating Hifz audio...'}</span>
					<span class="font-semibold text-primary">{Math.round(hifzProgress)}%</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-secondary">
					<div
						class="h-full rounded-full bg-accent-primary transition-all duration-300"
						style={`width: ${hifzProgress}%;`}
					></div>
				</div>
				<div class="flex justify-between text-xs text-thirdly">
					<span>{formatProgressTime(hifzCurrentTime)}</span>
					<span>{formatProgressTime(hifzTotalTime)}</span>
				</div>
			</div>
		{/if}

		{#if errorMessage}
			<div
				class="rounded-xl border border-danger-color bg-danger-color/10 px-4 py-3 text-sm text-danger-color"
			>
				{errorMessage}
			</div>
		{/if}

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

		<div class="space-y-2">
			<label for="hifz-silence-multiplier" class="text-sm font-medium text-primary block">
				Silence duration between repetitions
			</label>
			<input
				id="hifz-silence-multiplier"
				type="number"
				min="0"
				max="3"
				step="0.25"
				value={silenceBetweenRepetitionsMultiplier}
				oninput={(event) =>
					setSilenceBetweenRepetitionsMultiplier(
						Number((event.currentTarget as HTMLInputElement).value)
					)}
				class="w-full bg-accent border border-color rounded-lg px-3 py-2 text-primary focus:border-accent-primary focus:outline-none transition-colors"
			/>
			<p class="text-xs text-thirdly leading-relaxed">
				The silence is the duration of the repeated segment right before it multiplied by this
				value. Use 0 for no silence.
			</p>
		</div>

		<label class="flex items-center gap-3 text-sm text-secondary">
			<input
				type="checkbox"
				checked={preserveVisualMerges}
				onchange={(event) =>
					(preserveVisualMerges = (event.currentTarget as HTMLInputElement).checked)}
				class="accent-accent-primary"
			/>
			<span class="leading-relaxed">
				<span class="block font-medium text-primary">Keep visual merges</span>
			</span>
		</label>

		{#if silenceBetweenRepetitionsMultiplier > 0}
			<label class="flex items-center gap-3 text-sm text-secondary">
				<input
					type="checkbox"
					checked={showSubtitlesDuringPause}
					onchange={(event) =>
						setShowSubtitlesDuringPause((event.currentTarget as HTMLInputElement).checked)}
					class="accent-accent-primary"
				/>
				<span class="leading-relaxed">
					<span class="block font-medium text-primary">
						Keep subtitles visible during pause intervals
					</span>
				</span>
			</label>
		{/if}

		{#if silenceBetweenRepetitionsMultiplier === 0 || showSubtitlesDuringPause}
			<label class="flex items-center gap-3 text-sm text-secondary">
				<input
					type="checkbox"
					checked={extendCompleteSubtitlesAcrossRepetitions}
					onchange={(event) =>
						(extendCompleteSubtitlesAcrossRepetitions = (event.currentTarget as HTMLInputElement)
							.checked)}
					class="accent-accent-primary"
				/>
				<span class="leading-relaxed">
					<span class="block font-medium text-primary">
						Stretch complete subtitles across repeated cycles
					</span>
				</span>
			</label>
		{/if}
	</div>

	<div class="border-t border-color bg-primary px-6 py-4 shrink-0">
		<div class="flex items-center justify-between">
			<div class="text-xs text-thirdly">
				{#if summary.subtitleCount === 0}
					Add subtitles before generating a Hifz track.
				{:else if summary.audioClipCount === 0}
					No audio found. A silent Hifz track will be generated.
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
