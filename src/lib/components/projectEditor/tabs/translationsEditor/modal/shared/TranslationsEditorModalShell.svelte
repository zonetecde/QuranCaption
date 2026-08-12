<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import AiActivityLogCard from './AiActivityLogCard.svelte';
	import AiRunStatusCard from './AiRunStatusCard.svelte';

	type MetricItem = {
		label: string;
		value: string | number;
		valueClass?: string;
	};

	type ActivityEntry = {
		id: string;
		step: string;
		message: string;
		tone: 'info' | 'success' | 'error';
	};

	type AssistantWorkspace = {
		configuration: {
			title: string;
			description: string;
			icon: string;
		};
		provider: {
			title: string;
			description: string;
			currentModelLabel: string;
			model: string;
			endpointLabel: string;
			endpoint: string;
			notSetLabel: string;
		};
		run: {
			title: string;
			description: string;
			buttonLabel: string;
			buttonWidthClass?: string;
			disabled: boolean;
			onclick: () => void | Promise<void>;
		};
		status: {
			title: string;
			subtitle: string;
			progressPercent: number;
			metrics: MetricItem[];
		};
		activityLog: ActivityEntry[];
		activityTitle?: string;
		activityMaxHeightClass?: string;
	};

	let {
		close,
		title,
		icon,
		shellClass = '',
		bodyClass = 'flex-1 min-h-0 overflow-hidden',
		iconContainerClass = 'w-10 h-10',
		iconClass = 'text-xl',
		workspace,
		subtitle,
		afterHeader,
		configurationFields,
		configurationSummary,
		afterStatus,
		children
	}: {
		close: () => void;
		title: string;
		icon: string;
		shellClass?: string;
		bodyClass?: string;
		iconContainerClass?: string;
		iconClass?: string;
		workspace?: AssistantWorkspace;
		subtitle?: Snippet;
		afterHeader?: Snippet;
		configurationFields?: Snippet;
		configurationSummary?: Snippet;
		afterStatus?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div
	class={`bg-secondary border-color border rounded-2xl shadow-2xl shadow-black flex flex-col relative overflow-hidden ${shellClass}`}
	transition:slide
>
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-3 min-w-0">
				<div
					class={`${iconContainerClass} bg-accent-primary rounded-full flex items-center justify-center flex-shrink-0`}
				>
					<span class={`material-icons text-black ${iconClass}`}>{icon}</span>
				</div>
				<div class="min-w-0">
					<h2 class="text-xl font-bold text-primary">{title}</h2>
					<p class="text-sm text-thirdly">
						{@render subtitle?.()}
					</p>
				</div>
			</div>

			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>

	{@render afterHeader?.()}

	{#if workspace}
		<div class={bodyClass}>
			<div class="min-h-0 overflow-y-auto space-y-5 border-r border-color p-6">
				<div class="rounded-xl border border-color bg-accent px-4 py-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h3 class="text-base font-semibold text-primary">{workspace.configuration.title}</h3>
							<p class="mt-1 text-sm leading-relaxed text-thirdly">
								{workspace.configuration.description}
							</p>
						</div>
						<div class="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
							<span class="material-icons text-accent-primary">{workspace.configuration.icon}</span>
						</div>
					</div>
				</div>

				{@render configurationFields?.()}
				{@render configurationSummary?.()}

				<div class="rounded-xl border border-color bg-secondary px-4 py-4">
					<div class="flex items-start gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
							<span class="material-icons text-accent-primary">settings</span>
						</div>
						<div class="min-w-0 space-y-1">
							<div class="text-sm font-semibold text-primary">{workspace.provider.title}</div>
							<p class="text-sm leading-relaxed text-thirdly">{workspace.provider.description}</p>
							<div class="text-xs text-thirdly">
								{workspace.provider.currentModelLabel}:
								<span class="font-medium text-primary">
									{workspace.provider.model || workspace.provider.notSetLabel}
								</span>
							</div>
							<div class="break-all text-xs text-thirdly">
								{workspace.provider.endpointLabel}:
								<span class="font-medium text-primary">
									{workspace.provider.endpoint || workspace.provider.notSetLabel}
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="min-h-0 space-y-5 overflow-y-auto bg-primary/30 p-6">
				<div class="rounded-xl border border-color bg-secondary px-4 py-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h3 class="text-base font-semibold text-primary">{workspace.run.title}</h3>
							<p class="mt-1 text-sm leading-relaxed text-thirdly">{workspace.run.description}</p>
						</div>
						<button
							type="button"
							class={`rounded-lg bg-[var(--accent-primary)] ${workspace.run.buttonWidthClass ?? 'w-56'} px-4 py-2.5 text-sm font-semibold text-black transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55`}
							onclick={workspace.run.onclick}
							disabled={workspace.run.disabled}
						>
							{workspace.run.buttonLabel}
						</button>
					</div>
				</div>

				<AiRunStatusCard
					title={workspace.status.title}
					subtitle={workspace.status.subtitle}
					progressPercent={workspace.status.progressPercent}
					metrics={workspace.status.metrics}
					columnsClass="grid-cols-2"
				/>

				{@render afterStatus?.()}

				<AiActivityLogCard
					activityLog={workspace.activityLog}
					title={workspace.activityTitle}
					maxHeightClass={workspace.activityMaxHeightClass ?? 'max-h-[420px]'}
				/>
			</div>
		</div>
	{:else}
		<div class={bodyClass}>
			{@render children?.()}
		</div>
	{/if}
</div>
