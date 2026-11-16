#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Boundary guards (P0, invariants I2 and I8).
 *
 * Rust: the core crates may not depend — directly or transitively, normal
 * dependencies only — on a UI framework, a wasm binding layer, a JavaScript
 * runtime, an HTTP client or an async runtime. `cargo tree -e normal` means
 * dev-dependencies used by tests are allowed and excluded.
 *
 * TypeScript: adapters may not import UI components, nothing outside the
 * view layer may import a `.svelte` component, and live code may not import
 * the archived TypeScript under `deprecated/`. The rules are errors by default
 * after P8; `--no-strict` is only for a one-off local audit while a move is in
 * progress.
 *
 * Usage: node scripts/check-boundaries.mjs [--no-strict]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = join(REPO_ROOT, 'src');
const COMPONENT_DIRECTORY = 'src/lib/components';
const ADAPTER_DIRECTORY = 'src/lib/adapters';
const DEPRECATED_DIRECTORY = 'deprecated/';

/**
 * `svelte/store` belongs to view state: the view-state stores, the views
 * themselves, the core client's event-fed stores, and the few host shims that
 * publish state to a view. Everything else takes data as arguments.
 */
const SVELTE_STORE_ALLOWED = [
	'src/lib/stores/',
	'src/lib/components/',
	'src/routes/',
	'src/lib/core-client/',
	'src/lib/usage/coreMonitor.ts',
	'src/lib/practice/promptSubmissions.ts',
	'src/lib/speech/tts/service.ts',
	'src/lib/platform/pwa.ts',
	'src/lib/adapters/sync/service.ts',
	'src/lib/adapters/sync/webdav.ts',
	'src/lib/adapters/sync/google/oauth.ts'
];

/** Desktop and speech plugins stay behind the transport and the platform shims. */
const TAURI_ALLOWED = [
	'src/lib/core-client/transport.ts',
	'src/lib/core-client/coreHost.ts',
	'src/lib/platform/',
	'src/lib/adapters/sync/http.ts',
	'src/lib/adapters/sync/google/oauth.ts',
	'src/lib/speech/stt/native/nativeEngine.ts',
	'src/lib/components/WindowBar.svelte'
];

/** Crates that must stay framework-free (invariant I2). */
const CORE_CRATES = ['onspot-domain', 'onspot-ports', 'onspot-app', 'onspot-dsp'];

/** Crate names that may never appear in a core crate's normal dependency tree. */
const FORBIDDEN_CRATES = ['tauri', 'wasm-bindgen', 'js-sys', 'web-sys', 'reqwest', 'tokio', 'svelte'];

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.svelte']);

function walk(directory) {
	return readdirSync(directory)
		.sort()
		.flatMap((entry) => {
			const path = join(directory, entry);
			if (statSync(path).isDirectory()) return walk(path);
			const extension = entry.slice(entry.lastIndexOf('.'));
			return SOURCE_EXTENSIONS.has(extension) ? [path] : [];
		});
}

/** Import specifiers in a file, ignoring comments and prose. */
function importSpecifiers(text) {
	const withoutComments = text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
	const specifiers = new Set();
	const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s+['"]([^'"]+)['"]/gm];

	for (const pattern of patterns) {
		for (const match of withoutComments.matchAll(pattern)) specifiers.add(match[1]);
	}
	return [...specifiers];
}

/** Resolves a project specifier to a repo-relative path, or null for a package import. */
function resolveProjectPath(specifier, fromFile) {	let target;

	if (specifier.startsWith('#lib/')) {
		target = join('src/lib', specifier.slice('#lib/'.length));
	} else if (specifier.startsWith('$lib/')) {
		target = join('src/lib', specifier.slice('$lib/'.length));
	} else if (specifier.startsWith('.')) {
		target = relative(REPO_ROOT, resolve(dirname(fromFile), specifier));
	} else {
		return null;
	}

	return target.split(sep).join('/').replace(/\.js$/, '.ts');
}

function checkRustCore() {
	const failures = [];

	for (const crate of CORE_CRATES) {
		let tree;
		try {
			tree = execFileSync(
				'cargo',
				['tree', '-e', 'normal', '--no-dedupe', '--prefix', 'none', '--format', '{p}', '-p', crate],
				{ cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
			);
		} catch (error) {
			failures.push(`${crate}: could not read its dependency tree (${String(error.stderr || error.message).trim().split('\n')[0]})`);
			continue;
		}

		const names = new Set(
			tree
				.split('\n')
				.map((line) => line.trim().split(/\s+/)[0])
				.filter(Boolean)
		);
		const forbidden = FORBIDDEN_CRATES.filter((name) => names.has(name));
		if (forbidden.length > 0) failures.push(`${crate} depends on: ${forbidden.join(', ')}`);
	}

	return failures;
}

/** True when the repo-relative file is under, or is, one of the allow-listed paths. */
function allowedBy(repoPath, allowed) {
	return allowed.some((entry) => (entry.endsWith('/') ? repoPath.startsWith(entry) : repoPath === entry));
}

function checkTypeScriptLayers() {
	const warnings = [];

	for (const path of walk(SOURCE_ROOT)) {
		const repoPath = relative(REPO_ROOT, path).split(sep).join('/');
		const text = readFileSync(path, 'utf8');

		for (const specifier of importSpecifiers(text)) {
			const target = resolveProjectPath(specifier, path);
			if (specifier === 'svelte/store' && !allowedBy(repoPath, SVELTE_STORE_ALLOWED)) {
				warnings.push(`${repoPath}: imports svelte/store outside a view-state store or host shim`);
			}
			if (
				(specifier.startsWith('@tauri-apps/') || specifier === 'plugin:speech') &&
				!allowedBy(repoPath, TAURI_ALLOWED)
			) {
				warnings.push(`${repoPath}: imports a desktop/speech plugin outside a host shim (${specifier})`);
			}
			if (!target) continue;

			const importsComponent = target.startsWith(`${COMPONENT_DIRECTORY}/`) || target.endsWith('.svelte');
			const isAdapter = repoPath.startsWith(`${ADAPTER_DIRECTORY}/`);
			const isView = repoPath.startsWith(`${COMPONENT_DIRECTORY}/`) || repoPath.startsWith('src/routes/');

			if (target.startsWith(DEPRECATED_DIRECTORY)) {
				warnings.push(`${repoPath}: live code imports archived TypeScript (${specifier})`);
			} else if (isAdapter && target.startsWith(`${COMPONENT_DIRECTORY}/`)) {
				warnings.push(`${repoPath}: adapter imports UI (${specifier})`);
			} else if (!isView && importsComponent) {
				warnings.push(`${repoPath}: outside the view layer but imports a component (${specifier})`);
			}
		}
	}

	return warnings;
}

function main() {
	const strict = !process.argv.includes('--no-strict');
	const rustFailures = checkRustCore();
	const typescriptWarnings = checkTypeScriptLayers();

	console.log(`Rust core crates checked: ${CORE_CRATES.join(', ')}`);
	for (const failure of rustFailures) console.error(`ERROR ${failure}`);

	console.log(`TypeScript layer rules checked under src/ (${typescriptWarnings.length} violation${typescriptWarnings.length === 1 ? '' : 's'})`);
	for (const warning of typescriptWarnings) console.error(`ERROR ${warning}`);

	if (rustFailures.length > 0) {
		console.error(`\n${rustFailures.length} boundary violation${rustFailures.length === 1 ? '' : 's'} in the Rust core.`);
		process.exit(1);
	}

	if (strict && typescriptWarnings.length > 0) {
		console.error(`\n${typescriptWarnings.length} TypeScript layer violation(s).`);
		process.exit(1);
	}

	console.log('\nBoundaries are intact.');
}

main();
