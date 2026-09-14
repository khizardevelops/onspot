export { cn } from './cn';

/*
 * Element-ref helper types expected by shadcn-svelte components. They live in
 * the same module as `cn` because the registry imports both from `$lib/utils`.
 */
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
