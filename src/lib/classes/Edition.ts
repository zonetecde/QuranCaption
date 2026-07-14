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
		public quranEdition: Edition | null = null
	) {}

	/**
	 * Indique si cette entrée représente une langue du projet plutôt qu'une édition Quran brute.
	 * @returns {boolean} `true` pour une langue ajoutée dans Minbar Studio.
	 */
	isProjectLanguage(): boolean {
		return this.source === 'project-language';
	}
}
