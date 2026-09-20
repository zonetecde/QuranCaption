<script lang="ts">
	type InputVariant = 'free' | 'quotation';

	type Props = {
		id?: string;
		element?: HTMLTextAreaElement | null;
		value: string;
		variant?: InputVariant;
		compactWhenEmpty?: boolean;
		placeholder?: string;
		inputStyle: string;
		blockStyle?: string;
		convertLabel?: string;
		onConvert?: () => void;
		onInput: (value: string) => void;
		onKeydown: (event: KeyboardEvent) => void;
	};

	const INPUT_BASE_CLASS =
		'transcript-part-input rounded-lg border px-3 py-2 text-base! leading-relaxed text-primary outline-none noto-sans-arabic';
	const INPUT_VARIANT_CLASSES: Record<InputVariant, string> = {
		free: 'shrink-0 border-dashed border-color bg-primary transition focus:border-[var(--accent-primary)]',
		quotation: 'transcript-block-main transcript-quotation-input'
	};

	let {
		id,
		element = $bindable(null),
		value,
		variant = 'free',
		compactWhenEmpty = false,
		placeholder,
		inputStyle,
		blockStyle,
		convertLabel,
		onConvert,
		onInput,
		onKeydown
	}: Props = $props();
</script>

{#snippet textArea()}
	<textarea
		{id}
		bind:this={element}
		{value}
		dir="auto"
		rows="1"
		style={inputStyle}
		class={`${INPUT_BASE_CLASS} ${INPUT_VARIANT_CLASSES[variant]}`}
		class:transcript-empty-slot={variant === 'free' && compactWhenEmpty}
		class:transcript-empty={variant === 'quotation' && !value}
		{placeholder}
		oninput={(event) => onInput(event.currentTarget.value)}
		onkeydown={onKeydown}
	></textarea>
{/snippet}

{#if onConvert}
	<div class="group/transcript-block relative w-fit max-w-full shrink-0" style={blockStyle}>
		{@render textArea()}
		{#if value.trim()}
			<button
				type="button"
				class="pointer-events-none absolute left-0 top-full z-20 flex h-5 w-full cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-b-md border border-amber-500/35 bg-amber-500/90 px-2 text-[10px] font-semibold text-black opacity-0 transition hover:bg-amber-400 group-hover/transcript-block:pointer-events-auto group-hover/transcript-block:opacity-100"
				onclick={onConvert}
				aria-label={convertLabel}
			>
				<span class="material-icons-outlined text-xs">format_quote</span>
				{convertLabel}
			</button>
		{/if}
	</div>
{:else}
	{@render textArea()}
{/if}

<style>
	.transcript-part-input {
		field-sizing: content;
		width: auto;
		min-width: 4rem;
		max-width: 100%;
		height: 3rem;
		min-height: 3rem;
		max-height: 3rem;
		padding-top: 0.625rem !important;
		padding-bottom: 0.25rem !important;
		line-height: 1.25rem !important;
		resize: none;
	}

	.transcript-empty-slot {
		width: 2.5rem;
		min-width: 2.5rem;
		padding-inline: 0.5rem;
	}

	.transcript-empty-slot:not(:focus),
	.transcript-empty:not(:focus) {
		opacity: 0.35;
	}

	.transcript-quotation-input {
		border-color: color-mix(in srgb, #facc15 70%, transparent);
		background-color: color-mix(in srgb, #facc15 30%, var(--bg-primary));
	}

	.transcript-quotation-input:focus {
		border-color: #facc15 !important;
		box-shadow: none !important;
		outline: none;
	}

	.noto-sans-arabic {
		font-family: 'Noto Sans Arabic', sans-serif;
	}
</style>
