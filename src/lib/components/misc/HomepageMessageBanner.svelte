<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import type { HomepageMessage } from '$lib/services/StylePresetLibraryService';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import QRCode from 'qrcode';

	let {
		message,
		ondismiss
	}: {
		message: HomepageMessage;
		ondismiss: () => void;
	} = $props();

	let qrCodeDataUrl = $state('');
	let expandedImageUrl = $state<string | null>(null);
	let isPlayStoreLink = $derived(
		message.playStoreUrl?.toLowerCase().includes('play.google') ?? false
	);
	let linkLabel = $derived(
		message.playStoreUrl
			? new URL(message.playStoreUrl).hostname.replace(/^www\./, '') || message.playStoreUrl
			: ''
	);

	$effect(() => {
		let cancelled = false;
		qrCodeDataUrl = '';
		if (!message.qrCodeUrl) return;

		void QRCode.toDataURL(message.qrCodeUrl, {
			width: 220,
			margin: 1,
			color: { dark: '#111827', light: '#ffffff' }
		})
			.then((dataUrl) => {
				if (!cancelled) qrCodeDataUrl = dataUrl;
			})
			.catch((error) => console.error('Failed to generate homepage message QR code:', error));

		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') expandedImageUrl = null;
	}}
/>

{#if !globalState.uiState.isTourActive && !globalState.uiState.showReflectionPrompt}
	<div class="message-banner fixed z-[900]">
		<div class="banner-content p-4 sm:p-5">
			<div class="flex items-start gap-3.5">
				<div class="banner-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
					<span class="material-icons-outlined text-2xl">campaign</span>
				</div>

				<div class="min-w-0 flex-1">
					<h2 class="text-primary mt-1 text-lg leading-tight font-bold sm:text-xl">
						{message.title}
					</h2>
					<p
						class="text-secondary mt-1.5 whitespace-pre-line text-[13px] leading-relaxed sm:text-sm"
					>
						{message.description}
					</p>
				</div>

				{#if qrCodeDataUrl}
					<div class="qr-card shrink-0 rounded-xl bg-white p-1.5">
						<img class="h-24 w-24" src={qrCodeDataUrl} alt={message.title} />
					</div>
				{/if}
			</div>

			{#if message.imageUrls.length > 0}
				<div
					class="gallery mt-4 justify-center bg-black/10 rounded-3xl flex min-w-0 gap-2.5 overflow-x-auto py-3"
				>
					{#each message.imageUrls as imageUrl (imageUrl)}
						<button
							class="message-image-frame flex h-44 shrink-0 items-center justify-center overflow-hidden rounded-xl"
							type="button"
							onclick={() => (expandedImageUrl = imageUrl)}
							aria-label={message.title}
						>
							<img
								class="message-image h-full w-auto object-contain"
								src={imageUrl}
								alt={message.title}
							/>
						</button>
					{/each}
				</div>
			{/if}

			<div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<button
					class="dismiss-btn text-secondary hover:text-primary flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors"
					onclick={ondismiss}
				>
					{$LL.common.dismiss()}
				</button>
				{#if message.playStoreUrl}
					<button
						class="play-store-btn flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-200"
						onclick={() => void openUrl(message.playStoreUrl!)}
					>
						{#if isPlayStoreLink}
							<svg class="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
								<path
									fill="#00d7fe"
									d="M6.2 3.6C5.5 4.3 5.1 5.4 5.1 6.8v34.4c0 1.4.4 2.5 1.1 3.2l.1.1L25.6 25.2v-.5L6.3 3.5z"
								/>
								<path
									fill="#ffce00"
									d="m32 31.7-6.4-6.4v-.5l6.4-6.4.1.1 7.6 4.3c2.2 1.2 2.2 3.3 0 4.5l-7.7 4.4z"
								/>
								<path
									fill="#ff3a44"
									d="M32.1 31.6 25.5 25 6.2 44.4c1.1 1.2 2.9 1.3 5 .2l20.9-13z"
								/>
								<path fill="#00f076" d="M32.1 18.4 11.2 5.4c-2.1-1.2-3.9-1-5 .2L25.5 25l6.6-6.6z" />
							</svg>
							<span>Play Store</span>
						{:else}
							<span class="material-icons-outlined text-lg">open_in_new</span>
							<span>{linkLabel}</span>
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>

	{#if expandedImageUrl}
		<div
			class="image-viewer fixed inset-0 z-[5000] flex items-center justify-center p-8"
			role="presentation"
			onclick={() => (expandedImageUrl = null)}
		>
			<button
				class="absolute top-5 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-black/85"
				type="button"
				onclick={() => (expandedImageUrl = null)}
				aria-label={$LL.common.close()}
				title={$LL.common.close()}
			>
				<span class="material-icons-outlined">close</span>
			</button>
			<img
				class="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
				src={expandedImageUrl}
				alt={message.title}
				onclick={(event) => event.stopPropagation()}
			/>
		</div>
	{/if}
{/if}

<style>
	.message-banner {
		bottom: 0;
		left: 50%;
		width: min(calc(100vw - 1rem), 820px);
		max-height: calc(100vh - 3.5rem);
		transform: translateX(-50%);
		overflow-y: auto;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--accent-primary) 10%, var(--bg-secondary)) 0%,
				var(--bg-secondary) 100%
			),
			var(--bg-secondary);
		border: 1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-color));
		border-bottom: 0;
		border-radius: 1.25rem 1.25rem 0 0;
		box-shadow:
			0 -14px 42px rgba(0, 0, 0, 0.36),
			inset 0 1px 0 rgba(255, 255, 255, 0.12);
		animation: bannerSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.message-banner::before {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.08),
			transparent 20%,
			transparent 80%,
			rgba(255, 255, 255, 0.05)
		);
		content: '';
		pointer-events: none;
	}

	.banner-content {
		position: relative;
	}

	.banner-icon {
		background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
		color: var(--accent-primary);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 0 18px color-mix(in srgb, var(--accent-primary) 24%, transparent);
	}

	.gallery {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--accent-primary) 45%, transparent) transparent;
	}

	.message-image-frame {
		max-width: min(24rem, 70vw);
		background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 7px 20px rgba(0, 0, 0, 0.2);
		cursor: zoom-in;
	}

	.message-image-frame:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 55%, var(--border-color));
	}

	.message-image {
		max-width: min(24rem, 70vw);
	}

	.qr-card {
		box-shadow:
			0 7px 20px rgba(0, 0, 0, 0.24),
			0 0 0 1px rgba(255, 255, 255, 0.16);
	}

	.image-viewer {
		background: rgba(0, 0, 0, 0.88);
		backdrop-filter: blur(12px);
		animation: viewerFadeIn 0.2s ease-out;
	}

	.dismiss-btn {
		border: 1px solid var(--border-color);
		background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
	}

	.dismiss-btn:hover {
		background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
	}

	.play-store-btn {
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: var(--accent-primary);
		color: var(--text-on-accent);
		box-shadow:
			0 10px 24px color-mix(in srgb, var(--accent-primary) 24%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.22);
	}

	.play-store-btn:hover {
		transform: translateY(-1px);
		box-shadow:
			0 12px 30px color-mix(in srgb, var(--accent-primary) 34%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.28);
	}

	@keyframes bannerSlideUp {
		from {
			opacity: 0;
			transform: translate(-50%, 100%);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	@keyframes viewerFadeIn {
		from {
			opacity: 0;
		}
	}
</style>
