<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { ProjectDetail } from '$lib/classes';
	import { ProjectService } from '$lib/services/ProjectService';
	import { PROJECT_TYPE_OPTIONS, type ProjectType } from '$lib/types/projectType';

	let {
		projectDetail,
		variant = 'row',
		onBeforeOpen = () => {}
	}: {
		projectDetail: ProjectDetail;
		variant?: 'badge' | 'row';
		onBeforeOpen?: () => void;
	} = $props();

	let isOpen = $state(false);

	function close() {
		isOpen = false;
	}

	function handleWindowClick() {
		close();
	}

	onMount(() => {
		if (typeof window === 'undefined') return;
		window.addEventListener('click', handleWindowClick);
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		window.removeEventListener('click', handleWindowClick);
	});

	function toggle(event: MouseEvent) {
		event.stopPropagation();
		if (!isOpen) {
			onBeforeOpen();
		}
		isOpen = !isOpen;
	}

	function stopPointerPropagation(event: PointerEvent) {
		event.stopPropagation();
	}

	function getOptionClass(option: ProjectType): string {
		return `cursor-pointer select-none rounded-sm px-3 py-1.5 text-xs transition-colors hover:bg-white/5 ${
			option === projectDetail.projectType ? 'bg-white/10 font-semibold text-[var(--text-primary)]' : ''
		}`;
	}

	async function selectProjectType(option: ProjectType) {
		projectDetail.projectType = option;
		close();
		await ProjectService.saveDetail(projectDetail);
	}
</script>

{#if variant === 'badge'}
	<div class="relative">
		<button
			type="button"
			onclick={toggle}
			class="inline-flex cursor-pointer items-center gap-1 rounded-full border-0 bg-[var(--bg-primary)]/30 px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-primary)]/90 backdrop-blur-sm hover:bg-[var(--bg-primary)]/45"
			style="margin: 0; appearance: none;"
			data-project-type
			data-no-drag
		>
			<span class="material-icons-outlined text-xs">folder_special</span>
			{projectDetail.projectType}
		</button>

		{#if isOpen}
			<ul
				class="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-xl backdrop-blur-sm"
				data-no-drag
				onpointerdown={stopPointerPropagation}
			>
				{#each PROJECT_TYPE_OPTIONS as option (option)}
					<li class={getOptionClass(option)} onclick={() => selectProjectType(option)}>
						{option}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else}
	<div class="relative mt-1 flex items-center gap-x-1 text-xs text-[var(--text-secondary)]">
		Folder:
		<button
			class="group inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-[var(--text-primary)] hover:bg-white/5"
			type="button"
			onclick={toggle}
		>
			<span>{projectDetail.projectType}</span>
			<span class="material-icons-outlined text-[12px] opacity-50 transition-opacity group-hover:opacity-80">
				arrow_drop_down
			</span>
		</button>

		{#if isOpen}
			<ul
				class="absolute left-12 top-full z-20 mt-1 w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-xl backdrop-blur-sm"
				data-no-drag
				onpointerdown={stopPointerPropagation}
			>
				{#each PROJECT_TYPE_OPTIONS as option (option)}
					<li class={getOptionClass(option)} onclick={() => selectProjectType(option)}>
						{option}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
