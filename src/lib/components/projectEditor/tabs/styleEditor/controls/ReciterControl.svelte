<script lang="ts">
	import { ProjectDetail } from '$lib/classes';
	import RecitersManager from '$lib/classes/Reciter';
	import EditableText from '$lib/components/misc/EditableText.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectService } from '$lib/services/ProjectService';

	const reciter = $derived(
		RecitersManager.getReciterObject(globalState.currentProject!.detail.reciter)
	);
</script>

<div class="flex flex-col gap-x-2">
	<EditableText
		text="Enter project reciter"
		bind:value={globalState.currentProject!.detail.reciter}
		maxLength={ProjectDetail.RECITER_MAX_LENGTH}
		placeholder={globalState.currentProject!.detail.reciter}
		textClasses="font-semibold"
		action={async () => {
			await ProjectService.saveDetail(globalState.currentProject!.detail);
		}}
		inputType="reciters"
	/>

	{#if reciter.number !== -1}
		<p class="reciters-font -mr-3 text-center text-3xl">{reciter.number}</p>
	{:else}
		<p class="mt-2 text-sm text-yellow-500">
			<span class="material-icons text-[18px]! align-middle">block</span>
			{$LL.editor.arabicCalligraphyUnavailable()}
		</p>
	{/if}
</div>
