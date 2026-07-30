const COMMANDS: &[&str] = &[];

/// Prépare le module Android natif lors de la compilation du plugin.
fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build the Android media plugin");
}
