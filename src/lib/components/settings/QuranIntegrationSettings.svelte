<script lang="ts">
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	let { compact = false }: { compact?: boolean } = $props();

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

{#if compact}
	<button
		class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
		style="background: var(--bg-accent); color: var(--text-secondary);"
		onclick={publicState.status === 'connected' ? disconnect : connect}
		disabled={publicState.status === 'connecting'}
	>
		<span class="material-icons text-base">account_circle</span>
		{publicState.status === 'connected'
			? $LL.settings.disconnect()
			: publicState.status === 'connecting'
				? $LL.settings.waitingForLogin()
				: $LL.settings.connectWithQuranCom()}
	</button>
{:else}
	<div class="space-y-5">
		<div class="space-y-2">
			<h3 class="text-lg font-medium text-primary">{$LL.settings.quranComIntegration()}</h3>
			<p class="text-sm text-thirdly">
				{$LL.common.quranComDescription()}
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
								? $LL.settings.connected()
								: publicState.status === 'connecting'
									? $LL.settings.connecting()
									: publicState.status === 'error'
										? $LL.settings.connectionError()
										: $LL.settings.notConnected()}
						</p>
					</div>

					{#if publicState.status === 'connected' && displayName}
						<p class="text-sm text-thirdly">{$LL.settings.signedInAs({ name: displayName })}</p>
					{:else if publicState.status === 'connecting'}
						<p class="text-sm text-thirdly">
							{$LL.settings.finishLoginBrowser()}
						</p>
					{:else if publicState.status === 'error' && publicState.errorMessage}
						<p class="text-sm text-red-300">{publicState.errorMessage}</p>
					{:else}
						<p class="text-sm text-thirdly">
							{$LL.settings.notConnectedMessage()}
						</p>
					{/if}
				</div>

				<div class="flex gap-2">
					{#if publicState.status === 'connected'}
						<button class="integration-btn integration-danger" onclick={disconnect}
							>{$LL.settings.disconnect()}</button
						>
					{:else}
						<button
							class="integration-btn integration-primary"
							onclick={connect}
							disabled={publicState.status === 'connecting'}
						>
							{publicState.status === 'connecting'
								? $LL.settings.waitingForLogin()
								: $LL.settings.connectWithQuranCom()}
						</button>
					{/if}
				</div>
			</div>

			{#if publicState.status === 'connected'}
				<div class="rounded-xl border border-color bg-secondary p-4 space-y-2">
					<p class="text-xs uppercase tracking-[0.18em] text-thirdly">
						{$LL.settings.accountLabel()}
					</p>
					<p class="text-sm text-primary break-all">{displayName || publicState.user?.sub}</p>
					<p class="text-xs text-thirdly break-all">
						{$LL.settings.subjectLabel({ id: publicState.user?.sub })}
					</p>
					{#if expiresLabel}
						<p class="text-xs text-thirdly">
							{$LL.settings.accessTokenExpires({ date: expiresLabel })}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

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
