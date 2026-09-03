/** Valeurs possibles pour les catégories de l'éditeur de styles. */
export type StyleCategoryName =
	| 'text'
	| 'positioning'
	| 'background'
	| 'shadow'
	| 'outline'
	| 'border'
	| 'line-background'
	| 'effects'
	| 'word-by-word-highlight'
	| 'general'
	| 'overlay'
	| 'surah-name'
	| 'reciter-name'
	| 'verse-number'
	| 'ayah-container'
	| 'creator-text';

export type GeneralStyleName =
	| 'show-subtitles'
	| 'show-verse-number'
	| 'verse-number-new-line'
	| 'show-decorative-brackets'
	| 'decorative-brackets-font-family'
	| 'riwayah'
	| 'mushaf-style'
	| 'basmala-style'
	| 'basmala-scale'
	| 'verse-number-format'
	| 'verse-number-position'
	| 'verse-number-numeral-system'
	| 'text-direction';

export type GlobalAnimationStyleName =
	| 'video-dimension'
	| 'media-fill'
	| 'media-scale'
	| 'media-position-x'
	| 'media-position-y'
	| 'fade-duration'
	| 'video-and-audio-fade'
	| 'video-clip-transition'
	| 'video-clip-transition-duration'
	| 'anti-collision'
	| 'spacing';

export type TextStyleName =
	| 'text-color'
	| 'verse-number-color'
	| 'font-size'
	| 'font-family'
	| 'font-weight'
	| 'enable-italic'
	| 'text-transform'
	| 'letter-spacing'
	| 'word-spacing'
	| 'line-height'
	| 'max-height'
	| 'max-line'
	| 'reactive-font-size'
	| 'reactive-y-position'
	| 'text-glow-enable'
	| 'text-glow-color'
	| 'text-glow-blur';

export type PositioningStyleName =
	| 'vertical-position'
	| 'horizontal-position'
	| 'width'
	| 'horizontal-text-alignment'
	| 'vertical-text-alignment';

export type BackgroundStyleName =
	| 'background-enable'
	| 'always-show'
	| 'time-appearance'
	| 'time-disappearance'
	| 'background-color'
	| 'background-opacity'
	| 'border-radius'
	| 'background-horizontal-padding';

export type ShadowStyleName =
	| 'shadow-enable'
	| 'text-shadow'
	| 'text-shadow-color'
	| 'box-shadow'
	| 'box-shadow-color';

export type OutlineStyleName = 'outline-enable' | 'text-outline' | 'text-outline-color';

export type BorderStyleName = 'border-enable' | 'border-width' | 'border-color' | 'border-style';

export type EffectsStyleName = 'opacity' | 'blur' | 'brightness' | 'contrast';

export type LineBackgroundStyleName =
	| 'line-background-enable'
	| 'line-background-color'
	| 'line-background-position'
	| 'line-background-height';

export type AnimationStyleName = 'scale' | 'rotation';

export type TimedOverlayStyleName =
	| 'time-ranges'
	| 'surah-name-time-ranges'
	| 'reciter-name-time-ranges'
	| 'ayah-container-time-ranges';

export type WordByWordHighlightStyleName =
	| 'enable-wbw-highlight'
	| 'wbw-show-current-word-only'
	| 'wbw-color'
	| 'wbw-persist-color'
	| 'wbw-reveal-specific-word-style'
	| 'wbw-keep-specific-word-style'
	| 'wbw-reveal-on-recitation'
	| 'enable-wbw-background'
	| 'enable-wbw-line-background'
	| 'wbw-line-background-color'
	| 'wbw-line-background-position'
	| 'wbw-line-background-height'
	| 'wbw-line-background-padding'
	| 'enable-wbw-underline'
	| 'enable-wbw-glow'
	| 'wbw-bg-color'
	| 'wbw-glow-color'
	| 'wbw-glow-blur'
	| 'wbw-underline-thickness'
	| 'wbw-always-show-verse-number'
	| 'enable-wbw-current-word-opacity'
	| 'wbw-current-word-custom-css'
	| 'wbw-current-word-opacity';

export type OverlayStyleName =
	| 'overlay-enable'
	| 'overlay-color'
	| 'overlay-opacity'
	| 'background-overlay-mode'
	| 'background-overlay-fade-intensity'
	| 'background-overlay-fade-coverage'
	| 'background-overlay-fade-softness'
	| 'background-overlay-fade-curve'
	| 'background-overlay-fade-invert'
	| 'background-overlay-fade-position-x'
	| 'background-overlay-fade-position-y'
	| 'background-overlay-fade-width'
	| 'background-overlay-fade-height'
	| 'overlay-custom-css'
	| 'overlay-blur'
	| 'video-frame-enable'
	| 'video-frame-content-above'
	| 'video-frame-color'
	| 'video-frame-vertical-size'
	| 'video-frame-horizontal-size'
	| 'video-frame-radius'
	| 'video-frame-softness';

export type SurahNameStyleName =
	| 'show-surah-name'
	| 'surah-name-always-show'
	| 'surah-name-format'
	| 'surah-name-time-appearance'
	| 'surah-name-time-disappearance'
	| 'surah-show-arabic'
	| 'surah-name-vertical-position'
	| 'surah-name-horizontal-position'
	| 'surah-show-latin'
	| 'surah-calligraphy-style'
	| 'surah-size'
	| 'surah-opacity'
	| 'surah-latin-spacing'
	| 'surah-latin-text-style';

export type ReciterNameStyleName =
	| 'show-reciter-name'
	| 'reciter-name-always-show'
	| 'reciter-name-format'
	| 'reciter-name-time-appearance'
	| 'reciter-name-time-disappearance'
	| 'reciter-show-arabic'
	| 'reciter-name-vertical-position'
	| 'reciter-name-horizontal-position'
	| 'reciter-show-latin'
	| 'reciter-size'
	| 'reciter-opacity'
	| 'reciter-latin-spacing'
	| 'reciter-latin-text-style';

export type CreatorTextStyleName = 'creator-text' | 'creator-text-composite';

export type CustomTextStyleName =
	| 'time-appearance'
	| 'time-disappearance'
	| 'text'
	| 'filepath'
	| 'opacity'
	| 'above-overlay'
	| 'always-show'
	| 'custom-css'
	| 'custom-text-composite';

export type VerseNumberStyleName =
	| 'verse-number'
	| 'show-verse-number'
	| 'verse-number-vertical-position'
	| 'verse-number-horizontal-position'
	| 'verse-number-format'
	| 'verse-number-text-style';

export type AyahContainerStyleName =
	| 'ayah-container-image'
	| 'ayah-container-vertical-position'
	| 'ayah-container-horizontal-position'
	| 'always-show'
	| 'time-appearance'
	| 'time-disappearance'
	| 'ayah-container-width'
	| 'ayah-container-height'
	| 'ayah-container-stretch';

/** Union de tous les identifiants de styles pris en charge. */
export type StyleName =
	| GeneralStyleName
	| TextStyleName
	| PositioningStyleName
	| BackgroundStyleName
	| ShadowStyleName
	| OutlineStyleName
	| BorderStyleName
	| EffectsStyleName
	| LineBackgroundStyleName
	| AnimationStyleName
	| TimedOverlayStyleName
	| WordByWordHighlightStyleName
	| OverlayStyleName
	| SurahNameStyleName
	| ReciterNameStyleName
	| CreatorTextStyleName
	| CustomTextStyleName
	| GlobalAnimationStyleName
	| VerseNumberStyleName
	| AyahContainerStyleName;
