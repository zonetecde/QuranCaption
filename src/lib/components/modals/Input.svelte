<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import AutocompleteInput from '../misc/AutocompleteInput.svelte';
	import RecitersManager from '$lib/classes/Reciter';
	import { ProjectDetail } from '$lib/classes';

	let input: HTMLInputElement | undefined = $state(undefined);

	onMount(() => {
		if (input) {
			input.focus();
			input.select();
		}
	});

	let {
		text,
		defaultText = '',
		maxlength = 100,
		placeholder = 'Enter text here',
		inputType = 'text',
		resolve
	}: {
		text: string;
		defaultText?: string;
		maxlength?: number;
		placeholder?: string;
		inputType?: 'text' | 'reciters';
		resolve: (result: string) => void;
	} = $props();

	let inputValue: string = $state(defaultText);

	function handleConfirm() {
		resolve(inputValue.trim());
	}

	function handleCancel() {
		resolve(defaultText);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleConfirm();
		} else if (event.key === 'Escape') {
			handleCancel();
		}
	}
</script>

<div
	class="bg-secondary border border-color rounded-2xl w-[500px] max-w-[90vw] p-6 shadow-2xl shadow-black/50 flex flex-col relative backdrop-blur-sm"
	transition:fade
>
	<!-- Header with icon -->
	<div class="flex items-center gap-3 mb-6">
		<div class="flex items-center justify-center w-10 h-10 bg-accent rounded-full">
			<span class="material-icons text-lg text-accent">edit</span>
		</div>
		<h2 class="text-lg font-semibold text-primary">{text}</h2>
	</div>

	<!-- Content -->
	<div class="mb-6">
		<!-- Input field with enhanced styling -->
		<div class="relative">
			{#if inputType === 'text'}
				<input
					bind:this={input}
					bind:value={inputValue}
					type="text"
					{maxlength}
					class="w-full"
					{placeholder}
					onkeydown={handleKeydown}
					autocomplete="off"
				/>
				<!-- Character counter in input -->
				<div class="absolute right-3 top-1/2 transform -translate-y-1/2">
					<span class="text-xs text-thirdly font-mono bg-secondary px-2 py-1 rounded-md">
						{inputValue.length}/{maxlength}
					</span>
				</div>
			{:else if inputType === 'reciters'}
				<AutocompleteInput
					bind:value={inputValue}
					suggestions={RecitersManager.reciters.map((r) => r.latin)}
					placeholder="Start typing to search reciters..."
					maxlength={ProjectDetail.RECITER_MAX_LENGTH}
					icon="person"
					labelIcon="record_voice_over"
					label="Reciter"
					onEnterPress={handleConfirm}
					focusOnMount={true}
				/>
			{/if}
		</div>

		<!-- Input hint -->
		<div class="mt-3 flex items-center gap-2 text-xs text-thirdly">
			<span class="material-icons text-sm">info</span>
			<span>Press Enter to confirm, Escape to cancel</span>
		</div>
	</div>

	<!-- Action buttons -->
	<div class="flex justify-end gap-3">
		<button
			class="btn px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105"
			onclick={handleCancel}
		>
			Cancel
		</button>
		<button
			class="btn-accent px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105
			       shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed
			       disabled:hover:scale-100"
			onclick={handleConfirm}
			disabled={!inputValue.trim()}
		>
			Confirm
		</button>
	</div>
</div>
