<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import Settings, { type PerformanceProfile } from '$lib/classes/Settings.svelte';
	import type { FadeValue } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import TimeInput from './TimeInput.svelte';
	import Style from '../styleEditor/Style.svelte';
	import { VerseRange } from '$lib/classes';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import type { ExportSkipRange } from '$lib/classes/ProjectEditorState.svelte';

	type VideoCodec = 'h264' | 'h265';

	const performanceProfileIds: PerformanceProfile[] = ['fastest', 'balanced', 'low_cpu'];
	const videoCodecIds: VideoCodec[] = ['h264', 'h265'];

	let showAdvancedSettings = $state(false);
	let skipCopy = $derived(
		$LL.export as unknown as {
			addSkip: () => string;
			skip: () => string;
			setSkipStartToCursor: () => string;
			setSkipEndToCursor: () => string;
			removeSkip: () => string;
		}
	);

	/**
	 * Ajoute une zone ignorée d'une seconde à la position du curseur.
	 * @returns {void}
	 */
	function addSkipRange(): void {
		const startTime = Math.max(0, Math.round(globalState.getTimelineState.cursorPosition));
		ProjectHistoryManager.track('add export skip range', () => {
			globalState.getExportState.skipRanges.push({ startTime, endTime: startTime + 1000 });
		});
	}

	/**
	 * Place une borne de zone ignorée sur le curseur de la timeline.
	 * @param {ExportSkipRange} range Zone ignorée à modifier.
	 * @param {'start' | 'end'} boundary Borne à déplacer.
	 * @returns {void}
	 */
	function setSkipBoundary(range: ExportSkipRange, boundary: 'start' | 'end'): void {
		const cursorTime = Math.max(0, Math.round(globalState.getTimelineState.cursorPosition));
		ProjectHistoryManager.track(`set export skip ${boundary}`, () => {
			if (boundary === 'start') {
				range.startTime = cursorTime;
				if (range.startTime >= range.endTime) range.endTime = range.startTime + 1000;
				return;
			}

			range.endTime = cursorTime;
			if (range.endTime <= range.startTime) {
				range.startTime = Math.max(0, range.endTime - 1000);
				if (range.endTime === range.startTime) range.endTime += 1000;
			}
		});
	}

	/**
	 * Supprime une zone ignorée de l'export.
	 * @param {number} index Index de la zone à supprimer.
	 * @returns {void}
	 */
	function removeSkipRange(index: number): void {
		ProjectHistoryManager.track('remove export skip range', () => {
			globalState.getExportState.skipRanges.splice(index, 1);
		});
	}

	/**
	 * Normalise et sauvegarde le nombre de WebViews utilisees pour capturer les frames.
	 * @returns {Promise<void>}
	 */
	async function saveParallelCaptureWorkers(): Promise<void> {
		if (!globalState.settings) return;
		globalState.settings.exportSettings.parallelCaptureWorkers = Math.max(
			1,
			Math.min(8, Math.round(globalState.settings.exportSettings.parallelCaptureWorkers || 4))
		);
		await Settings.save();
	}

	/**
	 * Sauvegarde le profil de performance global de l'export video.
	 * @param {PerformanceProfile} profile Profil selectionne.
	 * @returns {Promise<void>}
	 */
	async function savePerformanceProfile(profile: PerformanceProfile): Promise<void> {
		if (!globalState.settings) return;
		globalState.settings.exportSettings.performanceProfile = profile;
		await Settings.save();
	}

	/**
	 * Active ou désactive l'export limité à la récitation avec prise en charge de l'annulation.
	 * @param {boolean} enabled Nouvel état de l'option.
	 * @returns {void}
	 */
	function setExportOnlyRecitation(enabled: boolean): void {
		ProjectHistoryManager.track('toggle recitation-only export', () => {
			globalState.getExportState.exportOnlyRecitation = enabled;
		});
	}

	/**
	 * Modifie la marge conservée autour des coupures de récitation.
	 * @param {number} marginMs Marge en millisecondes.
	 * @returns {void}
	 */
	function setRecitationCutMargin(marginMs: number): void {
		ProjectHistoryManager.track('set recitation export cut margin', () => {
			globalState.getExportState.recitationCutMarginMs = Math.max(0, Math.round(marginMs || 0));
		});
	}

	/**
	 * Modifie la durée minimale de silence qui déclenche une coupure.
	 * @param {number} durationMs Durée en millisecondes.
	 * @returns {void}
	 */
	function setRecitationMinimumSilence(durationMs: number): void {
		ProjectHistoryManager.track('set recitation export minimum silence', () => {
			globalState.getExportState.recitationMinimumSilenceMs = Math.max(
				0,
				Math.round(durationMs || 0)
			);
		});
	}

	// Initialize export state values if not set
	$effect(() => {
		if (!globalState.getExportState.videoStartTime) {
			globalState.getExportState.videoStartTime = 0;
		}
		if (!globalState.getExportState.videoEndTime) {
			globalState.getExportState.videoEndTime = globalState.getAudioTrack.getDuration().ms || 0;
		}
	});

	// Helper function to format duration for display
	function formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		} else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
	}
</script>

<!-- Export Video Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">{$LL.export.exportVideo()}</h3>
		<p class="text-thirdly text-sm">
			{$LL.export.configureExportSettings()}
		</p>
	</div>

	<!-- Time Range Selection -->
	<div data-tour-id="export-range" class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportRange()}</h4>
		<p class="text-thirdly text-sm mb-4">{$LL.export.selectTimeRange()}</p>

		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="grid grid-cols-1 grid-rows-2 gap-4">
				<!-- Start Time -->
				<TimeInput
					label={$LL.export.startTime()}
					bind:value={globalState.getExportState.videoStartTime}
				/>

				<!-- End Time -->
				<TimeInput
					label={$LL.export.endTime()}
					bind:value={globalState.getExportState.videoEndTime}
				/>
			</div>

			<div class="mt-3 flex flex-col items-center justify-between">
				<button
					type="button"
					class="w-full inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
					onclick={addSkipRange}
				>
					<span class="material-icons text-[17px]!">add</span>
					{skipCopy.addSkip()}
				</button>

				{#if (globalState.getExportState.skipRanges ?? []).length > 0}
					<div class="mt-3 space-y-2 w-full">
						{#each globalState.getExportState.skipRanges ?? [] as range, index}
							<div class="rounded-md border border-violet-500/35 bg-violet-500/10 p-2.5">
								<div class="mb-2 flex items-center justify-between gap-2">
									<span class="text-xs font-medium text-violet-300">
										{skipCopy.skip()}
										{index + 1} · {formatDuration(range.startTime)}–{formatDuration(range.endTime)}
									</span>
									<button
										type="button"
										class="material-icons rounded p-0.5 text-base text-thirdly transition-colors hover:bg-violet-500/20 hover:text-violet-300"
										title={skipCopy.removeSkip()}
										onclick={() => removeSkipRange(index)}>close</button
									>
								</div>
								<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
									<button
										type="button"
										class="rounded border border-violet-500/30 bg-secondary px-2 py-1.5 text-xs text-secondary transition-colors hover:border-violet-400 hover:text-violet-300"
										onclick={() => setSkipBoundary(range, 'start')}
									>
										{skipCopy.setSkipStartToCursor()}
									</button>
									<button
										type="button"
										class="rounded border border-violet-500/30 bg-secondary px-2 py-1.5 text-xs text-secondary transition-colors hover:border-violet-400 hover:text-violet-300"
										onclick={() => setSkipBoundary(range, 'end')}
									>
										{skipCopy.setSkipEndToCursor()}
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Export summary -->
			<div class="mt-4 space-y-3 rounded-lg border border-color bg-secondary p-3">
				<div class="flex items-center justify-between text-sm">
					<span class="text-secondary">{$LL.export.exportDuration()}</span>
					<span class="text-accent-primary font-medium">
						{formatDuration(
							Math.max(
								0,
								(globalState.getExportState.videoEndTime || 0) -
									(globalState.getExportState.videoStartTime || 0)
							)
						)}
					</span>
				</div>

				<div class="flex items-center justify-between border-t border-color pt-3 text-sm">
					<span class="text-secondary min-w-[150px]">{$LL.export.exportVerseRange()}</span>
					<span class="text-accent-primary font-medium">
						{VerseRange.getExportVerseRange().toString()}
					</span>
				</div>
			</div>
		</div>
	</div>

	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">
			{$LL.export.videoQualityOrientation()}
		</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<p class="text-thirdly text-sm mb-4">
				{$LL.export.setResolutionOrientation()}
			</p>

			<Style
				style={globalState.getStyle('global', 'video-dimension')!}
				target="global"
				applyValueSimple={(v) => {
					globalState.getStyle('global', 'video-dimension')!.value = v as {
						width: number;
						height: number;
					};
				}}
				disabled={false}
			/>
		</div>
	</div>

	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.videoAudioFade()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<p class="text-thirdly text-sm mb-4">
				{$LL.export.enableDisableFade()}
			</p>

			<Style
				style={globalState.getStyle('global', 'video-and-audio-fade')!}
				target="global"
				applyValueSimple={(v) => {
					globalState.getStyle('global', 'video-and-audio-fade')!.value = v as FadeValue;
				}}
				disabled={false}
			/>
		</div>
	</div>
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.performanceSettings()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="flex flex-col gap-3">
				<p class="text-thirdly text-sm leading-snug">
					{$LL.export.setFpsDescription()}
				</p>
				<input
					type="number"
					min="5"
					max="60"
					step="1"
					class="input w-full h-10"
					bind:value={globalState.getExportState.fps}
				/>
			</div>
		</div>
	</div>

	<!-- Video Filename & Export Location -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.videoFileName()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="flex flex-col gap-6">
				<div>
					<p class="text-thirdly text-sm mb-4">
						{$LL.export.enterFileName()}
					</p>

					<div class="flex flex-col gap-2">
						<input
							type="text"
							class="input w-full"
							placeholder={globalState.currentProject?.detail.generateExportFileName()}
							bind:value={globalState.getExportState.customFileName}
						/>
						<p class="text-thirdly text-xs italic">
							{$LL.export.extensionAddedAutomatically()}
						</p>
					</div>
				</div>

				<div class="border-t border-color pt-4">
					<ExportFolderPicker description={$LL.export.chooseExportLocation()} />
				</div>
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportVideo}>
			{$LL.export.exportButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.startExportDescription()}
		</p>
	</div>

	<div class="mt-5">
		<button
			type="button"
			class="w-full flex items-center justify-between rounded-lg border border-color bg-accent px-4 py-3 text-left transition-colors hover:bg-primary/60"
			onclick={() => {
				showAdvancedSettings = !showAdvancedSettings;
			}}
			aria-expanded={showAdvancedSettings}
		>
			<div>
				<p class="text-sm font-medium text-primary">{$LL.export.advancedSettings()}</p>
				<p class="text-xs text-thirdly">
					{$LL.export.controlExportPerformance()}
				</p>
			</div>
			<span
				class="material-icons text-secondary transition-transform duration-200"
				style={`transform: rotate(${showAdvancedSettings ? 180 : 0}deg);`}
			>
				expand_more
			</span>
		</button>

		{#if showAdvancedSettings}
			<div class="mt-3 rounded-lg border border-color bg-accent p-4" transition:slide>
				<section class="mb-6">
					<h4 class="text-base font-medium text-secondary mb-3">
						{$LL.export.recitationContent()}
					</h4>
					<div class="rounded-lg border border-color bg-secondary p-4">
						<label class="flex items-start gap-3 cursor-pointer select-none">
							<input
								type="checkbox"
								class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)]"
								checked={globalState.getExportState.exportOnlyRecitation}
								onchange={(event) =>
									setExportOnlyRecitation((event.currentTarget as HTMLInputElement).checked)}
							/>
							<span class="text-sm text-primary">
								{$LL.export.exportOnlyRecitation()}
								<span class="block text-xs text-thirdly mt-1">
									{$LL.export.exportOnlyRecitationDescription()}
								</span>
							</span>
						</label>

						{#if globalState.getExportState.exportOnlyRecitation}
							<div class="mt-4 border-t border-color pt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
								<div>
									<label
										class="block text-sm font-medium text-primary mb-2"
										for="recitation-cut-margin"
									>
										{$LL.export.recitationCutMargin()}
									</label>
									<input
										id="recitation-cut-margin"
										type="number"
										min="0"
										step="50"
										class="input w-full h-10"
										value={globalState.getExportState.recitationCutMarginMs}
										onchange={(event) =>
											setRecitationCutMargin(
												(event.currentTarget as HTMLInputElement).valueAsNumber
											)}
									/>
									<p class="text-xs text-thirdly mt-2">
										{$LL.export.recitationCutMarginDescription()}
									</p>
								</div>
								<div>
									<label
										class="block text-sm font-medium text-primary mb-2"
										for="recitation-minimum-silence"
									>
										{$LL.export.recitationMinimumSilence()}
									</label>
									<input
										id="recitation-minimum-silence"
										type="number"
										min="0"
										step="100"
										class="input w-full h-10"
										value={globalState.getExportState.recitationMinimumSilenceMs}
										onchange={(event) =>
											setRecitationMinimumSilence(
												(event.currentTarget as HTMLInputElement).valueAsNumber
											)}
									/>
									<p class="text-xs text-thirdly mt-2">
										{$LL.export.recitationMinimumSilenceDescription()}
									</p>
								</div>
							</div>
						{/if}
					</div>
				</section>

				<div class="mb-4">
					<h4 class="text-base font-medium text-secondary mb-1">
						{$LL.export.exportPerformance()}
					</h4>
					<p class="text-thirdly text-sm">
						{$LL.export.chooseCpuUsage()}
					</p>
				</div>

				{#if globalState.settings}
					<div class="mb-4 rounded-lg border border-color bg-secondary p-4">
						<label
							class="block text-sm font-medium text-primary mb-2"
							for="parallel-capture-workers"
						>
							{$LL.export.parallelCaptureWorkers()}
						</label>
						<input
							id="parallel-capture-workers"
							type="number"
							min="1"
							max="8"
							step="1"
							class="input w-full h-10"
							bind:value={globalState.settings.exportSettings.parallelCaptureWorkers}
							onchange={saveParallelCaptureWorkers}
						/>
						<p class="text-xs text-thirdly mt-2">
							{$LL.export.parallelCaptureWorkersDescription()}
						</p>
					</div>

					<div class="mb-4 rounded-lg border border-color bg-secondary p-4">
						<label class="block text-sm font-medium text-primary mb-2" for="video-codec">
							{$LL.export.videoCodec()}
						</label>
						<select
							id="video-codec"
							class="input w-full"
							bind:value={globalState.settings.exportSettings.videoCodec}
							disabled={globalState.getExportState.exportWithoutBackground}
							onchange={() => void Settings.save()}
						>
							{#each videoCodecIds as codec (codec)}
								<option value={codec}>
									{codec === 'h264'
										? $LL.export.h264Compatibility()
										: $LL.export.h265SmallerFiles()}
								</option>
							{/each}
						</select>
						<p class="text-xs text-thirdly mt-2">
							{$LL.export.videoCodecDescription()}
						</p>
					</div>

					<div class="grid grid-cols-1 gap-3">
						{#each performanceProfileIds as id (id)}
							{@const label =
								id === 'fastest'
									? $LL.export.fastest()
									: id === 'balanced'
										? $LL.export.balanced()
										: $LL.export.lowCpu()}
							{@const desc =
								id === 'fastest'
									? $LL.export.fastestDescription()
									: id === 'balanced'
										? $LL.export.balancedDescription()
										: $LL.export.lowCpuDescription()}
							<button
								type="button"
								class="rounded-xl border p-4 text-left transition-colors"
								class:border-accent-primary={globalState.settings.exportSettings
									.performanceProfile === id}
								class:bg-secondary={globalState.settings.exportSettings.performanceProfile === id}
								class:border-color={globalState.settings.exportSettings.performanceProfile !== id}
								onclick={() => void savePerformanceProfile(id)}
							>
								<div class="flex items-center justify-between gap-3">
									<p class="text-sm font-medium text-primary">{label}</p>
									{#if globalState.settings.exportSettings.performanceProfile === id}
										<span class="material-icons text-accent-primary text-lg">check_circle</span>
									{/if}
								</div>
								<p class="mt-1 text-xs text-thirdly">{desc}</p>
							</button>
						{/each}
					</div>
				{/if}

				<div class="mb-4 mt-4">
					<h4 class="text-base font-medium text-secondary mb-1">{$LL.export.background()}</h4>
					<label class="mt-2 flex items-start gap-3 cursor-pointer select-none">
						<input
							type="checkbox"
							class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)]"
							bind:checked={globalState.getExportState.exportWithoutBackground}
						/>
						<span class="text-sm text-primary">
							{$LL.export.exportWithoutBackground()}
							<span class="block text-xs text-thirdly mt-1">
								{$LL.export.rendersOnlyOverlay()}
							</span>
						</span>
					</label>

					{#if globalState.getExportState.exportWithoutBackground}
						<div class="">
							<label class="block text-sm text-primary mb-2" for="transparent-export-format">
								{$LL.export.transparentExportFormat()}
							</label>
							<select
								id="transparent-export-format"
								class="input w-full"
								bind:value={globalState.getExportState.transparentExportFormat}
							>
								<option value="mov_prores_4444">{$LL.export.movQtrleRecommended()}</option>
								<option value="webm_vp9_alpha">{$LL.export.webmVp9()}</option>
							</select>
							<p class="text-xs text-thirdly mt-2">
								{$LL.export.movQtrleCompatibility()}
							</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
