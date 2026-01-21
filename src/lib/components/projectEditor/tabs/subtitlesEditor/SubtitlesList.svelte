<script lang="ts">
	import { Clip, Duration, SubtitleClip, TrackType } from '$lib/classes';
	import { ClipWithTranslation, SilenceClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';

	// div contenant tout les sous-titres
	let subtitlesListElement: HTMLDivElement | null = $state(null);
	let lastSubtitleId = 0;

	// timeline settings
	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	// récupère le sous-titre actuellement en train d'être joué
	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay(true);
		});
	});

	$effect(() => {
		const _ = globalState.currentProject!.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips
			.length;

		// Dès qu'on ajoute un sous-titre, scroll en bas de la liste
		const list = document.querySelector('.subtitles-list');
		if (list) {
			list.scrollTop = list.scrollHeight;
		}
	});

	$effect(() => {
		// scroll sur le sous-titre actuellement en train d'être joué
		const subtitle = currentSubtitle();
		if (!subtitle || !globalState.getVideoPreviewState.isPlaying) {
			return;
		}
		if (subtitle.id === lastSubtitleId) {
			return;
		}
		lastSubtitleId = subtitle.id;

		const listElement = subtitlesListElement;
		if (!listElement) return;

		const target = listElement.querySelector(
			`[data-subtitle-id="${subtitle.id}"]`
		) as HTMLElement | null;
		if (!target) return;

		// si le scroll est petit, alors smooth, sinon instant
		const targetTop = target.offsetTop;
		const listScrollTop = listElement.scrollTop;
		const listHeight = listElement.clientHeight;
		const targetCenter = targetTop - listScrollTop - listHeight / 2;
		const scrollDistance = Math.abs(targetCenter);
		const behavior = scrollDistance < 500 ? 'smooth' : 'instant';
		target.scrollIntoView({ block: 'center', behavior });
	});
</script>

<div class="subtitles-panel z-20">
	<div class="panel-header">
		<h3 class="text-primary">Subtitles</h3>
		<div class="count-badge">
			{globalState.currentProject!.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips.length}
		</div>
	</div>

	<div class="subtitles-list" bind:this={subtitlesListElement}>
		{#each globalState.currentProject!.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips as _clip, index (_clip.id)}
			{@const clip = _clip as Clip}
			{@const subtitleClip = clip as SubtitleClip}
			<div
				data-subtitle-id={clip.id}
				onclick={() => {
					const s = globalState.currentProject!.projectEditorState.subtitlesEditor;
					if (s.editSubtitle && s.editSubtitle.id === clip.id) {
						// Si on reclique sur le même, on désélectionne
						s.editSubtitle = null;
						return;
					}
					if (clip instanceof SilenceClip || clip instanceof ClipWithTranslation) {
						if (clip instanceof ClipWithTranslation) {
							clip.markAsManualEdit();
						}
						s.editSubtitle = clip;
					}
				}}
				class="subtitle-card cursor-pointer hover:border-[var(--accent-primary)] hover:bg-opacity-80! hover:-translate-y-0.5! transition-all duration-200"
				class:silence={subtitleClip.type === 'Silence'}
				class:predefined={subtitleClip.type === 'Pre-defined Subtitle'}
				class:selected={globalState.currentProject!.projectEditorState.subtitlesEditor.editSubtitle
					?.id === clip.id}
				class:current={currentSubtitle()?.id === clip.id}
			>
				<div class="card-header">
					<div class="timing-info">
						<span class="timestamp monospaced"
							>{new Duration(clip.startTime).getFormattedTime(false, false)}</span
						>
					</div>

					{#if subtitleClip.type !== 'Silence' && subtitleClip.type !== 'Pre-defined Subtitle'}
						<div class="verse-number">
							<span class="monospaced">{subtitleClip.surah}:{subtitleClip.verse}</span>
						</div>
					{:else}
						<div
							class="type-badge"
							class:silence={subtitleClip.type === 'Silence'}
							class:predefined={subtitleClip.type === 'Pre-defined Subtitle'}
						>
							{subtitleClip.type === 'Silence' ? 'SILENCE' : 'PRE-DEFINED'}
						</div>
					{/if}
				</div>

				{#if subtitleClip.type === 'Silence'}
					<div class="silence-indicator h-0">
						<div class="silence-icon">🔇</div>
						<span class="silence-text text-thirdly">Silent segment</span>
					</div>
				{:else}
					<div
						class="text-content arabic"
						class:custom={subtitleClip.type === 'Pre-defined Subtitle'}
					>
						{subtitleClip.text}
					</div>

					{#if Object.keys(subtitleClip.translations).length > 0}
						<div class="translations">
							{#each Object.keys(subtitleClip.translations) as translation}
								{#if translation.startsWith('type') === false}
									<div class="translation-item">
										<span class="lang-code monospaced">{translation.slice(0, 3).toUpperCase()}</span
										>
										<span class="translation-text text-secondary">
											{subtitleClip.translations[translation].text}
										</span>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.subtitles-panel {
		height: 100%;
		display: flex;
		flex-direction: column;
		background-color: var(--bg-primary);
		border-left: 1px solid var(--border-color);
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		border-bottom: 1px solid var(--border-color);
		background-color: var(--bg-secondary);
		flex-shrink: 0;
	}

	.panel-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.count-badge {
		background-color: var(--accent-primary);
		color: black;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 0.5rem;
		min-width: 1.5rem;
		text-align: center;
	}

	.subtitles-list {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
		gap: 0.5rem;
		display: flex;
		flex-direction: column;
	}

	.subtitle-card {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 0.75rem;
		padding: 1rem;
		position: relative;
	}

	.subtitle-card.selected {
		border-color: orange !important;
		border-width: 1.5px;
	}
	.subtitle-card.selected:hover {
		border-color: orange !important;
		border-width: 1.5px;
	}

	.subtitle-card.current {
		border-color: #866322 !important;
		box-shadow: 0 6px 16px rgba(242, 201, 76, 0.25);
	}

	.subtitle-card.silence {
		border-left: 3px solid var(--text-thirdly);
		background-color: var(--bg-accent);
	}

	.subtitle-card.predefined {
		border-left: 3px solid var(--accent-secondary);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.timing-info .timestamp {
		background-color: var(--bg-accent);
		color: var(--accent-primary);
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--border-color);
	}

	.verse-number {
		background-color: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--border-color);
	}

	.type-badge {
		font-size: 0.6875rem;
		font-weight: 700;
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.type-badge.silence {
		background-color: var(--bg-accent);
		color: var(--text-thirdly);
		border: 1px solid var(--text-thirdly);
	}

	.type-badge.predefined {
		background-color: var(--accent-secondary);
		color: black;
		border: 1px solid var(--accent-secondary);
	}

	.text-content {
		font-size: 1rem;
		line-height: 1.6;
		color: var(--text-primary);
		margin-bottom: 0.75rem;
	}

	.text-content.arabic {
		font-family: 'Hafs', serif;
		font-size: 1.125rem;
		line-height: 1.8;
		text-align: right;
		direction: rtl;
	}

	.text-content.custom {
		font-style: italic;
		color: var(--text-secondary);
	}

	.silence-indicator {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
		padding: 1rem 0;
	}

	.silence-icon {
		font-size: 1.5rem;
		opacity: 0.7;
	}

	.silence-text {
		font-style: italic;
		font-size: 0.875rem;
	}

	.translations {
		border-top: 1px solid var(--border-color);
		padding-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.translation-item {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.lang-code {
		background-color: var(--bg-accent);
		color: var(--text-thirdly);
		font-size: 0.6875rem;
		font-weight: 600;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		text-transform: uppercase;
		flex-shrink: 0;
		margin-top: 0.125rem;
		border: 1px solid var(--border-color);
	}

	.translation-text {
		font-size: 0.875rem;
		line-height: 1.5;
		flex: 1;
	}

	/* Scrollbar styling to match app theme */
	.subtitles-list::-webkit-scrollbar {
		width: 8px;
	}

	.subtitles-list::-webkit-scrollbar-track {
		background-color: var(--bg-secondary);
		border-radius: 4px;
	}

	.subtitles-list::-webkit-scrollbar-thumb {
		background-color: var(--text-thirdly);
		border-radius: 4px;
	}

	.subtitles-list::-webkit-scrollbar-thumb:hover {
		background-color: var(--text-secondary);
	}
</style>
