<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import OpenAISettingsFields from '$lib/components/ai/OpenAISettingsFields.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	function persistSettings(): void {
		void Settings.save();
	}
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-lg font-medium text-primary">{$LL.settings.aiKey()}</h3>
		<p class="mt-1 text-sm text-thirdly">
			{$LL.common.aiKeyDescription()}
		</p>
	</div>

	<div class="rounded-xl border border-color bg-primary p-4">
		<OpenAISettingsFields
			showAdvancedTrimToggle={true}
			onSettingsChanged={persistSettings}
			onBatchSettingsChanged={persistSettings}
			onCandidatesChanged={persistSettings}
		/>
	</div>
</div>
