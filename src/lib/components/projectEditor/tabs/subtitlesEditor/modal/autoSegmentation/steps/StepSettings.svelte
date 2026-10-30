<script lang="ts">
	import { getSharedWizard } from '../sharedWizard';
	import HuggingFaceAccountSettings from '$lib/components/settings/HuggingFaceAccountSettings.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	const wizard = getSharedWizard();
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">{$LL.editor.alignmentSettings()}</h3>
		<p class="text-sm text-thirdly">{$LL.editor.alignmentSettingsDesc()}</p>
	</div>

	<HuggingFaceAccountSettings badge />
	<div class="grid grid-cols-2 gap-3">
		<label class="space-y-1 text-xs text-thirdly">
			<span>{$LL.editor.modelLabel()}</span>
			<select
				value={wizard.selection.cloudModel}
				onchange={(event) => wizard.setCloudModel(event.currentTarget.value as 'Base' | 'Large')}
				class="w-full rounded-lg border border-color bg-bg-primary px-3 py-2 text-sm text-primary"
			>
				<option value="Base">{$LL.editor.cloudModelBase()}</option>
				<option value="Large">{$LL.editor.cloudModelLarge()}</option>
			</select>
		</label>
		<label class="space-y-1 text-xs text-thirdly">
			<span>{$LL.editor.deviceLabel()}</span>
			<select
				value={wizard.selection.device}
				onchange={(event) => wizard.setDevice(event.currentTarget.value as 'GPU' | 'CPU')}
				class="w-full rounded-lg border border-color bg-bg-primary px-3 py-2 text-sm text-primary"
			>
				<option value="GPU">{$LL.editor.cloudDeviceGpu()}</option>
				<option value="CPU">{$LL.editor.cloudDeviceCpu()}</option>
			</select>
		</label>
	</div>

	<div class="rounded-xl border border-color p-4 space-y-2">
		<div class="mb-3 space-y-3 border-b border-color pb-3">
			<label class="block space-y-1 text-xs text-thirdly">
				<span>{$LL.editor.styleName.riwayah()}</span>
				<select
					value={wizard.selection.riwayah}
					onchange={(event) =>
						wizard.setRiwayah(event.currentTarget.value as 'hafs' | 'warsh' | 'qalun' | 'shuba')}
					class="w-full rounded-lg border border-color bg-bg-primary px-3 py-2 text-sm text-primary"
				>
					<option value="hafs">{$LL.editor.segmentationHafs()}</option>
					<option value="warsh">{$LL.editor.segmentationWarsh()}</option>
					<option value="qalun">{$LL.editor.segmentationQalun()}</option>
					<option value="shuba">{$LL.editor.segmentationShuba()}</option>
				</select>
			</label>
			<div class="text-xs uppercase text-thirdly">{$LL.editor.segmentBoundaries()}</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="space-y-1 text-xs text-thirdly">
					<span>{$LL.editor.startEarlier()}</span>
					<input
						type="number"
						min="0"
						max="1000"
						step="10"
						value={wizard.padLeftMs}
						oninput={(event) => wizard.setPadLeft(Number(event.currentTarget.value))}
						class="w-full rounded-lg border border-color bg-bg-primary px-3 py-2 text-sm text-primary"
					/>
				</label>
				<label class="space-y-1 text-xs text-thirdly">
					<span>{$LL.editor.endLater()}</span>
					<input
						type="number"
						min="0"
						max="1000"
						step="10"
						value={wizard.padRightMs}
						oninput={(event) => wizard.setPadRight(Number(event.currentTarget.value))}
						class="w-full rounded-lg border border-color bg-bg-primary px-3 py-2 text-sm text-primary"
					/>
				</label>
			</div>
		</div>
		<label class="flex items-center gap-2 text-sm text-secondary"
			><input
				type="checkbox"
				checked={wizard.fillBySilence}
				onchange={(e) => wizard.setFillBySilence((e.currentTarget as HTMLInputElement).checked)}
				class="accent-accent-primary"
			/>
			{$LL.editor.fillGapsWithSilence()}</label
		>
	</div>
</section>
