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
  let readable = response.body!;

  // Cache Storage consumes one stream branch directly. The old path retained
  // every chunk, joined those into a second 64–77 MB allocation, and copied
  // that again into a Response—an avoidable memory spike during model load.
  if (cache) {
    const [readBranch, cacheBranch] = readable.tee();
    readable = readBranch;
    void cache
      .put(url, new Response(cacheBranch, { headers: response.headers }))
      .catch((error) => console.warn(`[tts] could not cache ${url}:`, error));
  }

  const reader = readable.getReader();
  let bytes = new Uint8Array(total || 1024 * 1024);
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > bytes.length) {
      const grown = new Uint8Array(Math.max(loaded + value.length, bytes.length * 2));
      grown.set(bytes);
      bytes = grown;
    }
    bytes.set(value, loaded);
    loaded += value.length;
    onProgress?.(loaded, total);
  }

  return loaded === bytes.length ? bytes.buffer : bytes.slice(0, loaded).buffer;
}

/** True when `url` is already stored, so the UI can say "cached". */
export async function isCached(url: string): Promise<boolean> {
  const cache = await openCache();
  return !!(await cache?.match(url));
}
