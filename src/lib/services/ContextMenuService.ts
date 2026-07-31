import { tick } from 'svelte';
import { get } from 'svelte/store';
import { currentMenu } from 'svelte-contextmenu/stores';

interface ContextMenuController {
	show(event: MouseEvent): void;
}

/**
 * Affiche un menu contextuel en le maintenant dans le viewport mobile.
 * @param {ContextMenuController | null | undefined} controller Menu contextuel à afficher.
 * @param {MouseEvent} event Événement ayant déclenché l'ouverture du menu.
 * @returns {Promise<void>} Promesse résolue après le repositionnement du menu.
 */
export async function showContextMenuInViewport(
	controller: ContextMenuController | null | undefined,
	event: MouseEvent
): Promise<void> {
	event.preventDefault();
	if (!controller) return;

	controller.show(event);
	await tick();

	const menu = get(currentMenu) as HTMLElement | null;
	if (!menu) return;

	const margin = 8;
	const viewport = window.visualViewport;
	const viewportLeft = viewport?.offsetLeft ?? 0;
	const viewportTop = viewport?.offsetTop ?? 0;
	const viewportWidth = viewport?.width ?? window.innerWidth;
	const viewportHeight = viewport?.height ?? window.innerHeight;

	menu.style.maxWidth = `${viewportWidth - margin * 2}px`;
	menu.style.maxHeight = `${viewportHeight - margin * 2}px`;
	menu.style.overflow = 'auto';

	const rect = menu.getBoundingClientRect();
	let left = Number.parseFloat(menu.style.left);
	let top = Number.parseFloat(menu.style.top);

	left += Math.max(viewportLeft + margin - rect.left, 0);
	left -= Math.max(rect.right - (viewportLeft + viewportWidth - margin), 0);
	top += Math.max(viewportTop + margin - rect.top, 0);
	top -= Math.max(rect.bottom - (viewportTop + viewportHeight - margin), 0);

	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
}
