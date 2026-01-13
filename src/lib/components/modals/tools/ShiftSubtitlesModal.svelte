<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { slide, fade } from 'svelte/transition';
	import toast from 'svelte-5-french-toast';

	let { close } = $props();

	let shiftAmount = $state(0);
	let direction: 'left' | 'right' = $state('right');
	let unit: 'seconds' | 'milliseconds' = $state('seconds');

	function applyShift() {
		if (shiftAmount === 0) {
			close();
			return;
		}

		let offsetMs = shiftAmount;
		if (unit === 'seconds') {
			offsetMs *= 1000;
		}

		if (direction === 'left') {
			offsetMs = -offsetMs;
		}

		const success = globalState.getSubtitleTrack.shiftAllClips(offsetMs);
		if (success) {
			toast.success(`Subtitles shifted by ${shiftAmount} ${unit} to the ${direction}.`);
			close();
		}
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[500px] max-w-[90vw] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<!-- Header -->
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">move_down</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">Shift All Subtitles</h2>
					<p class="text-sm text-thirdly">Move all subtitles forward or backward in time</p>
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

	<!-- Body -->
	<div class="px-6 py-5 space-y-6">
		<p class="text-sm text-secondary leading-relaxed">
			Move all subtitles forward or backward in time. This is useful for fixing global sync issues.
		</p>

		<!-- Direction Selection -->
		<div class="grid grid-cols-2 gap-3">
			<button
				class="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200 cursor-pointer {direction ===
				'left'
					? 'bg-accent-primary text-black border-accent-primary shadow-lg shadow-accent-primary/20'
					: 'bg-accent border-color text-secondary hover:bg-secondary/60'}"
				onclick={() => (direction = 'left')}
			>
				<span class="material-icons">keyboard_double_arrow_left</span>
				<span class="text-sm font-medium">Backward (Left)</span>
			</button>
			<button
				class="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200 cursor-pointer {direction ===
				'right'
					? 'bg-accent-primary text-black border-accent-primary shadow-lg shadow-accent-primary/20'
					: 'bg-accent border-color text-secondary hover:bg-secondary/60'}"
				onclick={() => (direction = 'right')}
			>
				<span class="material-icons">keyboard_double_arrow_right</span>
				<span class="text-sm font-medium">Forward (Right)</span>
			</button>
		</div>

		<!-- Amount Input -->
		<div class="space-y-2">
			<label for="shift-amount" class="text-sm font-medium text-primary block">Shift Amount</label>
			<div class="flex gap-2">
				<input
					id="shift-amount"
					type="number"
					bind:value={shiftAmount}
					min="0"
					step="0.1"
					class="flex-1 bg-accent border border-color rounded-lg px-3 py-2 text-primary focus:border-accent-primary focus:outline-none transition-colors"
					placeholder="0.0"
				/>
				<select
					bind:value={unit}
					class="bg-accent border border-color rounded-lg px-3 py-2 text-primary focus:border-accent-primary focus:outline-none transition-colors cursor-pointer"
				>
					<option value="seconds">Seconds</option>
					<option value="milliseconds">Milliseconds</option>
				</select>
			</div>
		</div>

		<div
			class="bg-accent/50 rounded-xl p-4 text-xs text-secondary flex gap-3 items-start border border-color/50"
		>
			<span class="material-icons text-sm text-accent-primary mt-0.5">info</span>
			<p class="leading-relaxed">
				This action will move <strong class="text-primary"
					>{globalState.getSubtitleTrack.clips.length}</strong
				> subtitles. Please ensure no subtitles will be pushed before 0:00.
			</p>
		</div>
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="text-xs text-thirdly">Ready to apply changes.</div>
			<div class="flex gap-3">
				<button class="btn px-5 py-2 text-sm" onclick={close}>Cancel</button>
				<button class="btn-accent px-5 py-2 text-sm flex items-center gap-2" onclick={applyShift}>
					<span class="material-icons text-base">done</span>
					Apply Shift
				</button>
			</div>
		</div>
	</div>
</div>
