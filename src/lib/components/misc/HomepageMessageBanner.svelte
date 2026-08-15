<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import type { HomepageMessage } from '$lib/services/StylePresetLibraryService';
	import { openUrl } from '@tauri-apps/plugin-opener';

	let {
		message,
		ondismiss
	}: {
		message: HomepageMessage;
		ondismiss: () => void;
	} = $props();

	let expandedImageUrl = $state<string | null>(null);
	let isPlayStoreLink = $derived(
		message.playStoreUrl?.toLowerCase().includes('play.google') ?? false
	);
	let linkLabel = $derived(
		message.playStoreUrl
			? new URL(message.playStoreUrl).hostname.replace(/^www\./, '') || message.playStoreUrl
			: ''
	);
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') expandedImageUrl = null;
	}}
/>

{#if !globalState.uiState.isTourActive && !globalState.uiState.showReflectionPrompt}
	<div class="message-banner fixed z-[900]">
		<div class="banner-content p-4">
			<div class="flex items-start gap-3">
				<div class="banner-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
					<span class="material-icons-outlined text-xl">campaign</span>
				</div>

				<div class="min-w-0 flex-1">
					<h2 class="text-primary mt-0.5 text-lg leading-tight font-bold">
						{message.title}
					</h2>
					<p class="text-secondary mt-1.5 whitespace-pre-line text-sm leading-relaxed">
						{message.description}
					</p>
				</div>
			</div>

			{#if message.imageUrls.length > 0}
				<div
					class="gallery mt-4 flex min-w-0 gap-2.5 overflow-x-auto rounded-2xl bg-black/10 p-2.5"
				>
					{#each message.imageUrls as imageUrl (imageUrl)}
						<button
							class="message-image-frame flex h-52 shrink-0 items-center justify-center overflow-hidden rounded-xl"
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

			<div class="mt-4 flex flex-col gap-2">
				{#if message.playStoreUrl}
					<button
						class="play-store-btn flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-all duration-200"
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
				<button
					class="dismiss-btn text-secondary hover:text-primary flex min-h-12 items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition-colors"
					onclick={ondismiss}
				>
					{$LL.common.dismiss()}
				</button>
			</div>
		</div>
	</div>

	{#if expandedImageUrl}
		<div
			class="image-viewer fixed inset-0 z-[5000] flex items-center justify-center p-4"
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
		left: 0;
		width: 100%;
		max-height: calc(100dvh - env(safe-area-inset-top) - 1rem);
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
		padding-bottom: max(1rem, env(safe-area-inset-bottom));
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
		max-width: 82vw;
		background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 7px 20px rgba(0, 0, 0, 0.2);
		cursor: zoom-in;
	}

	.message-image-frame:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 55%, var(--border-color));
	}

	.message-image {
		max-width: 82vw;
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
			transform: translateY(100%);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes viewerFadeIn {
		from {
			opacity: 0;
		}
	}
</style>
