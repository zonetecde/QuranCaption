<script lang="ts">
	import type { QuranCollection } from '$lib/types/quranAuth';
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';
	import toast from 'svelte-5-french-toast';
	import { onMount } from 'svelte';

	let {
		surah,
		verse,
		resolve
	}: {
		surah: number;
		verse: number;
		resolve: () => void;
	} = $props();

	let collections = $state<QuranCollection[]>([]);
	let selectedCollectionIds = $state<string[]>([]);
	// Snapshot initial pour savoir ensuite quoi ajouter et quoi retirer.
	let initialSelectedCollectionIds = $state<string[]>([]);
	let isLoading = $state(true);
	let isSubmitting = $state(false);
	let isCreateFormOpen = $state(false);
	let isCreatingCollection = $state(false);
	let newCollectionName = $state('');
	let errorMessage = $state<string | null>(null);
	let createErrorMessage = $state<string | null>(null);
	let bookmarkIdsByCollectionId = $state<Record<string, string>>({});

	const verseKey = $derived(`${surah}:${verse}`);
	const hasPendingChanges = $derived(
		selectedCollectionIds.length !== initialSelectedCollectionIds.length ||
			selectedCollectionIds.some((id) => !initialSelectedCollectionIds.includes(id)) ||
			initialSelectedCollectionIds.some((id) => !selectedCollectionIds.includes(id))
	);
	const canCreateCollection = $derived(
		newCollectionName.trim().length > 0 && !isCreatingCollection && !isLoading
	);

	/** Charge les collections de l'utilisateur et pré-coche celles qui contiennent déjà le verset. */
	async function loadCollections(): Promise<void> {
		isLoading = true;
		errorMessage = null;

		try {
			const [loadedCollections, verseState] = await Promise.all([
				quranAuthService.getCollections(),
				quranAuthService.getCollectionsContainingVerse(surah, verse)
			]);
			collections = loadedCollections;
			initialSelectedCollectionIds = verseState.selectedCollectionIds;
			selectedCollectionIds = [...verseState.selectedCollectionIds];
			bookmarkIdsByCollectionId = verseState.bookmarkIdsByCollectionId;
		} catch (error) {
			errorMessage =
				error instanceof Error && error.message.trim().length > 0
					? error.message
					: 'Unable to load your Quran.com collections.';
		} finally {
			isLoading = false;
		}
	}

	/** Ajoute ou retire une collection de la sélection courante dans la modale. */
	function toggleCollection(collectionId: string): void {
		if (selectedCollectionIds.includes(collectionId)) {
			selectedCollectionIds = selectedCollectionIds.filter((id) => id !== collectionId);
			return;
		}

		selectedCollectionIds = [...selectedCollectionIds, collectionId];
	}

	/** Ouvre ou ferme le petit formulaire de création de collection. */
	function toggleCreateForm(): void {
		isCreateFormOpen = !isCreateFormOpen;
		createErrorMessage = null;
		if (!isCreateFormOpen) {
			newCollectionName = '';
		}
	}

	/** Crée une collection Quran.com et la sélectionne immédiatement dans la liste. */
	async function createCollection(): Promise<void> {
		if (!canCreateCollection) return;

		isCreatingCollection = true;
		createErrorMessage = null;

		try {
			const createdCollection = await quranAuthService.createCollection(newCollectionName);
			const alreadyExists = collections.some(
				(collection) => collection.id === createdCollection.id
			);
			if (!alreadyExists) {
				collections = [...collections, createdCollection].sort((a, b) =>
					a.name.localeCompare(b.name)
				);
			}

			if (!selectedCollectionIds.includes(createdCollection.id)) {
				selectedCollectionIds = [...selectedCollectionIds, createdCollection.id];
			}

			newCollectionName = '';
			isCreateFormOpen = false;
			toast.success(`Collection "${createdCollection.name}" created.`);
		} catch (error) {
			createErrorMessage =
				error instanceof Error && error.message.trim().length > 0
					? error.message
					: 'Unable to create this collection.';
		} finally {
			isCreatingCollection = false;
		}
	}

	/** Applique les différences entre l'état initial et l'état actuel des cases cochées. */
	async function addBookmark(): Promise<void> {
		if (!hasPendingChanges || isSubmitting) return;

		isSubmitting = true;
		errorMessage = null;

		// Nouvelles cases cochées => on ajoute le verset.
		const collectionsToAdd = collections.filter(
			(collection) =>
				selectedCollectionIds.includes(collection.id) &&
				!initialSelectedCollectionIds.includes(collection.id)
		);
		// Cases décochées par rapport à l'état initial => on retire le verset.
		const collectionsToRemove = collections.filter(
			(collection) =>
				initialSelectedCollectionIds.includes(collection.id) &&
				!selectedCollectionIds.includes(collection.id)
		);
		const failedOperations: string[] = [];
		let addedCount = 0;
		let removedCount = 0;

		for (const collection of collectionsToAdd) {
			try {
				await quranAuthService.addVerseToCollection(collection.id, surah, verse);
				addedCount += 1;
			} catch {
				failedOperations.push(`add to "${collection.name}"`);
			}
		}

		for (const collection of collectionsToRemove) {
			try {
				// On réutilise l'id du bookmark déjà trouvé à l'ouverture si on l'a encore.
				const bookmarkId =
					bookmarkIdsByCollectionId[collection.id] ??
					(await quranAuthService.getCollectionBookmarkId(collection.id, surah, verse));
				if (!bookmarkId) {
					throw new Error('Bookmark id not found.');
				}
				await quranAuthService.removeVerseFromCollection(collection.id, bookmarkId);
				removedCount += 1;
			} catch {
				failedOperations.push(`remove from "${collection.name}"`);
			}
		}

		isSubmitting = false;

		if (addedCount === 0 && removedCount === 0) {
			errorMessage = `Unable to update verse ${verseKey} in the selected collections.`;
			return;
		}

		const successParts: string[] = [];
		if (addedCount > 0) {
			successParts.push(
				addedCount === 1 ? 'added to 1 collection' : `added to ${addedCount} collections`
			);
		}
		if (removedCount > 0) {
			successParts.push(
				removedCount === 1
					? 'removed from 1 collection'
					: `removed from ${removedCount} collections`
			);
		}
		toast.success(`Verse ${verseKey} was ${successParts.join(' and ')}.`);

		if (failedOperations.length > 0) {
			toast.error(`Some operations failed: ${failedOperations.join(', ')}`);
		}

		resolve();
	}

	onMount(() => {
		void loadCollections();
	});
</script>

<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
	<div class="w-full max-w-2xl rounded-2xl border border-color bg-primary shadow-2xl">
		<div class="flex items-start justify-between gap-4 border-b border-color px-6 py-5">
			<div class="space-y-1">
				<div class="flex items-center gap-3">
					<div
						class="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-primary)]/16 text-accent-primary"
					>
						<span class="material-icons-outlined text-[22px]">bookmark_add</span>
					</div>
					<div>
						<h2 class="text-xl font-semibold text-primary">Bookmark Verse</h2>
						<p class="text-sm text-thirdly">
							Add verse {verseKey} to one or more Quran.com collections.
						</p>
					</div>
				</div>
			</div>

			<button
				class="rounded-full p-2 text-thirdly transition-colors hover:bg-secondary hover:text-primary"
				onclick={resolve}
				title="Close"
			>
				<span class="material-icons-outlined">close</span>
			</button>
		</div>

		<div class="space-y-4 px-6 py-5">
			{#if isLoading}
				<div class="rounded-xl border border-color bg-secondary px-4 py-8 text-center">
					<div
						class="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-color border-t-accent-primary"
					></div>
					<p class="text-sm text-thirdly">Loading your Quran.com collections...</p>
				</div>
			{:else if errorMessage}
				<div class="rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-4">
					<div class="mb-2 flex items-center gap-2 text-red-300">
						<span class="material-icons-outlined text-base">error</span>
						<span class="font-medium">Collection error</span>
					</div>
					<p class="text-sm text-red-200">{errorMessage}</p>
					<div class="mt-4">
						<button class="integration-btn integration-primary" onclick={loadCollections}>
							Retry
						</button>
					</div>
				</div>
			{:else}
				<div class="space-y-4">
					<div class="flex items-center justify-between gap-3">
						<p class="text-xs font-semibold uppercase tracking-[0.18em] text-thirdly">
							Available collections
						</p>
						<button
							type="button"
							class="integration-btn"
							onclick={toggleCreateForm}
							disabled={isCreatingCollection || isSubmitting}
						>
							<span class="material-icons-outlined text-[18px]">
								{isCreateFormOpen ? 'expand_less' : 'add'}
							</span>
							{isCreateFormOpen ? 'Hide form' : 'New collection'}
						</button>
					</div>

					{#if isCreateFormOpen || collections.length === 0}
						<div class="space-y-3 rounded-xl border border-color bg-secondary p-4">
							<div class="space-y-1">
								<p class="text-sm font-medium text-primary">
									{collections.length === 0
										? 'Create your first collection'
										: 'Create a new collection'}
								</p>
								<p class="text-xs text-thirdly">
									The new collection will be created on Quran.com and selected automatically.
								</p>
							</div>

							<div class="flex flex-col gap-3 sm:flex-row">
								<input
									class="min-w-0 flex-1 rounded-xl border border-color bg-primary px-4 py-3 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
									type="text"
									placeholder="Collection name"
									bind:value={newCollectionName}
									onkeydown={(event) => {
										if (event.key === 'Enter') {
											event.preventDefault();
											void createCollection();
										}
									}}
								/>
								<button
									type="button"
									class="integration-btn integration-primary"
									onclick={createCollection}
									disabled={!canCreateCollection || isSubmitting}
								>
									{isCreatingCollection ? 'Creating...' : 'Create'}
								</button>
							</div>

							{#if createErrorMessage}
								<p class="text-sm text-red-300">{createErrorMessage}</p>
							{/if}
						</div>
					{/if}

					{#if collections.length === 0}
						<div class="rounded-xl border border-color bg-secondary px-4 py-8 text-center">
							<div
								class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-primary)]/14 text-accent-primary"
							>
								<span class="material-icons-outlined text-[22px]">collections_bookmark</span>
							</div>
							<p class="text-sm font-medium text-primary">No collections found yet</p>
							<p class="mt-1 text-sm text-thirdly">
								Create one above, then bookmark verse {verseKey} into it.
							</p>
						</div>
					{:else}
						<div class="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
							{#each collections as collection (collection.id)}
								<button
									type="button"
									class={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
										selectedCollectionIds.includes(collection.id)
											? 'border-[var(--accent-primary)]/60 bg-[var(--accent-primary)]/10 shadow-sm'
											: 'border-color bg-secondary hover:bg-[var(--bg-accent)]'
									}`}
									onclick={() => toggleCollection(collection.id)}
								>
									<div class="flex items-center justify-between gap-3">
										<div class="min-w-0">
											<p class="truncate text-sm font-medium text-primary">{collection.name}</p>
											<p class="text-xs text-thirdly">
												Updated {new Date(collection.updatedAt).toLocaleString()}
											</p>
										</div>
										<div
											class={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
												selectedCollectionIds.includes(collection.id)
													? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
													: 'border-color bg-primary text-transparent'
											}`}
										>
											<span class="material-icons-outlined text-[14px]">check</span>
										</div>
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-between gap-3 border-t border-color px-6 py-4">
			<p class="text-xs text-thirdly">
				{selectedCollectionIds.length}
				{selectedCollectionIds.length === 1 ? ' collection selected' : ' collections selected'}
			</p>

			<div class="flex items-center gap-3">
				<button class="integration-btn" onclick={resolve}>Cancel</button>
				<button
					class="integration-btn integration-primary"
					onclick={addBookmark}
					disabled={!hasPendingChanges || isSubmitting || isLoading}
				>
					{isSubmitting ? 'Saving...' : 'Save changes'}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.integration-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding-inline: 1rem;
		border-radius: 0.9rem;
		border: 1px solid var(--border-color);
		font-size: 0.85rem;
		font-weight: 600;
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease,
			transform 0.18s ease;
	}

	.integration-btn:hover:enabled {
		transform: translateY(-1px);
	}

	.integration-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.integration-btn.integration-primary {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
		border-color: color-mix(in srgb, var(--accent-primary) 45%, var(--border-color));
	}

	.integration-btn.integration-primary:hover:enabled {
		background: color-mix(in srgb, var(--accent-primary) 28%, transparent);
	}
</style>
