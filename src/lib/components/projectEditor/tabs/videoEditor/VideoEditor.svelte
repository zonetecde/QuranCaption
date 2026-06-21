<script lang="ts">
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import AssetsManager from './assetsManager/AssetsManager.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { get } from 'svelte/store';

	let stockMediaOpen = $derived(globalState.stockMediaLibrary.libraryOpen);
	let assetsTrayExpanded = $state(true);

	$effect(() => {
		if (stockMediaOpen) {
			assetsTrayExpanded = true;
		}
	});
</script>

<div class="video-editor-mobile-shell">
	<section class="video-editor-preview-shell">
		<VideoPreview showControls useSplitHeight={false} />
	</section>

	<section
		class="video-editor-assets-tray"
		class:collapsed={!assetsTrayExpanded}
		class:library-open={stockMediaOpen}
	>
		<button
			class="video-editor-assets-toggle"
			type="button"
			aria-expanded={assetsTrayExpanded}
			onclick={() => (assetsTrayExpanded = !assetsTrayExpanded)}
		>
			<span class="video-editor-assets-toggle-title">
				<span class="material-icons text-[20px]">video_library</span>
				<span>{get(LL).editor.assets()}</span>
			</span>
			<span class="material-icons text-[20px]">
				{assetsTrayExpanded ? 'expand_more' : 'expand_less'}
			</span>
		</button>

		<section class="video-editor-assets-content">
			<AssetsManager {stockMediaOpen} showHeader={false} embedded />
		</section>
	</section>

	<section class="video-editor-timeline-shell">
		<Timeline useSplitHeight={false} />
	</section>
</div>

<style>
	.video-editor-mobile-shell {
		display: flex;
		height: 100%;
		min-height: 0;
		width: 100%;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem;
		overflow: hidden;
	}

	.video-editor-preview-shell,
	.video-editor-timeline-shell {
		display: flex;
		min-height: 0;
		overflow: hidden;
		border: 1px solid var(--border-color);
		border-radius: 12px;
	}

	.video-editor-preview-shell {
		flex: 1 1 0;
		flex-direction: column;
		min-height: 220px;
		background: var(--bg-primary);
	}

	.video-editor-timeline-shell {
		flex: 1 1 0;
		min-height: 220px;
		background: var(--timeline-bg-primary);
	}

	.video-editor-assets-tray {
		display: flex;
		flex-shrink: 0;
		min-height: 40px;
		max-height: min(36dvh, 360px);
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border-color);
		border-radius: 12px;
		background: var(--bg-secondary);
		transition: max-height 0.2s ease;
	}

	.video-editor-assets-tray.collapsed {
		max-height: 40px;
	}

	.video-editor-assets-tray.library-open {
		max-height: min(46dvh, 460px);
	}

	.video-editor-assets-toggle {
		display: flex;
		min-height: 40px;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border-bottom: 1px solid var(--border-color);
		padding: 0.45rem 0.8rem;
		color: var(--text-primary);
	}

	.video-editor-assets-toggle-title {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 0.625rem;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.video-editor-assets-content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		padding: 0.75rem;
	}

	.video-editor-assets-content :global([data-tour-id='assets-manager']) {
		background: transparent;
	}

	@media (orientation: landscape) {
		.video-editor-mobile-shell {
			gap: 0.4rem;
			padding: 0.4rem;
		}

		.video-editor-preview-shell,
		.video-editor-timeline-shell {
			min-height: 160px;
		}

		.video-editor-assets-tray {
			max-height: min(42dvh, 300px);
		}

		.video-editor-assets-tray.library-open {
			max-height: min(52dvh, 360px);
		}
	}
</style>
