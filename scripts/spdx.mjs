#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Adds the AGPL SPDX identifier to every source file this project owns.
 *
 * Run with `--check` in CI to fail when a new source file is missing it. The
 * header is inserted after a shebang, and vendored or generated trees are
 * skipped because they are not ours to relicense.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPDX = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const CHECK = process.argv.includes('--check');

const EXTENSIONS = new Map([
	['.ts', '//'],
	['.js', '//'],
	['.mjs', '//'],
	['.rs', '//'],
	['.sh', '#'],
	['.svelte', '<!--']
]);

const SKIP_DIRECTORIES = new Set([
	'.commandcode',
	'.git',
	'.svelte-kit',
	'build',
	'coverage',
	'dist',
	'gen',
	'node_modules',
	'target'
]);

const SKIP_PATHS = [
	'src/lib/speech/tts/piper/vendor',
	'src/routes/model-lab/vendor',
	'static/piper-wasm',
	'src-tauri/gen',
	'src-tauri/target'
];

function isSkipped(relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	return SKIP_PATHS.some((prefix) => normalized.startsWith(prefix));
}

function headerFor(extension) {
	const prefix = EXTENSIONS.get(extension);
	if (!prefix) return null;

	return prefix === '<!--' ? `<!-- ${SPDX} -->` : `${prefix} ${SPDX}`;
}

function alreadyHasHeader(source) {
	return source
		.split('\n', 4)
		.some((line) => line.includes('SPDX-License-Identifier'));
}

function withHeader(source, header) {
	if (source.startsWith('#!')) {
		const newline = source.indexOf('\n');
		if (newline === -1) return `${source}\n\n${header}\n`;
		return `${source.slice(0, newline + 1)}\n${header}\n${source.slice(newline + 1)}`;
	}

	return `${header}\n\n${source}`;
}

function collectFiles(directory, files = []) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) continue;

		const absolutePath = path.join(directory, entry.name);
		const relativePath = path.relative(ROOT, absolutePath);

		if (entry.isDirectory()) {
			if (SKIP_DIRECTORIES.has(entry.name) || isSkipped(relativePath)) continue;
			collectFiles(absolutePath, files);
			continue;
		}

		if (isSkipped(relativePath)) continue;
		if (EXTENSIONS.has(path.extname(entry.name))) files.push(absolutePath);
	}

	return files;
}

const files = collectFiles(ROOT);
const missing = [];
let updated = 0;

for (const file of files) {
	const extension = path.extname(file);
	const source = fs.readFileSync(file, 'utf8');

	if (alreadyHasHeader(source)) continue;

	if (CHECK) {
		missing.push(path.relative(ROOT, file));
		continue;
	}

	fs.writeFileSync(file, withHeader(source, headerFor(extension)));
	updated++;
}

if (CHECK) {
	if (missing.length) {
		console.error(`Missing SPDX headers in ${missing.length} file(s):`);
		for (const file of missing) console.error(`  ${file}`);
		process.exitCode = 1;
	} else {
		console.log(`All ${files.length} source files carry an SPDX header.`);
	}
} else {
	console.log(`Added SPDX headers to ${updated} of ${files.length} source files.`);
}
