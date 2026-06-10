<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import type {
		ShortcutActionDefinition,
		ShortcutActionsMap,
		ShortcutCategoryMap
	} from '$lib/types/settings-shortcuts';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	type ActionDef = ShortcutActionDefinition;

	let capturing = $state<{
		category: string;
		action: string;
		index: number;
	} | null>(null);
	/**
	 * Traduit le nom d'une catégorie de raccourci.
	 * @param {string} key Identifiant de la catégorie.
	 * @returns {string} Nom traduit ou la clé brute.
	 */
	function tCatName(key: string): string {
		const m = (get(LL).settings.shortcutCat as Record<string, () => string>)[key];
		return m ? m() : key;
	}
	/**
	 * Traduit le nom d'une action de raccourci.
	 * @param {string} key Identifiant de l'action.
	 * @param {string} fallback Texte de secours si la traduction est absente.
	 * @returns {string} Nom traduit ou le fallback.
	 */
	function tActionName(key: string, fallback: string): string {
		const m = (get(LL).settings.shortcutAction as Record<string, () => string>)[key];
		return m ? m() : fallback;
	}
	/**
	 * Traduit la description d'une action de raccourci.
	 * @param {string} key Identifiant de l'action.
	 * @returns {string} Description traduite ou chaîne vide.
	 */
	function tActionDesc(key: string): string {
		const m = (get(LL).settings.shortcutActionDesc as Record<string, () => string>)[key];
		return m ? m() : '';
	}
	/**
	 * Traduit la description d'une catégorie de raccourci.
	 * @param {string} key Identifiant de la catégorie.
	 * @returns {string} Description traduite ou chaîne vide.
	 */
	function tCatDesc(key: string): string {
		const m = (get(LL).settings.shortcutCatDesc as Record<string, () => string>)[key];
		return m ? m() : '';
	}

	const timelineWheelActions = new Set([
		'ZOOM',
		'HORIZONTAL_SCROLL',
		'VERTICAL_SCROLL',
		'FRAME_BY_FRAME_SCROLL'
	]);
	const timelineWheelOptions = [
		{ value: 'scroll', label: get(LL).settings.scroll() },
		{ value: 'control', label: get(LL).settings.ctrlScroll() },
		{ value: 'shift', label: get(LL).settings.shiftScroll() },
		{ value: 'control+shift', label: get(LL).settings.ctrlShiftScroll() },
		{ value: 'alt', label: get(LL).settings.altScroll() },
		{ value: 'disabled', label: get(LL).common.disabled() }
	];

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
		if (!k) return get(LL).common.none();
		if (k === 'control') return get(LL).settings.ctrl();
		if (k === 'control+shift') return get(LL).settings.ctrlShift();
		if (k === 'scroll') return get(LL).settings.scroll();
		if (k === ' ') return get(LL).settings.space();
		const specials: Record<string, string> = {
			arrowleft: 'ArrowLeft',
			arrowright: 'ArrowRight',
			arrowup: 'ArrowUp',
			arrowdown: 'ArrowDown',
			pageup: 'PageUp',
			pagedown: 'PageDown',
			escape: get(LL).settings.esc(),
			enter: get(LL).settings.enter(),
			backspace: get(LL).settings.backspace()
		};
		return specials[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
	}

	/**
	 * Indique si l'action utilise un raccourci de molette dans la catégorie timeline.
	 * @param {string} category Catégorie du raccourci.
	 * @param {string} action Action du raccourci.
	 * @returns {boolean} `true` si l'action se configure avec une option de scroll.
	 */
	function isTimelineWheelAction(category: string, action: string): boolean {
		return category === 'TIMELINE' && timelineWheelActions.has(action);
	}

	/**
	 * Remplace le raccourci de molette d'une action timeline.
	 * @param {string} category Catégorie du raccourci.
	 * @param {string} action Action du raccourci.
	 * @param {string} value Nouvelle option de molette.
	 * @returns {void}
	 */
	function setWheelShortcut(category: string, action: string, value: string): void {
		const s = globalState.settings as Settings | undefined;
		if (!s) return;

		const next = s.clone();
		next.shortcuts = {
			...(s.shortcuts as ShortcutActionsMap),
			[category]: {
				...((s.shortcuts as ShortcutActionsMap)?.[category] ?? {}),
				[action]: {
					...((s.shortcuts as ShortcutActionsMap)?.[category]?.[action] ?? {}),
					keys: [value]
				}
			}
		} as typeof next.shortcuts;
		globalState.settings = next;
		void Settings.save();
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
		const shortcuts = s.shortcuts as ShortcutActionsMap;
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
		next.shortcuts = {
			...(s.shortcuts as ShortcutActionsMap),
			[category]: {
				...((s.shortcuts as ShortcutActionsMap)?.[category] ?? {}),
				[action]: {
					...((s.shortcuts as ShortcutActionsMap)?.[category]?.[action] ?? {}),
					keys: newKeys.filter((k): k is string => !!k)
				}
			}
		} as typeof next.shortcuts;
		globalState.settings = next;
		void Settings.save();
	}

	function clearKey(category: string, action: string, index: number) {
		const s = globalState.settings as Settings | undefined;
		if (!s) return;
		const shortcuts = s.shortcuts as ShortcutActionsMap;
		const actionDef = shortcuts[category][action];
		const prevKeys = actionDef?.keys ?? [];
		const newKeys = [...prevKeys];
		newKeys.splice(index, 1);

		const next = s.clone();
		next.shortcuts = {
			...(s.shortcuts as ShortcutActionsMap),
			[category]: {
				...((s.shortcuts as ShortcutActionsMap)?.[category] ?? {}),
				[action]: {
					...((s.shortcuts as ShortcutActionsMap)?.[category]?.[action] ?? {}),
					keys: newKeys
				}
			}
		} as typeof next.shortcuts;
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
		const s = globalState.settings as Settings | undefined;
		if (!s) return [] as Array<{ key: string; meta: ShortcutCategoryMap[string] }>;
		const categories = s.shortcutCategories as ShortcutCategoryMap;
		return Object.keys(s.shortcutCategories).map((key) => ({
			key,
			meta: categories[key]
		}));
	}
	function actionsFor(category: string) {
		const s = globalState.settings as Settings | undefined;
		if (!s) return [] as Array<{ key: string; def: ActionDef }>;
		const shortcuts = s.shortcuts as ShortcutActionsMap;
		return Object.keys(shortcuts[category] ?? {}).map((key) => ({
			key,
			def: shortcuts[category][key]
		}));
	}

	onMount(() => {
		// Ouvre l'onglet des raccourcis par défaut
		Settings.load();
	});
</script>

{#if !globalState.settings}
	<div class="p-4 text-secondary">{$LL.editor.loadingShortcuts()}</div>
{:else}
	<div class="space-y-8">
		{#each allCategories() as cat (cat.key)}
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<span class="material-icons text-accent">{cat.meta.icon}</span>
					<h3 class="text-base font-semibold text-primary">{tCatName(cat.key)}</h3>
				</div>
				<p class="text-xs text-secondary">{tCatDesc(cat.key)}</p>

				<div class="mt-2 rounded-xl border border-border-color bg-primary/20">
					{#each actionsFor(cat.key) as action (action.key)}
						<div
							class="flex items-center gap-4 p-3 hover:bg-white/5 border-t first:border-t-0 border-border-color"
						>
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium text-primary truncate">
									{tActionName(action.key, action.def.name ?? action.key)}
								</div>
								<div class="text-xs text-secondary">{tActionDesc(action.key)}</div>
							</div>

							<div class="flex items-center gap-2">
								{#if isTimelineWheelAction(cat.key, action.key)}
									<select
										class="rounded-md border border-border-color bg-white/5 px-2 py-1 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
										value={action.def.keys?.[0] ?? 'disabled'}
										onchange={(event) =>
											setWheelShortcut(
												cat.key,
												action.key,
												(event.currentTarget as HTMLSelectElement).value
											)}
									>
										{#each timelineWheelOptions as option (option.value)}
											<option value={option.value}>{option.label}</option>
										{/each}
									</select>
								{:else}
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
											title={$LL.editor.addASecondKey()}
										>
											<span class="material-icons text-xs">add</span>
										</button>
										{#if action.def.keys?.[1]}
											<span
												class="text-[10px] text-thirdly bg-secondary/60 border border-border-color rounded-full px-2 py-0.5"
												title="{$LL.settings.aSecondKeyAlreadyDefined()}">+1</span
											>
										{/if}
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
			title="{$LL.settings.clickToSetKey()}"
		>
			{#if capturing && capturing.category === category && capturing.action === action && capturing.index === index}
				<span
					class="i loader mr-1 animate-spin h-3 w-3 border-2 border-accent border-t-transparent rounded-full"
				></span>
				<span>{$LL.settings.pressAKey()}</span>
			{:else}
				<span class="material-icons text-xs opacity-70">keyboard</span>
				<span>{formatKey(value)}</span>
			{/if}
		</button>
		<button
			class="p-1 rounded-md text-secondary hover:text-primary hover:bg-white/10"
			onclick={() => onClear(category, action, index)}
			title={$LL.common.clear()}
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
