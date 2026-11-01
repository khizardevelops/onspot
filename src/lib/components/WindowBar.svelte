<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The desktop app's own title bar: a thin strip of the page's paper, so it
	 * follows light and dark mode with the rest of the app. The system bar is
	 * off (`decorations: false` in tauri.conf.json); Tauri keeps the window's
	 * edges resizable.
	 *
	 * Drag the bar to move the window; double-click it to maximise or restore
	 * (`data-tauri-drag-region`). Windows and Linux get minimise, maximise and
	 * close here. macOS keeps its native traffic lights, drawn over the bar's
	 * left end (tauri.macos.conf.json: an overlay title bar).
	 */
	import { onMount } from 'svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { Copy, Minus, Square, X } from '@lucide/svelte';

	/** macOS draws its own window controls over the bar. */
	const HAS_NATIVE_CONTROLS = /Macintosh|Mac OS X/i.test(navigator.userAgent);

	const appWindow = getCurrentWindow();
	let isMaximized = $state(false);

	/** Runs a window action, reporting a refusal (a missing permission, say) instead of dropping it. */
	function runWindowAction(name: string, action: () => Promise<void>): void {
		action().catch((error: unknown) => console.error(`[window] ${name} failed`, error));
	}

	async function syncMaximized(): Promise<void> {
		isMaximized = await appWindow.isMaximized();
	}

	onMount(() => {
		runWindowAction('read maximised state', syncMaximized);

		// Maximise, restore and edge snapping all resize the window.
		const stopListening = appWindow.onResized(() => runWindowAction('read maximised state', syncMaximized));

		return () => {
			void stopListening.then((stop) => stop());
		};
	});
</script>

<div class="window-bar paper-surface" class:native-controls={HAS_NATIVE_CONTROLS} data-tauri-drag-region>
	{#if !HAS_NATIVE_CONTROLS}
		<div class="window-controls">
			<button
				type="button"
				class="window-control"
				aria-label="Minimise"
				onclick={() => runWindowAction('minimise', () => appWindow.minimize())}
			>
				<Minus size={15} strokeWidth={1.5} />
			</button>
			<button
				type="button"
				class="window-control"
				aria-label={isMaximized ? 'Restore' : 'Maximise'}
				onclick={() => runWindowAction('toggle maximise', () => appWindow.toggleMaximize())}
			>
				{#if isMaximized}
					<Copy size={12} strokeWidth={1.5} />
				{:else}
					<Square size={11} strokeWidth={1.5} />
				{/if}
			</button>
			<button
				type="button"
				class="window-control close"
				aria-label="Close"
				onclick={() => runWindowAction('close', () => appWindow.close())}
			>
				<X size={15} strokeWidth={1.5} />
			</button>
		</div>
	{/if}
</div>

<style>
	.window-bar {
		/* Above the page (z 1), so its controls stay reachable. */
		position: relative;
		z-index: 2;
		display: flex;
		justify-content: flex-end;
		height: var(--window-bar-height);
		border-bottom: 1px solid var(--sheet-line);
		user-select: none;
	}
	/* Room for macOS's traffic lights (three 12px buttons from 8px in, 20px apart). */
	.window-bar.native-controls {
		padding-left: 72px;
	}

	.window-controls {
		display: flex;
		height: 100%;
	}
	.window-control {
		/* Windows 11's close red: the one colour that says "this closes the app" everywhere. */
		--window-close-red: #c42b1c;

		display: grid;
		place-items: center;
		width: 44px;
		height: 100%;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
	}
	.window-control:hover {
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
		color: var(--foreground);
	}
	.window-control:active {
		background: color-mix(in srgb, var(--foreground) 14%, transparent);
	}
	.window-control.close:hover,
	.window-control.close:active {
		background: var(--window-close-red);
		color: #ffffff;
	}
	.window-control:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}
</style>
