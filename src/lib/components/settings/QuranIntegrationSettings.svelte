<script lang="ts">
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';

	const publicState = $derived(quranAuthService.publicState);
	const displayName = $derived(
		publicState.user?.name ||
			publicState.user?.preferredUsername ||
			publicState.user?.email ||
			publicState.user?.sub ||
			''
	);
	const expiresLabel = $derived(
		publicState.expiresAt ? new Date(publicState.expiresAt).toLocaleString() : null
	);

	async function connect(): Promise<void> {
		await quranAuthService.beginLogin();
	}

	async function disconnect(): Promise<void> {
		await quranAuthService.disconnect();
	}
</script>

<div class="space-y-5">
	<div class="space-y-2">
		<h3 class="text-lg font-medium text-primary">Quran.com Integration</h3>
		<p class="text-sm text-thirdly">
			Connect your Quran.com account to unlock bookmarks, preferences, collections, and future sync
			features in Quran Caption.
		</p>
	</div>

	<div class="rounded-2xl border border-color bg-primary p-5 space-y-4">
		<div class="flex items-start justify-between gap-4">
			<div class="space-y-1">
				<div class="flex items-center gap-2">
					<span
						class="inline-flex h-2.5 w-2.5 rounded-full {publicState.status === 'connected'
							? 'bg-emerald-400'
							: publicState.status === 'connecting'
								? 'bg-amber-400'
								: publicState.status === 'error'
									? 'bg-red-400'
									: 'bg-white/20'}"
					></span>
					<p class="text-sm font-semibold text-primary">
						{publicState.status === 'connected'
							? 'Connected'
							: publicState.status === 'connecting'
								? 'Connecting'
								: publicState.status === 'error'
									? 'Connection error'
									: 'Not connected'}
					</p>
				</div>

				{#if publicState.status === 'connected' && displayName}
					<p class="text-sm text-thirdly">Signed in as {displayName}</p>
				{:else if publicState.status === 'connecting'}
					<p class="text-sm text-thirdly">
						Finish the Quran.com login in your browser, then return to Quran Caption.
					</p>
				{:else if publicState.status === 'error' && publicState.errorMessage}
					<p class="text-sm text-red-300">{publicState.errorMessage}</p>
				{:else}
					<p class="text-sm text-thirdly">
						You are currently using Quran Caption without a Quran.com account.
					</p>
				{/if}
			</div>

			<div class="flex gap-2">
				{#if publicState.status === 'connected'}
					<button class="integration-btn integration-danger" onclick={disconnect}>Disconnect</button
					>
				{:else}
					<button
						class="integration-btn integration-primary"
						onclick={connect}
						disabled={publicState.status === 'connecting'}
					>
						{publicState.status === 'connecting'
							? 'Waiting for login...'
							: 'Connect with Quran.com'}
					</button>
				{/if}
			</div>
		</div>

		{#if publicState.status === 'connected'}
			<div class="rounded-xl border border-color bg-secondary p-4 space-y-2">
				<p class="text-xs uppercase tracking-[0.18em] text-thirdly">Account</p>
				<p class="text-sm text-primary break-all">{displayName || publicState.user?.sub}</p>
				<p class="text-xs text-thirdly break-all">Subject: {publicState.user?.sub}</p>
				{#if expiresLabel}
					<p class="text-xs text-thirdly">Access token expires: {expiresLabel}</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.integration-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding-inline: 1rem;
		border-radius: 0.9rem;
		border: 1px solid var(--border-color);
		font-size: 0.85rem;
		font-weight: 600;
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease,
			transform 0.18s ease;
	}

	.integration-btn:hover:enabled {
		transform: translateY(-1px);
	}

	.integration-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.integration-btn.integration-primary {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
		border-color: color-mix(in srgb, var(--accent-primary) 45%, var(--border-color));
	}

	.integration-btn.integration-primary:hover:enabled {
		background: color-mix(in srgb, var(--accent-primary) 28%, transparent);
	}

	.integration-btn.integration-danger {
		color: #fca5a5;
		background: rgba(239, 68, 68, 0.08);
		border-color: rgba(239, 68, 68, 0.25);
	}

	.integration-btn.integration-danger:hover:enabled {
		background: rgba(239, 68, 68, 0.14);
	}
</style>
