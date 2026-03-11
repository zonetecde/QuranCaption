# Development Documentation — Quran Caption

Welcome to the **Quran Caption** development guide. This document provides a comprehensive overview
of the project's architecture, tech stack, and development workflows to help you get started quickly
and maintain consistency across the codebase.

---

## 🚀 Tech Stack

Quran Caption is a desktop application built with the following modern technologies:

| Layer                     | Technology                                    |
| :------------------------ | :-------------------------------------------- |
| **Frontend Framework**    | [Svelte 5](https://svelte.dev/) (using Runes) |
| **Desktop Environment**   | [Tauri 2.0](https://tauri.app/) (Rust-based)  |
| **Styling**               | [Tailwind CSS v4](https://tailwindcss.com/)   |
| **Programming Languages** | TypeScript, Rust, Python                      |
| **AI/ML**                 | PyTorch, Transformers (via Python sidecars)   |
| **State Management**      | Svelte Runes + Class-based reactive models    |
| **Build Tool**            | [Vite](https://vitejs.dev/)                   |
| **Testing**               | [Vitest](https://vitest.dev/)                 |

---

## 🏗️ Architecture Overview

The application follows a hybrid architecture to balance performance, UI responsiveness, and AI
capabilities:

1.  **Frontend (Svelte 5)**: Manages the user interface, video editor timeline, and visual styling.
    It uses Svelte 5's **Runes** (`$state`, `$derived`, `$effect`) for fine-grained reactivity.
2.  **Backend (Tauri/Rust)**: Handles file system operations, window management, and acts as a
    bridge to the operating system. It also manages **Sidecars**.
3.  **Sidecars (Python & Binaries)**:
    - **Python**: Executes heavy AI tasks like audio segmentation and subtitle alignment using
      pre-trained models.
    - **FFmpeg/FFprobe**: Used for media processing, extraction, and exporting.
    - **yt-dlp**: Handles video/audio downloading from external sources.

---

## 📂 Project Structure

```text
├── src/                    # Frontend source (SvelteKit)
│   ├── lib/
│   │   ├── classes/        # Domain models (Reactive classes using Runes)
│   │   ├── components/     # UI Components
│   │   ├── services/       # Business logic & stateful services
│   │   └── runes/          # Global runes or shared state
│   └── routes/             # SvelteKit pages
├── src-tauri/              # Rust source & Tauri configuration
│   ├── src/                # Rust backend modules
│   │   ├── commands/       # IPC Commands callable from frontend
│   │   ├── segmentation/   # Logic for audio/video cutting
│   │   └── exporter/       # Frame extraction and video generation
│   ├── python/             # Python-based AI logic (Sidecars)
│   ├── binaries/           # External executables (ffmpeg, yt-dlp)
│   └── tauri.conf.json     # Main configuration for Tauri
├── static/                 # Static assets (fonts, icons, default images)
└── scripts/                # Helper scripts for development/build
```

---

## 🛠️ Setup & Installation

### Prerequisites

- **Node.js**: v18+ (latest LTS recommended)
- **Rust**: Latest stable (via [rustup](https://rustup.rs/))
- **Python**: 3.10+ (for AI features)
- **FFmpeg & FFprobe**: Required for media processing.

### Steps

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/zonetecde/QuranCaption.git
    cd QuranCaption
    ```
2.  **Install Frontend Dependencies**:
    ```bash
    npm install
    ```
3.  **Setup Tauri Binaries**: Follow the instructions in
    [`src-tauri/binaries/README.md`](src-tauri/binaries/README.md) to add `ffmpeg`, `ffprobe`, and
    `yt-dlp` for your OS.
4.  **Setup Python Environment** (If working on AI features):
    ```bash
    cd src-tauri/python
    python -m venv venv
    source venv/bin/activate  # or venv\Scripts\activate on Windows
    pip install -r requirements.txt
    ```

---

## 💻 Development Workflow

### Commands

- `npm run tauri dev`: Start the Svelte dev server and launches the Tauri desktop window.
- `npm run dev`: Starts ONLY the Vite development server (useful for browser-only debugging).
- `npm run tauri build`: Build the production application.
- `npm run check`: Run Svelte-check for type-checking.
- `npm run lint`: Lint the project using ESLint and Prettier.
- `npm run test:unit`: Run unit tests with Vitest.

### Svelte 5 & Runes

We use Svelte 5's Runes exclusively for state management.

- Files ending in `.svelte.ts` in `src/lib/classes` contain reactive domain logic.
- Avoid using `writable` stores; prefer classes with `$state()` properties.

### Tauri Commands (IPC)

When adding new backend functionality:

1.  Define a function in `src-tauri/src/commands/`.
2.  Register it in `src-tauri/src/app/invoke.rs`.
3.  Call it from the frontend using `@tauri-apps/api/core`:
    ```typescript
    import { invoke } from '@tauri-apps/api/core';
    const result = await invoke('my_custom_command', { arg1: 'value' });
    ```

---

## 🧩 Key Implementation Details

### 1. Project Persistence

Projects are saved as JSON files. The `ProjectService` and `Project` class handle the
serialization/deserialization logic. We use `class-transformer` to convert plain JSON back into
reactive class instances.

### 2. Audio Segmentation

The `AutoSegmentation` service communicates with the Python sidecar. It uses a custom alignment
algorithm to detect Basmala, Istiʿādha, and verse timings. The Python script (`local_segmenter.py`)
returns a JSON with timestamps used to create `Clip` objects.

### 3. Video Rendering

Exporting is handled by combining:

- **Frontend**: `modern-screenshot` for capturing styled verses as high-quality images.
- **Backend (Rust)**: `ffmpeg` commands to assemble frames, audio, and background videos into the
  final output.

---

## 🛠️ Utilities & Scripts

The `scripts/` directory contains various Node.js scripts for data maintenance and preprocessing:

- **Data Downloaders**: Scripts to fetch translations (German, Spanish, Wolof) and Surah SVGs.
- **SVG Processing**: Tools to add padding, crop, or replace SVG images used for Quranic text.
- **Reciter Management**: Scripts to sort, translate, and transform reciter metadata.
- **JSON Optimization**: Tools like `simplify-qpc-json.js` to minimize the size of Quran data files.

To run these scripts, use `node scripts/<script-name>.js`.

---

## 🚀 CI/CD

The project uses **GitHub Actions** for continuous integration and automated releases.

- The configuration is located in `.github/workflows/build.yml`.
- It automatically builds and packages the application for Windows, macOS, and Linux whenever a new
  tag is pushed.

---

## 🤝 Contribution Guidelines

- **Atomic Commits**: Keep your commits small and focused.
- **Code Style**: Run `npm run lint:fix` before pushing.
- **TypeScript**: Always use strict typing. Avoid `any`.
- **Docs**: Update this document if you change the architecture or add major modules.

---

## 📖 Useful Resources

- [Svelte 5 Documentation](https://svelte-5-preview.vercel.app/)
- [Tauri 2.0 Documentation](https://v2.tauri.app/)
- [Tailwind CSS v4 Docs](https://tailwindcss.com/blog/tailwindcss-v4-alpha)
