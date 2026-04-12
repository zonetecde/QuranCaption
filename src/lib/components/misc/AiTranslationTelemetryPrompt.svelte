<script lang="ts">
	import AiTranslationTelemetryService from '$lib/services/AiTranslationTelemetryService';
	import { globalState } from '$lib/runes/main.svelte';

	async function allowTelemetry() {
		await AiTranslationTelemetryService.setTelemetryConsent('granted');
		void AiTranslationTelemetryService.submitPendingToPostHog();
	}

	async function denyTelemetry() {
		await AiTranslationTelemetryService.setTelemetryConsent('denied');
		globalState.uiState.showAiTranslationTelemetryPrompt = false;
	}
</script>

{#if globalState.uiState.showAiTranslationTelemetryPrompt}
	<section
		class="fixed bottom-2 right-3 xl:right-5 z-30 w-[360px] max-w-[calc(100vw-1.5rem)] rounded-2xl overflow-hidden telemetry-prompt"
	>
		<div class="prompt-header px-4 py-3.5">
			<div class="flex items-start gap-3">
				<div
					class="w-9 h-9 rounded-full bg-accent-primary flex items-center justify-center flex-shrink-0 shadow-md"
				>
					<span class="material-icons-outlined text-black text-base">translate</span>
				</div>
				<div>
					<p class="text-sm font-bold text-primary leading-tight">
						Send translation telemetry to improve Quran Caption?
					</p>
					<p class="text-[12px] text-thirdly leading-snug mt-1">
						Would you like to send AI-assisted translations and manual reviews to help improve the
						software?
					</p>
				</div>
			</div>
		</div>

		<div class="px-4 pb-4 pt-3 space-y-3">
			<p class="text-xs text-thirdly">
				{globalState.uiState.aiTranslationTelemetryPendingCount} pending translation item{globalState
					.uiState.aiTranslationTelemetryPendingCount > 1
					? 's'
					: ''} will be sent only once.
			</p>
			<div class="grid grid-cols-2 gap-2">
				<button
					class="action-btn action-no"
					onclick={denyTelemetry}
					disabled={globalState.uiState.aiTranslationTelemetrySubmitting}
				>
					No
				</button>
				<button
					class="action-btn action-yes"
					onclick={allowTelemetry}
					disabled={globalState.uiState.aiTranslationTelemetrySubmitting}
				>
					{#if globalState.uiState.aiTranslationTelemetrySubmitting}
						Sending...
					{:else}
						Yes
					{/if}
				</button>
			</div>
		</div>
	</section>
{/if}

<style>
	.telemetry-prompt {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent-primary) 6%, var(--bg-secondary)) 0%,
			var(--bg-secondary) 100%
		);
		border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-color));
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.38),
			0 0 0 1px color-mix(in srgb, var(--accent-primary) 8%, transparent);
		animation: promptSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes promptSlideIn {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.prompt-header {
		background: linear-gradient(
			120deg,
			color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%,
			transparent 70%
		);
		border-bottom: 1px solid color-mix(in srgb, var(--accent-primary) 12%, var(--border-color));
	}

	.action-btn {
		height: 2.75rem;
		border-radius: var(--radius-l);
		border: 1px solid var(--border-color);
		font-size: 0.85rem;
		font-weight: 600;
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease,
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.action-btn:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.action-btn:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.action-no {
		background: transparent;
		color: var(--text-secondary);
	}

	.action-no:hover:not(:disabled) {
		background: color-mix(in srgb, white 6%, transparent);
		color: var(--text-primary);
	}

	.action-yes {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: var(--text-on-accent);
	}

	.action-yes:hover:not(:disabled) {
		box-shadow: 0 4px 16px color-mix(in srgb, var(--accent-primary) 40%, transparent);
	}
</style>
