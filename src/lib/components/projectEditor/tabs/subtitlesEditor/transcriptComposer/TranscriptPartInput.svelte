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
		onInput,
		onKeydown
	}: Props = $props();
</script>

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
