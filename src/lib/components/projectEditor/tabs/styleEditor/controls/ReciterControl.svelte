<script lang="ts">
	import { ProjectDetail } from '$lib/classes';
	import RecitersManager from '$lib/classes/Reciter';
	import EditableText from '$lib/components/misc/EditableText.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectService } from '$lib/services/ProjectService';

	const speakerCalligraphy = $derived(
		RecitersManager.getReciterObject(globalState.currentProject!.detail.speaker)
	);
</script>

<div class="flex flex-col gap-x-2">
	<EditableText
		text={$LL.home.projectReciterPlaceholder()}
		bind:value={globalState.currentProject!.detail.speaker}
		maxLength={ProjectDetail.SPEAKER_MAX_LENGTH}
		placeholder={globalState.currentProject!.detail.speaker}
		textClasses="font-semibold"
		action={async () => {
			await ProjectService.saveDetail(globalState.currentProject!.detail);
		}}
		inputType="speakers"
	/>

	{#if speakerCalligraphy.number !== -1}
		<p class="reciters-font -mr-3 text-center text-3xl">{speakerCalligraphy.number}</p>
	{:else}
		<p class="mt-2 text-sm text-yellow-500">
			<span class="material-icons text-[18px]! align-middle">block</span>
			{$LL.editor.arabicCalligraphyUnavailable()}
		</p>
	{/if}
</div>
