import type { BaseTranslation } from '../i18n-types';
import common from './common';
import home from './home';
import editor from './editor';
import export_ from './export';
import translations from './translations';
import style from './style';
import settings from './settings';
import tour from './tour';
import modals from './modals';
import tools from './tools';
import status from './status';
import migration from './migration';
import aiVideo from './aiVideo';
import donation from './donation';
import exporterMonitor from './exporterMonitor';
import batch from './batch';

const en: BaseTranslation = {
	common,
	home,
	editor,
	export: export_,
	translations,
	style,
	settings,
	tour,
	modals,
	tools,
	status,
	migration,
	aiVideo,
	donation,
	exporterMonitor,
	batch
};

export default en;
