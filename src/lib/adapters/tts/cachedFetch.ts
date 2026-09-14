/**
 * Cache-backed download for weights fetched outside Transformers.js.
 *
 * Transformers.js keeps its own `transformers-cache`, so models loaded through
 * it survive a refresh. Piper voices are fetched directly, so without this they
 * were re-downloaded in full (63-77 MB) on every page load.
 *
 * Note the cache is per-origin: running the dev server on :5173 and :5174 gives
 * two independent caches, and switching between them re-downloads everything.
 */
const CACHE_NAME = 'onspot-tts-cache';

export interface DownloadProgress {
  (loadedBytes: number, totalBytes: number): void;
}

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Private mode or storage disabled: fall back to an uncached download.
    return null;
  }
}

/** Fetches `url`, serving from cache when present and storing it when not. */
export async function cachedFetch(url: string, onProgress?: DownloadProgress): Promise<ArrayBuffer> {
  const cache = await openCache();

  const hit = await cache?.match(url);
  if (hit) {
    const buffer = await hit.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength);
    return buffer;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}) for ${url}`);

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  // Store a copy so the next load is instant. A failure here (quota, private
  // mode) must not fail the download that already succeeded.
  try {
    await cache?.put(url, new Response(bytes, {
      headers: { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' },
    }));
  } catch (err) {
    console.warn(`[tts] could not cache ${url}:`, err);
  }

  return bytes.buffer;
}

/** True when `url` is already stored, so the UI can say "cached". */
export async function isCached(url: string): Promise<boolean> {
  const cache = await openCache();
  return !!(await cache?.match(url));
}
