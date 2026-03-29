<script lang="ts">
	import { onMount } from 'svelte';
	import MarkdownIt from 'markdown-it';
	import anchor from 'markdown-it-anchor';
	import { slide } from 'svelte/transition';
	import toast from 'svelte-5-french-toast';
	import type { UpdateInfo } from '$lib/services/VersionService.svelte';
	import { VersionService } from '$lib/services/VersionService.svelte';
	import { globalState } from '$lib/runes/main.svelte';

	let { update, resolve }: { update: UpdateInfo; resolve: () => void } = $props();
	let html = '<p>Loading...</p>';
	let sanitized = $state('<p>Loading...</p>');
	let DOMPurify: any | undefined;

	// markdown-it configuré avec plugins utiles
	const md = new MarkdownIt({ html: true, linkify: true, typographer: true }).use(anchor);

	onMount(async () => {
		// DOMPurify nécessite window -> import dynamique pour éviter les erreurs côté SSR
		try {
			//@ts-ignore
			const mod = await import('dompurify');
			DOMPurify = mod && (mod.default || mod);
			// some bundlers export a factory; if so, call it with window
			if (typeof DOMPurify === 'function' && typeof DOMPurify.sanitize !== 'function') {
				DOMPurify = DOMPurify(window);
			}
		} catch (e) {
			DOMPurify = undefined;
		}

		renderMarkdown();
	});

	function renderMarkdown() {
		const src = update?.changelog.trim() || '';
		html = md.render(src);
		if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
			sanitized = DOMPurify.sanitize(html);
		} else {
			// fallback si pas encore chargé: afficher le HTML non-sanitized (normalement on est client)
			sanitized = html;
		}
	}

	async function startUpdate() {
		await VersionService.downloadAndInstall();
	}

	function dismissModal() {
		globalState.settings!.persistentUiState.lastClosedUpdateModal = new Date().toISOString();
		resolve();
	}

	// Reactive derivations from VersionService state
	let updateState = $derived(VersionService.updateState);
	let downloadProgress = $derived(VersionService.downloadProgress);
	let downloadedBytes = $derived(VersionService.downloadedBytes);
	let totalBytes = $derived(VersionService.totalBytes);
	let updateError = $derived(VersionService.updateError);
	let isUpdating = $derived(
		updateState === 'downloading' || updateState === 'installing' || updateState === 'done'
	);
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[600px] max-w-[90vw] h-[500px] shadow-2xl shadow-black flex flex-col relative"
	transition:slide
>
	<!-- Header with gradient background -->
	<div
		class="bg-gradient-to-r from-accent-primary to-accent-secondary rounded-t-2xl px-6 py-6 border-b border-color"
	>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<div class="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center shadow-lg">
					{#if updateState === 'done'}
						<span class="material-icons text-green-400 text-xl">check_circle</span>
					{:else if updateState === 'error'}
						<span class="material-icons text-red-400 text-xl">error</span>
					{:else if isUpdating}
						<span class="material-icons text-accent-primary text-xl animate-spin">sync</span>
					{:else}
						<span class="material-icons text-accent-primary text-xl">system_update</span>
					{/if}
				</div>
				<div>
					<h2 class="text-2xl font-bold text-white">
						{#if updateState === 'done'}
							Update Complete!
						{:else if updateState === 'installing'}
							Installing...
						{:else if updateState === 'downloading'}
							Downloading Update...
						{:else if updateState === 'error'}
							Update Failed
						{:else}
							Update Available!
						{/if}
					</h2>
					<p class="text-sm text-white/80">
						{#if updateState === 'done'}
							Restarting app...
						{:else if updateState === 'downloading'}
							{VersionService.formatBytes(downloadedBytes)} / {totalBytes > 0
								? VersionService.formatBytes(totalBytes)
								: '...'}
						{:else if updateState === 'installing'}
							Applying update...
						{:else if updateState === 'error'}
							{updateError || 'An error occurred'}
						{:else}
							Version {update!.latestVersion || 'Unknown'} is ready
						{/if}
					</p>
				</div>
			</div>

			<!-- Close button (hidden during update) -->
			{#if !isUpdating}
				<button
					class="w-10 h-10 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-white/80 hover:text-white group cursor-pointer"
					onclick={dismissModal}
				>
					<span
						class="material-icons text-lg group-hover:rotate-90 transition-transform duration-200"
					>
						close
					</span>
				</button>
			{/if}
		</div>

		<!-- Progress bar (shown during download/install) -->
		{#if isUpdating}
			<div class="mt-4">
				<div class="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
					<div
						class="h-full rounded-full transition-all duration-300 ease-out"
						class:bg-white={updateState === 'downloading'}
						class:bg-green-400={updateState === 'done' || updateState === 'installing'}
						style="width: {downloadProgress}%"
					></div>
				</div>
				<div class="flex justify-between mt-1.5">
					<span class="text-xs text-white/60">
						{#if updateState === 'done'}
							Complete
						{:else if updateState === 'installing'}
							Installing...
						{:else}
							Downloading...
						{/if}
					</span>
					<span class="text-xs text-white/60 font-medium">
						{downloadProgress}%
					</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Content -->
	<div class="flex-1 flex flex-col p-6 min-h-0">
		{#if updateState === 'error'}
			<!-- Error state -->
			<div class="flex-1 flex flex-col items-center justify-center text-center gap-4">
				<div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
					<span class="material-icons text-red-400 text-3xl">warning</span>
				</div>
				<div>
					<h3 class="text-lg font-semibold text-primary mb-2">Update Failed</h3>
					<p class="text-sm text-secondary max-w-sm">
						{updateError || 'Something went wrong while updating. Please try again or download the update manually.'}
					</p>
				</div>
			</div>
		{:else if updateState === 'done'}
			<!-- Success state -->
			<div class="flex-1 flex flex-col items-center justify-center text-center gap-4">
				<div class="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center animate-bounce">
					<span class="material-icons text-green-400 text-3xl">rocket_launch</span>
				</div>
				<div>
					<h3 class="text-lg font-semibold text-primary mb-2">Update Installed!</h3>
					<p class="text-sm text-secondary">
						The app will restart automatically in a moment...
					</p>
				</div>
			</div>
		{:else}
			<!-- Update info / Changelog -->
			<div class="mb-4">
				<div class="flex items-center gap-2 mb-2">
					<span class="material-icons text-accent-primary text-base">new_releases</span>
					<h3 class="text-lg font-semibold text-primary">What's New</h3>
				</div>
				<div
					class="w-full h-px bg-gradient-to-r from-transparent via-border-color to-transparent"
				></div>
			</div>

			<!-- Changelog content - scrollable -->
			<div class="flex-1 min-h-0">
				<div
					class="prose prose-sm prose-invert max-w-none h-full bg-white/5 px-4 rounded-lg overflow-auto text-white border border-color"
				>
					{@html sanitized}
				</div>
			</div>
		{/if}

		<!-- Action buttons -->
		<div class="flex justify-end gap-3 mt-6 pt-4 border-t border-color">
			{#if updateState === 'error'}
				<button
					class="btn px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105"
					onclick={() => {
						VersionService.resetUpdateState();
						dismissModal();
					}}
				>
					Close
				</button>
				<button
					class="btn-accent px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl flex items-center gap-2"
					onclick={() => {
						VersionService.resetUpdateState();
						startUpdate();
					}}
				>
					<span class="material-icons text-sm">refresh</span>
					Retry
				</button>
			{:else if isUpdating}
				<div class="flex items-center gap-2 text-sm text-secondary">
					<span class="material-icons text-base animate-spin">hourglass_empty</span>
					Please don't close the app...
				</div>
			{:else}
				<button
					class="btn px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105"
					onclick={dismissModal}
				>
					Later
				</button>
				<button
					class="btn-accent px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl flex items-center gap-2"
					onclick={startUpdate}
				>
					<span class="material-icons text-sm">download</span>
					Update Now
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	/* Enhanced prose styling for better markdown rendering */
	:global(.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6) {
		color: white !important;
		margin-top: 1.5em !important;
		margin-bottom: 0.5em !important;
	}

	:global(.prose h1) {
		font-size: 1.5em !important;
		font-weight: 700 !important;
	}

	:global(.prose h2) {
		font-size: 1.3em !important;
		font-weight: 600 !important;
	}

	:global(.prose h3) {
		font-size: 1.1em !important;
		font-weight: 600 !important;
	}

	:global(.prose p) {
		color: rgba(255, 255, 255, 0.9) !important;
		margin-bottom: 1em !important;
	}

	:global(.prose ul, .prose ol) {
		color: rgba(255, 255, 255, 0.9) !important;
		margin: 1em 0 !important;
	}

	:global(.prose li) {
		color: rgba(255, 255, 255, 0.9) !important;
		margin: 0.25em 0 !important;
	}

	:global(.prose strong) {
		color: white !important;
		font-weight: 600 !important;
	}

	:global(.prose code) {
		background-color: rgba(255, 255, 255, 0.1) !important;
		color: #58a6ff !important;
		padding: 0.2em 0.4em !important;
		border-radius: 0.25rem !important;
		font-size: 0.9em !important;
	}

	:global(.prose a) {
		color: #58a6ff !important;
		text-decoration: underline !important;
	}

	:global(.prose a:hover) {
		color: #79c0ff !important;
	}

	/* Spin animation for sync icon */
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.animate-spin {
		animation: spin 1s linear infinite;
	}

	/* Bounce animation for success icon */
	@keyframes bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-10px);
		}
	}
	.animate-bounce {
		animation: bounce 1s ease-in-out infinite;
	}

	/* Icon rotation on close button hover */
	.group:hover .group-hover\:rotate-90 {
		transform: rotate(90deg);
	}
</style>
