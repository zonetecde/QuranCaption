<script lang="ts">
	import LocalEngineCard from '../LocalEngineCard.svelte';
	import { maskToken } from '../helpers/format';
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
	const isCloud = $derived(() => wizard.selection.aiVersion === 'multi_v2');
	const isLocalV2 = $derived(() => wizard.selection.aiVersion === 'multi_v2_local');
	const isMuaalemLocal = $derived(() => wizard.selection.aiVersion === 'muaalem_local');
	const isSurahSplitter = $derived(() => wizard.selection.aiVersion === 'surah_splitter');
	const isLegacy = $derived(() => wizard.selection.aiVersion === 'legacy_v1');
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">2. Prepare this method</h3>
		<p class="text-sm text-thirdly">
			{#if isCloud()}
				No local installation is required.
			{:else if isLocalV2()}
				Install the required local packages and configure your Hugging Face token.
			{:else if isMuaalemLocal()}
				Install the required local packages for the Muaalem local workflow.
			{:else if isSurahSplitter()}
				Install the required local packages for the Surah Splitter workflow.
			{:else}
				Install the legacy local dependencies.
			{/if}
		</p>
	</div>

	{#if isCloud()}
		<div class="rounded-xl border border-color bg-accent/40 p-4">
			<div class="mb-2 flex items-center gap-2 text-primary">
				<span class="material-icons">check_circle</span>
				<span class="text-sm font-semibold">Ready to use</span>
			</div>
			<p class="text-sm text-thirdly">
				This method runs remotely and does not need local Python packages.
			</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#if isLocalV2()}
				<div class="rounded-xl border border-color bg-accent/70 p-3">
					<div class="mb-2 text-xs uppercase text-thirdly">Hugging Face token</div>
					<p class="mb-2 text-xs text-thirdly">
						Required for the private local Quranic Universal Aligner models.
					</p>
					<div class="mb-2 text-sm font-mono text-primary">
						{maskToken(wizard.selection.hfToken)}
					</div>
					<div class="flex gap-2">
						<button
							class="btn-accent px-3 py-1.5 text-xs"
							onclick={() => void wizard.promptHFToken()}
						>
							{wizard.selection.hfToken ? 'Update token' : 'Set token'}
						</button>
						<button
							class="btn px-3 py-1.5 text-xs"
							onclick={() => void wizard.clearHFToken()}
							disabled={!wizard.selection.hfToken}
						>
							Clear token
						</button>
					</div>
				</div>
			{/if}

			<div class="space-y-2 rounded-xl border border-color p-3">
				<div class="text-xs uppercase text-thirdly">Required local packages</div>
				{#if wizard.isCheckingStatus}
					<div class="text-sm text-secondary">Checking local engines in background...</div>
				{:else if isLegacy()}
					<LocalEngineCard
						title="Legacy Whisper local packages"
						status={wizard.localStatus?.engines?.legacy ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'legacy'}
						isInstalled={!!wizard.localStatus?.engines?.legacy?.ready}
						onInstall={() => void wizard.installEngine('legacy')}
					/>
				{:else if isLocalV2()}
					<LocalEngineCard
						title="Private Local Quranic Universal Aligner packages"
						status={wizard.localStatus?.engines?.multi ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'multi'}
						isInstalled={!!wizard.localStatus?.engines?.multi?.ready}
						onInstall={() => void wizard.installEngine('multi')}
					/>
				{:else if isMuaalemLocal()}
					<p class="text-xs text-thirdly">
						No token required. Fully local installation with on-device model downloads.
					</p>
					<LocalEngineCard
						title="Muaalem Local packages"
						status={wizard.localStatus?.engines?.muaalem ?? null}
						isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'muaalem'}
						isInstalled={!!wizard.localStatus?.engines?.muaalem?.ready}
						onInstall={() => void wizard.installEngine('muaalem')}
					/>
				{:else}
					<p class="text-xs text-thirdly">
						No token required. Surah Splitter downloads its WhisperX model during the first run.
					</p>
					<LocalEngineCard
						title="Surah Splitter Local packages"
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
					This option is fully local, but it is usually less accurate than the official Quranic
					Universal Aligner pipeline.
				</div>
			{/if}
			{#if isSurahSplitter()}
				<div class="rounded-xl border border-color bg-accent/40 p-3 text-xs text-thirdly">
					This option can auto-detect the surah. Selecting the surah manually in the next step
					improves matching precision.
				</div>
			{/if}
		</div>
	{/if}
</section>
