<script lang="ts">
	import { onMount } from 'svelte';
	import 'material-icons/iconfont/material-icons.css';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import { getPredefinedArabicText } from '$lib/classes/Clip.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { androidBackButton } from '$lib/services/mobileModalSheet';
	import {
		INTRO_RECITERS,
		getIntroAudioUrl,
		prependRecitationIntro,
		type IntroFormula,
		type IntroReciterId,
		type RecitationIntroTranslations
	} from '$lib/services/RecitationIntroService';

	let { close }: { close: () => void } = $props();
	let dialog: HTMLDialogElement;
	let reciterId = $state<IntroReciterId>('husary');
	let selection = $state<'istiadha' | 'basmala' | 'both'>('both');
	let addPadding = $state(false);
	let paddingStart = $state(0.5);
	let paddingEnd = $state(0.5);
	let busy = $state(false);
	let errorMessage = $state('');
	let previewError = $state(false);
	const copy = $derived(Reflect.get($LL.editor, 'recitationIntro') as RecitationIntroTranslations);
	const formulas: IntroFormula[] = $derived(
		selection === 'both'
			? ["Isti'adha", 'Basmala']
			: selection === 'istiadha'
				? ["Isti'adha"]
				: ['Basmala']
	);
	const valid = $derived(
		!addPadding || [paddingStart, paddingEnd].every((value) => Number.isFinite(value) && value >= 0)
	);

	onMount(() => {
		if (globalState.currentProject)
			globalState.currentProject.projectEditorState.videoPreview.isPlaying = false;
		dialog.showModal();
	});

	$effect(() => {
		void reciterId;
		void selection;
		previewError = false;
	});

	/**
	 * Arrête les autres extraits pour comparer une seule voix à la fois.
	 * @param {Event} event Lecture d'un extrait.
	 * @returns {void}
	 */
	function playPreview(event: Event): void {
		for (const audio of dialog.querySelectorAll('audio')) {
			if (audio !== event.currentTarget) audio.pause();
		}
	}

	/**
	 * Prépare les audios puis applique l'introduction avec les espacements choisis.
	 * @param {SubmitEvent} event Soumission du formulaire.
	 * @returns {Promise<void>} Fin de l'ajout ou affichage de l'erreur.
	 */
	async function addIntroduction(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy || !valid) return;
		busy = true;
		errorMessage = '';
		for (const audio of dialog.querySelectorAll('audio')) audio.pause();
		try {
			await prependRecitationIntro({
				reciterId,
				formulas: [...formulas],
				paddingStartMs: addPadding ? Math.round(paddingStart * 1000) : 0,
				paddingEndMs: addPadding ? Math.round(paddingEnd * 1000) : 0
			});
			toast.success(copy.success());
			dialog.close();
		} catch (error) {
			console.error('Recitation introduction failed:', error);
			const messages = Reflect.get(
				get(LL).editor,
				'recitationIntro'
			) as RecitationIntroTranslations;
			errorMessage =
				error instanceof Error &&
				[messages.invalidSettings(), messages.projectChanged()].includes(error.message)
					? error.message
					: messages.downloadError();
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	use:androidBackButton={() => {
		if (!busy) dialog.close();
	}}
	aria-labelledby="recitation-intro-title"
	aria-describedby="recitation-intro-description"
	class="m-auto w-[94vw] max-h-[90dvh] overflow-y-auto rounded-2xl border border-color bg-secondary p-0 text-[var(--text-primary)] shadow-2xl"
	onclose={close}
	oncancel={(event) => {
		if (busy) event.preventDefault();
	}}
	onkeydown={(event) => event.stopPropagation()}
>
	<form onsubmit={addIntroduction} aria-busy={busy}>
		<header
			class="flex items-start justify-between gap-4 border-b border-color bg-gradient-to-br from-[var(--bg-accent)] to-[var(--bg-secondary)] px-6 py-5"
		>
			<div class="flex items-start gap-3">
				<span
					class="material-icons rounded-xl bg-[var(--accent-primary)]/15 p-2 text-accent-primary"
					aria-hidden="true">playlist_add</span
				>
				<div>
					<h2 id="recitation-intro-title" class="text-lg font-semibold">{copy.title()}</h2>
					<p id="recitation-intro-description" class="mt-1 text-sm leading-relaxed text-secondary">
						{copy.description()}
					</p>
				</div>
			</div>
			<button
				type="button"
				disabled={busy}
				onclick={() => dialog.close()}
				aria-label={$LL.common.close()}
				class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-secondary transition hover:bg-accent hover:text-primary disabled:opacity-40"
			>
				<span class="material-icons text-lg" aria-hidden="true">close</span>
			</button>
		</header>

		<fieldset disabled={busy} class="space-y-5 px-6 py-5 disabled:opacity-60">
			<div>
				<p id="intro-formulas-label" class="mb-2 text-sm font-medium">{copy.formulas()}</p>
				<div class="grid grid-cols-3 gap-2" role="group" aria-labelledby="intro-formulas-label">
					{#each ['istiadha', 'basmala', 'both'] as option (option)}
						<button
							type="button"
							aria-pressed={selection === option}
							onclick={() => (selection = option as typeof selection)}
							class="cursor-pointer rounded-xl border px-2 py-3 text-sm font-medium transition {selection ===
							option
								? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-accent-primary'
								: 'border-color bg-accent text-secondary hover:text-primary'}"
							>{copy[option as 'istiadha' | 'basmala' | 'both']()}</button
						>
					{/each}
				</div>
			</div>

			<div class="space-y-2">
				<label for="intro-reciter" class="block text-sm font-medium">{copy.reciter()}</label>
				<select
					id="intro-reciter"
					bind:value={reciterId}
					class="w-full cursor-pointer rounded-lg border border-color bg-accent px-3 py-2.5 text-sm text-primary focus:border-[var(--accent-primary)] focus:outline-none"
				>
					{#each INTRO_RECITERS as reciter (reciter.id)}
						<option value={reciter.id}>{copy.reciters[reciter.id]()}</option>
					{/each}
				</select>
				<p class="text-xs leading-relaxed text-secondary">{copy.sourceNote()}</p>
			</div>

			<section
				class="space-y-3 rounded-xl border border-color bg-[var(--bg-accent)]/50 p-4"
				aria-label={copy.preview()}
			>
				<p class="flex items-center gap-2 text-xs font-medium text-secondary">
					<span class="material-icons text-base text-accent-primary" aria-hidden="true"
						>headphones</span
					>{copy.preview()}
				</p>
				{#key `${reciterId}:${selection}`}
					{#each formulas as formula (formula)}
						<div class="space-y-2">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-xs text-secondary"
									>{formula === 'Basmala' ? copy.basmala() : copy.istiadha()}</span
								>
								<span dir="rtl" lang="ar" class="text-xl leading-relaxed arabic"
									>{getPredefinedArabicText(formula)}</span
								>
							</div>
							<audio
								controls
								preload="none"
								src={getIntroAudioUrl(reciterId, formula)}
								aria-label={formula === 'Basmala' ? copy.basmala() : copy.istiadha()}
								onplay={playPreview}
								onerror={() => (previewError = true)}
								class="h-9 w-full"
							></audio>
						</div>
					{/each}
				{/key}
				{#if previewError}<p role="status" class="text-xs text-secondary">
						{copy.previewError()}
					</p>{/if}
			</section>

			<label class="flex cursor-pointer items-center gap-2 text-sm font-medium">
				<input id="intro-add-padding" type="checkbox" bind:checked={addPadding} />
				{copy.addPadding()}
			</label>

			{#if addPadding}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<label for="intro-padding-start" class="block text-sm font-medium"
							>{copy.paddingStart()}</label
						>
						<div
							class="flex items-center gap-2 rounded-lg border border-color bg-accent px-3 focus-within:border-[var(--accent-primary)]"
						>
							<input
								id="intro-padding-start"
								type="number"
								min="0"
								step="0.1"
								required
								bind:value={paddingStart}
								class="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
							/>
							<span class="text-xs text-secondary">{$LL.common.seconds()}</span>
						</div>
					</div>
					<div class="space-y-2">
						<label for="intro-padding-end" class="block text-sm font-medium"
							>{copy.paddingEnd()}</label
						>
						<div
							class="flex items-center gap-2 rounded-lg border border-color bg-accent px-3 focus-within:border-[var(--accent-primary)]"
						>
							<input
								id="intro-padding-end"
								type="number"
								min="0"
								step="0.1"
								required
								bind:value={paddingEnd}
								class="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
							/>
							<span class="text-xs text-secondary">{$LL.common.seconds()}</span>
						</div>
					</div>
				</div>
			{/if}

			<div class="space-y-3">
				<div dir="ltr" class="flex items-stretch gap-1 text-center text-[11px]" aria-hidden="true">
					{#if addPadding && paddingStart > 0}
						<span
							class="flex items-center rounded-md border border-dashed border-color px-2 py-2 text-secondary"
							>{valid ? paddingStart : 0} {$LL.common.sec()}</span
						>
					{/if}
					{#each formulas as formula (formula)}
						<span
							class="flex flex-1 items-center justify-center rounded-md bg-[var(--accent-primary)]/15 px-2 py-2 text-accent-primary"
							>{formula === 'Basmala' ? copy.basmala() : copy.istiadha()}</span
						>
					{/each}
					{#if addPadding && paddingEnd > 0}
						<span
							class="flex items-center rounded-md border border-dashed border-color px-2 py-2 text-secondary"
							>{valid ? paddingEnd : 0} {$LL.common.sec()}</span
						>
					{/if}
					<span
						class="flex flex-1 items-center justify-center rounded-md bg-accent px-2 py-2 text-secondary"
						>{copy.existingProject()}</span
					>
				</div>
				{#if addPadding}<p class="text-xs leading-relaxed text-secondary">
						{copy.timingHint()}
					</p>{/if}
			</div>
		</fieldset>

		{#if errorMessage}<p
				role="alert"
				class="mx-6 mb-4 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-400"
			>
				{errorMessage}
			</p>{/if}

		<footer
			class="flex items-center justify-end gap-3 border-t border-color bg-[var(--bg-accent)]/30 px-6 py-4"
		>
			<button
				type="button"
				disabled={busy}
				onclick={() => dialog.close()}
				class="cursor-pointer rounded-lg border border-color px-4 py-2 text-sm text-secondary transition hover:bg-accent disabled:opacity-40"
				>{$LL.common.cancel()}</button
			>
			<button
				type="submit"
				disabled={busy || !valid}
				class="btn-accent flex items-center gap-2 rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
			>
				<span class="material-icons text-lg" class:animate-spin={busy} aria-hidden="true"
					>{busy ? 'sync' : 'playlist_add'}</span
				>
				{busy ? copy.adding() : copy.apply()}
			</button>
		</footer>
	</form>
</dialog>

<style>
	dialog::backdrop {
		background: rgb(0 0 0 / 0.65);
		backdrop-filter: blur(4px);
	}
	audio {
		color-scheme: dark;
	}
</style>
