<script lang="ts">
	import { slide } from 'svelte/transition';
	import { Quran } from '$lib/classes/Quran';
	import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import {
		getAutoSegmentationAudioInfo,
		runAutoSegmentation,
		checkLocalSegmentationStatus,
		installLocalSegmentationDeps,
		type AutoSegmentationResult,
		type SegmentationMode,
		type LocalSegmentationStatus
	} from '$lib/services/AutoSegmentation';

	let { close } = $props();

	let isRunning = $state(false);
	let result: AutoSegmentationResult | null = $state(null);
	let errorMessage = $state<string | null>(null);

	// Mode selection state
	let selectedMode = $state<SegmentationMode>('api');
	let localStatus = $state<LocalSegmentationStatus | null>(null);
	let isCheckingStatus = $state(true);
	let isInstallingDeps = $state(false);
	let currentStatus = $state<string>('');
	let installStatus = $state<string>('');

	// Advanced settings state
	let showAdvancedSettings = $state(false);
	let minSilenceMs = $state(200);
	let minSpeechMs = $state(1000);
	let padMs = $state(50);

	// Model selection for local processing
	type WhisperModel = 'tiny' | 'base' | 'medium' | 'large';
	let selectedModel = $state<WhisperModel>('base');

	const modelOptions = [
		{
			value: 'tiny' as const,
			label: 'Tiny',
			description: 'Fastest, less accurate (~60 MB)',
			size: '~60 MB',
			source: 'tarteel-ai/whisper-tiny-ar-quran'
		},
		{
			value: 'base' as const,
			label: 'Base',
			description: 'Balanced speed/accuracy (~150 MB)',
			size: '~150 MB',
			source: 'tarteel-ai/whisper-base-ar-quran'
		},
		{
			value: 'medium' as const,
			label: 'Medium',
			description: 'Very accurate, slower (~800 MB)',
			size: '~800 MB',
			source: 'openai/whisper-medium'
		},
		{
			value: 'large' as const,
			label: 'Large',
			description: 'Most accurate, slowest (~3 GB)',
			size: '~3 GB',
			source: 'IJyad/whisper-large-v3-Tarteel'
		}
	];

	const audioInfo = $derived(() => getAutoSegmentationAudioInfo());
	const hasAudio = $derived(() => !!audioInfo());
	const savedSettings = $derived(() => globalState.settings?.autoSegmentationSettings);

	$effect(() => {
		const persisted = savedSettings();
		if (!persisted) return;

		minSilenceMs = persisted.minSilenceMs;
		minSpeechMs = persisted.minSpeechMs;
		padMs = persisted.padMs;
		selectedModel = persisted.whisperModel;
		selectedMode = persisted.mode === 'local' && localStatus?.ready ? 'local' : 'api';
	});

	// Check local segmentation status on mount
	onMount(async () => {
		isCheckingStatus = true;
		try {
			localStatus = await checkLocalSegmentationStatus();
		} catch {
			localStatus = null;
		} finally {
			isCheckingStatus = false;
		}
	});

	function persistAutoSegmentationSettings(next: Partial<AutoSegmentationSettings>): void {
		if (!globalState.settings) return;
		Object.assign(globalState.settings.autoSegmentationSettings, next);
		void Settings.save();
	}

	function persistTimingSettings(): void {
		persistAutoSegmentationSettings({ minSilenceMs, minSpeechMs, padMs });
	}

	function persistModeSettings(): void {
		persistAutoSegmentationSettings({ mode: selectedMode });
	}

	function persistModelSettings(): void {
		persistAutoSegmentationSettings({ whisperModel: selectedModel });
	}

	async function handleInstallDeps() {
		if (isInstallingDeps) return;
		isInstallingDeps = true;
		errorMessage = null;
		installStatus = 'Starting installation...';

		// Listen for install status updates
		const unlisten = await listen<{ message: string }>('install-status', (event) => {
			installStatus = event.payload.message;
		});

		try {
			await installLocalSegmentationDeps();
			// Re-check status after installation
			localStatus = await checkLocalSegmentationStatus();
		} catch (error) {
			errorMessage = `Failed to install dependencies: ${error}`;
		} finally {
			isInstallingDeps = false;
			installStatus = '';
			unlisten();
		}
	}

	function formatVerseRange(resultData: AutoSegmentationResult | null): string {
		if (
			!resultData ||
			resultData.status !== 'completed' ||
			resultData.verseRange.parts.length === 0
		) {
			return 'No verse range detected.';
		}

		return resultData.verseRange.parts
			.map((part) => {
				const surahName =
					Quran.getSurahsNames()[part.surah - 1]?.transliteration || `Surah ${part.surah}`;
				const verseRange =
					part.verseStart === part.verseEnd
						? `${part.verseStart}`
						: `${part.verseStart}-${part.verseEnd}`;
				return `Surah ${surahName}: ${verseRange}`;
			})
			.join(', ');
	}

	async function startSegmentation() {
		if (isRunning || !hasAudio()) return;
		isRunning = true;
		errorMessage = null;
		result = null;
		currentStatus = '';

		// Listen for status updates from local segmentation
		let unlisten: UnlistenFn | null = null;
		if (selectedMode === 'local') {
			unlisten = await listen<{ step: string; message: string }>('segmentation-status', (event) => {
				currentStatus = event.payload.message;
			});
		}

		try {
			const response = await runAutoSegmentation(
				{
					minSilenceMs,
					minSpeechMs,
					padMs,
					whisperModel: selectedMode === 'local' ? selectedModel : undefined
				},
				selectedMode
			);
			if (!response) {
				errorMessage = 'Segmentation failed. Please check the console for details.';
			} else if (response.status === 'cancelled') {
				errorMessage = 'Segmentation canceled.';
			} else if (response.status === 'failed') {
				errorMessage = response.message;
			} else {
				result = response;
			}
		} finally {
			isRunning = false;
			currentStatus = '';
			if (unlisten) unlisten();
		}
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[680px] max-w-[90vw] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<!-- Header -->
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">graphic_eq</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">Auto Segmentation</h2>
					<p class="text-sm text-thirdly">Send audio to the AI to auto-create subtitles</p>
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

	<!-- Body -->
	<div class="px-6 py-5 space-y-4">
		<!-- Body -->
		{#if !showAdvancedSettings}
			<div class="bg-accent border border-color rounded-xl p-4 space-y-3" transition:slide>
				<div class="space-y-2">
					<p class="text-sm text-secondary leading-relaxed">
						This will analyze the <span class="text-primary font-medium">first audio clip</span> in your
						timeline and automatically generate subtitle clips from it.
					</p>

					<ul class="text-sm text-secondary leading-relaxed list-disc pl-5 space-y-1">
						<li>
							Existing subtitles will be <span class="text-primary font-medium">replaced</span>.
						</li>
						<li>
							Each generated segment includes a confidence score. Anything <span
								class="text-primary font-medium">below 0.75</span
							> will be highlighted in yellow and should be reviewed.
						</li>
					</ul>
				</div>

				<div class="flex items-center gap-2 text-xs text-thirdly">
					<span class="material-icons text-sm mt-0.5">info</span>
					<span>
						Audio source:
						{#if hasAudio()}
							<span class="text-primary font-medium">{audioInfo()?.fileName}</span>
						{:else}
							<span class="text-danger-color font-medium">No audio clip found</span>
						{/if}
					</span>
				</div>
			</div>
		{/if}

		<!-- Processing Mode Selection -->
		<div class="bg-accent border border-color rounded-xl p-4 space-y-3">
			<div class="text-sm text-primary font-medium">Processing Mode</div>

			<div class="space-y-2">
				<!-- API Mode - Always visible -->
				<label
					class="flex items-start gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors"
				>
					<input
						type="radio"
						name="mode"
						value="api"
						bind:group={selectedMode}
						onchange={persistModeSettings}
						class="mt-0.5 accent-accent-primary"
					/>
					<div class="flex-1">
						<div class="text-sm text-primary font-medium">Cloud API</div>
						<div class="text-xs text-thirdly">Fast, but limited by GPU quota</div>
					</div>
					<span class="material-icons text-accent-primary text-lg">cloud</span>
				</label>

				<!-- Local Mode - Shows loading while checking, then actual status -->
				{#if isCheckingStatus}
					<div class="flex items-center gap-2 text-sm text-secondary p-2">
						<div
							class="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"
						></div>
						Checking local processing availability...
					</div>
				{:else if localStatus}
					<label
						class="flex items-start gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors"
						class:opacity-50={!localStatus?.ready && !localStatus?.pythonInstalled}
					>
						<input
							type="radio"
							name="mode"
							value="local"
							bind:group={selectedMode}
							onchange={persistModeSettings}
							disabled={!localStatus?.ready}
							class="mt-0.5 accent-accent-primary"
						/>
						<div class="flex-1">
							<div class="text-sm text-primary font-medium flex items-center gap-2">
								Local Processing
								{#if localStatus?.ready}
									<span class="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full"
										>Ready</span
									>
								{:else if localStatus?.pythonInstalled && !localStatus?.packagesInstalled}
									<span class="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full"
										>Setup needed</span
									>
								{:else if !localStatus?.pythonInstalled}
									<span class="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full"
										>Python required</span
									>
								{/if}
							</div>
							<div class="text-xs text-thirdly">
								No quota limits, requires Python + ML packages (~3 GB)
							</div>
						</div>
						<span class="material-icons text-accent-primary text-lg">computer</span>
					</label>
				{/if}
			</div>

			<!-- Installation prompt if needed (only after check completes) -->
			{#if !isCheckingStatus && localStatus?.pythonInstalled && !localStatus?.packagesInstalled}
				<div
					class="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3"
				>
					<span class="material-icons text-yellow-400">download</span>
					<div class="flex-1">
						<div class="text-sm text-primary">Python packages need to be installed</div>
						<div class="text-xs text-thirdly">This will download ~3 GB of ML libraries</div>
					</div>
					<button
						class="btn-accent px-3 py-1.5 text-xs flex items-center gap-1.5"
						onclick={handleInstallDeps}
						disabled={isInstallingDeps}
					>
						{#if isInstallingDeps}
							<div
								class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
							></div>
							{installStatus || 'Installing...'}
						{:else}
							<span class="material-icons text-sm">download</span>
							Install
						{/if}
					</button>
				</div>
			{:else if !isCheckingStatus && localStatus && !localStatus?.pythonInstalled}
				<div class="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
					<span class="material-icons text-red-400">warning</span>
					<div class="flex-1">
						<div class="text-sm text-primary">Python is not installed</div>
						<div class="text-xs text-thirdly">
							Install Python 3.10+ from
							<a href="https://python.org" target="_blank" class="text-accent-primary underline"
								>python.org</a
							>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Advanced Settings (Collapsible) -->
		<div
			class="bg-accent border border-color rounded-xl overflow-hidden overflow-y-auto max-h-[200px] xl:max-h-[400px]"
		>
			<button
				class="w-full px-4 py-3 flex items-center justify-between hover:bg-[rgba(255,255,255,0.03)] transition-colors"
				onclick={() => (showAdvancedSettings = !showAdvancedSettings)}
			>
				<div class="flex items-center gap-2 text-sm text-primary font-medium">
					<span class="material-icons text-base"
						>{showAdvancedSettings ? 'expand_less' : 'expand_more'}</span
					>
					Advanced Settings
				</div>
				<span class="text-xs text-thirdly">
					{showAdvancedSettings ? 'Hide' : 'Show'}
				</span>
			</button>

			{#if showAdvancedSettings}
				<div class="px-4 pb-4 space-y-4 border-t border-color" transition:slide={{ duration: 200 }}>
					<!-- Model Selection (Local only) -->
					{#if selectedMode === 'local'}
						<div class="space-y-3 pt-3 border-t border-color">
							<div class="text-xs text-thirdly font-medium uppercase">Whisper Model</div>
							<div class="space-y-2">
								{#each modelOptions as option}
									<label
										class="flex items-center gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors {selectedModel ===
										option.value
											? 'bg-[rgba(0,200,255,0.1)]'
											: ''}"
									>
										<input
											type="radio"
											name="model"
											value={option.value}
											bind:group={selectedModel}
											onchange={persistModelSettings}
											class="accent-accent-primary"
										/>
										<div class="flex-1">
											<div class="flex flex-col">
												<div class="flex items-center gap-2">
													<span class="text-sm text-primary font-medium">{option.label}</span>
													<span
														class="text-[10px] bg-secondary/10 px-1.5 py-0.5 rounded text-secondary/70 font-mono border border-[var(--text-secondary)]/10 truncate max-w-[200px]"
														title="HuggingFace Model: {option.source}"
													>
														{option.source}
													</span>
												</div>
												<div class="text-xs text-thirdly">{option.description}</div>
											</div>
										</div></label
									>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Timing Parameters -->
					<div class="pt-3 space-y-3">
						<div class="text-xs text-thirdly font-medium uppercase">Timing Parameters</div>

						<!-- Min Silence -->
						<div>
							<div class="flex items-center justify-between mb-1">
								<label class="text-sm text-secondary"
									>Min Silence Duration <span class="text-xs text-thirdly">(default: 200ms)</span
									></label
								>
								<span class="text-xs text-primary font-mono">{minSilenceMs} ms</span>
							</div>
							<input
								type="range"
								min="50"
								max="1000"
								step="50"
								bind:value={minSilenceMs}
								onchange={persistTimingSettings}
								class="w-full accent-accent-primary"
							/>
							<p class="text-xs text-thirdly mt-1">Minimum pause between segments</p>
						</div>

						<!-- Min Speech -->
						<div>
							<div class="flex items-center justify-between mb-1">
								<label class="text-sm text-secondary"
									>Min Speech Duration <span class="text-xs text-thirdly">(default: 1000ms)</span
									></label
								>
								<span class="text-xs text-primary font-mono">{minSpeechMs} ms</span>
							</div>
							<input
								type="range"
								min="500"
								max="3000"
								step="100"
								bind:value={minSpeechMs}
								onchange={persistTimingSettings}
								class="w-full accent-accent-primary"
							/>
							<p class="text-xs text-thirdly mt-1">Minimum segment length to keep</p>
						</div>

						<!-- Padding -->
						<div>
							<div class="flex items-center justify-between mb-1">
								<label class="text-sm text-secondary"
									>Padding <span class="text-xs text-thirdly">(default: 50ms)</span></label
								>
								<span class="text-xs text-primary font-mono">{padMs} ms</span>
							</div>
							<input
								type="range"
								min="0"
								max="300"
								step="10"
								bind:value={padMs}
								onchange={persistTimingSettings}
								class="w-full accent-accent-primary"
							/>
							<p class="text-xs text-thirdly mt-1">Extra time added before/after each segment</p>
						</div>
					</div>
				</div>
			{/if}
		</div>

		{#if isRunning}
			<div class="flex items-center gap-3 bg-accent border border-color rounded-xl px-4 py-3">
				<div
					class="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"
				></div>
				<div class="text-sm text-secondary">
					{#if currentStatus}
						{currentStatus}
					{:else if selectedMode === 'api'}
						Sending audio to cloud API...
					{:else}
						Starting local processing...
					{/if}
				</div>
			</div>
		{:else if result && result.status === 'completed'}
			<div class="bg-accent border border-color rounded-xl px-4 py-3 space-y-2">
				<div class="flex items-center gap-2 text-sm text-primary font-semibold">
					<span class="material-icons text-accent-primary">check_circle</span>
					Segmentation complete
				</div>
				<div class="text-sm text-secondary">
					Segments found: <span class="text-primary font-semibold">{result.segmentsApplied}</span>
				</div>
				<div class="text-sm text-secondary">
					Verse range:
					<span class="text-primary font-semibold">{formatVerseRange(result)}</span>
				</div>
				<div class="text-sm text-secondary">
					Low-confidence segments:
					<span class="text-primary font-semibold">{result.lowConfidenceSegments}</span>
					{#if result.lowConfidenceSegments > 0}
						<span class="text-thirdly"> (make sure to review them manually)</span>
					{/if}
				</div>
			</div>
		{:else if errorMessage}
			<div
				class="bg-danger-color/10 border border-danger-color rounded-xl px-4 py-3 text-sm space-y-1"
			>
				<div class="font-semibold text-danger-color">Segmentation failed</div>
				<div class="text-secondary break-words">{errorMessage}</div>
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="text-xs text-thirdly">
				{#if result && result.status === 'completed'}
					Segmentation is complete. You can close this modal.
				{:else}
					Ready to start auto-segmentation.
				{/if}
			</div>
			<div class="flex gap-3">
				{#if result && result.status === 'completed'}
					<button class="btn-accent px-5 py-2 text-sm" onclick={close}>Finish</button>
				{:else}
					<button class="btn px-5 py-2 text-sm" onclick={close}>Close</button>
					<button
						class="btn-accent px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={startSegmentation}
						disabled={isRunning || !hasAudio() || isCheckingStatus}
					>
						<span class="material-icons text-base">auto_awesome</span>
						Start segmentation
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
