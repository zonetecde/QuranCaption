Place Android FFmpeg executables here by ABI:

```text
android-binaries/
  arm64-v8a/
    libffmpeg_exec.so
    libffprobe_exec.so
  armeabi-v7a/
    libffmpeg_exec.so
    libffprobe_exec.so
  x86/
    libffmpeg_exec.so
    libffprobe_exec.so
  x86_64/
    libffmpeg_exec.so
    libffprobe_exec.so
```

These files must be Android native executables for the matching ABI, not Windows `.exe` files and
not desktop Linux builds. They are named `lib*_exec.so` so Android packages and extracts them
through `jniLibs`; the Rust resolver then executes them from the native library directory at
runtime.
