<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs, TrackType } from '$lib/classes/enums';
	import Settings from '$lib/classes/Settings.svelte';

	const PAD = 10;
	const TOOLTIP_W = 340;
	const TOOLTIP_H = 240;
	const MARGIN = 10;

	type TourStep = {
		targetId: string;
		title: string;
		description: string;
		/** 'button' = user clicks Next/Finish; 'auto' = advances when condition becomes true */
		advanceMode: 'button' | 'auto';
		advanceCondition?: () => boolean;
		buttonLabel?: string;
		/** When true, clicks inside the spotlight area are forwarded to the element below */
		allowSpotlightClick?: boolean;
		/** Optional hint shown below the progress bar instead of generic action text */
		hint?: string;
	};

	const TOUR_STEPS: TourStep[] = [
		// ── HOME PAGE ──────────────────────────────────────────────────────────
		{
			targetId: 'new-project-button',
			title: 'Create a new project',
			description:
				'This button lets you create a new Quran Caption project. For each recitation you want to subtitle, you create one project.',
			advanceMode: 'button',
			buttonLabel: 'Next'
		},
		{
			targetId: 'tutorial-project-card',
			title: 'Open the tutorial project',
			description:
				'A tutorial project with <strong>Surah Al-Fatihah</strong> by Yasser Al-Dosari has been created for you. <strong>Click on it</strong> to get started!',
			advanceMode: 'auto',
			advanceCondition: () => globalState.currentProject !== null,
			allowSpotlightClick: true,
			hint: 'Click the tutorial project card to continue'
		},
		// ── VIDEO EDITOR ────────────────────────────────────────────────────────
		{
			targetId: 'assets-manager',
			title: 'The Video Editor',
			description:
				'Here you import your Quran recitation. Three options: <strong>Add Asset</strong> (local file), <strong>Download Quran Recitation</strong> (Quran.com or MP3Quran), or <strong>Download from Social Media</strong> for YouTube and other public platforms. The tutorial project already has an audio asset ready for you.',
			advanceMode: 'button',
			buttonLabel: 'Next'
		},
		{
			targetId: 'assets-manager',
			title: 'Add to the timeline',
			description:
				'Hover over the asset card in the list on the left and click <strong>Add to Timeline</strong> to load it into the editing timeline.',
			advanceMode: 'auto',
			advanceCondition: () =>
				(globalState.currentProject?.content.timeline.getFirstTrack(TrackType.Audio)?.clips
					?.length ?? 0) > 0,
			allowSpotlightClick: true,
			hint: 'Hover the asset and click "Add to Timeline" to continue'
		},
		// ── SUBTITLES EDITOR ────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-subtitles',
			title: 'Go to Subtitles Editor',
			description:
				'Head to the <strong>Subtitles Editor</strong> to start adding Quranic text to your audio.',
			advanceMode: 'auto',
			advanceCondition: () =>
				globalState.currentProject?.projectEditorState.currentTab ===
				ProjectEditorTabs.SubtitlesEditor,
			allowSpotlightClick: true,
			hint: 'Click the "Subtitles editor" tab to continue'
		},
		{
			targetId: 'verse-picker-area',
			title: 'Manual segmentation',
			description:
				'Subtitles are added in real time as the recitation plays. Press <strong>Space</strong> to play/pause, then use <strong>↑</strong> / <strong>↓</strong> to select the words currently being recited. When the reciter finishes a verse or part of one, press <strong>Enter</strong> to validate — the subtitle is added between the end of the previous one and the current playback position.',
			advanceMode: 'button',
			buttonLabel: 'Next'
		},
		{
			targetId: 'subtitles-help-button',
			title: 'Shortcuts & walkthrough',
			description:
				"Hover the <strong>?</strong> icon to see all available shortcuts (basmala, isti'adha, silence, and more). You'll also find a short <strong>interactive video</strong> that walks you through the manual subtitle workflow.",
			advanceMode: 'button',
			buttonLabel: 'Next'
		},
		{
			targetId: 'auto-segment-button',
			title: 'Auto-Segment with AI',
			description:
				'Prefer automation? Click <strong>Auto-Segment</strong> and the AI will detect verse boundaries automatically. Segments marked <strong>yellow or red</strong> in the timeline are low-confidence — you <strong>must review</strong> them.',
			advanceMode: 'button',
			buttonLabel: 'Next'
		},
		// ── TRANSLATIONS ────────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-translations',
			title: 'Go to Translations',
			description: 'Head to the <strong>Translations</strong> tab to manage your translations.',
			advanceMode: 'auto',
			advanceCondition: () =>
				globalState.currentProject?.projectEditorState.currentTab ===
				ProjectEditorTabs.Translations,
			allowSpotlightClick: true,
			hint: 'Click the "Translations" tab to continue'
		},
		{
			targetId: 'translations-workspace',
			title: 'Adapting translations',
			description:
				'Notice how verse 1:7 was recited in <strong>two parts</strong> — two subtitle segments. For each, only the <strong>matching portion of the translation</strong> is selected. Drag across the words to do this. A word-by-word English helper is available for non-Arabic speakers.',
			advanceMode: 'button',
			buttonLabel: 'Next'
		},
		// ── STYLE ───────────────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-style',
			title: 'Go to Style',
			description:
				'Head to the <strong>Style</strong> tab to customize the visual appearance of your video.',
			advanceMode: 'auto',
			advanceCondition: () =>
				globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style,
			allowSpotlightClick: true,
			hint: 'Click the "Style" tab to continue'
		},
		{
			targetId: 'style-subtabs',
			title: 'Three style categories',
			description:
				'<strong>Global</strong> — video overlay, reciter name, surah name...<br><strong>Arabic</strong> — Arabic text style, font, size, shadow...<br><strong>Translation</strong> — translation text style.',
			advanceMode: 'button',
			buttonLabel: 'Next'
		},
		// ── EXPORT ──────────────────────────────────────────────────────────────
		{
			targetId: 'nav-tab-export',
			title: 'Go to Export',
			description: 'Finally, head to the <strong>Export</strong> tab to render your video.',
			advanceMode: 'auto',
			advanceCondition: () =>
				globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Export,
			allowSpotlightClick: true,
			hint: 'Click the "Export" tab to continue'
		},
		{
			targetId: 'export-range',
			title: 'Export your video',
			description:
				"Use the range inputs to export only a <strong>portion</strong> of the video if needed. No need for 4K — it's mostly text and will only slow down your machine!",
			advanceMode: 'button',
			buttonLabel: 'Finish'
		}
	];

	let { close }: { close: () => void } = $props();

	// Measure title bar height so the overlay never covers it
	let titleBarHeight = $state(0);
	$effect(() => {
		const titleBar = document.querySelector('[data-tauri-drag-region]');
		if (titleBar) {
			titleBarHeight = titleBar.getBoundingClientRect().height;
		}
	});

	let currentStepIndex = $state(0);
	let currentStep = $derived(TOUR_STEPS[currentStepIndex]);

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
		return () => {
			window.removeEventListener('resize', handleWindowResize);
			if (resizeObserver) resizeObserver.disconnect();
		};
	});

	// Update spotlight when step changes
	$effect(() => {
		const step = currentStep; // reactive dependency
		tooltipVisible = false;

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const el = findTarget(step.targetId);
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
		});
	});

	// Auto-advance watcher
	$effect(() => {
		const step = currentStep; // reactive dependency
		if (step.advanceMode !== 'auto' || !step.advanceCondition) return;
		const met = step.advanceCondition();
		if (met) {
			const tid = setTimeout(() => advance(), 400);
			return () => clearTimeout(tid);
		}
	});

	/** Forward a mouse event to the real element below the blocking overlay */
	function forwardEventThrough(e: MouseEvent) {
		const blocker = e.currentTarget as HTMLElement;
		blocker.style.pointerEvents = 'none';
		const elBelow = document.elementFromPoint(e.clientX, e.clientY);
		blocker.style.pointerEvents = 'auto';
		if (elBelow) {
			elBelow.dispatchEvent(
				new MouseEvent(e.type, {
					bubbles: true,
					cancelable: true,
					clientX: e.clientX,
					clientY: e.clientY,
					screenX: e.screenX,
					screenY: e.screenY
				})
			);
		}
	}

	/** Handle click on the blocking overlay: forward only if this step allows spotlight interaction */
	function handleBlockingClick(e: MouseEvent) {
		const { clientX, clientY } = e;
		// clientY is viewport-relative; spotlightRect.y is relative to the overlay container (below titlebar)
		const relY = clientY - titleBarHeight;
		const { x, y, w, h } = spotlightRect;
		const insideSpotlight = clientX >= x && clientX <= x + w && relY >= y && relY <= y + h;
		if (insideSpotlight && currentStep.allowSpotlightClick) {
			forwardEventThrough(e);
		}
		// All other clicks (outside spotlight OR info-only steps): silently blocked
		e.stopPropagation();
		e.preventDefault();
	}

	/** Pass mousemove through the spotlight area only for interactive steps (hover effects) */
	function handleBlockingMouseMove(e: MouseEvent) {
		if (!currentStep.allowSpotlightClick) return;
		const { clientX, clientY } = e;
		const relY = clientY - titleBarHeight;
		const { x, y, w, h } = spotlightRect;
		if (clientX >= x && clientX <= x + w && relY >= y && relY <= y + h) {
			forwardEventThrough(e);
		}
	}

	function advance() {
		if (currentStepIndex < TOUR_STEPS.length - 1) {
			currentStepIndex++;
		} else {
			completeTour();
		}
	}

	function goBack() {
		if (currentStepIndex > 0) {
			currentStepIndex--;
		}
	}

	async function completeTour() {
		if (globalState.settings) {
			globalState.settings.persistentUiState.hasSeenTour = true;
			await Settings.save();
		}
		close();
	}
</script>

<!-- Root container: position fixed, starts below the title bar so window controls remain accessible -->
<div
	style="position: fixed; top: {titleBarHeight}px; left: 0; right: 0; bottom: 0; z-index: 9997; pointer-events: none; overflow: hidden;"
>
	<!-- Blocking overlay: always present, blocks all interactions outside the spotlight -->
	<div
		style="position: absolute; inset: 0; pointer-events: auto; cursor: default;"
		onclick={handleBlockingClick}
		onmousemove={handleBlockingMouseMove}
		onmouseenter={handleBlockingMouseMove}
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
			<button class="tour-close-btn" onclick={completeTour} title="Skip tutorial">
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
				<span class="ml-auto text-xs" style="color: var(--text-thirdly);"
					>{currentStepIndex + 1} / {TOUR_STEPS.length}</span
				>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between gap-2">
				{#if currentStepIndex > 0}
					<button class="tour-btn-secondary" onclick={goBack}>
						<span class="material-icons" style="font-size: 14px;">arrow_back</span>
						Back
					</button>
				{:else}
					<div></div>
				{/if}

				{#if currentStep.advanceMode === 'button'}
					<button class="tour-btn-primary" onclick={advance}>
						{currentStep.buttonLabel ?? 'Next'}
						<span class="material-icons" style="font-size: 14px;">
							{currentStep.buttonLabel === 'Finish' ? 'check' : 'arrow_forward'}
						</span>
					</button>
				{:else if currentStep.hint}
					<div class="flex items-center gap-1 text-xs" style="color: var(--text-thirdly);">
						<span class="material-icons animate-pulse" style="font-size: 12px;">touch_app</span>
						{currentStep.hint}
					</div>
				{/if}
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
