<div align="center">

<img src="src-tauri/icons/128x128.png" width="100" alt="Minbar Studio logo" />

<h1>Minbar Studio</h1>

<p><strong>Caption and translate lectures, khutbahs, reminders, podcasts, poetry, and nasheeds.</strong></p>

<p>
  <a href="https://github.com/zonetecde/QuranCaption/releases?q=MS-&amp;expanded=true">Minbar Studio releases</a> |
  <a href="documentations/minbar-architecture.md">Architecture</a> |
  <a href="https://discord.gg/Hxfqq2QA2J">Discord</a>
</p>

</div>

---

## What is Minbar Studio?

Minbar Studio is a desktop video editor for spoken and sung content: courses, Friday khutbahs,
reminders, conferences, podcasts, poetry, and nasheeds. Import audio or video, transcribe the
speech, add translations, customize the presentation, and export for YouTube, TikTok, or Instagram.

Minbar Studio and Quran Caption are separate applications that share a multimedia foundation. Quran
Caption focuses on Quranic recitations structured around verses. Minbar Studio uses free-text
subtitles and can mark Quran passages and other quotations within a transcript.

## Features

### Transcription and subtitle editing

- Transcribe audio through Groq or ElevenLabs using your own provider API key.
- Write and edit transcripts manually with the timeline and keyboard shortcuts.
- Use word timestamps and configurable subtitle length limits.
- Review AI suggestions for transcription corrections, subtitle boundaries, and Quran or quotation
  detection. Text AI tools require your own configured API key.

### Translations and references

- Add project languages and generate editable translations with your configured text AI provider.
- Keep ordinary speech, Quran passages, and quotations distinct within the same subtitle.
- Insert Quran references such as `{{2:255}}` or a word range such as `{{2:255:2-4}}`.
- Use Quran translation sources for referenced passages.

### Visual customization

- Customize fonts, colors, outlines, shadows, backgrounds, placement, and margins.
- Style ordinary speech, Quran passages, and quotations separately, including their translations.
- Add speaker names, creator branding, custom text, images, and video overlays.
- Save local presets and share styles through the dedicated Minbar Studio community library.
- Undo and redo project edits.

### Media and export

- Edit audio and video on the timeline, adjust framing and rotation, and preview audio effects.
- Create landscape, portrait, square, or custom video layouts.
- Export finished videos and subtitles for your publishing workflow.

## Download

Open the
[Minbar Studio releases](https://github.com/zonetecde/QuranCaption/releases?q=MS-&expanded=true) and
choose the newest published stable release tagged **`MS-X.X.X`**. The repository also hosts Quran
Caption (`QC-*`) and Quran Caption Mobile (`QCM-*`) releases.

| Platform              | Minbar Studio installer                                   |
| --------------------- | --------------------------------------------------------- |
| Windows               | `MinbarStudio.Windows.exe`                                |
| macOS (Apple Silicon) | `MinbarStudio.MacOS.ARM.dmg`                              |
| macOS (Intel)         | `MinbarStudio.MacOS.Intel.dmg`                            |
| Linux                 | `MinbarStudio.Linux.AppImage` or `MinbarStudio.Linux.deb` |

The desktop app checks for newer stable `MS-*` releases and offers their changelogs and an update.
Minbar Studio is free and open source; external AI providers may charge for API usage.

## For developers

This application lives on the **`minbar-studio`** branch of
[`zonetecde/QuranCaption`](https://github.com/zonetecde/QuranCaption/tree/minbar-studio).

**Stack:** Svelte 5 / TypeScript / Rust / Tauri 2 / Tailwind CSS / FFmpeg

- [Development guide](DEVELOPMENT.md)
- [Minbar Studio domain architecture](documentations/minbar-architecture.md)
- [Video style schema and editor rules](documentations/style-json.md)
- [Shared foundation ported from Quran Caption](documentations/minbar-main-portage.md)
- [Required FFmpeg, FFprobe, and yt-dlp binaries](src-tauri/binaries/README.md)

## Contributing

Issues and pull requests are welcome. Mention **Minbar Studio** when reporting a problem in the
shared repository, or join the [Discord community](https://discord.gg/Hxfqq2QA2J).

---

Made by [Rayane Staszewski](https://rayanestaszewski.fr) |
[Support the project](https://ko-fi.com/vzero)
