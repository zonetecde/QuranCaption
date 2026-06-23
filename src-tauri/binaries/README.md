In this folder, install `ffprobe`, `ffmpeg` and `yt-dlp` in binaries.

#### 🔧 Download Links (per OS) for FFMPEG, FFPROBE and YT-DLP

**For Windows**  
Download the `.exe` files and place them in binaries:

- [ffprobe.exe and ffmpeg.exe (ZIP archive)](https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip)
- [yt-dlp.exe](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe)

**For Linux**  
Download the files **without extensions** and place them in binaries:

- [ffprobe and ffmpeg (tar.xz archive)](https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp)

> ⚠️ Make sure the files are executable (`chmod +x`).

**For macOS**  
Download the files **without extensions** and place them in binaries:

- [ffprobe and ffmpeg (via Homebrew)](https://brew.sh/)  
  *(Use `brew install ffmpeg` to install both executables)*
- [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos)

> ⚠️ Make sure the files are executable (`chmod +x`).

**For Android**
Do not place Android FFmpeg binaries in this desktop `binaries/` folder. Android
must use ABI-specific executables from `src-tauri/android-binaries/<abi>/` named:

- `libffmpeg_exec.so`
- `libffprobe_exec.so`

They must be real Android native executables for the target ABI. Desktop `.exe`
files or desktop Linux/macOS binaries cannot run on Android.
