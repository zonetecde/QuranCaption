<script lang="ts">
	import type { LocalEngineStatus } from '$lib/services/AutoSegmentation';

	let {
		title,
		status,
		isInstalling,
		onInstall,
		isInstalled
	} = $props<{
		title: string;
		status: LocalEngineStatus | null;
		isInstalling: boolean;
		onInstall: () => void;
		isInstalled: boolean;
	}>();

	const badgeTone = $derived(() => (status?.usable ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'));
	const badgeText = $derived(() => {
		if (status?.usable) return 'Ready';
		if (status?.ready && status?.tokenRequired && !status?.tokenProvided) return 'Token needed';
		if (status?.ready) return 'Installed';
		return 'Needs install';
	});
</script>

<div class="rounded-lg border border-color p-3">
	<div class="flex items-center justify-between gap-3">
		<div>
			<div class="text-sm font-medium text-primary">{title}</div>
			<div class="text-xs text-thirdly">{status?.message ?? 'Status unavailable'}</div>
		</div>
		<div class="flex items-center gap-2">
			<span class={`rounded-full px-2 py-0.5 text-xs ${badgeTone()}`}>{badgeText()}</span>
			<button class="btn px-3 py-1.5 text-xs" onclick={onInstall} disabled={isInstalling || isInstalled}>
				{#if isInstalling}
					Installing...
				{:else if isInstalled}
					Installed
				{:else}
					Install
				{/if}
			</button>
		</div>
	</div>
</div>
