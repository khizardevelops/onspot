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
 * TypeScript: adapters may not import UI components, and nothing outside the
 * view layer may import a `.svelte` component. The rules report warnings for
 * now (P0 installs the guard, later phases fix the violations and then the
 * rule becomes an error); an internal error still fails the run.
 *
 * Usage: node scripts/check-boundaries.mjs [--strict]
 *   --strict turns TypeScript warnings into a failure (planned for the phase
 *   that has cleaned up the offences).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = join(REPO_ROOT, 'src');
const COMPONENT_DIRECTORY = 'src/lib/components';
const ADAPTER_DIRECTORY = 'src/lib/adapters';

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
function resolveProjectPath(specifier, fromFile) {
	let target;

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

function checkTypeScriptLayers() {
	const warnings = [];

	for (const path of walk(SOURCE_ROOT)) {
		const repoPath = relative(REPO_ROOT, path).split(sep).join('/');
		const text = readFileSync(path, 'utf8');

		for (const specifier of importSpecifiers(text)) {
			const target = resolveProjectPath(specifier, path);
			if (!target) continue;

			const importsComponent = target.startsWith(`${COMPONENT_DIRECTORY}/`) || target.endsWith('.svelte');
			const isAdapter = repoPath.startsWith(`${ADAPTER_DIRECTORY}/`);
			const isView = repoPath.startsWith(`${COMPONENT_DIRECTORY}/`) || repoPath.startsWith('src/routes/');

			if (isAdapter && target.startsWith(`${COMPONENT_DIRECTORY}/`)) {
				warnings.push(`${repoPath}: adapter imports UI (${specifier})`);
			} else if (!isView && importsComponent) {
				warnings.push(`${repoPath}: outside the view layer but imports a component (${specifier})`);
			}
		}
	}

	return warnings;
}

function main() {
	const strict = process.argv.includes('--strict');
	const rustFailures = checkRustCore();
	const typescriptWarnings = checkTypeScriptLayers();

	console.log(`Rust core crates checked: ${CORE_CRATES.join(', ')}`);
	for (const failure of rustFailures) console.error(`ERROR ${failure}`);

	console.log(`TypeScript layer rules checked under src/ (${typescriptWarnings.length} warning${typescriptWarnings.length === 1 ? '' : 's'})`);
	for (const warning of typescriptWarnings) console.warn(`WARN  ${warning}`);

	if (rustFailures.length > 0) {
		console.error(`\n${rustFailures.length} boundary violation${rustFailures.length === 1 ? '' : 's'} in the Rust core.`);
		process.exit(1);
	}

	if (strict && typescriptWarnings.length > 0) {
		console.error(`\n${typescriptWarnings.length} TypeScript layer warning(s) treated as errors (--strict).`);
		process.exit(1);
	}

	console.log('\nBoundaries are intact.');
}

main();
