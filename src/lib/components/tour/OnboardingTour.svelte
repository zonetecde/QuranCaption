<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { Project, ProjectContent, ProjectDetail, ProjectEditorTabs } from '$lib/classes';
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { onDestroy, untrack } from 'svelte';

	const PAD = 10;
	const TOOLTIP_W = 340;
	const TOOLTIP_H = 240;
	const MARGIN = 10;

	type TourStep = {
		targetId: string;
		title: string;
		description: string;
		buttonLabel?: string;
		tab?: ProjectEditorTabs;
	};

	let previewProject: Project | null = null;
	let disposed = false;
	let preparingPreview = $state(false);
	onDestroy(() => {
		disposed = true;
		if (!previewProject) return;
		if (globalState.currentProject === previewProject) globalState.currentProject = null;
		if (globalState.uiState.tourPreviewProject === previewProject) {
			globalState.uiState.tourPreviewProject = null;
		}
	});
	const TOUR_STEPS = $derived<TourStep[]>([
		// ── HOME PAGE ──────────────────────────────────────────────────────────
		{
			targetId: 'new-project-button',
			title: $LL.tour.stepCreateProjectTitle(),
			description: $LL.tour.stepCreateProjectDesc()
		},
		// ── VIDEO EDITOR ────────────────────────────────────────────────────────
		{
			targetId: 'assets-manager',
			tab: ProjectEditorTabs.VideoEditor,
			title: $LL.tour.stepVideoEditorTitle(),
			description: $LL.tour.stepVideoEditorDesc(),
			buttonLabel: $LL.common.next()
		},
		{
			targetId: 'assets-manager',
			tab: ProjectEditorTabs.VideoEditor,
			title: $LL.tour.stepAddToTimelineTitle(),
			description: $LL.tour.stepAddToTimelineDesc()
		},
		// ── SUBTITLES EDITOR ────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-subtitles',
			tab: ProjectEditorTabs.Transcription,
			title: $LL.tour.stepSubtitlesEditorTitle(),
			description: $LL.tour.stepSubtitlesEditorDesc()
		},
		{
			targetId: 'transcription-composer-area',
			tab: ProjectEditorTabs.Transcription,
			title: $LL.tour.stepManualSegmentationTitle(),
			description: $LL.tour.stepManualSegmentationDesc(),
			buttonLabel: $LL.common.next()
		},
		{
			targetId: 'transcription-help-button',
			tab: ProjectEditorTabs.Transcription,
			title: $LL.tour.stepShortcutsTitle(),
			description: $LL.tour.stepShortcutsDesc(),
			buttonLabel: $LL.common.next()
		},
		// ── TRANSLATIONS ────────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-translations',
			tab: ProjectEditorTabs.Translations,
			title: $LL.tour.stepTranslationsTitle(),
			description: $LL.tour.stepTranslationsDesc()
		},
		{
			targetId: 'translations-workspace',
			tab: ProjectEditorTabs.Translations,
			title: $LL.tour.stepAdaptingTranslationsTitle(),
			description: $LL.tour.stepAdaptingTranslationsDesc(),
			buttonLabel: $LL.common.next()
		},
		// ── STYLE ───────────────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-style',
			tab: ProjectEditorTabs.Style,
			title: $LL.tour.stepStyleTitle(),
			description: $LL.tour.stepStyleDesc()
		},
		{
			targetId: 'style-subtabs',
			tab: ProjectEditorTabs.Style,
			title: $LL.tour.stepStyleCategoriesTitle(),
			description: $LL.tour.stepStyleCategoriesDesc(),
			buttonLabel: $LL.common.next()
		},
		// ── EXPORT ──────────────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-export',
			tab: ProjectEditorTabs.Export,
			title: $LL.tour.stepExportTitle(),
			description: $LL.tour.stepExportDesc()
		},
		{
			targetId: 'export-range',
			tab: ProjectEditorTabs.Export,
			title: $LL.tour.stepExportVideoTitle(),
			description: $LL.tour.stepExportVideoDesc(),
			buttonLabel: $LL.common.finish()
		}
	]);

	let { close }: { close: () => void } = $props();

	// Measure title bar height so the overlay never covers it
	let titleBarHeight = $state(0);
	$effect(() => {
		const titleBar = document.querySelector('[data-tauri-drag-region]');
		if (titleBar) {
			titleBarHeight = titleBar.getBoundingClientRect().height;
		}
	});

	let currentStepIndex = $state(untrack(() => (globalState.currentProject ? 1 : 0)));
	let currentStep = $derived(TOUR_STEPS[currentStepIndex]);
	let previousStepIndex = $derived(currentStepIndex > 1 ? currentStepIndex - 1 : -1);

	$effect(() => {
		const tab = currentStep.tab;
		untrack(() => {
			if (tab && globalState.currentProject) {
				globalState.currentProject.projectEditorState.currentTab = tab;
			}
		});
	});

	$effect(() => {
		if (!globalState.currentProject && currentStepIndex > 0) {
			currentStepIndex = 0;
		}
	});

	let spotlightRect = $state({ x: 0, y: 0, w: 0, h: 0 });
	let tooltipPlacement = $state<'top' | 'bottom' | 'left' | 'right'>('bottom');
	let tooltipLeft = $state(0);
	let tooltipTop = $state(0);
	let tooltipVisible = $state(false);

	let resizeObserver: ResizeObserver | null = null;

	function findTarget(tourId: string): Element | null {
		return document.querySelector(`[data-tour-id="${tourId}"]`);
	}

	function clamp(val: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, val));
	}

	function computePlacement(rect: { x: number; y: number; w: number; h: number }) {
		const vw = window.innerWidth;
		const vh = window.innerHeight - titleBarHeight;
		const spaceBottom = vh - (rect.y + rect.h);
		const spaceTop = rect.y;
		const spaceRight = vw - (rect.x + rect.w);
		const spaceLeft = rect.x;
		const best = Math.max(spaceBottom, spaceTop, spaceRight, spaceLeft);
		if (best === spaceBottom) return 'bottom';
		if (best === spaceTop) return 'top';
		if (best === spaceRight) return 'right';
		return 'left';
	}

	function computeTooltipPosition(rect: typeof spotlightRect, placement: typeof tooltipPlacement) {
		const vw = window.innerWidth;
		// Available height excludes the title bar (overlay starts below it)
		const vh = window.innerHeight - titleBarHeight;
		const OFFSET = 16;
		let left = 0,
			top = 0;

		switch (placement) {
			case 'bottom':
				left = rect.x + rect.w / 2 - TOOLTIP_W / 2;
				top = rect.y + rect.h + OFFSET;
				break;
			case 'top':
				left = rect.x + rect.w / 2 - TOOLTIP_W / 2;
				top = rect.y - TOOLTIP_H - OFFSET;
				break;
			case 'right':
				left = rect.x + rect.w + OFFSET;
				top = rect.y + rect.h / 2 - TOOLTIP_H / 2;
				break;
			case 'left':
				left = rect.x - TOOLTIP_W - OFFSET;
				top = rect.y + rect.h / 2 - TOOLTIP_H / 2;
				break;
		}

		// Always clamp — may slightly overlap spotlight but NEVER goes off-screen
		left = clamp(left, MARGIN, vw - TOOLTIP_W - MARGIN);
		top = clamp(top, MARGIN, vh - TOOLTIP_H - MARGIN);

		return { left, top };
	}

	function updateSpotlight(el: Element) {
		const r = el.getBoundingClientRect();
		// Subtract titleBarHeight because the overlay container starts below the title bar
		spotlightRect = {
			x: r.left - PAD,
			y: r.top - titleBarHeight - PAD,
			w: r.width + PAD * 2,
			h: r.height + PAD * 2
		};
		const placement = computePlacement(spotlightRect);
		tooltipPlacement = placement;
		const pos = computeTooltipPosition(spotlightRect, placement);
		tooltipLeft = pos.left;
		tooltipTop = pos.top;
	}

	function setupResizeObserver(el: Element) {
		if (resizeObserver) resizeObserver.disconnect();
		resizeObserver = new ResizeObserver(() => updateSpotlight(el));
		resizeObserver.observe(el);
	}

	function handleWindowResize() {
		const el = findTarget(currentStep.targetId);
		if (el) updateSpotlight(el);
	}

	$effect(() => {
		window.addEventListener('resize', handleWindowResize);
		window.addEventListener('scroll', handleWindowResize, true);
		return () => {
			window.removeEventListener('resize', handleWindowResize);
			window.removeEventListener('scroll', handleWindowResize, true);
			if (resizeObserver) resizeObserver.disconnect();
		};
	});

	// Observe targets mounted after switching tabs.
	$effect(() => {
		const step = currentStep; // reactive dependency
		tooltipVisible = false;
		let target: Element | null | undefined;
		let frame = 0;
		/** @returns {void} Schedule a target refresh after the current DOM updates. */
		function refreshTarget() {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const el = findTarget(step.targetId);
				if (el === target) return;
				target = el;
				resizeObserver?.disconnect();
				if (el) {
					updateSpotlight(el);
					setupResizeObserver(el);
				} else {
					// Fallback: no spotlight hole, tooltip centered within the overlay area (below titlebar)
					spotlightRect = { x: -9999, y: -9999, w: 0, h: 0 };
					tooltipLeft = window.innerWidth / 2 - TOOLTIP_W / 2;
					tooltipTop = (window.innerHeight - titleBarHeight) / 2 - TOOLTIP_H / 2;
				}
				tooltipVisible = true;
			});
		}
		const observer = new MutationObserver(refreshTarget);
		observer.observe(document.body, { childList: true, subtree: true });
		refreshTarget();
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			resizeObserver?.disconnect();
		};
	});

	/** Block clicks on the interface while presenting it. */
	function handleBlockingClick(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
	}

	/** @returns {Promise<void>} Show the next step, opening an unsaved preview when needed. */
	async function advance(): Promise<void> {
		if (preparingPreview) return;
		if (!globalState.currentProject) {
			preparingPreview = true;
			try {
				const content = await ProjectContent.getDefaultProjectContent();
				if (disposed) return;
				previewProject = new Project(
					new ProjectDetail($LL.tour.stepCreateProjectTitle(), ''),
					content
				);
				globalState.uiState.tourPreviewProject = previewProject;
				globalState.currentProject = previewProject;
			} catch (error) {
				console.error('Failed to prepare tutorial preview', error);
				return;
			} finally {
				preparingPreview = false;
			}
		}
		if (currentStepIndex < TOUR_STEPS.length - 1) {
			currentStepIndex++;
		} else {
			completeTour();
		}
	}

	function goBack() {
		if (previousStepIndex >= 0) {
			currentStepIndex = previousStepIndex;
		}
	}

	async function completeTour() {
		try {
			if (globalState.settings) {
				globalState.settings.persistentUiState.hasSeenTour = true;
				await Settings.save();
			}
		} catch (error) {
			console.error('Failed to save tutorial completion', error);
		} finally {
			close();
		}
	}
</script>

<!-- Root container: position fixed, starts below the title bar so window controls remain accessible -->
<div
	style="position: fixed; top: {titleBarHeight}px; left: 0; right: 0; bottom: 0; z-index: 9997; pointer-events: none; overflow: hidden;"
>
	<div
		style="position: absolute; inset: 0; pointer-events: auto; cursor: default;"
		onclick={handleBlockingClick}
	></div>

	<!-- SVG overlay: dark background with spotlight hole -->
	<svg
		style="position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none;"
		xmlns="http://www.w3.org/2000/svg"
	>
		<defs>
			<mask id="tour-spotlight-mask">
				<rect width="100%" height="100%" fill="white" />
				<rect
					x={spotlightRect.x}
					y={spotlightRect.y}
					width={spotlightRect.w}
					height={spotlightRect.h}
					rx="10"
					fill="black"
					style="transition: x 300ms ease, y 300ms ease, width 300ms ease, height 300ms ease;"
				/>
			</mask>
		</defs>
		<rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#tour-spotlight-mask)" />
		<rect
			x={spotlightRect.x}
			y={spotlightRect.y}
			width={spotlightRect.w}
			height={spotlightRect.h}
			rx="10"
			fill="none"
			stroke="var(--accent-primary)"
			stroke-width="2.5"
			opacity="0.9"
			style="transition: x 300ms ease, y 300ms ease, width 300ms ease, height 300ms ease;"
		/>
	</svg>

	<!-- Tooltip bubble -->
	{#if tooltipVisible}
		<div
			class="tour-tooltip"
			style="position: absolute; left: {tooltipLeft}px; top: {tooltipTop}px; width: {TOOLTIP_W}px; pointer-events: auto;"
		>
			<!-- Skip / close -->
			<button class="tour-close-btn" onclick={completeTour} title={$LL.tour.skipTutorial()}>
				<span class="material-icons" style="font-size: 14px;">close</span>
			</button>

			<!-- Header -->
			<div class="flex items-center gap-2 mb-3">
				<div
					class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
					style="background: color-mix(in srgb, var(--accent-primary) 20%, transparent);"
				>
					<span class="material-icons" style="font-size: 14px; color: var(--accent-primary);"
						>school</span
					>
				</div>
				<h3 class="text-sm font-semibold" style="color: var(--text-primary);">
					{currentStep.title}
				</h3>
			</div>

			<!-- Description -->
			<p class="text-xs leading-relaxed mb-4" style="color: var(--text-secondary);">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html currentStep.description}
			</p>

			<!-- Progress dots -->
			<div class="flex items-center gap-1 mb-3">
				{#each TOUR_STEPS as _step, i (i)}
					<div
						class="rounded-full transition-all duration-300"
						style="
							height: 6px;
							width: {i === currentStepIndex ? '16px' : '6px'};
							background: {i === currentStepIndex
							? 'var(--accent-primary)'
							: i < currentStepIndex
								? 'color-mix(in srgb, var(--accent-primary) 50%, transparent)'
								: 'color-mix(in srgb, var(--text-thirdly) 30%, transparent)'};
						"
					></div>
				{/each}
				<span class="ms-auto text-xs" style="color: var(--text-thirdly);"
					>{currentStepIndex + 1} / {TOUR_STEPS.length}</span
				>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between gap-2">
				{#if previousStepIndex >= 0}
					<button class="tour-btn-secondary" onclick={goBack}>
						<span class="material-icons rtl-mirror" style="font-size: 14px;">arrow_back</span>
						{$LL.common.back()}
					</button>
				{:else}
					<div></div>
				{/if}

				<button class="tour-btn-primary" onclick={advance} disabled={preparingPreview}>
					{currentStep.buttonLabel ?? $LL.common.next()}
					<span
						class="material-icons"
						class:rtl-mirror={currentStep.buttonLabel !== $LL.common.finish()}
						style="font-size: 14px;"
					>
						{currentStep.buttonLabel === $LL.common.finish() ? 'check' : 'arrow_forward'}
					</span>
				</button>
			</div>

			<!-- Directional arrow -->
			<div class="tour-arrow tour-arrow-{tooltipPlacement}"></div>
		</div>
	{/if}
</div>

<!-- end root fixed container -->

<style>
	.tour-tooltip {
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 20px;
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.6),
			0 0 0 1px rgba(255, 255, 255, 0.05);
	}

	.tour-close-btn {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-accent);
		color: var(--text-primary);
		cursor: pointer;
		border: none;
		transition: all 0.2s;
	}

	.tour-close-btn:hover {
		color: var(--text-secondary);
		filter: brightness(1.2);
	}

	.tour-btn-primary {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 16px;
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tour-btn-primary:hover {
		filter: brightness(1.1);
		transform: translateY(-1px);
	}

	.tour-btn-secondary {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 12px;
		background: var(--bg-accent);
		color: var(--text-secondary);
		border: none;
		border-radius: 8px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tour-btn-secondary:hover {
		filter: brightness(1.1);
	}

	/* Directional arrows */
	.tour-arrow {
		position: absolute;
		width: 0;
		height: 0;
	}

	.tour-arrow-bottom {
		top: -9px;
		left: 50%;
		transform: translateX(-50%);
		border-left: 9px solid transparent;
		border-right: 9px solid transparent;
		border-bottom: 9px solid var(--border-color);
	}

	.tour-arrow-bottom::after {
		content: '';
		position: absolute;
		top: 2px;
		left: -8px;
		border-left: 8px solid transparent;
		border-right: 8px solid transparent;
		border-bottom: 8px solid var(--bg-secondary);
	}

	.tour-arrow-top {
		bottom: -9px;
		left: 50%;
		transform: translateX(-50%);
		border-left: 9px solid transparent;
		border-right: 9px solid transparent;
		border-top: 9px solid var(--border-color);
	}

	.tour-arrow-top::after {
		content: '';
		position: absolute;
		bottom: 2px;
		left: -8px;
		border-left: 8px solid transparent;
		border-right: 8px solid transparent;
		border-top: 8px solid var(--bg-secondary);
	}

	.tour-arrow-right {
		left: -9px;
		top: 50%;
		transform: translateY(-50%);
		border-top: 9px solid transparent;
		border-bottom: 9px solid transparent;
		border-right: 9px solid var(--border-color);
	}

	.tour-arrow-right::after {
		content: '';
		position: absolute;
		top: -8px;
		left: 2px;
		border-top: 8px solid transparent;
		border-bottom: 8px solid transparent;
		border-right: 8px solid var(--bg-secondary);
	}

	.tour-arrow-left {
		right: -9px;
		top: 50%;
		transform: translateY(-50%);
		border-top: 9px solid transparent;
		border-bottom: 9px solid transparent;
		border-left: 9px solid var(--border-color);
	}

	.tour-arrow-left::after {
		content: '';
		position: absolute;
		top: -8px;
		right: 2px;
		border-top: 8px solid transparent;
		border-bottom: 8px solid transparent;
		border-left: 8px solid var(--bg-secondary);
	}
</style>
