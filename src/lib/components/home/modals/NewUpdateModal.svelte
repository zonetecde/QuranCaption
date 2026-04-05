<script lang="ts">
	import { onMount } from 'svelte';
	import MarkdownIt from 'markdown-it';
	import anchor from 'markdown-it-anchor';
	import { slide } from 'svelte/transition';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { VersionService, type UpdateInfo } from '$lib/services/VersionService.svelte';
	import { globalState } from '$lib/runes/main.svelte';

	let { update, resolve }: { update: UpdateInfo; resolve: () => void } = $props();
	let html = '<p>Loading...</p>';
	let sanitized = $state('<p>Loading...</p>');
	let changelogSrcdoc = $state('<!doctype html><html><body>Loading...</body></html>');
	type DomPurifyLike = { sanitize: (dirty: string) => string };
	let DOMPurify: DomPurifyLike | undefined;

	function isDomPurifyLike(value: unknown): value is DomPurifyLike {
		return (
			typeof value === 'object' &&
			value !== null &&
			'sanitize' in value &&
			typeof (value as DomPurifyLike).sanitize === 'function'
		);
	}

	// markdown-it configuré avec plugins utiles
	const md = new MarkdownIt({ html: true, linkify: true, typographer: true }).use(anchor);

	onMount(async () => {
		// DOMPurify nécessite window -> import dynamique pour éviter les erreurs côté SSR
		try {
			const mod = await import('dompurify');
			const maybeDefault = (mod as { default?: unknown }).default ?? mod;
			// some bundlers export a factory; if so, call it with window
			if (typeof maybeDefault === 'function') {
				const maybeInstance = (maybeDefault as (targetWindow: Window) => unknown)(window);
				DOMPurify = isDomPurifyLike(maybeInstance) ? maybeInstance : undefined;
			} else if (isDomPurifyLike(maybeDefault)) {
				DOMPurify = maybeDefault;
			}
		} catch (_e) {
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
		changelogSrcdoc = buildChangelogSrcdoc(sanitized);
	}

	/**
	 * Build the changelog iframe srcdoc.
	 * Uses the current document's styles for theming.
	 * @param content
	 */
	function buildChangelogSrcdoc(content: string): string {
		if (typeof document === 'undefined') {
			return `<!doctype html><html><body>${content}</body></html>`;
		}

		const rootStyles = getComputedStyle(document.body);
		const bgPrimary = rootStyles.getPropertyValue('--bg-primary').trim() || '#111827';
		const bgSecondary = rootStyles.getPropertyValue('--bg-secondary').trim() || '#1f2937';
		const bgAccent = rootStyles.getPropertyValue('--bg-accent').trim() || '#0f172a';
		const textPrimary = rootStyles.getPropertyValue('--text-primary').trim() || '#f9fafb';
		const textSecondary = rootStyles.getPropertyValue('--text-secondary').trim() || '#d1d5db';
		const textThirdly = rootStyles.getPropertyValue('--text-thirdly').trim() || '#9ca3af';
		const borderColor = rootStyles.getPropertyValue('--border-color').trim() || '#374151';
		const accentPrimary = rootStyles.getPropertyValue('--accent-primary').trim() || '#60a5fa';
		const accentSecondary = rootStyles.getPropertyValue('--accent-secondary').trim() || '#3b82f6';

		return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<style>
		:root {
			color-scheme: dark;
			--bg-primary: ${bgPrimary};
			--bg-secondary: ${bgSecondary};
			--bg-accent: ${bgAccent};
			--text-primary: ${textPrimary};
			--text-secondary: ${textSecondary};
			--text-thirdly: ${textThirdly};
			--border-color: ${borderColor};
			--accent-primary: ${accentPrimary};
			--accent-secondary: ${accentSecondary};
		}

		html, body {
			margin: 0;
			min-height: 100%;
			background: var(--bg-accent);
			color: var(--text-primary);
			font-family: Arial, sans-serif;
		}

		body {
			box-sizing: border-box;
			padding: 1rem;
		}

		* {
			box-sizing: border-box;
		}

		p, li, blockquote, td, th {
			color: var(--text-secondary);
			line-height: 1.65;
		}

		h1, h2, h3, h4, h5, h6 {
			color: var(--text-primary);
			margin: 1.25em 0 0.5em;
			line-height: 1.25;
		}

		h1 { font-size: 1.5rem; }
		h2 { font-size: 1.25rem; }
		h3 { font-size: 1.1rem; }

		strong, b {
			color: var(--text-primary);
			font-weight: 700;
		}

		a {
			color: var(--accent-primary);
		}

		a:hover {
			color: var(--accent-secondary);
		}

		code {
			background: var(--bg-secondary);
			color: var(--accent-primary);
			padding: 0.15rem 0.35rem;
			border-radius: 0.35rem;
			border: 1px solid color-mix(in srgb, var(--border-color) 85%, transparent);
		}

		pre {
			background: var(--bg-primary);
			color: var(--text-primary);
			padding: 1rem;
			border-radius: 0.75rem;
			border: 1px solid var(--border-color);
			overflow: auto;
		}

		pre code {
			background: transparent;
			border: 0;
			padding: 0;
			color: inherit;
		}

		hr {
			border: 0;
			border-top: 1px solid var(--border-color);
			margin: 1.25rem 0;
		}

		blockquote {
			margin: 1rem 0;
			padding: 0.75rem 1rem;
			border-left: 4px solid var(--accent-primary);
			background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
		}

		table {
			width: 100%;
			border-collapse: collapse;
		}

		th, td {
			border: 1px solid var(--border-color);
			padding: 0.5rem 0.75rem;
		}

		ul, ol {
			padding-left: 1.5rem;
		}

		img {
			max-width: 100%;
		}
	</style>
</head>
<body>
	${content}
</body>
</html>`;
	}

	async function startUpdate() {
		await VersionService.downloadAndInstall();
	}

	async function openManualDownloadPage() {
		await openUrl('https://github.com/zonetecde/QuranCaption/releases/latest');
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
	let currentTheme = $derived(globalState.settings?.persistentUiState?.theme || 'default');
	let isUpdating = $derived(
		updateState === 'downloading' || updateState === 'installing' || updateState === 'done'
	);

	$effect(() => {
		currentTheme;
		renderMarkdown();
	});
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
					<h2 class="text-2xl font-bold text-primary">
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
					<p class="text-sm text-secondary">
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
					class="w-10 h-10 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary group cursor-pointer"
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
					<span class="text-xs text-secondary">
						{#if updateState === 'done'}
							Complete
						{:else if updateState === 'installing'}
							Installing...
						{:else}
							Downloading...
						{/if}
					</span>
					<span class="text-xs text-secondary font-medium">
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
						{updateError ||
							'Something went wrong while updating. Please try again or download the update manually.'}
					</p>
				</div>
			</div>
		{:else if updateState === 'done'}
			<!-- Success state -->
			<div class="flex-1 flex flex-col items-center justify-center text-center gap-4">
				<div
					class="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center animate-bounce"
				>
					<span class="material-icons text-green-400 text-3xl">rocket_launch</span>
				</div>
				<div>
					<h3 class="text-lg font-semibold text-primary mb-2">Update Installed!</h3>
					<p class="text-sm text-secondary">The app will restart automatically in a moment...</p>
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
					class="changelog-prose prose prose-sm max-w-none h-full bg-accent px-4 rounded-lg overflow-auto border border-color"
				>
					<iframe
						title="Update changelog"
						class="h-full w-full rounded-lg"
						srcdoc={changelogSrcdoc}
						sandbox="allow-popups allow-popups-to-escape-sandbox"
					></iframe>
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
					class="btn px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105 flex items-center gap-2"
					onclick={openManualDownloadPage}
				>
					<span class="material-icons text-sm">open_in_new</span>
					Download Manually
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
					class="btn px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105 flex items-center gap-2"
					onclick={openManualDownloadPage}
				>
					<span class="material-icons text-sm">open_in_new</span>
					Download Manually
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
	:global(.changelog-prose) {
		color: var(--text-primary) !important;
	}

	:global(
		.changelog-prose h1,
		.changelog-prose h2,
		.changelog-prose h3,
		.changelog-prose h4,
		.changelog-prose h5,
		.changelog-prose h6
	) {
		color: var(--text-primary) !important;
		margin-top: 1.5em !important;
		margin-bottom: 0.5em !important;
	}

	:global(.changelog-prose h1) {
		font-size: 1.5em !important;
		font-weight: 700 !important;
	}

	:global(.changelog-prose h2) {
		font-size: 1.3em !important;
		font-weight: 600 !important;
	}

	:global(.changelog-prose h3) {
		font-size: 1.1em !important;
		font-weight: 600 !important;
	}

	:global(.changelog-prose p) {
		color: var(--text-secondary) !important;
		margin-bottom: 1em !important;
	}

	:global(.changelog-prose ul, .changelog-prose ol) {
		color: var(--text-secondary) !important;
		margin: 1em 0 !important;
	}

	:global(.changelog-prose li) {
		color: var(--text-secondary) !important;
		margin: 0.25em 0 !important;
	}

	:global(.changelog-prose strong) {
		color: var(--text-primary) !important;
		font-weight: 600 !important;
	}

	:global(.changelog-prose code) {
		background-color: var(--bg-secondary) !important;
		color: var(--accent-primary) !important;
		padding: 0.2em 0.4em !important;
		border-radius: 0.25rem !important;
		font-size: 0.9em !important;
		border: 1px solid var(--border-color) !important;
	}

	:global(.changelog-prose a) {
		color: var(--accent-primary) !important;
		text-decoration: underline !important;
	}

	:global(.changelog-prose a:hover) {
		color: var(--accent-secondary) !important;
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
