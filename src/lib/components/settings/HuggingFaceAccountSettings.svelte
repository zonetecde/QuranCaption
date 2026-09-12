<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import LL from '$lib/i18n/i18n-svelte';

	type AccountStatus = {
		configured: boolean;
		valid: boolean;
		username: string | null;
	};

	type Copy = {
		huggingFaceAccount: () => string;
		huggingFaceQuotaDescription: () => string;
		huggingFaceTokenPlaceholder: () => string;
		huggingFaceConfigured: () => string;
		huggingFaceNotConfigured: () => string;
		huggingFaceConnectedBadge: () => string;
		huggingFaceConfigureBadge: () => string;
		huggingFaceInvalidToken: () => string;
		huggingFaceConnect: () => string;
		huggingFaceDisconnect: () => string;
		huggingFaceCreateToken: () => string;
		huggingFaceTokenGuide: () => string;
		huggingFaceValidationFailed: () => string;
	};

	let { badge = false }: { badge?: boolean } = $props();
	let copy = $derived($LL.settings as unknown as Copy);
	let token = $state('');
	let status = $state<AccountStatus | null>(null);
	let isLoading = $state(true);
	let error = $state('');
	let isExpanded = $state(false);

	/** Charge l'état du compte Hugging Face depuis le coffre-fort du système. */
	async function refreshStatus(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			status = await invoke<AccountStatus>('hugging_face_account_status');
		} catch {
			error = copy.huggingFaceValidationFailed();
		} finally {
			isLoading = false;
		}
	}

	/** Valide puis stocke le token Hugging Face dans le coffre-fort du système. */
	async function connect(): Promise<void> {
		if (!token.trim()) return;
		isLoading = true;
		error = '';
		try {
			status = await invoke<AccountStatus>('hugging_face_account_connect', { token });
			token = '';
			isExpanded = false;
		} catch {
			error = copy.huggingFaceInvalidToken();
		} finally {
			isLoading = false;
		}
	}

	/** Supprime le token Hugging Face du coffre-fort du système. */
	async function disconnect(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			await invoke('hugging_face_account_disconnect');
			status = { configured: false, valid: false, username: null };
		} catch {
			error = copy.huggingFaceValidationFailed();
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void refreshStatus();
	});
</script>

{#if badge}
	<div class="relative shrink-0">
		{#if status?.configured && status.valid}
			<div
				class="flex items-center gap-1.5 rounded-full border border-green-500/40 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400"
			>
				<span class="material-icons text-sm">cloud_done</span>
				{copy.huggingFaceConnectedBadge()}
			</div>
		{:else}
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-full border border-color bg-primary px-2.5 py-1 text-xs text-secondary transition-colors hover:border-[var(--accent-primary)] hover:text-primary"
				disabled={isLoading}
				onclick={() => (isExpanded = !isExpanded)}
			>
				<span class="material-icons text-sm">add_link</span>
				{isLoading ? '...' : copy.huggingFaceConfigureBadge()}
			</button>

			{#if isExpanded}
				<div
					class="absolute right-0 top-full z-20 mt-2 w-[min(20rem,calc(100vw-4rem))] rounded-xl border border-color bg-primary p-3 shadow-xl"
				>
					<p class="text-xs text-thirdly">{copy.huggingFaceQuotaDescription()}</p>
					<div class="mt-3 flex gap-2">
						<input
							type="password"
							class="min-w-0 flex-1 rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary outline-none focus:border-[var(--accent-primary)]"
							placeholder={copy.huggingFaceTokenPlaceholder()}
							bind:value={token}
							disabled={isLoading}
							onkeydown={(event) => event.key === 'Enter' && void connect()}
						/>
						<button
							class="btn-accent px-3 py-2 text-xs"
							disabled={isLoading || !token.trim()}
							onclick={connect}
						>
							{copy.huggingFaceConnect()}
						</button>
					</div>
					{#if error}
						<p class="mt-2 text-xs text-red-400" role="alert">{error}</p>
					{/if}
					<div class="mt-3 flex gap-4 text-xs">
						<button
							class="text-accent hover:underline"
							onclick={() => openUrl('https://huggingface.co/settings/tokens/new?tokenType=read')}
						>
							{copy.huggingFaceCreateToken()}
						</button>
						<button
							class="text-accent hover:underline"
							onclick={() => openUrl('https://huggingface.co/docs/hub/security-tokens')}
						>
							{copy.huggingFaceTokenGuide()}
						</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
{:else}
	<div class="rounded-xl border border-color bg-primary p-4">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<h4 class="text-sm font-semibold text-primary">{copy.huggingFaceAccount()}</h4>
				<p class="mt-1 text-xs text-thirdly">{copy.huggingFaceQuotaDescription()}</p>
			</div>
			<div
				class="flex shrink-0 items-center gap-1.5 rounded-full border border-color px-2.5 py-1 text-xs"
				class:text-green-400={status?.configured && status.valid}
				class:text-thirdly={!status?.configured || !status.valid}
			>
				<span class="material-icons text-sm">
					{status?.configured && status.valid ? 'check_circle' : 'link_off'}
				</span>
				{#if isLoading}
					...
				{:else if status?.configured && status.valid}
					{copy.huggingFaceConfigured()}
				{:else}
					{copy.huggingFaceNotConfigured()}
				{/if}
			</div>
		</div>

		{#if status?.configured && status.valid}
			<div class="mt-3 flex items-center justify-between gap-3">
				<p class="truncate text-sm text-secondary">
					{status.username ? `@${status.username}` : copy.huggingFaceConfigured()}
				</p>
				<button class="btn px-3 py-1.5 text-xs" disabled={isLoading} onclick={disconnect}>
					{copy.huggingFaceDisconnect()}
				</button>
			</div>
		{:else}
			<div class="mt-3 flex gap-2">
				<input
					type="password"
					class="min-w-0 flex-1 rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary outline-none focus:border-[var(--accent-primary)]"
					placeholder={copy.huggingFaceTokenPlaceholder()}
					bind:value={token}
					disabled={isLoading}
					onkeydown={(event) => event.key === 'Enter' && void connect()}
				/>
				<button
					class="btn-accent px-3 py-2 text-xs"
					disabled={isLoading || !token.trim()}
					onclick={connect}
				>
					{copy.huggingFaceConnect()}
				</button>
			</div>
		{/if}

		{#if error}
			<p class="mt-2 text-xs text-red-400" role="alert">{error}</p>
		{/if}

		<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
			<button
				class="text-accent hover:underline"
				onclick={() => openUrl('https://huggingface.co/settings/tokens/new?tokenType=read')}
			>
				{copy.huggingFaceCreateToken()}
			</button>
			<button
				class="text-accent hover:underline"
				onclick={() => openUrl('https://huggingface.co/docs/hub/security-tokens')}
			>
				{copy.huggingFaceTokenGuide()}
			</button>
		</div>
	</div>
{/if}
