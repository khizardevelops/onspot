#!/usr/bin/env node
// Packs one or more pages of the app (or any folder/file "section") into a repomix bundle.
// Starting from the page's route files, it follows local imports ($lib, relative, ?worker,
// new URL(..., import.meta.url), CSS @import) so the bundle carries everything the page uses.
// Pages are discovered from src/routes, so a new route is exportable without any setup.
// Run `npm run bundle -- --help` for usage.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = 'src/routes';
const OUT_DIR = 'repomix';

const TEXT_FILE = /\.(svelte|ts|js|mjs|cjs|css|json|html|md)$/;
const TRACEABLE = /\.(svelte|ts|js|mjs|cjs|css)$/;
const UI_FILE = /\.(svelte|css|html)$/;
const RESOLVE_SUFFIXES = ['', '.ts', '.js', '.svelte', '.svelte.ts', '.svelte.js', '/index.ts', '/index.js'];
const STYLE_EXTENSIONS = { xml: 'xml', markdown: 'md', json: 'json', plain: 'txt' };

const IMPORT_PATTERNS = [
	/\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g, // import x from '..', export * from '..'
	/\bimport\s*['"]([^'"]+)['"]/g, // import '../app.css'
	/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('..')
	/\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g, // new URL('./x.worker.ts', import.meta.url)
	/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g // CSS @import
];

const HELP = `Export pages or sections of the app with repomix.

Usage: npm run bundle -- <target...> [options] [-- <extra repomix args>]

Targets
  <page>             A route name (see --list), e.g. settings, history, home
  <path>             Any file or folder, e.g. src/lib/adapters/tts
  <glob>             A quoted glob, e.g. "src/lib/stores/*.ts"
  --all              Every page

Options
  --separate         One bundle per target instead of one combined bundle
  --depth <n>        Follow imports n levels deep (default: unlimited)
  --no-deps          Only the targets' own files (same as --depth 0)
  --layout           Also include the parent +layout files (the app shell) and their imports
  --ui               Keep only markup and styles (.svelte, .css, .html)
  --exclude <glob>   Drop matching files; repeatable, e.g. --exclude "src/lib/components/ui/**"
  --style <type>     xml (default), markdown, json or plain
  -o, --out <file>   Output file (single bundle only; default repomix/<targets>-bundle.<ext>)
  --dry-run          Print the file list instead of running repomix
  --list             Print the page names and exit

Examples
  npm run bundle -- settings
  npm run bundle -- settings history
  npm run bundle -- --all --separate
  npm run bundle -- home --ui --exclude "src/lib/components/ui/**"
  npm run bundle -- src/lib/adapters/tts --depth 1
  npm run bundle -- insights -- --compress --copy`;

function fail(message) {
	console.error(`bundle: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const separator = argv.indexOf('--');
	const own = separator === -1 ? argv : argv.slice(0, separator);
	const opts = {
		targets: [],
		passthrough: separator === -1 ? [] : argv.slice(separator + 1),
		all: false,
		separate: false,
		depth: Infinity,
		layout: false,
		ui: false,
		exclude: [],
		style: 'xml',
		out: null,
		dryRun: false,
		list: false
	};
	const value = (i, flag) => own[i + 1] ?? fail(`${flag} needs a value`);

	for (let i = 0; i < own.length; i++) {
		const arg = own[i];
		switch (arg) {
			case '-h':
			case '--help':
				console.log(HELP);
				process.exit(0);
			case '--all': opts.all = true; break;
			case '--separate': opts.separate = true; break;
			case '--depth': opts.depth = Number(value(i++, arg)); break;
			case '--no-deps': opts.depth = 0; break;
			case '--layout': opts.layout = true; break;
			case '--ui': opts.ui = true; break;
			case '--exclude': opts.exclude.push(globToMatcher(value(i++, arg))); break;
			case '--style': opts.style = value(i++, arg); break;
			case '-o':
			case '--out': opts.out = value(i++, arg); break;
			case '--dry-run': opts.dryRun = true; break;
			case '--list': opts.list = true; break;
			default:
				if (arg.startsWith('-')) fail(`unknown option ${arg} (repomix options go after a second --)`);
				opts.targets.push(arg);
		}
	}
	if (!Number.isInteger(opts.depth) && opts.depth !== Infinity) fail('--depth must be a whole number');
	if (!(opts.style in STYLE_EXTENSIONS)) fail(`--style must be one of ${Object.keys(STYLE_EXTENSIONS).join(', ')}`);
	return opts;
}

/** Tracked and untracked-but-not-ignored files, so build output and node_modules never leak in. */
function repoFiles() {
	const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
	return out.split('\0').filter((file) => file && existsSync(path.join(ROOT, file)));
}

/** Minimal glob support: `**` spans folders, `*` and `?` stay inside one. A plain path matches itself and everything under it. */
function globToMatcher(glob) {
	const clean = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
	if (!/[*?]/.test(clean)) return (file) => file === clean || file.startsWith(`${clean}/`);
	const source = clean
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*\//g, '\0')
		.replace(/\*\*/g, '\u0001')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]')
		.replace(/\0/g, '(?:.*/)?')
		.replace(/\u0001/g, '.*');
	const pattern = new RegExp(`^${source}$`);
	return (file) => pattern.test(file);
}

/** Route directories are the ones holding SvelteKit `+` files; each `+page` is a page. */
function discoverRoutes(files) {
	const routeDirs = new Set();
	const pages = new Map();
	for (const file of files) {
		if (!file.startsWith(`${ROUTES}/`)) continue;
		const dir = path.posix.dirname(file);
		const base = path.posix.basename(file);
		if (base.startsWith('+')) routeDirs.add(dir);
		if (base.startsWith('+page.')) {
			const name = dir
				.slice(ROUTES.length + 1)
				.split('/')
				.filter((segment) => segment && !/^\(.*\)$/.test(segment)) // (groups) don't appear in URLs
				.join('/');
			pages.set(name || 'home', dir);
		}
	}
	return { routeDirs, pages };
}

/** The route directory a file belongs to: its nearest ancestor that holds `+` files. */
function owningRoute(file, routeDirs) {
	let dir = path.posix.dirname(file);
	while (dir.startsWith(ROUTES) && !routeDirs.has(dir)) dir = path.posix.dirname(dir);
	return dir;
}

/**
 * A page's own files are everything in its route folder that no nested route claims. The root
 * +layout is the app shell, so it stays out of every page but `home` unless --layout asks for it.
 */
function pageEntries(routeDir, files, routeDirs, withLayout) {
	const isLayout = (file) => path.posix.basename(file).startsWith('+layout.');
	const own = files.filter((file) => file.startsWith(`${routeDir}/`) && owningRoute(file, routeDirs) === routeDir);
	if (!withLayout) return routeDir === ROUTES ? own.filter((file) => !isLayout(file)) : own;
	const parents = [];
	for (let dir = path.posix.dirname(routeDir); dir.startsWith(ROUTES); dir = path.posix.dirname(dir)) {
		parents.push(...files.filter((file) => path.posix.dirname(file) === dir && isLayout(file)));
	}
	return [...new Set([...own, ...parents])];
}

function resolveTarget(target, files, routes, opts) {
	if (routes.pages.has(target)) {
		return { label: target, entries: pageEntries(routes.pages.get(target), files, routes.routeDirs, opts.layout) };
	}
	const relative = path.posix.normalize(target.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
	const absolute = path.join(ROOT, relative);
	if (existsSync(absolute)) {
		const entries = statSync(absolute).isDirectory()
			? files.filter((file) => file.startsWith(`${relative}/`))
			: files.filter((file) => file === relative);
		return { label: relative, entries };
	}
	if (/[*?]/.test(relative)) {
		return { label: relative, entries: files.filter(globToMatcher(relative)) };
	}
	const names = [...routes.pages.keys()].join(', ');
	fail(`"${target}" is not a page (${names}) or an existing path`);
}

function importsOf(file) {
	const source = readFileSync(path.join(ROOT, file), 'utf8');
	const specs = [];
	for (const pattern of IMPORT_PATTERNS) {
		for (const match of source.matchAll(pattern)) specs.push(match[1]);
	}
	return specs;
}

/** Maps an import specifier to a repo file, or null for packages and SvelteKit virtual modules. */
function resolveImport(spec, fromFile, fileSet) {
	const bare = spec.split('?')[0];
	let base;
	if (bare === '$lib' || bare.startsWith('$lib/')) base = `src/lib${bare.slice(4)}`;
	else if (bare.startsWith('.')) base = path.posix.join(path.posix.dirname(fromFile), bare);
	else return null;
	const candidates = RESOLVE_SUFFIXES.map((suffix) => base + suffix);
	if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`);
	return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

/** A barrel only imports and re-exports (shadcn's ui/x/index.ts, adapters/llm/index.ts). */
function isBarrel(file) {
	if (!/\.(ts|js)$/.test(file)) return false;
	const rest = readFileSync(path.join(ROOT, file), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '')
		.replace(/\bimport\s[^;]*?from\s*['"][^'"]+['"];?/g, '')
		.replace(/\bexport\s+(?:type\s+)?\{[^}]*\}(?:\s*from\s*['"][^'"]+['"])?;?/g, '')
		.replace(/\bexport\s+\*(?:\s+as\s+\w+)?\s+from\s*['"][^'"]+['"];?/g, '');
	return rest.trim() === '';
}

/** Breadth-first over local imports. Passing through a barrel doesn't count as a level. */
function trace(entries, fileSet, maxDepth) {
	const depthOf = new Map(entries.map((file) => [file, 0]));
	const queue = [...entries];
	while (queue.length > 0) {
		const file = queue.shift();
		const depth = depthOf.get(file);
		if (depth >= maxDepth || !TRACEABLE.test(file)) continue;
		for (const spec of importsOf(file)) {
			const dep = resolveImport(spec, file, fileSet);
			if (!dep) continue;
			const barrel = isBarrel(dep);
			const next = barrel ? depth : depth + 1;
			if (depthOf.has(dep) && depthOf.get(dep) <= next) continue;
			depthOf.set(dep, next);
			if (barrel) queue.unshift(dep);
			else queue.push(dep);
		}
	}
	return [...depthOf.keys()];
}

function collect(group, fileSet, opts) {
	const traced = trace(group.flatMap((target) => target.entries), fileSet, opts.depth);
	return traced
		.filter((file) => TEXT_FILE.test(file))
		.filter((file) => !opts.ui || UI_FILE.test(file))
		.filter((file) => !opts.exclude.some((matches) => matches(file)))
		.sort();
}

function slug(label) {
	return label
		.replace(/^src\//, '')
		.replace(/[*?]+/g, 'x')
		.replace(/[^a-zA-Z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function describe(group, opts) {
	const labels = group.map((target) => target.label).join(', ');
	const depth = opts.depth === Infinity ? 'all local imports followed' : `imports followed ${opts.depth} level(s) deep`;
	const notes = [depth, opts.layout ? 'app shell layout included' : 'app shell layout left out'];
	if (opts.ui) notes.push('markup and styles only');
	return `OnSpot export of: ${labels}. Generated by \`npm run bundle\` (${notes.join('; ')}).`;
}

function bundle(group, fileSet, opts) {
	const files = collect(group, fileSet, opts);
	const labels = group.map((target) => target.label).join(', ');
	if (files.length === 0) fail(`no files matched for ${labels}`);

	if (opts.dryRun) {
		const bytes = files.reduce((sum, file) => sum + statSync(path.join(ROOT, file)).size, 0);
		console.log(`\n${labels}: ${files.length} files, ${Math.round(bytes / 1024)} KB`);
		for (const file of files) console.log(`  ${file}`);
		return;
	}

	const out = opts.out ?? `${OUT_DIR}/${group.map((target) => slug(target.label)).join('+')}-bundle.${STYLE_EXTENSIONS[opts.style]}`;
	console.log(`\nPacking ${labels} (${files.length} files) -> ${out}`);
	const result = spawnSync(
		'npx',
		['--yes', 'repomix', '--stdin', '--style', opts.style, '--output', out, '--header-text', describe(group, opts), ...opts.passthrough],
		{ cwd: ROOT, input: files.join('\n'), stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' }
	);
	if (result.error) fail(result.error.message);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const opts = parseArgs(process.argv.slice(2));
const files = repoFiles();
const fileSet = new Set(files);
const routes = discoverRoutes(files);

if (opts.list) {
	console.log('Pages:');
	for (const [name, dir] of routes.pages) console.log(`  ${name.padEnd(14)} ${dir}`);
	console.log('\nAny file, folder or quoted glob also works as a target, e.g. src/lib/adapters/tts');
	process.exit(0);
}

const targetNames = opts.all ? [...routes.pages.keys(), ...opts.targets] : opts.targets;
if (targetNames.length === 0) {
	console.log(HELP);
	process.exit(1);
}
const targets = [...new Set(targetNames)].map((target) => resolveTarget(target, files, routes, opts));
const groups = opts.separate ? targets.map((target) => [target]) : [targets];
if (opts.out && groups.length > 1) fail('--out works with a single bundle; drop --separate or --out');
if (opts.all && !opts.separate && !opts.out && opts.targets.length === 0) opts.out = `${OUT_DIR}/all-pages-bundle.${STYLE_EXTENSIONS[opts.style]}`;

for (const group of groups) bundle(group, fileSet, opts);
