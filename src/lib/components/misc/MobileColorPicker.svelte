<script lang="ts">
	import ColorPicker, { ChromeVariant } from 'svelte-awesome-color-picker';
	import { onDestroy } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { androidBackButton } from '$lib/services/mobileModalSheet';

	let {
		value,
		label,
		onChange,
		onInteractionStart,
		onInteractionEnd,
		compact = false
	}: {
		value: string;
		label: string;
		onChange: (value: string) => void;
		onInteractionStart?: () => void;
		onInteractionEnd?: () => void;
		compact?: boolean;
	} = $props();

	let isOpen = $state(false);
	let pickerHex = $state<string | null>(null);

	/**
	 * Déplace le modal hors des conteneurs scrollables qui pourraient le couper.
	 * @param {HTMLElement} element Racine du modal.
	 * @returns {{ destroy: () => void }} Nettoyage du portail.
	 */
	function portal(element: HTMLElement): { destroy: () => void } {
		document.body.appendChild(element);
		return {
			destroy: () => element.remove()
		};
	}

	/**
	 * Ouvre le sélecteur avec la couleur courante.
	 * @returns {void}
	 */
	function openPicker(): void {
		pickerHex = value;
		onInteractionStart?.();
		isOpen = true;
	}

	/**
	 * Ferme le sélecteur et termine l'interaction courante.
	 * @returns {void}
	 */
	function closePicker(): void {
		if (!isOpen) return;
		isOpen = false;
		onInteractionEnd?.();
	}

	/**
	 * Applique immédiatement la couleur choisie.
	 * @param {string | null} hex Couleur hexadécimale produite par le sélecteur.
	 * @returns {void}
	 */
	function applyColor(hex: string | null): void {
		if (!hex) return;
		pickerHex = hex;
		onChange(hex);
	}

	onDestroy(() => {
		if (isOpen) onInteractionEnd?.();
	});
</script>

<button
	type="button"
	class:compact
	class="mobile-color-picker-trigger"
	aria-label={label}
	onclick={(event) => {
		event.stopPropagation();
		openPicker();
	}}
>
	<span style={`background-color: ${value};`}></span>
</button>

{#if isOpen}
	<div
		use:portal
		use:androidBackButton={closePicker}
		class="mobile-color-picker-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) closePicker();
		}}
	>
		<div class="mobile-color-picker-panel" role="dialog" aria-modal="true" aria-label={label}>
			<header>
				<span>{label}</span>
				<button
					type="button"
					class="btn-icon"
					aria-label={$LL.common.close()}
					onclick={closePicker}
				>
					<span class="material-icons">close</span>
				</button>
			</header>
			<div class="mobile-color-picker-interaction">
				<ColorPicker
					bind:hex={pickerHex}
					components={ChromeVariant}
					sliderDirection="horizontal"
					isDialog={false}
					isAlpha={false}
					isTextInput={false}
					texts={{ label: { h: label, s: label, v: label } }}
					onInput={({ hex }) => applyColor(hex)}
					--picker-width="min(82vw, 22rem)"
					--picker-height="min(62vw, 17rem)"
					--slider-width="2.75rem"
					--picker-indicator-size="1.5rem"
					--cp-bg-color="var(--bg-secondary)"
					--cp-border-color="var(--border-color)"
					--cp-text-color="var(--text-primary)"
					--cp-input-color="var(--bg-accent)"
				/>
			</div>
		</div>
	</div>
{/if}

<style>
	.mobile-color-picker-trigger {
		display: flex;
		min-height: 2.75rem;
		width: 100%;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 0.5rem;
		background: var(--bg-accent);
		padding: 0.25rem;
	}

	.mobile-color-picker-trigger.compact {
		width: 3rem;
	}

	.mobile-color-picker-trigger > span {
		height: 100%;
		min-height: 2rem;
		width: 100%;
		border-radius: 0.35rem;
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 18%);
	}

	.mobile-color-picker-backdrop {
		position: fixed;
		z-index: 1000;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(0 0 0 / 70%);
		padding: 1rem;
	}

	.mobile-color-picker-panel {
		display: flex;
		max-height: calc(100dvh - 2rem);
		max-width: 100%;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		overflow-y: auto;
		overscroll-behavior: none;
		border: 1px solid var(--border-color);
		border-radius: 1rem;
		background: var(--bg-secondary);
		padding: 0.75rem;
		box-shadow: 0 1.25rem 3rem rgb(0 0 0 / 45%);
	}

	.mobile-color-picker-interaction {
		touch-action: none;
	}

	header {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-weight: 700;
	}
</style>
