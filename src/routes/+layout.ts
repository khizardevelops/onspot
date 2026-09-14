// SPA mode: no server rendering, and no per-route prerender. adapter-static
// emits a single `index.html` fallback that boots the client router, which is
// what a client-only app wants. Setting `prerender = true` here would produce a
// second index.html that the fallback then overwrites.
export const prerender = false;
export const ssr = false;
export const trailingSlash = 'always';
