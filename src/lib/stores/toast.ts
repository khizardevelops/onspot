import { writable } from 'svelte/store';

export interface Toast {
	id: number;
	message: string;
}

const store = writable<Toast[]>([]);
let nextId = 1;

export const toasts = { subscribe: store.subscribe };

/** Shows a transient message. Auto-dismisses. */
export function toast(message: string, durationMs = 2600): void {
	const id = nextId++;
	store.update((list) => [...list, { id, message }]);
	setTimeout(() => {
		store.update((list) => list.filter((item) => item.id !== id));
	}, durationMs);
}
