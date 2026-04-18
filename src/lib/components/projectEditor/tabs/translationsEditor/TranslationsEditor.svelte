<script lang="ts">
	import { fade } from 'svelte/transition';
	import AddTranslationModal from './modal/AddTranslationModal.svelte';
	import TranslationInlineStylePanel from './TranslationInlineStylePanel.svelte';
	import MobileRightDrawer from '$lib/components/misc/MobileRightDrawer.svelte';
	import TranslationsEditorSettings from './leftPanel/TranslationsEditorSettings.svelte';
	import Workspace from './workspace/Workspace.svelte';

	let addTranslationModalVisibility = $state(false);
</script>

<div class="relative flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="w-[230px] 2xl:w-[310px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col"
	>
		<TranslationsEditorSettings
			setAddTranslationModalVisibility={(visible: boolean) =>
				(addTranslationModalVisibility = visible)}
		/>
	</section>
	<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
		<section class="w-full min-w-0 flex flex-col min-h-0">
			<Workspace
				setAddTranslationModalVisibility={(visible: boolean) =>
					(addTranslationModalVisibility = visible)}
			/>
		</section>
	</section>

	<section
		class="hidden 2xl:flex w-[330px] flex-shrink-0 max-h-full overflow-hidden flex-col border-l border-color border-t ml-1 rounded-lg bg-secondary"
	>
		<TranslationInlineStylePanel />
	</section>

	<MobileRightDrawer title="Inline Style Panel" icon="tune" triggerTopClass="top-0">
		<TranslationInlineStylePanel />
	</MobileRightDrawer>
</div>

{#if addTranslationModalVisibility}
	<div class="modal-wrapper" transition:fade>
		<AddTranslationModal close={() => (addTranslationModalVisibility = false)} />
	</div>
{/if}
