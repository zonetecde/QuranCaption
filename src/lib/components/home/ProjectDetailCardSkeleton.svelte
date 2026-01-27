<script lang="ts">
	export let isListView: boolean = false;
	export let count: number = 8;
</script>

<div
	class={'mt-4 ' +
		(isListView
			? 'grid grid-cols-1 gap-3'
			: 'grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6')}
>
	{#each Array(count) as _, index}
		<div
			class="bg-secondary border border-[var(--border-color)] rounded-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] flex flex-col justify-between"
			data-index={index}
		>
			<div>
				<section class="skeleton-block w-full h-40 rounded-t-lg"></section>
				<div class="px-4 pb-4 relative mt-4 space-y-3">
					<div class="flex justify-between items-center">
						<div class="skeleton-block h-4 w-40 rounded"></div>
						<div class="skeleton-block h-4 w-16 rounded"></div>
					</div>
					<div class="skeleton-block h-3 w-28 rounded"></div>
					<div class="skeleton-block h-3 w-24 rounded"></div>
					<div class="skeleton-block h-3 w-32 rounded"></div>
				</div>
			</div>
			<div class="mt-auto pt-3 border-t border-[var(--border-color)] px-4 pb-4">
				<div class="flex justify-between items-center mb-3">
					<div class="skeleton-block h-3 w-20 rounded"></div>
					<div class="skeleton-block h-3 w-20 rounded"></div>
				</div>
				<div class="flex gap-2">
					<div class="skeleton-block h-8 flex-grow rounded"></div>
					<div class="skeleton-block h-8 w-10 rounded"></div>
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.skeleton-block {
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.06) 25%,
			rgba(255, 255, 255, 0.18) 37%,
			rgba(255, 255, 255, 0.06) 63%
		);
		background-size: 400% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes skeleton-shimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: 0 0;
		}
	}
</style>
