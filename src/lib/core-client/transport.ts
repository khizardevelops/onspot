// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The driver's one door to the core (P1).
 *
 * Two implementations sit behind one interface: the wasm package in the
 * browser and Tauri commands in the desktop/Android webview. A component never
 * learns which one answered; the probe and every later feature use `CoreClient`.
 *
 * The wasm package is built into `static/core-bridge/` by `bun run bridge:wasm`
 * and loaded by URL at runtime, so the app still builds and runs without it
 * while the legacy backend is the default (ADR-002).
 */

import { resolve } from '$app/paths';
import { Channel, invoke } from '@tauri-apps/api/core';
import { isTauri } from '#lib/platform/runtime.js';
import type { InitResponse, PingRequest, PingResponse, UiEvent } from './types.gen';

/** Which transport answered. Shown by the dev probe; no behaviour branches on it. */
export type CoreTransportName = 'wasm' | 'tauri';

/** Everything a driver may ask of the core, transport-independent. */
export interface CoreClient {
	/** Which transport this client speaks. */
	readonly transport: CoreTransportName;
	/** Boots the core and subscribes to its events. Call once. */
	init(): Promise<InitResponse>;
	/** Proves the round trip; later phases replace it with real use cases. */
	ping(request?: PingRequest): Promise<PingResponse>;
	/** Runs a catalog command. */
	command<T>(command: string, payload?: unknown): Promise<T>;
	/** Receives core events. Returns the unsubscribe function. */
	subscribe(listener: (event: UiEvent) => void): () => void;
}

/** The shape wasm-bindgen emits in `static/core-bridge/onspot_bridge.js`. */
interface WasmBridgeModule {
	default(): Promise<unknown>;
	init_core_wasm(
		config: unknown,
		eventCallback: (event: unknown) => void,
		sqlHost: unknown
	): Promise<InitResponse>;
	dispatch_wasm(command: string, payload: unknown): Promise<unknown>;
}

/** A readable message from a bridge rejection (JS `Error`, Tauri object or string). */
function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'object' && error !== null && 'message' in error) {
		return String((error as { message: unknown }).message);
	}
	return String(error);
}

class WasmCoreClient implements CoreClient {
	readonly transport = 'wasm' as const;

	private module: WasmBridgeModule | null = null;
	private readonly listeners = new Set<(event: UiEvent) => void>();

	async init(): Promise<InitResponse> {
		const module = await this.load();
		try {
			// The database is opened lazily and only for the core backend, so the
			// legacy default never pays for it and a page without the wasm package
			// can still run.
			const { createCoreSqlHost } = await import('./sqlHost.js');
			const sqlHost = await createCoreSqlHost();
			return await module.init_core_wasm({ appVersion: __APP_VERSION__ }, (event) => {
				for (const listener of this.listeners) listener(event as UiEvent);
			}, sqlHost);
		} catch (error) {
			throw new Error(`core.init failed: ${describe(error)}`);
		}
	}

	async ping(request: PingRequest = { note: null }): Promise<PingResponse> {
		const module = await this.load();
		try {
			return (await module.dispatch_wasm('core.ping', request)) as PingResponse;
		} catch (error) {
			throw new Error(`core.ping failed: ${describe(error)}`);
		}
	}

	/** Runs any catalog command; the typed helpers land with each feature. */
	async command<T>(command: string, payload?: unknown): Promise<T> {
		const module = await this.load();
		try {
			return (await module.dispatch_wasm(command, payload ?? null)) as T;
		} catch (error) {
			throw new Error(`${command} failed: ${describe(error)}`);
		}
	}

	subscribe(listener: (event: UiEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private async load(): Promise<WasmBridgeModule> {
		if (this.module) return this.module;

		// Runtime URL, not a bundled import: the package is generated locally and
		// gitignored, so the build must not depend on it existing. `resolve('/')`
		// is the app root with its base path and trailing slash (`/` or `/onspot/`).
		const url = `${resolve('/')}core-bridge/onspot_bridge.js`;
		const module = (await import(/* @vite-ignore */ url)) as WasmBridgeModule;
		await module.default();
		this.module = module;
		return module;
	}
}

class TauriCoreClient implements CoreClient {
	readonly transport = 'tauri' as const;

	private events: Channel<UiEvent> | null = null;
	private readonly listeners = new Set<(event: UiEvent) => void>();

	async init(): Promise<InitResponse> {
		const events = new Channel<UiEvent>();
		events.onmessage = (event) => {
			for (const listener of this.listeners) listener(event);
		};
		this.events = events;
		return invoke<InitResponse>('core_init', { events });
	}

	async ping(request: PingRequest = { note: null }): Promise<PingResponse> {
		return this.command<PingResponse>('core.ping', request);
	}

	async command<T>(command: string, payload?: unknown): Promise<T> {
		if (!this.events) throw new Error(`${command} needs core_init first.`);
		return invoke<T>('core_command', { cmd: command, payload: payload ?? null });
	}

	subscribe(listener: (event: UiEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

/**
 * Builds the client for the running app: Tauri commands in the desktop/Android
 * webview, the wasm package in a browser.
 *
 * @returns A client that has not been initialised yet.
 */
export function createCoreClient(): CoreClient {
	return isTauri() ? new TauriCoreClient() : new WasmCoreClient();
}
