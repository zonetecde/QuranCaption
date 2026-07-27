<script lang="ts">
	import { bytesToMb, type DownloadProgress } from '$lib/services/DownloadWithProgress';

	/**
	 * Bouton de téléchargement avec progression intégrée et géométrie stable.
	 *
	 * La progression vit DANS le bouton (barre de remplissage + lecture en chiffres
	 * tabulaires), pas dans un toast flottant qui se redimensionne : la largeur du
	 * texte ne bouge plus, donc plus de saut de ligne à chaque octet. Quand la taille
	 * totale est inconnue (proxy transcodé sans Content-Length), on bascule sur une
	 * bande indéterminée + les Mo téléchargés.
	 */
	let {
		idleLabel,
		busyLabel,
		busy,
		disabled,
		progress = null,
		onclick
	}: {
		idleLabel: string;
		busyLabel: string;
		busy: boolean;
		disabled: boolean;
		progress?: DownloadProgress | null;
		onclick: () => void;
	} = $props();

	const percent = $derived(
		progress && progress.total && progress.total > 0
			? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
			: null
	);

	// Lecture de droite : pourcentage si la taille est connue, sinon Mo transférés.
	const readout = $derived.by(() => {
		if (!busy || !progress || progress.downloaded <= 0) return null;
		return percent !== null ? `${percent}%` : `${bytesToMb(progress.downloaded)} MB`;
	});

	const indeterminate = $derived(busy && percent === null);
</script>

<button
	class="download-btn btn-accent"
	type="button"
	{onclick}
	{disabled}
	aria-busy={busy}
>
	{#if busy && percent !== null}
		<span class="download-btn__fill" style="width: {percent}%"></span>
	{:else if indeterminate}
		<span class="download-btn__fill download-btn__fill--indeterminate"></span>
	{/if}

	<span class="download-btn__content">
		{#if busy}
			<span class="material-icons download-btn__spinner">sync</span>
			<span class="download-btn__label">{busyLabel}</span>
			{#if readout}
				<span class="download-btn__readout">{readout}</span>
			{/if}
		{:else}
			<span class="material-icons text-lg">download</span>
			<span class="download-btn__label">{idleLabel}</span>
		{/if}
	</span>
</button>

<style>
	.download-btn {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		width: 100%;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.15));
		transition: scale 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.download-btn:hover:not(:disabled) {
		scale: 1.02;
	}

	.download-btn:disabled {
		cursor: not-allowed;
	}

	/* Opacité réduite seulement quand rien ne se passe : pendant un download le
	   bouton est disabled mais doit rester bien lisible pour montrer l'avancée. */
	.download-btn:disabled:not([aria-busy='true']) {
		opacity: 0.5;
	}

	.download-btn__fill {
		position: absolute;
		inset: 0 auto 0 0;
		z-index: -1;
		background: rgb(255 255 255 / 0.22);
		transition: width 250ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.download-btn__fill--indeterminate {
		width: 40%;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgb(255 255 255 / 0.28) 50%,
			transparent 100%
		);
		animation: download-btn-slide 1.15s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes download-btn-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(350%);
		}
	}

	.download-btn__content {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.download-btn__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.download-btn__spinner {
		font-size: 1.125rem;
		animation: download-btn-spin 1s linear infinite;
	}

	@keyframes download-btn-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Chiffres tabulaires + largeur plancher : la lecture ne « respire » pas quand
	   le nombre passe de 9% à 10% ou de 9.9 à 10.0 Mo. */
	.download-btn__readout {
		flex: none;
		min-width: 4ch;
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
		opacity: 0.85;
	}

	@media (prefers-reduced-motion: reduce) {
		.download-btn,
		.download-btn__fill {
			transition: none;
		}
		.download-btn__fill--indeterminate {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
		.download-btn__spinner {
			animation-duration: 2.4s;
		}
	}
</style>
