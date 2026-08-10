<script lang="ts">
	import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes';
	import {
		canonicalizePredefinedSubtitleType,
		type PredefinedSubtitleType
	} from '$lib/classes/Clip.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	type SpecialPreset = Exclude<PredefinedSubtitleType, 'Other'> | 'Silence';

	let {
		onClose,
		onAddQuranSubtitle
	}: {
		onClose: () => void;
		onAddQuranSubtitle: () => Promise<void> | undefined;
	} = $props();
	let selectedPreset = $state<SpecialPreset | 'Quran' | null>(null);
	let editedSubtitle = $derived(globalState.getSubtitlesEditorState.editSubtitle);
	let isEditing = $derived(
		editedSubtitle instanceof SubtitleClip ||
			editedSubtitle instanceof PredefinedSubtitleClip ||
			editedSubtitle instanceof SilenceClip
	);

	const presets: Array<{ label: SpecialPreset; icon: string; action: string }> = [
		{ label: 'Silence', icon: 'volume_off', action: 'ADD_SILENCE' },
		{ label: "Isti'adha", icon: 'self_improvement', action: 'ADD_ISTIADHAH' },
		{ label: 'Basmala', icon: 'spa', action: 'ADD_BASMALA' },
		{ label: 'Amin', icon: 'front_hand', action: 'ADD_AMIN' },
		{ label: 'Takbir', icon: 'campaign', action: 'ADD_TAKBIR' },
		{ label: 'Tahmeed', icon: 'record_voice_over', action: 'ADD_TAHMEED' },
		{ label: 'Tasleem', icon: 'waving_hand', action: 'ADD_TASLEEM' },
		{ label: 'Sadaqa', icon: 'verified', action: 'ADD_SADAQA' }
	];

	$effect(() => {
		if (editedSubtitle instanceof SilenceClip) {
			selectedPreset = 'Silence';
		} else if (editedSubtitle instanceof PredefinedSubtitleClip) {
			const type = canonicalizePredefinedSubtitleType(editedSubtitle.predefinedSubtitleType);
			selectedPreset = type === 'Other' ? null : type;
		} else if (editedSubtitle instanceof SubtitleClip) {
			selectedPreset = 'Quran';
		}
	});

	/**
	 * Ajoute le preset choisi à la piste de sous-titres.
	 *
	 * @param {SpecialPreset} preset Preset à ajouter.
	 * @returns {void}
	 */
	function addPreset(preset: SpecialPreset): void {
		const subtitleTrack = globalState.getSubtitleTrack;
		const success =
			preset === 'Silence'
				? subtitleTrack.addSilence()
				: subtitleTrack.addPredefinedSubtitle(preset);
		if (success) {
			globalState.currentProject!.detail.updateVideoDetailAttributes();
			onClose();
		}
	}

	/**
	 * Applique le type choisi au sous-titre sélectionné.
	 *
	 * @param {SpecialPreset} preset Nouveau type du sous-titre.
	 * @returns {void}
	 */
	function editPreset(preset: SpecialPreset): void {
		const subtitle = editedSubtitle;
		if (
			!(
				subtitle instanceof SubtitleClip ||
				subtitle instanceof PredefinedSubtitleClip ||
				subtitle instanceof SilenceClip
			)
		) {
			return;
		}

		ProjectHistoryManager.track('edit subtitle type', () => {
			globalState.getSubtitleTrack.editSubtitleToSpecial(subtitle, preset);
		});

		const pendingId = globalState.getSubtitlesEditorState.pendingSplitEditNextId;
		globalState.getSubtitlesEditorState.editSubtitle = pendingId
			? (globalState.getSubtitleTrack.getClipById(pendingId) ?? null)
			: null;
		globalState.getSubtitlesEditorState.pendingSplitEditNextId = null;
		onClose();
	}

	/**
	 * Valide le choix courant en mode ajout ou modification.
	 *
	 * @returns {void}
	 */
	function applyPreset(): void {
		if (!selectedPreset) return;

		if (selectedPreset === 'Quran') {
			void onAddQuranSubtitle();
			onClose();
			return;
		}

		if (isEditing) {
			editPreset(selectedPreset);
			return;
		}

		addPreset(selectedPreset);
	}

	/**
	 * Ferme le sélecteur et annule l'édition éventuelle.
	 *
	 * @returns {void}
	 */
	function cancel(): void {
		if (isEditing) {
			globalState.getSubtitlesEditorState.editSubtitle = null;
			globalState.getSubtitlesEditorState.pendingSplitEditNextId = null;
		}
		onClose();
	}
</script>

<section class="preset-picker">
	<header class="preset-picker-header">
		<div class="preset-picker-title">
			<span class="material-icons text-accent">dashboard_customize</span>
			<h3>{$LL.editor.predefinedLabel()}</h3>
		</div>
		<div class="preset-picker-actions">
			<button class="preset-action-button" type="button" onclick={cancel}>
				{$LL.common.cancel()}
			</button>
			<button
				class="preset-action-button preset-action-button-primary"
				type="button"
				disabled={!selectedPreset}
				onclick={applyPreset}
			>
				{$LL.common.apply()}
			</button>
		</div>
	</header>

	<div class="preset-grid">
		{#if isEditing}
			<button
				class="preset-button"
				class:selected={selectedPreset === 'Quran'}
				type="button"
				onclick={() => (selectedPreset = 'Quran')}
			>
				<span class="material-icons">menu_book</span>
				<span>{$LL.editor.verseLabel()}</span>
			</button>
		{/if}

		{#each presets as preset (preset.label)}
			<button
				class="preset-button"
				class:selected={selectedPreset === preset.label}
				type="button"
				onclick={() => (selectedPreset = preset.label)}
			>
				<span class="material-icons">{preset.icon}</span>
				<span>
					{preset.label === 'Silence'
						? $LL.editor.silenceLabel()
						: ($LL.settings.shortcutAction as unknown as Record<string, () => string>)[
								preset.action
							]?.()}
				</span>
			</button>
		{/each}
	</div>
</section>

<style>
	.preset-picker {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.65rem;
		background: var(--bg-primary);
	}

	.preset-picker-header,
	.preset-picker-title,
	.preset-picker-actions {
		display: flex;
		align-items: center;
	}

	.preset-picker-header {
		flex-shrink: 0;
		justify-content: space-between;
		gap: 0.5rem;
		color: var(--text-primary);
		font-size: 0.8rem;
		font-weight: 600;
	}

	.preset-picker-title {
		gap: 0.4rem;
	}

	.preset-grid {
		display: grid;
		min-height: 0;
		flex: 1;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.4rem;
		overflow-y: auto;
	}

	.preset-button {
		display: flex;
		min-height: 3.25rem;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border: 1px solid var(--border-color);
		border-radius: 0.65rem;
		background: var(--bg-secondary);
		color: var(--text-secondary);
		font-size: 0.7rem;
	}

	.preset-button .material-icons {
		font-size: 1rem;
	}

	.preset-button.selected {
		border-color: var(--accent-primary);
		background: color-mix(in srgb, var(--accent-primary) 15%, var(--bg-secondary));
		color: var(--text-primary);
	}

	.preset-picker-actions {
		flex-shrink: 0;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.preset-action-button {
		border: 1px solid var(--border-color);
		border-radius: 0.5rem;
		padding: 0.4rem 0.8rem;
		color: var(--text-secondary);
		font-size: 0.72rem;
	}

	.preset-action-button-primary {
		border-color: transparent;
		background: var(--accent-primary);
		color: var(--text-on-accent);
	}

	.preset-action-button:disabled {
		opacity: 0.45;
	}
</style>
