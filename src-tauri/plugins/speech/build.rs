// Generates one `allow-<command>` permission per command (see permissions/default.toml).
const COMMANDS: &[&str] = &[
    "model_status",
    "download_model",
    "cancel_download",
    "delete_model",
    "load_model",
    "transcribe",
    "release",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
