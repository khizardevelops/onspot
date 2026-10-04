// Minimal whisper.cpp binding for the model lab's WebGPU spike.
//
// Unlike whisper.cpp's examples/whisper.wasm, inference runs on the calling
// thread (our Web Worker), not a std::thread: WebGPU objects belong to the
// thread that created them. WebGPU's async calls suspend through JSPI, so
// wgpu_init and wgpu_full are JSPI exports and return Promises in JS.
//
// The model comes from a heap buffer (whisper_init_from_buffer_with_params),
// not the Emscripten FS, so the file bytes are held once and can be freed by
// the caller right after init.

#include "whisper.h"

#include <emscripten.h>

#include <string>

static whisper_context * g_ctx = nullptr;
static std::string g_text;

extern "C" {

EMSCRIPTEN_KEEPALIVE int wgpu_init(void * buffer, int size, int use_gpu) {
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = use_gpu != 0;
    g_ctx = whisper_init_from_buffer_with_params(buffer, (size_t) size, params);
    return g_ctx ? 1 : 0;
}

// Streams the model from JS instead of holding the whole file in the WASM heap.
// `Module.modelChunks` is an async iterator of Uint8Array (e.g. a Response body
// reader) set by the worker before calling wgpu_init_stream. whisper.cpp reads
// tensor by tensor and uploads each one to the GPU, so neither the JS side nor
// the heap ever holds the full 190 MB file: WASM memory never shrinks, so a
// full-file heap copy would stay resident for the life of the worker.
EM_ASYNC_JS(int, js_read_model, (void * out, int size), {
    const state = Module.modelState ??= { chunk: null, offset: 0, done: false };
    let written = 0;
    while (written < size) {
        if (!state.chunk || state.offset >= state.chunk.length) {
            if (state.done) break;
            const next = await Module.modelChunks.next();
            if (next.done) { state.done = true; break; }
            state.chunk = next.value;
            state.offset = 0;
        }
        const n = Math.min(size - written, state.chunk.length - state.offset);
        HEAPU8.set(state.chunk.subarray(state.offset, state.offset + n), out + written);
        state.offset += n;
        written += n;
    }
    return written;
});

EM_JS(int, js_model_eof, (), {
    const state = Module.modelState;
    return state && state.done && (!state.chunk || state.offset >= state.chunk.length) ? 1 : 0;
});

EM_JS(void, js_model_close, (), {
    Module.modelState = null;
    Module.modelChunks = null;
});

static size_t stream_read(void *, void * output, size_t read_size) {
    return (size_t) js_read_model(output, (int) read_size);
}

static bool stream_eof(void *) {
    return js_model_eof() != 0;
}

static void stream_close(void *) {
    js_model_close();
}

EMSCRIPTEN_KEEPALIVE int wgpu_init_stream(int use_gpu) {
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
    whisper_model_loader loader = { nullptr, stream_read, stream_eof, stream_close };
    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = use_gpu != 0;
    g_ctx = whisper_init_with_params(&loader, params);
    return g_ctx ? 1 : 0;
}

// Returns whisper_full's status (0 = ok); read the text with wgpu_text().
EMSCRIPTEN_KEEPALIVE int wgpu_full(const float * pcm, int n_samples, const char * lang, int n_threads) {
    if (!g_ctx) return -100;
    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.language         = lang;
    params.n_threads        = n_threads;
    params.print_realtime   = false;
    params.print_progress   = false;
    params.print_timestamps = false;
    params.print_special    = false;
    params.translate        = false;

    const int status = whisper_full(g_ctx, params, pcm, n_samples);
    g_text.clear();
    if (status == 0) {
        const int n = whisper_full_n_segments(g_ctx);
        for (int i = 0; i < n; ++i) {
            if (i) g_text += ' ';
            g_text += whisper_full_get_segment_text(g_ctx, i);
        }
    }
    return status;
}

EMSCRIPTEN_KEEPALIVE const char * wgpu_text() {
    return g_text.c_str();
}

EMSCRIPTEN_KEEPALIVE const char * wgpu_system_info() {
    return whisper_print_system_info();
}

EMSCRIPTEN_KEEPALIVE void wgpu_free() {
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
}

}
