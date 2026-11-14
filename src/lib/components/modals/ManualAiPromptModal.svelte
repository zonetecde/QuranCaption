<script lang="ts">
	import type { ManualAiSession } from '$lib/services/ManualAiSession.svelte';
	import TranslationsEditorModalShell from '$lib/components/projectEditor/tabs/translationsEditor/modal/shared/TranslationsEditorModalShell.svelte';
	import ManualAiWorkflow from './ManualAiWorkflow.svelte';

	let {
		session,
		title,
		error,
		close
	}: {
		session: ManualAiSession;
		title: string;
		error: string;
		close: () => void;
	} = $props();
</script>

<TranslationsEditorModalShell
	{title}
	{close}
	icon="content_paste"
	shellClass="w-[720px] max-w-[94vw] max-h-[88vh]"
	bodyClass="min-h-0 overflow-y-auto"
>
	{#if error}<p role="alert" class="px-5 pt-5 text-sm text-red-400">{error}</p>{/if}
	<ManualAiWorkflow {session} />
</TranslationsEditorModalShell>
