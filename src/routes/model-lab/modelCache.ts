/**
 * Model-lab download cache: one Cache API bucket so a reload does not
 * re-download 190-264 MB of ggml weights. Lab-only.
 */
const CACHE_NAME = 'onspot-model-lab';

export async function fetchCached(
	url: string,
	onProgress: (progress: number, status: string) => void
): Promise<Blob> {
	const cache = await caches.open(CACHE_NAME);
	const hit = await cache.match(url);
	if (hit) {
		onProgress(100, 'cached');
		return hit.blob();
	}
	const response = await fetch(url);
	if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
	const total = Number(response.headers.get('content-length')) || 0;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	let lastReported = -1;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		const progress = total ? Math.floor((received / total) * 100) : 0;
		if (progress !== lastReported) {
			lastReported = progress;
			onProgress(progress, 'downloading');
		}
	}
	const blob = new Blob(chunks as BlobPart[]);
	await cache.put(url, new Response(blob));
	return blob;
}

/**
 * Like `fetchCached`, but never holds the whole file in memory: a download is
 * streamed straight into the cache, and the cached body comes back as a chunk
 * iterator for a consumer that reads it piece by piece.
 */
export async function streamCached(
	url: string,
	onProgress: (progress: number, status: string) => void
): Promise<{ chunks: AsyncIterator<Uint8Array>; bytes: number }> {
	const cache = await caches.open(CACHE_NAME);
	let hit = await cache.match(url);
	if (hit) {
		onProgress(100, 'cached');
	} else {
		const response = await fetch(url);
		if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
		const total = Number(response.headers.get('content-length')) || 0;
		let received = 0;
		let lastReported = -1;
		const counted = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					received += chunk.length;
					const progress = total ? Math.floor((received / total) * 100) : 0;
					if (progress !== lastReported) {
						lastReported = progress;
						onProgress(progress, 'downloading');
					}
					controller.enqueue(chunk);
				}
			})
		);
		await cache.put(url, new Response(counted, { headers: { 'content-length': String(total) } }));
		hit = await cache.match(url);
		if (!hit) throw new Error(`${url}: not in cache after download`);
	}
	const bytes = Number(hit.headers.get('content-length')) || 0;
	const reader = hit.body!.getReader();
	return {
		bytes,
		chunks: {
			next: async () => {
				const { done, value } = await reader.read();
				return done ? { done: true, value: undefined } : { done: false, value };
			}
		}
	};
}
