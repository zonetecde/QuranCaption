import { SerializableBase } from './misc/SerializableBase.js';
import { Category } from './videoStyles/Category.svelte.js';
import { Style } from './videoStyles/Style.svelte.js';
import { StylesData } from './videoStyles/StylesData.svelte.js';
import { VideoStyle } from './videoStyles/VideoStyle.svelte.js';

export { Category, Style, StylesData, VideoStyle };
export type * from './videoStyles/types.js';

SerializableBase.registerChildClass(VideoStyle, 'styles', StylesData);
SerializableBase.registerChildClass(StylesData, 'categories', Category);
SerializableBase.registerChildClass(Category, 'styles', Style);
