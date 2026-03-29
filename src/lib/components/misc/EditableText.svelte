<script lang="ts">
	import ModalManager from '../modals/ModalManager';

	let {
		text = 'Input',
		value = $bindable(),
		maxLength = 50,
		placeholder = 'Enter text here',
		action = () => {},
		parentClasses = '',
		textClasses = '',
		inputType = 'text',
		disabled = false
	}: {
		text?: string;
		value?: string;
		maxLength?: number;
		placeholder?: string;
		action?: () => void;
		parentClasses?: string;
		textClasses?: string;
		inputType?: 'text' | 'reciters';
		disabled?: boolean;
	} = $props();

	async function textClicked() {
		const newName = await ModalManager.inputModal(text, value, maxLength, placeholder, inputType);
		if (newName && newName.trim() !== '') {
			value = newName.trim();
			action();
		}
	}
</script>

<button
	onclick={textClicked}
	{disabled}
	class={'text-left text-nowrap group/name flex items-center cursor-pointer ' + parentClasses}
>
	<h4 class={'group-hover/name:underline ' + textClasses}>{value}</h4>
	<span
		class="material-icons-outlined text-lg! pt-0.5 ml-2 opacity-0 group-hover/name:opacity-100 transition-opacity duration-100"
		>edit</span
	>
</button>
