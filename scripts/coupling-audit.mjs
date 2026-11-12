#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Coupling audit (P0).
 *
 * Counts, for every file under src/, how tightly it is tied to the Svelte
 * runtime, the Tauri shell, browser globals and other layers, and writes
 * docs/architecture/coupling-matrix.md ordered by coupling score. The table
 * is the work list for the hexagonal migration: a file near the top reaches
 * into the most layers at once and therefore has to be split before its
 * business logic can move into the Rust core.
 *
 * Usage: node scripts/coupling-audit.mjs [--check]
 *   --check exits 1 when the generated table differs from the committed file,
 *   so CI can catch a matrix that was not regenerated after a refactor.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = join(REPO_ROOT, 'src');
const OUTPUT_PATH = join(REPO_ROOT, 'docs/architecture/coupling-matrix.md');

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.svelte']);

/** Weights for the coupling score. A framework import costs more than one browser global. */
const WEIGHTS = {
	svelte: 3,
	tauri: 3,
	browserGlobal: 1,
	crossLayer: 6
};

const BROWSER_GLOBALS = [
	'window.',
	'document.',
	'navigator.',
	'localStorage',
	'indexedDB',
	'AudioContext',
	'fetch('
];

const FRAMEWORK_IMPORTS = {
	svelte: [/^svelte($|\/)/],
	tauri: [/^@tauri-apps\//, /^plugin:/]
};

/** Directories whose files are UI, and therefore the layers everything else must not import. */
const COMPONENT_DIRECTORY = 'src/lib/components';
const ROUTE_DIRECTORY = 'src/routes';

function walk(directory) {
	const entries = readdirSync(directory).sort();

	return entries.flatMap((entry) => {
		const path = join(directory, entry);
		const stats = statSync(path);
		if (stats.isDirectory()) return walk(path);

		const extension = entry.slice(entry.lastIndexOf('.'));
		return SOURCE_EXTENSIONS.has(extension) ? [path] : [];
	});
}

/** File text with comments removed, so documentation that mentions `window.` is not counted. */
function codeOnly(text, extension) {
	const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
	const withoutLineComments = withoutBlockComments.replace(/(^|[^:])\/\/.*$/gm, '$1');

	// HTML comments inside a Svelte file.
	return extension === '.svelte' ? withoutLineComments.replace(/<!--[\s\S]*?-->/g, '') : withoutLineComments;
}

/** Every import specifier in a file, including dynamic imports and re-exports. */
function importSpecifiers(text) {
	const specifiers = new Set();
	const patterns = [
		/\bfrom\s+['"]([^'"]+)['"]/g,
		/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/^\s*import\s+['"]([^'"]+)['"]/gm
	];

	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) specifiers.add(match[1]);
	}
	return [...specifiers];
}

/** Resolves a project import specifier to a repo-relative path, or null when it is a package. */
function resolveProjectPath(specifier, fromFile) {
	let target = null;

	if (specifier.startsWith('#lib/') || specifier.startsWith('#lib')) {
		target = join('src/lib', specifier.slice('#lib'.length).replace(/^[/]/, ''));
	} else if (specifier.startsWith('$lib/')) {
		target = join('src/lib', specifier.slice('$lib/'.length));
	} else if (specifier.startsWith('$app/')) {
		target = join('src', specifier);
	} else if (specifier.startsWith('.')) {
		target = relative(REPO_ROOT, resolve(dirname(fromFile), specifier)).split(sep).join('/');
	} else {
		return null;
	}

	// Import specifiers name the emitted `.js` file; the source is `.ts` or `.svelte`.
	return target.replace(/\.js$/, '.ts').replace(/\.ts$/, '.ts');
}

function isComponentPath(path) {
	return path?.startsWith(`${COMPONENT_DIRECTORY}/`) || path?.endsWith('.svelte');
}

/** The layer a file belongs to, used in cross-layer reporting. */
function layerOf(path) {
	if (path.startsWith('src/routes/')) return 'routes';
	if (path.startsWith(`${COMPONENT_DIRECTORY}/`)) return 'components';
	if (path.startsWith('src/lib/adapters/')) return 'adapters';
	if (path.startsWith('src/lib/stores/')) return 'stores';
	if (path.startsWith('src/lib/speech/')) return 'speech';
	if (path.startsWith('src/lib/utils/')) return 'utils';
	if (path.startsWith('src/lib/languages/')) return 'languages';
	if (path.startsWith('src/lib/practice/')) return 'practice';
	if (path.startsWith('src/lib/usage/')) return 'usage';
	if (path.startsWith('src/lib/platform/')) return 'platform';
	if (path.startsWith('src/lib/gestures/')) return 'gestures';
	return 'lib';
}

function countOccurrences(text, needle) {
	return text.split(needle).length - 1;
}

function analyseFile(path) {
	const extension = path.slice(path.lastIndexOf('.'));
	const raw = readFileSync(path, 'utf8');
	const text = codeOnly(raw, extension);
	const specifiers = importSpecifiers(text);
	const repoPath = relative(REPO_ROOT, path).split(sep).join('/');

	const frameworkImports = { svelte: 0, tauri: 0 };
	for (const specifier of specifiers) {
		if (FRAMEWORK_IMPORTS.svelte.some((pattern) => pattern.test(specifier))) frameworkImports.svelte += 1;
		if (FRAMEWORK_IMPORTS.tauri.some((pattern) => pattern.test(specifier))) frameworkImports.tauri += 1;
	}

	const browserGlobals = BROWSER_GLOBALS.reduce((total, needle) => total + countOccurrences(text, needle), 0);

	const crossLayerImports = [];
	for (const specifier of specifiers) {
		const target = resolveProjectPath(specifier, path);
		if (!target) continue;

		const importsComponent = isComponentPath(target);
		const outsideUiLayer = !repoPath.startsWith(`${COMPONENT_DIRECTORY}/`) && !repoPath.startsWith(`${ROUTE_DIRECTORY}/`);
		const adapterImportsUi = repoPath.startsWith('src/lib/adapters/') && target.startsWith(`${COMPONENT_DIRECTORY}/`);
		const storeImportsUi = repoPath.startsWith('src/lib/stores/') && importsComponent;

		if ((outsideUiLayer && importsComponent) || adapterImportsUi || storeImportsUi) {
			crossLayerImports.push(`${specifier} (${layerOf(repoPath)} -> ${layerOf(target)})`);
		}
	}

	const score =
		frameworkImports.svelte * WEIGHTS.svelte +
		frameworkImports.tauri * WEIGHTS.tauri +
		browserGlobals * WEIGHTS.browserGlobal +
		crossLayerImports.length * WEIGHTS.crossLayer;

	return {
		path: repoPath,
		loc: raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0),
		svelte: frameworkImports.svelte,
		tauri: frameworkImports.tauri,
		browserGlobals,
		crossLayerImports,
		score
	};
}

function render(matrix) {
	const rows = matrix.slice(0, 40).map((entry, index) => {
		const imports = entry.crossLayerImports.length > 0 ? entry.crossLayerImports.join('<br>') : '—';
		return `| ${index + 1} | \`${entry.path}\` | ${entry.loc} | ${entry.svelte} | ${entry.tauri} | ${entry.browserGlobals} | ${entry.crossLayerImports.length} | ${entry.score} | ${imports} |`;
	});

	const totals = matrix.reduce(
		(sum, entry) => ({
			svelte: sum.svelte + entry.svelte,
			tauri: sum.tauri + entry.tauri,
			browserGlobals: sum.browserGlobals + entry.browserGlobals,
			crossLayer: sum.crossLayer + entry.crossLayerImports.length
		}),
		{ svelte: 0, tauri: 0, browserGlobals: 0, crossLayer: 0 }
	);

	return `# Coupling matrix

Generated by \`node scripts/coupling-audit.mjs\` (P0). Do not edit by hand:
re-run the script after moving or splitting a module. Regenerate with
\`bun run audit:coupling\`.

Coupling is counted per source file:

- **Svelte** — imports of \`svelte\`, \`svelte/store\` or another \`svelte/*\` entry (the Svelte
  runtime, stores and runes).
- **Tauri** — imports of \`@tauri-apps/*\` or \`plugin:*\`.
- **Browser** — references to \`window.\`, \`document.\`, \`navigator.\`, \`localStorage\`,
  \`indexedDB\`, \`AudioContext\` or \`fetch(\` in code (comments excluded).
- **Cross-layer** — imports of \`src/lib/components/*\` or a \`.svelte\` component from outside
  \`src/lib/components\` and \`src/routes\` (adapters importing UI is always a cross-layer import).

Score = Svelte × ${WEIGHTS.svelte} + Tauri × ${WEIGHTS.tauri} + browser globals × ${WEIGHTS.browserGlobal} + cross-layer × ${WEIGHTS.crossLayer}.
The score ranks where to start, not correctness: a view that uses stores and the DOM to draw
something is doing its job.

Totals across ${matrix.length} files: ${totals.svelte} Svelte imports, ${totals.tauri} Tauri imports,
${totals.browserGlobals} browser-global references, ${totals.crossLayer} cross-layer imports.

The top ${Math.min(40, matrix.length)} files are listed. The full JSON is not committed; read the
counts here or re-run the script.

| # | File | LOC | Svelte | Tauri | Browser | Cross-layer | Score | Cross-layer imports |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

function main() {
	const files = walk(SOURCE_ROOT);
	const matrix = files.map(analyseFile).sort((first, second) => second.score - first.score || first.path.localeCompare(second.path));
	const output = render(matrix);
	const checkOnly = process.argv.includes('--check');

	if (checkOnly) {
		let current = '';
		try {
			current = readFileSync(OUTPUT_PATH, 'utf8');
		} catch {
			console.error(`coupling matrix is missing: ${relative(REPO_ROOT, OUTPUT_PATH)}`);
			process.exit(1);
		}
		if (current !== output) {
			console.error('coupling matrix is stale: run `bun run audit:coupling`');
			process.exit(1);
		}
		console.log('coupling matrix is current');
		return;
	}

	writeFileSync(OUTPUT_PATH, output);
	const worst = matrix.slice(0, 8).map((entry) => `  ${String(entry.score).padStart(4)}  ${entry.path}`);
	console.log(`wrote ${relative(REPO_ROOT, OUTPUT_PATH)} (${matrix.length} files)`);
	console.log(worst.join('\n'));
}

main();
