<script lang="ts">
	import { Asset, AssetClip, AssetType } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { exists } from '@tauri-apps/plugin-fs';
	import { Howl } from 'howler';
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	type AudioEffectId = 'denoise' | 'clarity' | 'echo' | 'reverb';
	const parameterKeys = ['primary', 'secondary'] as const;
	type AudioEffectsCopy = {
		audioEffects: () => string;
		audioEffectsDescription: () => string;
		audioEffectsSegmentationRecommendation: () => string;
		selectTimelineAudio: () => string;
		chooseTimelineAudio: () => string;
		noTimelineAudio: () => string;
		chooseAudioEffect: () => string;
		denoise: () => string;
		denoiseDescription: () => string;
		clarity: () => string;
		clarityDescription: () => string;
		echo: () => string;
		echoDescription: () => string;
		reverb: () => string;
		reverbDescription: () => string;
		effectParameters: () => string;
		denoiseStrength: () => string;
		noiseFloor: () => string;
		lowCut: () => string;
		presenceGain: () => string;
		echoDelay: () => string;
		echoAmount: () => string;
		roomSize: () => string;
		reverbAmount: () => string;
		previewTenSeconds: () => string;
		preparingPreview: () => string;
		stopPreview: () => string;
		audioEffectResultHint: () => string;
		applyAudioEffect: () => string;
		pleaseSelectTimelineAudio: () => string;
		audioEffectSuccess: (args: { effect: string }) => string;
		audioEffectFailed: (args: { error: string }) => string;
		audioEffectPreviewFailed: (args: { error: string }) => string;
	};

	let { close }: { close: () => void } = $props();
	let selectedClipId = $state(0);
	let selectedEffectId = $state<AudioEffectId>('denoise');
	let isProcessing = $state(false);
	let isPreparingPreview = $state(false);
	let isPreviewing = $state(false);
	let previewAudio: Howl | null = null;
	let previewPath: string | null = null;
	let effectParameters = $state<Record<AudioEffectId, { primary: number; secondary: number }>>({
		denoise: { primary: 12, secondary: -50 },
		clarity: { primary: 80, secondary: 2 },
		echo: { primary: 70, secondary: 25 },
		reverb: { primary: 35, secondary: 22 }
	});
	let toolsCopy = $derived(get(LL).tools as unknown as AudioEffectsCopy);
	let commonCopy = $derived(get(LL).common);
	let effects = $derived([
		{
			id: 'denoise' as const,
			icon: 'hearing',
			label: toolsCopy.denoise(),
			description: toolsCopy.denoiseDescription(),
			primary: { label: toolsCopy.denoiseStrength(), min: 1, max: 30, step: 1, unit: 'dB' },
			secondary: { label: toolsCopy.noiseFloor(), min: -80, max: -20, step: 1, unit: 'dB' }
		},
		{
			id: 'clarity' as const,
			icon: 'record_voice_over',
			label: toolsCopy.clarity(),
			description: toolsCopy.clarityDescription(),
			primary: { label: toolsCopy.lowCut(), min: 40, max: 200, step: 5, unit: 'Hz' },
			secondary: { label: toolsCopy.presenceGain(), min: 0, max: 6, step: 1, unit: 'dB' }
		},
		{
			id: 'echo' as const,
			icon: 'graphic_eq',
			label: toolsCopy.echo(),
			description: toolsCopy.echoDescription(),
			primary: { label: toolsCopy.echoDelay(), min: 20, max: 300, step: 5, unit: 'ms' },
			secondary: { label: toolsCopy.echoAmount(), min: 5, max: 40, step: 1, unit: '%' }
		},
		{
			id: 'reverb' as const,
			icon: 'surround_sound',
			label: toolsCopy.reverb(),
			description: toolsCopy.reverbDescription(),
			primary: { label: toolsCopy.roomSize(), min: 15, max: 120, step: 5, unit: 'ms' },
			secondary: { label: toolsCopy.reverbAmount(), min: 5, max: 30, step: 1, unit: '%' }
		}
	]);

	let audioClipOptions = $derived(
		globalState.getAudioTrack.clips.flatMap((clip, index) => {
			if (!(clip instanceof AssetClip)) return [];
			const asset = globalState.currentProject?.content.assets.find(
				(projectAsset) => projectAsset.id === clip.assetId
			);
			if (!asset || (asset.type !== AssetType.Audio && asset.type !== AssetType.Video)) return [];
			return [{ clip, asset, index }];
		})
	);
	let selectedOption = $derived(audioClipOptions.find(({ clip }) => clip.id === selectedClipId));
	let selectedEffect = $derived(effects.find(({ id }) => id === selectedEffectId)!);
	let selectedParameters = $derived(effectParameters[selectedEffectId]);
	let isBusy = $derived(isProcessing || isPreparingPreview);

	onDestroy(() => {
		void stopPreview();
	});

	/**
	 * Retourne un chemin WAV disponible à côté de la source.
	 * @param {string} sourcePath Chemin source.
	 * @param {AudioEffectId} effect Effet ajouté au nom de sortie.
	 * @returns {Promise<string>} Chemin de sortie unique.
	 */
	async function getUniqueOutputPath(sourcePath: string, effect: AudioEffectId): Promise<string> {
		const basePath = sourcePath.replace(/\.[^./\\]+$/, '');
		let suffix = 1;
		let outputPath = `${basePath}_${effect}_${suffix}.wav`;
		while (await exists(outputPath)) {
			suffix += 1;
			outputPath = `${basePath}_${effect}_${suffix}.wav`;
		}
		return outputPath;
	}

	/** Arrête la préécoute et supprime son fichier temporaire. @returns {Promise<void>} Fin du nettoyage. */
	async function stopPreview(): Promise<void> {
		previewAudio?.unload();
		previewAudio = null;
		isPreviewing = false;
		const path = previewPath;
		previewPath = null;
		if (!path) return;
		try {
			await invoke('delete_file', { path });
		} catch (error) {
			console.warn('Unable to delete audio effect preview:', error);
		}
	}

	/** Génère et joue dix secondes au milieu de la portion audio utilisée par le clip. @returns {Promise<void>} Fin du lancement. */
	async function previewAudioEffect(): Promise<void> {
		if (!selectedOption) {
			toast.error(toolsCopy.pleaseSelectTimelineAudio());
			return;
		}

		await stopPreview();
		isPreparingPreview = true;
		const { clip, asset } = selectedOption;
		const parameters = { ...selectedParameters };
		try {
			await asset.ensureDurationLoaded();
			const availableSourceDuration = Math.max(0, asset.duration.ms - clip.sourceStartTime);
			const clipDuration = Math.min(availableSourceDuration, clip.endTime - clip.startTime);
			const previewDuration = Math.min(10_000, clipDuration);
			if (previewDuration <= 0) {
				throw new Error(toolsCopy.pleaseSelectTimelineAudio());
			}
			const previewStart = Math.round(
				clip.sourceStartTime + Math.max(0, (clipDuration - previewDuration) / 2)
			);
			previewPath = await invoke<string>('preview_audio_effect', {
				sourcePath: asset.filePath,
				effect: selectedEffect.id,
				primary: parameters.primary,
				secondary: parameters.secondary,
				startMs: previewStart,
				durationMs: Math.round(previewDuration)
			});
			previewAudio = new Howl({
				src: [convertFileSrc(previewPath)],
				html5: true,
				onplay: () => (isPreviewing = true),
				onend: () => void stopPreview(),
				onloaderror: (_id, error) => {
					toast.error(toolsCopy.audioEffectPreviewFailed({ error: String(error) }));
					void stopPreview();
				},
				onplayerror: (_id, error) => {
					toast.error(toolsCopy.audioEffectPreviewFailed({ error: String(error) }));
					void stopPreview();
				}
			});
			previewAudio.play();
		} catch (error) {
			console.error('Audio effect preview failed:', error);
			toast.error(toolsCopy.audioEffectPreviewFailed({ error: String(error) }));
			await stopPreview();
		} finally {
			isPreparingPreview = false;
		}
	}

	/** Applique l'effet choisi puis remplace la source du clip. @returns {Promise<void>} Fin du traitement. */
	async function applyAudioEffect(): Promise<void> {
		if (!selectedOption) {
			toast.error(toolsCopy.pleaseSelectTimelineAudio());
			return;
		}

		await stopPreview();
		isProcessing = true;
		const clipId = selectedOption.clip.id;
		const sourceAsset = selectedOption.asset;
		const parameters = { ...selectedParameters };
		try {
			const outputPath = await getUniqueOutputPath(sourceAsset.filePath, selectedEffect.id);
			await invoke('apply_audio_effect', {
				sourcePath: sourceAsset.filePath,
				outputPath,
				effect: selectedEffect.id,
				primary: parameters.primary,
				secondary: parameters.secondary
			});

			const newAsset = new Asset(outputPath);
			await newAsset.ensureDurationLoaded();
			const targetClip = globalState.getAudioTrack.clips.find((clip) => clip.id === clipId);
			if (!(targetClip instanceof AssetClip)) {
				throw new Error(toolsCopy.pleaseSelectTimelineAudio());
			}

			ProjectHistoryManager.track(toolsCopy.audioEffects(), () => {
				globalState.currentProject!.content.assets.unshift(newAsset);
				targetClip.assetId = newAsset.id;
			});
			globalState.updateVideoPreviewUI();
			toast.success(toolsCopy.audioEffectSuccess({ effect: selectedEffect.label }));
			close();
		} catch (error) {
			console.error('Audio effect failed:', error);
			toast.error(toolsCopy.audioEffectFailed({ error: String(error) }));
		} finally {
			isProcessing = false;
		}
	}
</script>

<div
	class="bg-secondary w-[620px] max-w-[calc(100vw-2rem)] max-h-[90vh] rounded-xl shadow-2xl overflow-hidden border border-color animate-in fade-in zoom-in duration-200"
>
	<div
		class="bg-gradient-to-r from-accent-primary/20 to-accent-secondary/20 p-6 border-b border-color relative"
	>
		<div class="flex items-center gap-4">
			<div class="bg-accent-primary/20 p-3 rounded-xl">
				<span class="material-icons text-accent-primary text-3xl">spatial_audio</span>
			</div>
			<div>
				<h2 class="text-2xl font-bold text-primary tracking-tight">
					{toolsCopy.audioEffects()}
				</h2>
				<p class="text-secondary text-sm">{toolsCopy.audioEffectsDescription()}</p>
			</div>
		</div>
		<button
			class="absolute top-4 end-4 text-thirdly hover:text-primary transition-colors cursor-pointer"
			onclick={close}
			disabled={isBusy}
			aria-label={commonCopy.close()}
		>
			<span class="material-icons">close</span>
		</button>
	</div>

	<div class="p-8 space-y-6 overflow-y-auto max-h-[65vh]">
		{#if globalState.getSubtitleTrack.clips.length === 0}
			<div class="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
				<span class="material-icons text-amber-400">tips_and_updates</span>
				<p class="text-sm leading-relaxed text-secondary">
					{toolsCopy.audioEffectsSegmentationRecommendation()}
				</p>
			</div>
		{/if}

		<div class="space-y-2">
			<label class="text-sm font-semibold text-secondary" for="audio-effect-source">
				{toolsCopy.selectTimelineAudio()}
			</label>
			<select
				id="audio-effect-source"
				bind:value={selectedClipId}
				disabled={isBusy || audioClipOptions.length === 0}
				onchange={() => void stopPreview()}
				class="w-full bg-accent border border-color rounded-lg px-4 py-3 text-primary focus:ring-2 focus:ring-accent-primary/50 outline-none transition-all cursor-pointer disabled:opacity-50"
			>
				<option value={0} disabled>{toolsCopy.chooseTimelineAudio()}</option>
				{#each audioClipOptions as option (option.clip.id)}
					<option value={option.clip.id}>
						#{option.index + 1} · {option.asset.fileName}
					</option>
				{/each}
			</select>
			{#if audioClipOptions.length === 0}
				<p class="text-sm text-thirdly">{toolsCopy.noTimelineAudio()}</p>
			{/if}
		</div>

		<fieldset class="space-y-3" disabled={isBusy}>
			<legend class="text-sm font-semibold text-secondary">
				{toolsCopy.chooseAudioEffect()}
			</legend>
			<div class="grid grid-cols-2 gap-3">
				{#each effects as effect (effect.id)}
					<button
						type="button"
						class="p-4 rounded-lg border text-start transition-colors {selectedEffectId ===
						effect.id
							? 'border-accent-primary bg-accent-primary/10'
							: 'border-color bg-accent/40 hover:bg-accent'}"
						onclick={() => {
							selectedEffectId = effect.id;
							void stopPreview();
						}}
						aria-pressed={selectedEffectId === effect.id}
					>
						<span class="flex items-center gap-2 font-semibold text-primary">
							<span class="material-icons text-accent-primary text-lg">{effect.icon}</span>
							{effect.label}
						</span>
						<span class="block mt-1 text-xs text-thirdly leading-relaxed">
							{effect.description}
						</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<fieldset class="space-y-4" disabled={isBusy}>
			<legend class="text-sm font-semibold text-secondary">
				{toolsCopy.effectParameters()}
			</legend>
			{#each parameterKeys as parameter (parameter)}
				{@const settings = selectedEffect[parameter]}
				<label class="block space-y-2">
					<span class="flex justify-between gap-4 text-sm text-secondary">
						<span>{settings.label}</span>
						<span class="font-mono text-primary">
							{selectedParameters[parameter]}
							{settings.unit}
						</span>
					</span>
					<input
						type="range"
						min={settings.min}
						max={settings.max}
						step={settings.step}
						value={selectedParameters[parameter]}
						oninput={(event) => {
							selectedParameters[parameter] = Number(event.currentTarget.value);
							void stopPreview();
						}}
						class="w-full accent-accent-primary"
					/>
				</label>
			{/each}
		</fieldset>

		{#if audioClipOptions.length > 0}
			<p class="text-xs text-thirdly leading-relaxed">
				{toolsCopy.audioEffectResultHint()}
			</p>
		{/if}
	</div>

	<div class="bg-accent/30 p-6 flex flex-wrap items-center gap-4 border-t border-color">
		<button
			class="btn px-5 py-2.5 text-sm font-medium flex items-center gap-2 me-auto"
			onclick={isPreviewing ? stopPreview : previewAudioEffect}
			disabled={isBusy || !selectedOption}
		>
			{#if isPreparingPreview}
				<span class="material-icons animate-spin text-base">sync</span>
				{toolsCopy.preparingPreview()}
			{:else if isPreviewing}
				<span class="material-icons text-base">stop</span>
				{toolsCopy.stopPreview()}
			{:else}
				<span class="material-icons text-base">play_arrow</span>
				{toolsCopy.previewTenSeconds()}
			{/if}
		</button>
		<button class="btn px-6 py-2.5 text-sm font-medium" onclick={close} disabled={isBusy}>
			{commonCopy.cancel()}
		</button>
		<button
			class="btn-accent px-8 py-2.5 text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
			onclick={applyAudioEffect}
			disabled={isBusy || !selectedOption}
		>
			{#if isProcessing}
				<span class="material-icons animate-spin text-base">sync</span>
				{commonCopy.processing()}
			{:else}
				<span class="material-icons text-base">spatial_audio</span>
				{toolsCopy.applyAudioEffect()}
			{/if}
		</button>
	</div>
</div>
