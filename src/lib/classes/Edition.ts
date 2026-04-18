export class Edition {
	constructor(
		public key: string,
		public name: string,
		public author: string,
		public language: string,
		public direction: string,
		public source: string,
		public comments: string,
		public link: string,
		public linkmin: string,
		public showInTranslationsEditor: boolean = true,
		public flag: string = '',
		public isCustom: boolean = false,
		public basmala: string = '',
		public istiadhah: string = '',
		public amin: string = '',
		public takbir: string = '',
		public tahmeed: string = '',
		public tasleem: string = '',
		public sadaqa: string = ''
	) {}
}
