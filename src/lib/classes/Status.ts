import { SerializableBase } from './misc/SerializableBase';

export class Status extends SerializableBase {
	static readonly NOT_SET = new Status('Not Set', '#ffffff');
	static readonly TO_CAPTION = new Status('To Caption', '#ffea00');
	static readonly TO_TRANSLATE = new Status('To Translate', '#c97b14');
	static readonly TO_EXPORT = new Status('To Export', '#e600ff');
	static readonly EXPORTED = new Status('Exported', '#11ff00');

	status: string;
	color: string;

	constructor(status: string, color: string) {
		super();
		this.status = status;
		this.color = color;
	}

	static getAllStatuses(): Status[] {
		return [
			Status.NOT_SET,
			Status.TO_CAPTION,
			Status.TO_TRANSLATE,
			Status.TO_EXPORT,
			Status.EXPORTED
		];
	}
}
