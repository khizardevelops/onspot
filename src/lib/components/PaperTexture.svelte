<script lang="ts" module>
	import {
		ShaderFitOptions,
		ShaderMount,
		emptyPixel,
		getShaderColorFromString,
		getShaderNoiseTexture,
		paperTextureFragmentShader,
		type PaperTextureParams
	} from '@paper-design/shaders';

	/** Paper Shaders' own "Default" preset (from `@paper-design/shaders-react`). */
	export const PAPER_DEFAULTS: Required<Omit<PaperTextureParams, 'image' | 'speed' | 'frame'>> = {
		fit: 'contain',
		scale: 0.9,
		rotation: 0,
		originX: 0.5,
		originY: 0.5,
		offsetX: 0,
		offsetY: 0,
		worldWidth: 0,
		worldHeight: 0,
		colorBack: '#d3d2ab',
		colorPaper: '#ffffff',
		colorShadow: '#cccccc',
		blending: 1,
		distortion: 0.75,
		clip: false,
		angle: 300,
		seed: 4,
		roughness: 0.4,
		roughnessSize: 0.5,
		roughnessRows: 0,
		fiber: 0.4,
		fiberSize: 0.5,
		folds: 0.5,
		foldSizeX: 1,
		foldSizeY: 1,
		foldOffsetX: 0,
		foldOffsetY: 0,
		wrinkles: 1,
		wrinkleSize: 0.65,
		crumples: 0,
		crumpleCount: 6,
		drops: 0.4
	};

	/** Bump when the rendering changes so stale textures are not reused. */
	const CACHE_NAME = 'onspot-paper-v1';
	/** Textures render at a size rounded up to this step, so small resizes reuse them. */
	const SIZE_STEP = 256;

	/**
	 * What Paper's React wrapper does before mounting: images must be decoded,
	 * and small ones get a 1024px layout size (the shader samples by it).
	 */
	async function prepare(image: HTMLImageElement): Promise<HTMLImageElement> {
		await image.decode();
		if (image.naturalWidth > 0 && image.naturalWidth < 1024 && image.naturalHeight < 1024) {
			const aspect = image.naturalWidth / image.naturalHeight;
			image.width = Math.round(aspect > 1 ? 1024 * aspect : 1024);
			image.height = Math.round(aspect > 1 ? 1024 : 1024 / aspect);
		}
		return image;
	}

	let images: Promise<{ noise: HTMLImageElement; blank: HTMLImageElement }> | null = null;
	function sourceImages() {
		images ??= (async () => {
			const noise = getShaderNoiseTexture();
			if (!noise) throw new Error('No window');
			const blank = new Image();
			blank.src = emptyPixel;
			const [a, b] = await Promise.all([prepare(noise), prepare(blank)]);
			return { noise: a, blank: b };
		})();
		return images;
	}

	/** Same params → uniforms mapping as Paper's React wrapper. */
	function uniforms(input: PaperTextureParams, noise: HTMLImageElement, blank: HTMLImageElement) {
		const p = { ...PAPER_DEFAULTS, ...input };
		return {
			// No source image: bind Paper's empty pixel, as the React wrapper does.
			u_image: blank,
			u_isImage: false,
			u_colorBack: getShaderColorFromString(p.colorBack),
			u_colorPaper: getShaderColorFromString(p.colorPaper),
			u_colorShadow: getShaderColorFromString(p.colorShadow),
			u_blending: p.blending,
			u_distortion: p.distortion,
			u_clip: p.clip,
			u_angle: p.angle,
			u_seed: p.seed,
			u_roughness: p.roughness,
			u_roughnessSize: p.roughnessSize,
			u_roughnessRows: p.roughnessRows,
			u_fiber: p.fiber,
			u_fiberSize: p.fiberSize,
			u_folds: p.folds,
			u_foldSizeX: p.foldSizeX,
			u_foldSizeY: p.foldSizeY,
			u_foldOffsetX: p.foldOffsetX,
			u_foldOffsetY: p.foldOffsetY,
			u_wrinkles: p.wrinkles,
			u_wrinkleSize: p.wrinkleSize,
			u_crumples: p.crumples,
			u_crumpleCount: p.crumpleCount,
			u_drops: p.drops,
			u_noiseTexture: noise,
			u_fit: ShaderFitOptions[p.fit],
			u_scale: p.scale,
			u_rotation: p.rotation,
			u_offsetX: p.offsetX,
			u_offsetY: p.offsetY,
			u_originX: p.originX,
			u_originY: p.originY,
			u_worldWidth: p.worldWidth,
			u_worldHeight: p.worldHeight
		};
	}

	const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

	/**
	 * Renders the paper once with Paper's ShaderMount, snapshots the canvas and
	 * disposes the WebGL context. The texture is static, so a plain image costs
	 * nothing afterwards: no live GL context and no re-render on resize.
	 */
	async function renderTexture(params: PaperTextureParams, width: number, height: number): Promise<Blob> {
		const { noise, blank } = await sourceImages();
		const host = document.createElement('div');
		host.setAttribute('aria-hidden', 'true');
		host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;opacity:0;pointer-events:none;z-index:-1;`;
		document.body.appendChild(host);
		const mount = new ShaderMount(
			host,
			paperTextureFragmentShader,
			uniforms(params, noise, blank),
			{ preserveDrawingBuffer: true },
			0,
			0,
			// The screen's own density; Paper's default forces 2x even on 1x screens.
			1
		);
		try {
			const canvas = host.querySelector('canvas');
			if (!canvas) throw new Error('Paper shader created no canvas');
			// Speed 0 renders once, after the first resize observation.
			for (let i = 0; i < 60 && canvas.width === 0; i++) await nextFrame();
			await nextFrame();
			await nextFrame();
			return await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Empty texture'))), 'image/webp', 0.92)
			);
		} finally {
			mount.dispose();
			host.remove();
		}
	}

	const inMemory = new Map<string, Promise<string>>();

	/** Object URL of the texture: from memory, the Cache API, or one fresh render. */
	function textureUrl(params: PaperTextureParams, width: number, height: number): Promise<string> {
		const w = Math.max(SIZE_STEP, Math.ceil(width / SIZE_STEP) * SIZE_STEP);
		const h = Math.max(SIZE_STEP, Math.ceil(height / SIZE_STEP) * SIZE_STEP);
		const key = `/__paper__/${w}x${h}@${window.devicePixelRatio || 1}/${encodeURIComponent(JSON.stringify(params))}`;
		let url = inMemory.get(key);
		if (!url) {
			url = (async () => {
				const cache = typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME).catch(() => null);
				const hit = await cache?.match(key);
				if (hit) return URL.createObjectURL(await hit.blob());
				const blob = await renderTexture(params, w, h);
				void cache?.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } }));
				return URL.createObjectURL(blob);
			})();
			url.catch(() => inMemory.delete(key));
			inMemory.set(key, url);
		}
		return url;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		params?: PaperTextureParams;
		class?: string;
		/**
		 * CSS custom property on `<html>` that receives the texture as `url(...)`, so
		 * other surfaces can reuse the same sheet (see `.paper-surface`).
		 */
		publishAs?: string;
	}

	let { params = {}, class: className = '', publishAs }: Props = $props();

	let host: HTMLDivElement;
	let url = $state<string | null>(null);
	let size = $state({ width: 0, height: 0 });

	onMount(() => {
		const measure = () => {
			const rect = host.getBoundingClientRect();
			// Only grow: a smaller window keeps using the larger texture.
			if (rect.width > size.width || rect.height > size.height) {
				size = { width: Math.max(rect.width, size.width), height: Math.max(rect.height, size.height) };
			}
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(measure, 300);
		});
		observer.observe(host);
		measure();
		return () => {
			observer.disconnect();
			clearTimeout(timer);
		};
	});

	$effect(() => {
		const { width, height } = size;
		const current = params;
		if (!width || !height) return;
		let cancelled = false;
		// A first render (once per device and size; later loads hit the cache) waits
		// until the app has settled, so the texture never delays the first content.
		const whenIdle = (callback: () => void) =>
			setTimeout(
				() =>
					'requestIdleCallback' in window
						? window.requestIdleCallback(callback, { timeout: 2000 })
						: callback(),
				800
			);
		whenIdle(() => {
			if (cancelled) return;
			textureUrl(current, width, height)
				.then((next) => {
					if (!cancelled) url = next;
				})
				.catch((error) => console.warn('[paper] texture unavailable', error));
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!publishAs) return;
		const root = document.documentElement.style;
		if (url) root.setProperty(publishAs, `url("${url}")`);
		else root.removeProperty(publishAs);
		return () => root.removeProperty(publishAs);
	});

	// A new theme drops the old texture at once; the plain colour shows until the new one is ready.
	let shownFor: PaperTextureParams | null = null;
	$effect.pre(() => {
		if (shownFor !== params) {
			shownFor = params;
			url = null;
		}
	});
</script>

<div
	bind:this={host}
	class="paper-texture {className}"
	class:ready={url !== null}
	style:background-image={url ? `url("${url}")` : undefined}
	aria-hidden="true"
></div>

<style>
	.paper-texture {
		background-size: cover;
		background-position: center;
		opacity: 0;
		transition: opacity 500ms ease;
	}
	.paper-texture.ready {
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.paper-texture {
			transition-duration: 1ms;
		}
	}
</style>
