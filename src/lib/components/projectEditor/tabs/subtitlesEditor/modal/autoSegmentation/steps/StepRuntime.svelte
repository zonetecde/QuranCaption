<script lang="ts">
	import LocalEngineCard from '../LocalEngineCard.svelte';
	import { maskToken } from '../helpers/format';
	import { getSharedWizard } from '../sharedWizard';
	import LL from '$lib/i18n/i18n-svelte';

	const wizard = getSharedWizard();
	const isCloud = $derived(() => wizard.selection.aiVersion === 'multi_v2');
	const isLocalV2 = $derived(() => wizard.selection.aiVersion === 'multi_v2_local');
	const isMuaalemLocal = $derived(() => wizard.selection.aiVersion === 'muaalem_local');
	const isSurahSplitter = $derived(() => wizard.selection.aiVersion === 'surah_splitter');
	const isLegacy = $derived(() => wizard.selection.aiVersion === 'legacy_v1');
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">{$LL.editor.prepareMethod()}</h3>
		<p class="text-sm text-thirdly">
			{#if isCloud()}
				{$LL.editor.prepareMethodCloudDesc()}
			{:else if isLocalV2()}
				{$LL.editor.prepareMethodLocalV2Desc()}
			{:else if isMuaalemLocal()}
				{$LL.editor.prepareMethodMuaalemDesc()}
			{:else if isSurahSplitter()}
				{$LL.editor.prepareMethodSurahSplitterDesc()}
			{:else}
				{$LL.editor.prepareMethodLegacyDesc()}
			{/if}
		</p>
	</div>

	{#if isCloud()}
		<div class="rounded-xl border border-color bg-accent/40 p-4">
			<div class="mb-2 flex items-center gap-2 text-primary">
				<span class="material-icons">check_circle</span>
				<span class="text-sm font-semibold">{$LL.editor.readyToUse()}</span>
			</div>
			<p class="text-sm text-thirdly">
				{$LL.editor.cloudMethodDescription()}
			</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#if isLocalV2()}
				<div class="rounded-xl border border-color bg-accent/70 p-3">
					<div class="mb-2 text-xs uppercase text-thirdly">{$LL.editor.huggingFaceTokenLabel()}</div>
					<p class="mb-2 text-xs text-thirdly">
						{$LL.editor.hfTokenRequiredHint()}
					</p>
					<div class="mb-2 text-sm font-mono text-primary">
						{maskToken(wizard.selection.hfToken)}
					</div>
					<div class="flex gap-2">
						<button
							class="btn-accent px-3 py-1.5 text-xs"
							onclick={() => void wizard.promptHFToken()}
						>
							{wizard.selection.hfToken ? $LL.editor.updateToken() : $LL.editor.setToken()}
						</button>
						<button
							class="btn px-3 py-1.5 text-xs"
							onclick={() => void wizard.clearHFToken()}
							disabled={!wizard.selection.hfToken}
						>
							{$LL.editor.clearToken()}
						</button>
					</div>
				</div>
			{/if}

			<div class="space-y-2 rounded-xl border border-color p-3">
				<div class="text-xs uppercase text-thirdly">{$LL.editor.requiredLocalPackages()}</div>
				{#if wizard.isCheckingStatus}
					<div class="text-sm text-secondary">{$LL.editor.checkingLocalEngines()}</div>
				{:else if isLegacy()}
					<LocalEngineCard
						title={$LL.editor.legacyWhisper()}
						status={wizard.localStatus?.engines?.legacy ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'legacy'}
						isInstalled={!!wizard.localStatus?.engines?.legacy?.ready}
						onInstall={() => void wizard.installEngine('legacy')}
					/>
				{:else if isLocalV2()}
					<LocalEngineCard
						title={$LL.editor.privateQuranicAligner()}
						status={wizard.localStatus?.engines?.multi ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'multi'}
						isInstalled={!!wizard.localStatus?.engines?.multi?.ready}
						onInstall={() => void wizard.installEngine('multi')}
					/>
				{:else if isMuaalemLocal()}
					<p class="text-xs text-thirdly">
						{$LL.editor.noTokenRequiredHint()}
					</p>
					<LocalEngineCard
						title={$LL.editor.muaalemLocal()}
						status={wizard.localStatus?.engines?.muaalem ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'muaalem'}
						isInstalled={!!wizard.localStatus?.engines?.muaalem?.ready}
						onInstall={() => void wizard.installEngine('muaalem')}
					/>
				{:else}
					<p class="text-xs text-thirdly">
						{$LL.editor.noTokenRequiredSurahSplitterHint()}
					</p>
					<LocalEngineCard
						title={$LL.editor.surahSplitterLocal()}
						status={wizard.localStatus?.engines?.surahSplitter ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'surah_splitter'}
						isInstalled={!!wizard.localStatus?.engines?.surahSplitter?.ready}
						onInstall={() => void wizard.installEngine('surah_splitter')}
					/>
				{/if}
				{#if wizard.installStatus}
					<div
						class="rounded-lg border border-color bg-accent/30 px-3 py-2 text-[11px] font-mono text-thirdly whitespace-pre-wrap break-words"
					>
						{wizard.installStatus}
					</div>
				{/if}
			</div>

			{#if isMuaalemLocal()}
				<div class="rounded-xl border border-color bg-accent/40 p-3 text-xs text-thirdly">
					{$LL.editor.muaalemLocalHint()}
				</div>
			{/if}
			{#if isSurahSplitter()}
				<div class="rounded-xl border border-color bg-accent/40 p-3 text-xs text-thirdly">
					{$LL.editor.surahSplitterLocalHint()}
				</div>
			{/if}
		</div>
	{/if}
</section>
