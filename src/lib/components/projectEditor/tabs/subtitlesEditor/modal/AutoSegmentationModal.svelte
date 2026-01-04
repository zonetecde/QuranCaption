<script lang="ts">
	import { slide } from 'svelte/transition';
	import { Quran } from '$lib/classes/Quran';
	import { onMount } from 'svelte';
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

	const audioInfo = $derived(() => getAutoSegmentationAudioInfo());
	const hasAudio = $derived(() => !!audioInfo());

	// Check local segmentation status on mount
	onMount(async () => {
		isCheckingStatus = true;
		try {
			localStatus = await checkLocalSegmentationStatus();
			// Default to local if ready, otherwise API
			selectedMode = localStatus.ready ? 'local' : 'api';
		} catch {
			localStatus = null;
		} finally {
			isCheckingStatus = false;
		}
	});

	async function handleInstallDeps() {
		if (isInstallingDeps) return;
		isInstallingDeps = true;
		errorMessage = null;
		try {
			await installLocalSegmentationDeps();
			// Re-check status after installation
			localStatus = await checkLocalSegmentationStatus();
			if (localStatus?.ready) {
				selectedMode = 'local';
			}
		} catch (error) {
			errorMessage = `Failed to install dependencies: ${error}`;
		} finally {
			isInstallingDeps = false;
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

		try {
			const response = await runAutoSegmentation({}, selectedMode);
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
		<div class="bg-accent border border-color rounded-xl p-4 space-y-3">
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

		<!-- Processing Mode Selection -->
		<div class="bg-accent border border-color rounded-xl p-4 space-y-3">
			<div class="text-sm text-primary font-medium">Processing Mode</div>

			{#if isCheckingStatus}
				<div class="flex items-center gap-2 text-sm text-secondary">
					<div
						class="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"
					></div>
					Checking local processing availability...
				</div>
			{:else}
				<div class="space-y-2">
					<!-- API Mode -->
					<label
						class="flex items-start gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors"
					>
						<input
							type="radio"
							name="mode"
							value="api"
							bind:group={selectedMode}
							class="mt-0.5 accent-accent-primary"
						/>
						<div class="flex-1">
							<div class="text-sm text-primary font-medium">Cloud API</div>
							<div class="text-xs text-thirdly">Fast, but limited by GPU quota</div>
						</div>
						<span class="material-icons text-accent-primary text-lg">cloud</span>
					</label>

					<!-- Local Mode -->
					<label
						class="flex items-start gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors"
						class:opacity-50={!localStatus?.ready && !localStatus?.pythonInstalled}
					>
						<input
							type="radio"
							name="mode"
							value="local"
							bind:group={selectedMode}
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
				</div>

				<!-- Installation prompt if needed -->
				{#if localStatus?.pythonInstalled && !localStatus?.packagesInstalled}
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
								Installing...
							{:else}
								<span class="material-icons text-sm">download</span>
								Install
							{/if}
						</button>
					</div>
				{:else if !localStatus?.pythonInstalled}
					<div
						class="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3"
					>
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
			{/if}
		</div>

		{#if isRunning}
			<div class="flex items-center gap-3 bg-accent border border-color rounded-xl px-4 py-3">
				<div
					class="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"
				></div>
				<div class="text-sm text-secondary">Segmenting audio... please wait.</div>
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
						disabled={isRunning || !hasAudio()}
					>
						<span class="material-icons text-base">auto_awesome</span>
						Start segmentation
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
