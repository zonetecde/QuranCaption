<script lang="ts">
	import LocalEngineCard from '../LocalEngineCard.svelte';
	import { maskToken } from '../helpers/format';
	import { getSharedWizard } from '../sharedWizard';
	import LL from '$lib/i18n/i18n-svelte';

	const wizard = getSharedWizard();
	const isCloud = $derived(() => wizard.selection.aiVersion === 'multi_v2');
	const isLocalV2 = $derived(() => wizard.selection.aiVersion === 'multi_v2_local');
	const isQuranWordTimingOld = $derived(
		() => wizard.selection.aiVersion === 'quran_word_timing_old'
	);
	const isWordTiming = $derived(() => wizard.selection.aiVersion === 'quran_word_timing');
	const isLegacy = $derived(() => wizard.selection.aiVersion === 'legacy_v1');
	const oldWordTimingStatus = $derived(wizard.localStatus?.engines?.quranwordtimingOld);
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">{$LL.editor.prepareMethod()}</h3>
		<p class="text-sm text-thirdly">
			{#if isCloud()}
				{$LL.editor.prepareMethodCloudDesc()}
			{:else if isLocalV2()}
				{$LL.editor.prepareMethodLocalV2Desc()}
			{:else if isQuranWordTimingOld()}
				{$LL.editor.quranwordtimingOldDetail()}
			{:else if isWordTiming()}
				{$LL.editor.quranwordtimingDetail()}
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
					<div class="mb-2 text-xs uppercase text-thirdly">
						{$LL.editor.huggingFaceTokenLabel()}
					</div>
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
						progress={wizard.installStatusProgress}
						statusMessage={wizard.installStatusMessage}
					/>
				{:else if isLocalV2()}
					<LocalEngineCard
						title={$LL.editor.privateQuranicAligner()}
						status={wizard.localStatus?.engines?.multi ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'multi'}
						isInstalled={!!wizard.localStatus?.engines?.multi?.ready}
						onInstall={() => void wizard.installEngine('multi')}
						progress={wizard.installStatusProgress}
						statusMessage={wizard.installStatusMessage}
					/>
				{:else if isWordTiming()}
					<p class="text-xs text-thirdly">
						{($LL.editor as any).quranwordtimingDownloadSizeHint?.() ?? ''}
					</p>
					<LocalEngineCard
						title={$LL.editor.quranwordtimingLabel()}
						status={wizard.localStatus?.engines?.quranwordtiming ?? null}
						isInstalling={wizard.isInstallingDeps &&
							wizard.installingEngine === 'quran_word_timing'}
						isInstalled={!!wizard.localStatus?.engines?.quranwordtiming?.ready}
						onInstall={() => void wizard.installEngine('quran_word_timing')}
						progress={wizard.installStatusProgress}
						statusMessage={wizard.installStatusMessage}
					/>
				{:else}
					<p class="text-xs text-thirdly">
						{$LL.editor.quranwordtimingOldDownloadSizeHint()}
					</p>
					<LocalEngineCard
						title={$LL.editor.quranwordtimingOldLabel()}
						status={oldWordTimingStatus
							? {
									...oldWordTimingStatus,
									message: oldWordTimingStatus.usable
										? $LL.editor.readyToUse()
										: $LL.editor.requiredLocalPackages()
								}
							: null}
						isInstalling={wizard.isInstallingDeps &&
							wizard.installingEngine === 'quran_word_timing_old'}
						isInstalled={!!wizard.localStatus?.engines?.quranwordtimingOld?.ready}
						onInstall={() => void wizard.installEngine('quran_word_timing_old')}
						progress={wizard.installStatusProgress}
						statusMessage={wizard.installStatusMessage}
					/>
				{/if}
				{#if wizard.installStatus && !wizard.isInstallingDeps}
					<div
						class="rounded-lg border border-color bg-accent/30 px-3 py-2 text-[11px] font-mono text-thirdly whitespace-pre-wrap break-words"
					>
						{wizard.installStatus}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</section>
