import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn-svelte's class combiner: conditional classes via clsx, then Tailwind
 * conflict resolution via tailwind-merge.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
