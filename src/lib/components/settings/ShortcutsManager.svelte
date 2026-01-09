<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';

	type ActionDef = { keys: string[]; name: string; description: string };

	let capturing = $state<{
		category: string;
		action: string;
		index: number;
	} | null>(null);

	// Gestion d’affichage du 2e slot par action (masqué par défaut)
	let expandedSecond = $state<Record<string, boolean>>({});
	function idFor(category: string, action: string) {
		return `${category}:${action}`;
	}
	function isSecondVisible(category: string, action: string) {
		const id = idFor(category, action);
		// Visible si explicitement déployé ou si on est en capture pour l’index 1
		return (
			expandedSecond[id] ||
			(capturing &&
				capturing.category === category &&
				capturing.action === action &&
				capturing.index === 1)
		);
	}

	function normalizeKey(k: string): string {
		if (k === ' ') return ' ';
		return k.toLowerCase();
	}
	function formatKey(k: string | undefined): string {
		if (!k) return 'None';
		if (k === ' ') return 'Space';
		const specials: Record<string, string> = {
			arrowleft: 'ArrowLeft',
			arrowright: 'ArrowRight',
			arrowup: 'ArrowUp',
			arrowdown: 'ArrowDown',
			pageup: 'PageUp',
			pagedown: 'PageDown',
			escape: 'Esc',
			enter: 'Enter',
			backspace: 'Backspace'
		};
		return specials[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
	}

	function beginCapture(category: string, action: string, index: number, e?: Event) {
		e?.preventDefault?.();
		// Ouvre le 2e slot si on souhaite capturer l’index 1
		if (index === 1) expandedSecond[idFor(category, action)] = true;
		capturing = { category, action, index };
	}
	function cancelCapture() {
		capturing = null;
	}

	function applyKey(category: string, action: string, index: number, key: string) {
		const s = globalState.settings as Settings | undefined;
		if (!s) return;
		const shortcuts = s.shortcuts as unknown as Record<string, Record<string, ActionDef>>;
		const actionDef = shortcuts[category][action];
		const prevKeys = actionDef?.keys ?? [];

		const otherIndex = index === 0 ? 1 : 0;
		const newKeys = [...prevKeys];
		if (newKeys[otherIndex] === key) {
			newKeys[otherIndex] = undefined as unknown as string;
		}
		newKeys[index] = key;

		// Ouvre le 2e slot si on vient de définir la 2e touche
		if (index === 1) expandedSecond[idFor(category, action)] = true;

		const next = s.clone();
		(next as any).shortcuts = {
			...((s as any).shortcuts ?? {}),
			[category]: {
				...((s as any).shortcuts?.[category] ?? {}),
				[action]: {
					...((s as any).shortcuts?.[category]?.[action] ?? {}),
					keys: newKeys.filter((k): k is string => !!k)
				}
			}
		};
		globalState.settings = next;
	}

	function clearKey(category: string, action: string, index: number) {
		const s = globalState.settings as Settings | undefined;
		if (!s) return;
		const shortcuts = s.shortcuts as unknown as Record<string, Record<string, ActionDef>>;
		const actionDef = shortcuts[category][action];
		const prevKeys = actionDef?.keys ?? [];
		const newKeys = [...prevKeys];
		newKeys.splice(index, 1);

		const next = s.clone();
		(next as any).shortcuts = {
			...((s as any).shortcuts ?? {}),
			[category]: {
				...((s as any).shortcuts?.[category] ?? {}),
				[action]: {
					...((s as any).shortcuts?.[category]?.[action] ?? {}),
					keys: newKeys
				}
			}
		};
		globalState.settings = next;

		// Si on a supprimé la 2e touche, referme le slot
		if (index === 1) {
			const id = idFor(category, action);
			if (!newKeys[1]) expandedSecond[id] = false;
		}
	}

	function handleKeydown(ev: KeyboardEvent) {
		if (!capturing) return;
		ev.preventDefault();
		ev.stopPropagation();
		if (ev.key === 'Escape') {
			cancelCapture();
			return;
		}
		const k = normalizeKey(ev.key);
		applyKey(capturing.category, capturing.action, capturing.index, k);
		cancelCapture();
	}

	$effect(() => {
		if (!capturing) return;
		window.addEventListener('keydown', handleKeydown, { capture: true });
		return () => window.removeEventListener('keydown', handleKeydown, true);
	});

	function allCategories() {
		const s: any = globalState.settings;
		if (!s) return [] as Array<{ key: string; meta: any }>;
		return Object.keys(s.shortcutCategories).map((key) => ({
			key,
			meta: s.shortcutCategories[key]
		}));
	}
	function actionsFor(category: string) {
		const s: any = globalState.settings;
		if (!s) return [] as Array<{ key: string; def: ActionDef }>;
		return Object.keys(s.shortcuts[category]).map((key) => ({
			key,
			def: s.shortcuts[category][key]
		}));
	}

	onMount(() => {
		// Ouvre l'onglet des raccourcis par défaut
		Settings.load();
	});
</script>

{#if !globalState.settings}
	<div class="p-4 text-secondary">Loading shortcuts…</div>
{:else}
	<div class="space-y-8">
		{#each allCategories() as cat}
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<span class="material-icons text-accent">{cat.meta.icon}</span>
					<h3 class="text-base font-semibold text-primary">{cat.meta.name}</h3>
				</div>
				<p class="text-xs text-secondary">{cat.meta.description}</p>

				<div class="mt-2 rounded-xl border border-border-color bg-primary/20">
					{#each actionsFor(cat.key) as action}
						<div
							class="flex items-center gap-4 p-3 hover:bg-white/5 border-t first:border-t-0 border-border-color"
						>
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium text-primary truncate">
									{action.def.name ?? action.key}
								</div>
								<div class="text-xs text-secondary">{action.def.description}</div>
							</div>

							<div class="flex items-center gap-2">
								<!-- Slot 1 toujours visible -->
								{@render KeySlot({
									category: cat.key,
									action: action.key,
									index: 0,
									value: action.def.keys?.[0],
									onCapture: beginCapture,
									onClear: (c, a, i) => {
										clearKey(c, a, i);
										// si on supprime la première, garder l’état d’ouverture tel quel
									}
								})}

								{#if isSecondVisible(cat.key, action.key)}
									<!-- Slot 2 visible si déployé / capture en cours -->
									{@render KeySlot({
										category: cat.key,
										action: action.key,
										index: 1,
										value: action.def.keys?.[1],
										onCapture: beginCapture,
										onClear: (c, a, i) => clearKey(c, a, i)
									})}
								{:else}
									<!-- Bouton + pour ajouter/afficher la 2e touche -->
									<button
										class="px-2 py-1 rounded-md border border-border-color text-xs text-secondary hover:text-primary bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-accent/30 flex items-center gap-1"
										onclick={() => (expandedSecond[idFor(cat.key, action.key)] = true)}
										title="Add a second key"
									>
										<span class="material-icons text-xs">add</span>
									</button>
									{#if action.def.keys?.[1]}
										<span
											class="text-[10px] text-thirdly bg-secondary/60 border border-border-color rounded-full px-2 py-0.5"
											title="A second key is already defined">+1</span
										>
									{/if}
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/if}

<!-- Composant interne d'affichage/édition d'une touche -->
{#snippet KeySlot({
	category,
	action,
	index,
	value,
	onCapture,
	onClear
}: {
	category: string;
	action: string;
	index: number;
	value?: string;
	onCapture: (category: string, action: string, index: number, e?: Event) => void;
	onClear: (category: string, action: string, index: number) => void;
})}
	<div class="flex items-center gap-1">
		<button
			class="px-2 py-1 rounded-md border border-border-color text-xs text-primary bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-accent/50 min-w-[84px] flex items-center justify-center gap-1"
			onclick={(e) => onCapture(category, action, index, e)}
			title="Click to set key"
		>
			{#if capturing && capturing.category === category && capturing.action === action && capturing.index === index}
				<span
					class="i loader mr-1 animate-spin h-3 w-3 border-2 border-accent border-t-transparent rounded-full"
				></span>
				<span>Press a key</span>
			{:else}
				<span class="material-icons text-xs opacity-70">keyboard</span>
				<span>{formatKey(value)}</span>
			{/if}
		</button>
		<button
			class="p-1 rounded-md text-secondary hover:text-primary hover:bg-white/10"
			onclick={() => onClear(category, action, index)}
			title="Clear"
		>
			<span class="material-icons text-sm">backspace</span>
		</button>
	</div>
{/snippet}

<style>
	.border-border-color {
		border-color: var(--border-color, rgba(255, 255, 255, 0.1));
	}
</style>
