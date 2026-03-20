<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onDestroy, onMount } from 'svelte';
	import {
		checkMediaDependencies,
		getManualInstallHelp,
		installMediaDependencies,
		type MediaBinaryName,
		type MediaDependencyGateState
	} from '$lib/services/MediaDependenciesService';

	let { mode = 'startup', close }: { mode?: 'startup' | 'youtube'; close?: () => void } = $props();

	let gateState: MediaDependencyGateState | null = $state(null);
	let isChecking = $state(false);
	let isInstalling = $state(false);
	let installStatus = $state('');
	let installProgress = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);
	let manualHelp = $state<string[]>([]);

	let unlistenStatus: UnlistenFn | null = null;

	function canClose(): boolean {
		return mode === 'youtube';
	}

	function getOs(): 'windows' | 'macos' | 'linux' {
		const userAgent = navigator?.userAgent?.toLowerCase() ?? '';
		if (userAgent.includes('win')) return 'windows';
		if (userAgent.includes('mac')) return 'macos';
		return 'linux';
	}

	function ffmpegGuideUrl(): string {
		const os = getOs();
		if (os === 'windows') return 'https://www.gyan.dev/ffmpeg/builds/';
		if (os === 'macos') return 'https://brew.sh/';
		return 'https://ffmpeg.org/download.html';
	}

	function ytDlpGuideUrl(): string {
		return 'https://github.com/yt-dlp/yt-dlp/releases/latest';
	}

	function missingDependencies(): MediaBinaryName[] {
		if (!gateState) return ['ffmpeg', 'ffprobe', 'yt-dlp'];
		const missing: MediaBinaryName[] = [];
		if (!gateState.statusByName.ffmpeg.installed) missing.push('ffmpeg');
		if (!gateState.statusByName.ffprobe.installed) missing.push('ffprobe');
		if (!gateState.statusByName['yt-dlp'].installed) missing.push('yt-dlp');
		return missing;
	}

	function updateManualHelp(): void {
		manualHelp = getManualInstallHelp(missingDependencies());
	}

	function maybeAutoClose(): void {
		if (!close || !gateState) return;
		if (mode === 'startup' && !gateState.isStartupBlocked) {
			close();
			return;
		}
		if (mode === 'youtube' && !gateState.isYtDlpMissing) {
			close();
		}
	}

	async function refreshState(): Promise<void> {
		isChecking = true;
		errorMessage = null;
		try {
			gateState = await checkMediaDependencies();
			updateManualHelp();
			maybeAutoClose();
		} catch (error) {
			errorMessage = `Failed to check media dependencies: ${error}`;
			manualHelp = getManualInstallHelp(['ffmpeg', 'ffprobe', 'yt-dlp']);
		} finally {
			isChecking = false;
		}
	}

	async function installDependencies(): Promise<void> {
		if (isInstalling) return;
		isInstalling = true;
		errorMessage = null;

		try {
			const result = await installMediaDependencies({
				includeYtDlp: true,
				onlyMissing: true
			});
			if (result.failed.length > 0) {
				errorMessage = result.failed.map((failure) => `${failure.name}: ${failure.reason}`).join('\n');
			}
			await refreshState();
		} catch (error) {
			errorMessage = `Installation failed: ${error}`;
		} finally {
			isInstalling = false;
		}
	}

	onMount(async () => {
		unlistenStatus = await listen<{ step?: string; message?: string; progress?: number }>(
			'media-deps-install-status',
			(event) => {
				const message = event.payload?.message;
				if (typeof message === 'string' && message.trim()) {
					installStatus = message;
				}
				if (typeof event.payload?.progress === 'number') {
					installProgress = event.payload.progress;
				}
			}
		);
		await refreshState();
	});

	onDestroy(() => {
		unlistenStatus?.();
	});
</script>

<div class="bg-secondary border-color border rounded-2xl w-[640px] max-w-[92vw] shadow-2xl shadow-black">
	<div class="px-6 py-5 border-b border-color flex items-center justify-between">
		<div>
			<h2 class="text-2xl font-bold text-primary">
				{mode === 'startup'
					? 'Media Dependencies Required'
					: 'yt-dlp Required for YouTube Download'}
			</h2>
			<p class="text-sm text-secondary mt-1">
				{mode === 'startup'
					? 'Quran Caption needs ffmpeg and ffprobe before continuing.'
					: 'YouTube download requires yt-dlp (ffmpeg/ffprobe are recommended too).'}
			</p>
		</div>
		{#if canClose()}
			<button
				class="w-9 h-9 rounded-full hover:bg-accent text-secondary hover:text-primary transition-colors"
				onclick={() => close?.()}
				aria-label="Close media dependencies modal"
			>
				<span class="material-icons">close</span>
			</button>
		{/if}
	</div>

	<div class="p-6 space-y-4">
		<div class="bg-accent border border-color rounded-lg p-4">
			<div class="space-y-2">
				{#each gateState?.binaryStatuses ?? [] as status}
					<div class="flex items-center justify-between text-sm">
						<div class="flex items-center gap-2">
							<span
								class={`material-icons text-base ${
									status.installed ? 'text-green-400' : 'text-red-400'
								}`}
							>
								{status.installed ? 'check_circle' : 'error'}
							</span>
							<span class="font-medium text-primary">{status.name}</span>
						</div>
						<span class="text-secondary">
							{status.installed
								? status.versionOutput || 'Installed'
								: status.errorCode || 'Not installed'}
						</span>
					</div>
				{/each}
			</div>
		</div>

		{#if installStatus}
			<div class="bg-accent border border-color rounded-lg p-4">
				<p class="text-sm text-secondary">{installStatus}</p>
				{#if installProgress !== null}
					<div class="mt-3 h-2 bg-primary rounded-full overflow-hidden">
						<div
							class="h-full bg-accent-primary transition-all duration-200"
							style={`width: ${Math.max(0, Math.min(100, installProgress))}%`}
						></div>
					</div>
				{/if}
			</div>
		{/if}

		{#if errorMessage}
			<div class="bg-red-500/10 border border-red-500/40 rounded-lg p-4">
				<p class="text-red-300 text-sm whitespace-pre-line">{errorMessage}</p>
			</div>
		{/if}

		{#if manualHelp.length > 0 && (errorMessage || (gateState && missingDependencies().length > 0))}
			<div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-2">
				<h3 class="text-sm font-semibold text-blue-300">Manual installation help</h3>
				{#each manualHelp as line}
					<p class="text-xs text-blue-200">{line}</p>
				{/each}
			</div>
		{/if}

		{#if gateState && missingDependencies().length > 0}
			<div class="flex flex-wrap gap-2">
				{#if missingDependencies().includes('ffmpeg') || missingDependencies().includes('ffprobe')}
					<button
						class="btn px-3 py-1.5 text-xs"
						onclick={() => openUrl(ffmpegGuideUrl())}
					>
						Open FFmpeg Guide
					</button>
				{/if}
				{#if missingDependencies().includes('yt-dlp')}
					<button class="btn px-3 py-1.5 text-xs" onclick={() => openUrl(ytDlpGuideUrl())}>
						Open yt-dlp Download
					</button>
				{/if}
			</div>
		{/if}

		<div class="flex justify-end gap-3 pt-2">
			<button
				class="btn px-4 py-2 text-sm"
				onclick={refreshState}
				disabled={isChecking || isInstalling}
			>
				{isChecking ? 'Checking...' : 'Retry'}
			</button>
			<button
				class="btn-accent px-4 py-2 text-sm"
				onclick={installDependencies}
				disabled={isInstalling}
			>
				{isInstalling ? 'Installing...' : 'Install Missing Dependencies'}
			</button>
		</div>
	</div>
</div>
