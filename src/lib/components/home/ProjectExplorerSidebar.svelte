<script lang="ts">
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';
	import { getProjectTypeLabel } from '$lib/i18n/statusMapper';
	import {
		ALL_PROJECTS_SELECTION,
		isSelectionActive,
		type ExplorerSelection,
		type ProjectExplorerTree
	} from './homeExplorer';

	let {
		tree,
		selection,
		activeDropNodeId = null,
		onSelectionChange
	}: {
		tree: ProjectExplorerTree;
		selection: ExplorerSelection;
		activeDropNodeId?: string | null;
		onSelectionChange: (selection: ExplorerSelection) => void;
	} = $props();

	let expandedSpeakers = $state<Set<string>>(new Set());
	let expandedTypes = $state<Set<string>>(new Set());
	let lastSelectionKey = $state<string>('all');

	/**
	 * Construit la clé interne d'un dossier de type de contenu.
	 * @param {string} speaker - Le nom de l'intervenant.
	 * @param {string} projectType - Le type de contenu.
	 * @returns {string} La clé du dossier.
	 */
	function getTypeKey(speaker: string, projectType: string): string {
		return `${speaker}:${projectType}`;
	}

	/**
	 * Compare deux ensembles sans les recréer inutilement.
	 * @param {Set<string>} left - Le premier ensemble.
	 * @param {Set<string>} right - Le second ensemble.
	 * @returns {boolean} Vrai lorsque les ensembles sont identiques.
	 */
	function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
		if (left.size !== right.size) return false;
		for (const value of left) {
			if (!right.has(value)) return false;
		}
		return true;
	}

	/**
	 * Sérialise une sélection pour détecter ses changements.
	 * @param {ExplorerSelection} currentSelection - La sélection à sérialiser.
	 * @returns {string} La clé de sélection.
	 */
	function getSelectionKey(currentSelection: ExplorerSelection): string {
		switch (currentSelection.kind) {
			case 'all':
				return 'all';
			case 'speaker':
				return `speaker:${currentSelection.speaker}`;
			case 'type':
				return `type:${currentSelection.speaker}:${currentSelection.projectType}`;
			case 'year':
				return `year:${currentSelection.speaker}:${currentSelection.projectType}:${currentSelection.year}`;
		}
	}

	$effect(() => {
		const validSpeakers = new Set(tree.speakers.map((node) => node.speaker));
		const validTypeKeys = new Set(
			tree.speakers.flatMap((speakerNode) =>
				speakerNode.types
					.filter((typeNode) => typeNode.years.length > 0)
					.map((typeNode) => getTypeKey(typeNode.speaker, typeNode.projectType))
			)
		);
		const nextExpandedSpeakers = new Set(
			Array.from(expandedSpeakers).filter((speaker) => validSpeakers.has(speaker))
		);
		const nextExpandedTypes = new Set(
			Array.from(expandedTypes).filter((typeKey) => validTypeKeys.has(typeKey))
		);

		const selectionKey = getSelectionKey(selection);
		if (
			selectionKey !== lastSelectionKey &&
			(selection.kind === 'speaker' || selection.kind === 'type' || selection.kind === 'year')
		) {
			nextExpandedSpeakers.add(selection.speaker);
			if (selection.kind === 'type' || selection.kind === 'year') {
				nextExpandedTypes.add(getTypeKey(selection.speaker, selection.projectType));
			}
		}

		lastSelectionKey = selectionKey;

		if (!areSetsEqual(expandedSpeakers, nextExpandedSpeakers)) {
			expandedSpeakers = nextExpandedSpeakers;
		}
		if (!areSetsEqual(expandedTypes, nextExpandedTypes)) {
			expandedTypes = nextExpandedTypes;
		}
	});

	/**
	 * Ouvre ou ferme le dossier d'un intervenant.
	 * @param {string} speaker - Le nom de l'intervenant.
	 * @returns {void}
	 */
	function toggleSpeaker(speaker: string) {
		const next = new Set(expandedSpeakers);
		if (next.has(speaker)) {
			next.delete(speaker);
		} else {
			next.add(speaker);
		}
		expandedSpeakers = next;
	}

	/**
	 * Indique si le dossier d'un intervenant est ouvert.
	 * @param {string} speaker - Le nom de l'intervenant.
	 * @returns {boolean} Vrai lorsque le dossier est ouvert.
	 */
	function isExpanded(speaker: string): boolean {
		return expandedSpeakers.has(speaker);
	}

	/**
	 * Ouvre ou ferme un dossier de type de contenu.
	 * @param {string} speaker - Le nom de l'intervenant.
	 * @param {string} projectType - Le type de contenu.
	 * @returns {void}
	 */
	function toggleType(speaker: string, projectType: string) {
		const typeKey = getTypeKey(speaker, projectType);
		const next = new Set(expandedTypes);
		if (next.has(typeKey)) {
			next.delete(typeKey);
		} else {
			next.add(typeKey);
		}
		expandedTypes = next;
	}

	/**
	 * Indique si un dossier de type de contenu est ouvert.
	 * @param {string} speaker - Le nom de l'intervenant.
	 * @param {string} projectType - Le type de contenu.
	 * @returns {boolean} Vrai lorsque le dossier est ouvert.
	 */
	function isTypeExpanded(speaker: string, projectType: string): boolean {
		return expandedTypes.has(getTypeKey(speaker, projectType));
	}

	/**
	 * Gère le clic sur la flèche d'un intervenant.
	 * @param {MouseEvent} event - L'événement de clic.
	 * @param {string} speaker - Le nom de l'intervenant.
	 * @returns {void}
	 */
	function handleToggleClick(event: MouseEvent, speaker: string) {
		event.stopPropagation();
		toggleSpeaker(speaker);
	}

	/**
	 * Sélectionne le dossier d'un intervenant.
	 * @param {string} speaker - Le nom de l'intervenant.
	 * @returns {void}
	 */
	function handleSpeakerClick(speaker: string) {
		onSelectionChange({ kind: 'speaker', speaker });
	}
</script>

<aside class="project-explorer">
	<div class="explorer-header">
		<p class="explorer-label">{$LL.home.projectExplorer()}</p>
		<p class="explorer-hint">{tree.totalCount} project{tree.totalCount === 1 ? '' : 's'}</p>
	</div>

	<div class="explorer-tree">
		<button
			type="button"
			class={`tree-row root-row ${isSelectionActive(selection, ALL_PROJECTS_SELECTION) ? 'active' : ''} ${activeDropNodeId === 'all' ? 'drop-target' : ''}`}
			data-explorer-node="all"
			onclick={() => onSelectionChange(ALL_PROJECTS_SELECTION)}
		>
			<span class="material-icons-outlined tree-icon">folder</span>
			<span class="tree-name">{$LL.home.all()}</span>
			<span class="tree-count">{tree.totalCount}</span>
		</button>

		{#each tree.speakers as speakerNode (speakerNode.id)}
			<div class="tree-group">
				<div
					class={`tree-row speaker-row ${isSelectionActive(selection, { kind: 'speaker', speaker: speakerNode.speaker }) ? 'active' : ''} ${activeDropNodeId === speakerNode.id ? 'drop-target' : ''}`}
				>
					<button
						type="button"
						class="tree-toggle"
						data-explorer-toggle={speakerNode.speaker}
						title={isExpanded(speakerNode.speaker) ? $LL.home.collapse() : $LL.home.expand()}
						onclick={(event) => handleToggleClick(event, speakerNode.speaker)}
					>
						<span
							class={`material-icons-outlined tree-chevron ${isExpanded(speakerNode.speaker) ? 'expanded' : ''}`}
						>
							chevron_right
						</span>
					</button>

					<button
						type="button"
						class="tree-select"
						data-explorer-node={`speaker:${speakerNode.speaker}`}
						onclick={() => handleSpeakerClick(speakerNode.speaker)}
					>
						<span class="material-icons-outlined tree-icon">record_voice_over</span>
						<span class="tree-name">{speakerNode.label}</span>
						<span class="tree-count">{speakerNode.count}</span>
					</button>
				</div>

				{#if isExpanded(speakerNode.speaker)}
					<div class="tree-children">
						{#each speakerNode.types as typeNode (typeNode.id)}
							{#if typeNode.years.length === 0}
								<button
									type="button"
									class={`tree-row child-row ${
										isSelectionActive(selection, {
											kind: 'type',
											speaker: typeNode.speaker,
											projectType: typeNode.projectType
										})
											? 'active'
											: ''
									} ${activeDropNodeId === typeNode.id ? 'drop-target' : ''}`}
									data-explorer-node={`type:${typeNode.speaker}:${typeNode.projectType}`}
									onclick={() =>
										onSelectionChange({
											kind: 'type',
											speaker: typeNode.speaker,
											projectType: typeNode.projectType
										})}
								>
									<span class="tree-branch" aria-hidden="true">
										<span class="tree-branch-line"></span>
										<span class="tree-branch-dot"></span>
									</span>
									<span class="tree-name">{getProjectTypeLabel(typeNode.label, get(LL))}</span>
									<span class="tree-count">{typeNode.count}</span>
								</button>
							{:else}
								<div class="tree-group">
									<div
										class={`tree-row child-row ${
											isSelectionActive(selection, {
												kind: 'type',
												speaker: typeNode.speaker,
												projectType: typeNode.projectType
											})
												? 'active'
												: ''
										} ${activeDropNodeId === typeNode.id ? 'drop-target' : ''}`}
									>
										<span class="tree-branch-with-toggle">
											<span class="tree-branch-line" aria-hidden="true"></span>
											<button
												type="button"
												class="tree-mini-toggle"
												title={isTypeExpanded(typeNode.speaker, typeNode.projectType)
													? $LL.home.collapse()
													: $LL.home.expand()}
												onclick={(event) => {
													event.stopPropagation();
													toggleType(typeNode.speaker, typeNode.projectType);
												}}
											>
												<span
													class={`material-icons-outlined tree-chevron ${
														isTypeExpanded(typeNode.speaker, typeNode.projectType) ? 'expanded' : ''
													}`}
												>
													chevron_right
												</span>
											</button>
										</span>
										<button
											type="button"
											class="tree-select"
											data-explorer-node={`type:${typeNode.speaker}:${typeNode.projectType}`}
											onclick={() =>
												onSelectionChange({
													kind: 'type',
													speaker: typeNode.speaker,
													projectType: typeNode.projectType
												})}
										>
											<span class="tree-name">{getProjectTypeLabel(typeNode.label, get(LL))}</span>
											<span class="tree-count">{typeNode.count}</span>
										</button>
									</div>

									{#if isTypeExpanded(typeNode.speaker, typeNode.projectType)}
										<div class="tree-year-children">
											{#each typeNode.years as yearNode (yearNode.id)}
												<button
													type="button"
													class={`tree-row child-row ${
														isSelectionActive(selection, {
															kind: 'year',
															speaker: yearNode.speaker,
															projectType: yearNode.projectType,
															year: yearNode.year
														})
															? 'active'
															: ''
													} ${activeDropNodeId === yearNode.id ? 'drop-target' : ''}`}
													data-explorer-node={`year:${yearNode.speaker}:${yearNode.projectType}:${yearNode.year}`}
													onclick={() =>
														onSelectionChange({
															kind: 'year',
															speaker: yearNode.speaker,
															projectType: yearNode.projectType,
															year: yearNode.year
														})}
												>
													<span class="tree-branch" aria-hidden="true">
														<span class="tree-branch-line"></span>
														<span class="tree-branch-dot"></span>
													</span>
													<span class="tree-name">{yearNode.label}</span>
													<span class="tree-count">{yearNode.count}</span>
												</button>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</aside>

<style>
	.project-explorer {
		padding-top: 0.25rem;
	}

	.explorer-header {
		margin-bottom: 0.9rem;
	}

	.explorer-label {
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--text-thirdly);
	}

	.explorer-hint {
		margin-top: 0.35rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	.explorer-tree {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.tree-group {
		display: flex;
		flex-direction: column;
	}

	.tree-row {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.35rem;
		border-radius: 0.5rem;
		padding: 0.35rem 0.5rem;
		text-align: left;
		color: var(--text-secondary);
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}

	.tree-row:hover {
		background: color-mix(in srgb, var(--bg-accent) 70%, transparent);
		color: var(--text-primary);
	}

	.tree-row.active {
		background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
		color: var(--text-primary);
	}

	.tree-row.drop-target {
		background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
		outline: 1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent);
	}

	.root-row {
		margin-bottom: 0.2rem;
	}

	.tree-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.4rem;
		color: inherit;
		flex-shrink: 0;
		position: relative;
		z-index: 2;
	}

	.tree-toggle:hover {
		background: color-mix(in srgb, var(--bg-accent) 80%, transparent);
	}

	.tree-chevron {
		font-size: 1.05rem;
		transition: transform 0.15s ease;
	}

	.tree-chevron.expanded {
		transform: rotate(90deg);
	}

	.tree-select {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		text-align: left;
		color: inherit;
	}

	.speaker-row {
		display: grid;
		grid-template-columns: 1.75rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	.tree-icon {
		font-size: 1.05rem;
		color: var(--accent-primary);
		flex-shrink: 0;
	}

	.tree-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.92rem;
	}

	.tree-count {
		flex-shrink: 0;
		font-size: 0.82rem;
		color: var(--text-thirdly);
	}

	.tree-row.active .tree-count {
		color: var(--text-secondary);
	}

	.tree-children {
		margin-left: 2rem;
		position: relative;
		padding-left: 0.3rem;
	}

	.tree-children::before {
		content: '';
		position: absolute;
		left: 0.55rem;
		top: 0.2rem;
		bottom: 0.2rem;
		width: 1px;
		background: color-mix(in srgb, var(--border-color) 80%, transparent);
	}

	.child-row {
		padding-left: 0.3rem;
	}

	.tree-year-children {
		margin-left: 1.1rem;
		position: relative;
	}

	.tree-branch-with-toggle {
		display: inline-flex;
		align-items: center;
		width: 1.9rem;
		flex-shrink: 0;
		gap: 0.25rem;
	}

	.tree-mini-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 0.25rem;
		color: inherit;
		flex-shrink: 0;
	}

	.tree-mini-toggle:hover {
		background: color-mix(in srgb, var(--bg-accent) 80%, transparent);
	}

	.tree-branch {
		display: inline-flex;
		align-items: center;
		width: 1.9rem;
		flex-shrink: 0;
		gap: 0.35rem;
	}

	.tree-branch-line {
		display: block;
		width: 0.8rem;
		height: 1px;
		background: color-mix(in srgb, var(--border-color) 80%, transparent);
	}

	.tree-branch-dot {
		display: block;
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--accent-primary) 70%, var(--text-thirdly) 30%);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--bg-primary) 88%, transparent);
	}
</style>
