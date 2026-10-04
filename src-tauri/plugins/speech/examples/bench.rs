//! Measures the native engine on audio files, outside the app.
//!
//!   cargo run --release -p tauri-plugin-speech --example bench -- \
//!     <model.bin> <language> <clip.f32> [<clip.f32> ...]
//!
//! Clips are raw 16 kHz mono little-endian f32 (`ffmpeg -i in.mp3 -ac 1 -ar 16000 -f f32le out.f32`).
//! Prints one JSON line per clip; run it under `/usr/bin/time -v` for peak memory.

use std::path::Path;
use std::time::Instant;

use tauri_plugin_speech::whisper::Engine;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [model, language, clips @ ..] = args.as_slice() else {
        eprintln!("usage: bench <model.bin> <language> <clip.f32>...");
        std::process::exit(2);
    };
    let engine = Engine::default();

    let started = Instant::now();
    engine.load(Path::new(model)).expect("load model");
    eprintln!("loaded in {:.2} s", started.elapsed().as_secs_f64());

    for clip in clips {
        let bytes = std::fs::read(clip).expect("read clip");
        let pcm: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|s| f32::from_le_bytes([s[0], s[1], s[2], s[3]]))
            .collect();
        let duration = pcm.len() as f64 / 16_000.0;
        let started = Instant::now();
        let text = engine.transcribe(Path::new(model), &pcm, language).expect("transcribe");
        let seconds = started.elapsed().as_secs_f64();
        println!(
            "{{\"clip\":{clip:?},\"duration\":{duration:.1},\"seconds\":{seconds:.2},\"rtf\":{:.3},\"text\":{text:?}}}",
            seconds / duration
        );
    }
}
