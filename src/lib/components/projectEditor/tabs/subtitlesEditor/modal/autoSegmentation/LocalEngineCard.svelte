<script lang="ts">
	import type { LocalEngineStatus } from '$lib/services/AutoSegmentation';
	import LL from '$lib/i18n/i18n-svelte';

	let { title, status, isInstalling, onInstall, isInstalled } = $props<{
		title: string;
		status: LocalEngineStatus | null;
		isInstalling: boolean;
		onInstall: () => void;
		isInstalled: boolean;
	}>();

	const badgeTone = $derived(() =>
		status?.usable ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
	);
	const badgeText = $derived(() => {
		if (status?.usable) return $LL.editor.readyToUse();
		if (status?.ready && status?.tokenRequired && !status?.tokenProvided) return $LL.editor.engineNotConfigured();
		if (status?.ready) return $LL.common.done();
		return $LL.editor.selectEngine();
	});
</script>

<div class="rounded-lg border border-color p-3">
	<div class="flex items-center justify-between gap-3">
		<div>
			<div class="text-sm font-medium text-primary">{title}</div>
			<div class="text-xs text-thirdly">{status?.message ?? $LL.editor.noEnginesAvailable()}</div>
		</div>
		<div class="flex items-center gap-2">
			<span class={`rounded-full px-2 py-0.5 text-xs ${badgeTone()}`}>{badgeText()}</span>
			{#if !isInstalled}
				<button class="btn px-3 py-1.5 text-xs" onclick={onInstall} disabled={isInstalling}>
					{#if isInstalling}
						{$LL.common.processing()}
					{:else if isInstalled}
						{$LL.common.done()}
					{:else}
						{$LL.common.download()}
					{/if}
				</button>
			{/if}
		</div>
	</div>
</div>
