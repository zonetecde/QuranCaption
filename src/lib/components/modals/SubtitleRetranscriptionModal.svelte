<script lang="ts">
	import type { SubtitleClip } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		runSubtitleRetranscription,
		type SubtitleRetranscriptionCandidate
	} from '$lib/services/AITranscription';
	import { scheduleWbwRealign } from '$lib/services/AutoSegmentation';
	import { onDestroy, onMount, untrack } from 'svelte';
	import toast from 'svelte-5-french-toast';

	type CandidateState = {
		model: SubtitleRetranscriptionCandidate['model'];
		label: string;
		status: 'pending' | 'running' | 'completed' | 'failed';
		text: string;
		error: string;
	};

	const RETRANSCRIPTION_MODELS: Array<Pick<CandidateState, 'model' | 'label'>> = [
		{ model: 'qwen3-asr-1.7b', label: 'Qwen3-ASR 1.7B' },
		{ model: 'medium', label: 'Whisper Medium' },
		{ model: 'large-v3', label: 'Whisper Large v3' }
	];

	let { clip, resolve }: { clip: SubtitleClip; resolve: () => void } = $props();
	let candidates = $state<CandidateState[]>(
		RETRANSCRIPTION_MODELS.map(({ model, label }) => ({
			model,
			label,
			status: 'pending',
			text: '',
			error: ''
		}))
	);
	let selectedCandidate = $state<string>('current');
	let previewing = $state(false);
	let disposed = false;

	/**
	 * Lance un modèle local et met à jour sa carte indépendamment des autres.
	 * @param {CandidateState} candidate Modèle et état UI à traiter.
	 * @returns {Promise<void>} Promesse résolue lorsque ce modèle a terminé.
	 */
	async function generateCandidate(candidate: CandidateState): Promise<void> {
		if (disposed) return;
		candidate.status = 'running';
		try {
			const result = await runSubtitleRetranscription(clip, candidate.model);
			if (disposed) return;
			candidate.text = result.text.trim();
			candidate.status = candidate.text ? 'completed' : 'failed';
		} catch (error) {
			if (disposed) return;
			candidate.status = 'failed';
			candidate.error = error instanceof Error ? error.message : String(error);
		}
	}

	/**
	 * Lance simultanément tous les modèles locaux de comparaison.
	 * @returns {Promise<void>} Promesse résolue après le dernier modèle.
	 */
	async function generateCandidates(): Promise<void> {
		await Promise.all(candidates.map(generateCandidate));
	}

	/**
	 * Joue ou met en pause la plage exacte du sous-titre dans la preview du projet.
	 * @returns {void}
	 */
	function toggleClipPreview(): void {
		const previewState = globalState.getVideoPreviewState;
		if (previewing && previewState.isPlaying) {
			previewState.togglePlayPause();
			previewing = false;
			return;
		}

		const startMs = Math.max(1, clip.startTime);
		globalState.getTimelineState.cursorPosition = startMs;
		globalState.getTimelineState.movePreviewTo = startMs;
		previewState.scrollTimelineToCursor();
		previewing = true;
		if (!previewState.isPlaying) previewState.togglePlayPause();
	}

	/**
	 * Ferme la modale et arrête uniquement la préécoute qu'elle a démarrée.
	 * @returns {void}
	 */
	function closeModal(): void {
		if (previewing && globalState.getVideoPreviewState.isPlaying) {
			globalState.getVideoPreviewState.togglePlayPause();
		}
		previewing = false;
		resolve();
	}

	/**
	 * Remplace le texte du clip par le candidat choisi et relance son alignement WBW.
	 * @returns {void}
	 */
	function applySelectedText(): void {
		const normalizedText = (
			selectedCandidate === 'current'
				? clip.text
				: (candidates.find((candidate) => candidate.model === selectedCandidate)?.text ?? '')
		).trim();
		if (!normalizedText) return;
		if (normalizedText !== clip.text) {
			const edited = globalState.getSubtitleTrack.editTranscript(
				clip,
				normalizedText,
				clip.speaker
			);
			if (!edited) return;
			globalState.currentProject!.detail.updateVideoDetailAttributes();
			globalState.updateVideoPreviewUI();
			scheduleWbwRealign([clip], { reason: 'text' });
			toast.success($LL.editor.retranscribeApplied());
		}
		closeModal();
	}

	$effect(() => {
		const cursor = globalState.getTimelineState.cursorPosition;
		const isPlaying = globalState.getVideoPreviewState.isPlaying;
		if (!previewing) return;
		if (!isPlaying) {
			previewing = false;
			return;
		}
		if (cursor < clip.endTime) return;

		untrack(() => globalState.getVideoPreviewState.togglePlayPause());
		previewing = false;
	});

	onMount(() => {
		void generateCandidates();
	});

	onDestroy(() => {
		disposed = true;
		if (previewing && globalState.getVideoPreviewState.isPlaying) {
			globalState.getVideoPreviewState.togglePlayPause();
		}
	});
</script>

<div
	class="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
>
	<div
		class="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-color bg-primary shadow-2xl"
	>
		<header class="flex items-start justify-between gap-4 border-b border-color px-6 py-5">
			<div class="flex min-w-0 items-start gap-3">
				<span class="material-icons-outlined mt-0.5 text-2xl text-accent-primary"
					>record_voice_over</span
				>
				<div>
					<h2 class="text-xl font-semibold text-primary">
						{$LL.editor.retranscribeSubtitleTitle()}
					</h2>
					<p class="mt-1 text-sm text-thirdly">{$LL.editor.retranscribeSubtitleDescription()}</p>
				</div>
			</div>
			<button
				type="button"
				class="rounded-full p-2 text-thirdly transition hover:bg-secondary hover:text-primary"
				onclick={closeModal}
				title={$LL.common.close()}
			>
				<span class="material-icons-outlined">close</span>
			</button>
		</header>

		<div class="flex-1 space-y-4 overflow-y-auto px-6 py-5">
			<div class="flex items-center justify-between gap-3">
				<p class="text-xs text-thirdly">
					{Math.max(0, (clip.endTime - clip.startTime) / 1000).toFixed(2)} s
				</p>
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-lg border border-color bg-secondary px-3 py-2 text-sm font-semibold text-primary transition hover:border-[var(--accent-primary)]"
					onclick={toggleClipPreview}
				>
					<span class="material-icons text-lg">{previewing ? 'pause' : 'play_arrow'}</span>
					{previewing ? $LL.editor.retranscribeStopListening() : $LL.editor.retranscribeListen()}
				</button>
			</div>

			<label
				class="block cursor-pointer rounded-xl border border-color bg-secondary p-4 transition hover:border-[var(--accent-primary)]"
			>
				<div class="flex items-start gap-3">
					<input
						type="radio"
						name="retranscription-candidate"
						checked={selectedCandidate === 'current'}
						onchange={() => (selectedCandidate = 'current')}
						class="mt-1"
					/>
					<div class="min-w-0 flex-1">
						<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-thirdly">
							{$LL.editor.retranscribeCurrentText()}
						</p>
						<p class="whitespace-pre-wrap text-base leading-relaxed text-primary" dir="auto">
							{clip.text}
						</p>
					</div>
				</div>
			</label>

			{#each candidates as candidate (candidate.model)}
				<label
					class="block rounded-xl border border-color bg-secondary p-4 transition {candidate.status ===
					'completed'
						? 'cursor-pointer hover:border-[var(--accent-primary)]'
						: ''}"
				>
					<div class="flex items-start gap-3">
						<input
							type="radio"
							name="retranscription-candidate"
							disabled={candidate.status !== 'completed'}
							checked={candidate.status === 'completed' && selectedCandidate === candidate.model}
							onchange={() => (selectedCandidate = candidate.model)}
							class="mt-1"
						/>
						<div class="min-w-0 flex-1">
							<div class="mb-2 flex items-center justify-between gap-3">
								<p class="text-sm font-semibold text-primary">{candidate.label}</p>
								{#if candidate.status === 'running'}
									<span class="inline-flex items-center gap-2 text-xs text-accent-primary">
										<span
											class="h-3 w-3 animate-spin rounded-full border-2 border-color border-t-accent-primary"
										></span>
										{$LL.editor.retranscribeRunning()}
									</span>
								{:else if candidate.status === 'pending'}
									<span class="text-xs text-thirdly">{$LL.editor.retranscribeWaiting()}</span>
								{/if}
							</div>
							{#if candidate.status === 'completed'}
								<p class="whitespace-pre-wrap text-base leading-relaxed text-primary" dir="auto">
									{candidate.text}
								</p>
							{:else if candidate.status === 'failed'}
								<p class="text-sm text-red-300" title={candidate.error}>
									{$LL.editor.retranscribeFailed()}
								</p>
							{/if}
						</div>
					</div>
				</label>
			{/each}
		</div>

		<footer class="flex justify-end gap-3 border-t border-color bg-secondary px-6 py-4">
			<button type="button" class="btn px-5 py-2.5" onclick={closeModal}
				>{$LL.common.cancel()}</button
			>
			<button type="button" class="btn-accent px-5 py-2.5" onclick={applySelectedText}>
				<span class="material-icons mr-1 align-middle text-lg">check</span>
				{$LL.editor.retranscribeApply()}
			</button>
		</footer>
	</div>
</div>
