<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { fade, scale } from 'svelte/transition';
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

<div class="modal-backdrop" onclick={close} transition:fade>
	<div
		class="modal-content bg-secondary border border-color"
		onclick={(e) => e.stopPropagation()}
		transition:scale={{ start: 0.95 }}
	>
		<div class="modal-header">
			<h3>Shift All Subtitles</h3>
			<button class="close-btn" onclick={close}>
				<span class="material-icons">close</span>
			</button>
		</div>

		<div class="modal-body space-y-6">
			<p class="text-sm text-secondary">
				Move all subtitles forward or backward in time. This is useful for fixing global sync issues.
			</p>

			<!-- Direction Selection -->
			<div class="grid grid-cols-2 gap-3">
				<button
					class="direction-card {direction === 'left' ? 'selected' : ''}"
					onclick={() => (direction = 'left')}
				>
					<span class="material-icons">keyboard_double_arrow_left</span>
					<span>Backward (Left)</span>
				</button>
				<button
					class="direction-card {direction === 'right' ? 'selected' : ''}"
					onclick={() => (direction = 'right')}
				>
					<span>Forward (Right)</span>
					<span class="material-icons">keyboard_double_arrow_right</span>
				</button>
			</div>

			<!-- Amount Input -->
			<div class="input-group">
				<label for="shift-amount" class="text-sm font-medium text-primary block mb-2"
					>Shift Amount</label
				>
				<div class="flex gap-2">
					<input
						id="shift-amount"
						type="number"
						bind:value={shiftAmount}
						min="0"
						step="0.1"
						class="flex-1 bg-accent border border-color rounded-md px-3 py-2 text-primary focus:border-accent-primary focus:outline-none"
						placeholder="0.0"
					/>
					<select
						bind:value={unit}
						class="bg-accent border border-color rounded-md px-3 py-2 text-primary focus:border-accent-primary focus:outline-none"
					>
						<option value="seconds">Seconds</option>
						<option value="milliseconds">Milliseconds</option>
					</select>
				</div>
			</div>

			<div class="bg-accent/50 rounded-lg p-3 text-xs text-secondary flex gap-2 items-start">
				<span class="material-icons text-sm text-accent-primary mt-0.5">info</span>
				<p>
					This action will move <strong>{globalState.getSubtitleTrack.clips.length}</strong> subtitles.
					Please ensure no subtitles will be pushed before 0:00.
				</p>
			</div>
		</div>

		<div class="modal-footer">
			<button class="btn-secondary" onclick={close}>Cancel</button>
			<button class="btn-primary" onclick={applyShift}>Apply Shift</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal-content {
		width: 100%;
		max-width: 450px;
		border-radius: 12px;
		box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
		overflow: hidden;
	}

	.modal-header {
		padding: 1rem 1.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--border-color);
	}

	.modal-header h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 0.375rem;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background-color: var(--bg-accent);
		color: var(--text-primary);
	}

	.modal-body {
		padding: 1.5rem;
	}

	.direction-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1rem;
		border-radius: 0.5rem;
		border: 1px solid var(--border-color);
		background-color: var(--bg-accent);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.direction-card:hover {
		background-color: var(--bg-secondary);
		border-color: var(--accent-primary);
	}

	.direction-card.selected {
		background-color: var(--accent-primary);
		color: black;
		border-color: var(--accent-primary);
	}

	.modal-footer {
		padding: 1rem 1.5rem;
		background-color: var(--bg-accent);
		border-top: 1px solid var(--border-color);
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
	}

	.btn-secondary {
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-weight: 500;
		font-size: 0.875rem;
		color: var(--text-primary);
		background-color: transparent;
		border: 1px solid var(--border-color);
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-secondary:hover {
		background-color: var(--bg-secondary);
	}

	.btn-primary {
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-weight: 500;
		font-size: 0.875rem;
		color: black;
		background-color: var(--accent-primary);
		border: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}
</style>
