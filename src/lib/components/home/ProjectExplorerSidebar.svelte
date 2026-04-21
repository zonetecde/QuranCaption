<script lang="ts">
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
		onSelectionChange,
	}: {
		tree: ProjectExplorerTree;
		selection: ExplorerSelection;
		activeDropNodeId?: string | null;
		onSelectionChange: (selection: ExplorerSelection) => void;
	} = $props();

	let expandedReciters = $state<Set<string>>(new Set());
	let lastSelectionKey = $state<string>('all');

	/**
	 * Avoids rewriting the set when nothing actually changed.
	 */
	function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
		if (left.size !== right.size) return false;
		for (const value of left) {
			if (!right.has(value)) return false;
		}
		return true;
	}

	function getSelectionKey(selection: ExplorerSelection): string {
		switch (selection.kind) {
			case 'all':
				return 'all';
			case 'reciter':
				return `reciter:${selection.reciter}`;
			case 'type':
				return `type:${selection.reciter}:${selection.projectType}`;
		}
	}

	$effect(() => {
		// Keeps the open state valid when the tree changes and auto-expands the newly selected branch.
		const validReciters = new Set(tree.reciters.map((node) => node.reciter));
		const nextExpandedReciters = new Set(
			Array.from(expandedReciters).filter((reciter) => validReciters.has(reciter))
		);

		const selectionKey = getSelectionKey(selection);
		if (
			selectionKey !== lastSelectionKey &&
			(selection.kind === 'reciter' || selection.kind === 'type')
		) {
			nextExpandedReciters.add(selection.reciter);
		}

		lastSelectionKey = selectionKey;

		if (!areSetsEqual(expandedReciters, nextExpandedReciters)) {
			expandedReciters = nextExpandedReciters;
		}
	});

	function toggleReciter(reciter: string) {
		const next = new Set(expandedReciters);
		if (next.has(reciter)) {
			next.delete(reciter);
		} else {
			next.add(reciter);
		}
		expandedReciters = next;
	}

	function isExpanded(reciter: string): boolean {
		return expandedReciters.has(reciter);
	}

	function handleToggleClick(event: MouseEvent, reciter: string) {
		event.stopPropagation();
		toggleReciter(reciter);
	}

	/**
	 * Clicking an already selected reciter acts as a lightweight collapse/expand toggle.
	 */
	function handleReciterClick(reciter: string) {
		const isSameReciterSelected =
			(selection.kind === 'reciter' && selection.reciter === reciter) ||
			(selection.kind === 'type' && selection.reciter === reciter);

		if (isSameReciterSelected) {
			toggleReciter(reciter);
			return;
		}

		onSelectionChange({ kind: 'reciter', reciter });
	}
</script>

<aside class="project-explorer">
	<div class="explorer-header">
		<p class="explorer-label">Project Explorer</p>
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
			<span class="tree-name">All</span>
			<span class="tree-count">{tree.totalCount}</span>
		</button>

		{#each tree.reciters as reciterNode (reciterNode.id)}
			<div class="tree-group">
				<div
					class={`tree-row reciter-row ${isSelectionActive(selection, { kind: 'reciter', reciter: reciterNode.reciter }) ? 'active' : ''} ${activeDropNodeId === reciterNode.id ? 'drop-target' : ''}`}
				>
					<button
						type="button"
						class="tree-toggle"
						data-explorer-toggle={reciterNode.reciter}
						title={isExpanded(reciterNode.reciter) ? 'Collapse' : 'Expand'}
						onclick={(event) => handleToggleClick(event, reciterNode.reciter)}
					>
						<span
							class={`material-icons-outlined tree-chevron ${isExpanded(reciterNode.reciter) ? 'expanded' : ''}`}
						>
							chevron_right
						</span>
					</button>

					<button
						type="button"
						class="tree-select"
						data-explorer-node={`reciter:${reciterNode.reciter}`}
						onclick={() => handleReciterClick(reciterNode.reciter)}
					>
						<span class="material-icons-outlined tree-icon">folder_open</span>
						<span class="tree-name">{reciterNode.label}</span>
						<span class="tree-count">{reciterNode.count}</span>
					</button>
				</div>

				{#if isExpanded(reciterNode.reciter)}
					<div class="tree-children">
						{#each reciterNode.types as typeNode (typeNode.id)}
							<button
								type="button"
								class={`tree-row child-row ${
									isSelectionActive(selection, {
										kind: 'type',
										reciter: typeNode.reciter,
										projectType: typeNode.projectType
									})
										? 'active'
										: ''
								} ${activeDropNodeId === typeNode.id ? 'drop-target' : ''}`}
								data-explorer-node={`type:${typeNode.reciter}:${typeNode.projectType}`}
								onclick={() =>
									onSelectionChange({
										kind: 'type',
										reciter: typeNode.reciter,
										projectType: typeNode.projectType
									})}
							>
								<span class="tree-branch" aria-hidden="true">
									<span class="tree-branch-line"></span>
									<span class="tree-branch-dot"></span>
								</span>
								<span class="tree-name">{typeNode.label}</span>
								<span class="tree-count">{typeNode.count}</span>
							</button>
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

	.reciter-row {
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
