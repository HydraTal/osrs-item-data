#!/usr/bin/env node
// Builds a release of this repo's data from one OSRS cache version:
//
//   1. resolve the cache: abextm/osrs-cache's latest release tag (one tag per game update), or --tag
//   2. fetch it: a shallow, sparse, blob-filtered clone of just the five indexes the renderer reads (~110 MB)
//   3. render: renderer/ (RuneLite's cache library) writes icons/<id>.png and data/items.json
//   4. classify: each record gets `equipable` from RuneLite's equipment-stats file (one download, the same file the
//      client fetches at startup; only the flag is kept), then scripts/rules.mjs writes data/categories.tsv
//   5. record: data/meta.json (what built it) and data/changes.json (what changed since the last commit)
//   6. --package: the release assets under .work/release/
//
// Usage:
//   node scripts/build.mjs                 build from the newest cache
//   node scripts/build.mjs --tag <tag>     build a specific abextm/osrs-cache tag
//   node scripts/build.mjs --check         decide, build nothing: changed=true|false, record=true|false, tag, reason
//                                          (written to $GITHUB_OUTPUT in CI); record means same content, new tag
//   node scripts/build.mjs --record        name a same-content tag in data/meta.json without rendering
//   node scripts/build.mjs --fingerprint   print a tag's index blob ids and item archive CRC
//   node scripts/build.mjs --package       also write the release assets
//   node scripts/build.mjs --package-only  write the release assets for what data/ already holds
//   node scripts/build.mjs --classify-only re-run scripts/rules.mjs over data/items.json (after a rules change)
//   --runelite <version>                   RuneLite cache library version (default: its latest release)
//   --force                                build even when data/meta.json already names this tag
//
// Requests: one to the GitHub API for the latest tag, one to repo.runelite.net for the library version, the clone,
// and one to static.runelite.net for the stats file. Set GITHUB_TOKEN to authenticate the API call (CI does).
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { classify } from './rules.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.work');
const DATA = path.join(ROOT, 'data');
const ICONS = path.join(ROOT, 'icons');
const CACHE_REPO = 'https://github.com/abextm/osrs-cache.git';
const INDEXES = [2, 7, 8, 9, 24]; // configs, models, sprites, textures, gamevals
const UA = 'osrs-item-data-build (+https://github.com/HydraTal/osrs-item-data)';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name =>
{
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};

function run(cmd, cmdArgs, opts = {})
{
	const res = spawnSync(cmd, cmdArgs, { stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', shell: opts.shell ?? false, cwd: opts.cwd ?? ROOT });
	if (res.status !== 0)
	{
		throw new Error(`${cmd} ${cmdArgs.join(' ')} exited ${res.status}`);
	}
	return res.stdout ?? '';
}

async function get(url, headers = {})
{
	const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30_000) });
	if (!res.ok)
	{
		throw new Error(`${url}: HTTP ${res.status}`);
	}
	return res;
}

async function latestCacheTag()
{
	// releases/latest skips pre-releases, so beta-world caches (beta-sailing-...) never land here.
	const res = await get('https://api.github.com/repos/abextm/osrs-cache/releases/latest', githubHeaders());
	return (await res.json()).tag_name;
}

async function latestRuneLite()
{
	const xml = await (await get('https://repo.runelite.net/net/runelite/cache/maven-metadata.xml')).text();
	const m = /<release>([^<]+)<\/release>/.exec(xml);
	if (!m)
	{
		throw new Error('no <release> in net.runelite:cache maven-metadata.xml');
	}
	return m[1];
}

function readJson(file, fallback)
{
	try
	{
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	}
	catch
	{
		return fallback;
	}
}

/** "2026-10-20-rev241" -> { date: "2026-10-20", revision: 241 } */
function parseTag(tag)
{
	const m = /^(\d{4}-\d{2}-\d{2})(?:-[a-z0-9]+)*-rev(\d+)$/.exec(tag);
	return m ? { date: m[1], revision: Number(m[2]) } : { date: null, revision: null };
}

/*
 * Whether a new cache changes anything this repo is built from. Weekly game updates nearly always do; a same-day
 * re-tag (2026-09-23 vs 2026-09-23-c1) often changes only configs this repo doesn't read. Three layers, cheapest first:
 *
 *   - the git blob ids of the index files, from one GitHub API call: no download at all
 *   - the item archive's CRC (configs archive 10), from 2.flatcache alone (6.5 MB): configs also hold NPCs, objects and
 *     the rest, so a changed 2.flatcache doesn't mean changed items
 *   - the net.runelite:cache version, which does the rendering
 *
 * RuneLite's own client version and jar hashes (bootstrap.json) are recorded for provenance only: RuneLite releases
 * don't follow cache updates, so they can't say whether the items changed.
 */
const ITEM_ARCHIVE = 10; // ConfigType.ITEM in the configs index

function githubHeaders()
{
	const headers = { Accept: 'application/vnd.github+json' };
	if (process.env.GITHUB_TOKEN)
	{
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}
	return headers;
}

/** { "2": blobSha, "7": ..., ... } for a tag, from the GitHub tree API. */
async function remoteIndexBlobs(tag)
{
	const tree = await (await get(`https://api.github.com/repos/abextm/osrs-cache/git/trees/${encodeURIComponent(tag)}`, githubHeaders())).json();
	const blobs = {};
	for (const i of INDEXES)
	{
		const entry = (tree.tree ?? []).find(t => t.path === `${i}.flatcache`);
		if (!entry)
		{
			throw new Error(`${tag} has no ${i}.flatcache`);
		}
		blobs[i] = entry.sha;
	}
	return blobs;
}

/** The same blob ids, from a fetched cache clone. */
function localIndexBlobs(cacheDir)
{
	return Object.fromEntries(INDEXES.map(i => [i, run('git', ['rev-parse', `HEAD:${i}.flatcache`], { cwd: cacheDir, capture: true }).trim()]));
}

/** The CRC of the configs index's item archive, from 2.flatcache's text. */
function itemArchiveCrc(flatcache)
{
	const m = new RegExp(`^id=${ITEM_ARCHIVE}\\r?\\n(?:(?!id=)[^\\n]*\\n)*?crc=(-?\\d+)`, 'm').exec(flatcache);
	if (!m)
	{
		throw new Error(`no archive ${ITEM_ARCHIVE} in 2.flatcache`);
	}
	return Number(m[1]);
}

async function remoteItemArchiveCrc(tag)
{
	const res = await get(`https://raw.githubusercontent.com/abextm/osrs-cache/${encodeURIComponent(tag)}/2.flatcache`);
	return itemArchiveCrc(await res.text());
}

async function runeliteClient()
{
	const boot = await (await get('https://static.runelite.net/bootstrap.json')).json();
	const hash = prefix => boot.artifacts.find(a => a.name.startsWith(prefix))?.hash ?? null;
	return { version: boot.version, client: hash('client-'), injectedClient: hash('injected-client-') };
}

/**
 * What --check decides: build (changed), note the tag without building (record: same content), or nothing.
 * `reason` says why, for the run log.
 */
async function decide(meta0, tag)
{
	if (flag('--force'))
	{
		return { changed: true, reason: 'forced' };
	}
	const fp = meta0.fingerprint;
	const runelite = await latestRuneLite();
	if (fp && fp.runelite !== runelite)
	{
		return { changed: true, reason: `RuneLite cache library ${fp.runelite} -> ${runelite}` };
	}
	if (meta0.cacheTag === tag)
	{
		return { changed: false, reason: `data/meta.json already names ${tag}` };
	}
	if (!fp)
	{
		return { changed: true, reason: 'no fingerprint recorded for the current data' };
	}
	const blobs = await remoteIndexBlobs(tag);
	const moved = INDEXES.filter(i => i !== 2 && blobs[i] !== fp.blobs[i]);
	if (moved.length)
	{
		return { changed: true, reason: `indexes ${moved.join(', ')} changed` };
	}
	const crc = blobs[2] === fp.blobs[2] ? fp.itemsCrc : await remoteItemArchiveCrc(tag);
	if (crc !== fp.itemsCrc)
	{
		return { changed: true, reason: 'item definitions changed' };
	}
	return { changed: false, record: true, blobs, reason: `same items, models, sprites, textures and gamevals as ${meta0.cacheTag}` };
}

/** Appends key=value lines to $GITHUB_OUTPUT in CI, and prints them either way. */
function output(values)
{
	const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
	for (const line of lines)
	{
		console.log(line);
	}
	if (process.env.GITHUB_OUTPUT)
	{
		fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
	}
}

function fetchCache(tag)
{
	const dir = path.join(WORK, `osrs-cache-${tag}`);
	if (INDEXES.every(i => fs.existsSync(path.join(dir, `${i}.flatcache`))))
	{
		return dir;
	}
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(WORK, { recursive: true });
	run('git', ['clone', '--quiet', '--depth', '1', '--branch', tag, '--filter=blob:none', '--no-checkout', CACHE_REPO, dir]);
	run('git', ['sparse-checkout', 'set', '--no-cone', ...INDEXES.map(i => `/${i}.flatcache`)], { cwd: dir });
	run('git', ['read-tree', '-mu', 'HEAD'], { cwd: dir });
	for (const i of INDEXES)
	{
		if (!fs.existsSync(path.join(dir, `${i}.flatcache`)))
		{
			throw new Error(`${tag} has no ${i}.flatcache`);
		}
	}
	return dir;
}

function render(cacheDir, runelite)
{
	const renderer = path.join(ROOT, 'renderer');
	const windows = process.platform === 'win32';
	// By absolute path: cmd.exe won't look in the working directory when NoDefaultCurrentDirectoryInExePath is set.
	// Through sh elsewhere, so a checkout that lost gradlew's executable bit still builds.
	const gradle = ['--quiet', 'installDist', `-PruneLiteVersion=${runelite}`];
	if (windows)
	{
		run(path.join(renderer, 'gradlew.bat'), gradle, { cwd: renderer, shell: true });
	}
	else
	{
		run('sh', [path.join(renderer, 'gradlew'), ...gradle], { cwd: renderer });
	}
	// Start from an empty icons/ so an item that's gone takes its icon with it. Unchanged icons come back
	// byte-identical, so git only sees what actually changed.
	fs.rmSync(ICONS, { recursive: true, force: true });
	const bin = path.join(renderer, 'build', 'install', 'osrs-item-data-renderer', 'bin', windows ? 'osrs-item-data-renderer.bat' : 'osrs-item-data-renderer');
	const out = run(bin, [cacheDir, ROOT], { capture: true, shell: windows });
	return JSON.parse(out.trim().split('\n').pop());
}

/**
 * Adds `equipable` to every record and rewrites items.json, one record per line. An id the stats file doesn't list is
 * not equipable, as in combo-tags (the CERT_ display copies have an equip slot but aren't gear), unless it's newer than
 * every id the file knows: an item from a game update RuneLite hasn't caught up with, which falls back to the cache's
 * equip slot.
 */
async function addEquipable(items)
{
	const stats = await (await get('https://static.runelite.net/item/stats.ids.min.json')).json();
	const newest = Math.max(...Object.keys(stats).map(Number));
	let fallback = 0;
	const out = items.map(i =>
	{
		let equipable = stats[i.id]?.equipable === true;
		if (!(i.id in stats) && i.id > newest)
		{
			equipable = i.wearPos[0] >= 0;
			fallback += i.name ? 1 : 0;
		}
		return { ...i, equipable };
	});
	fs.writeFileSync(path.join(DATA, 'items.json'), '[\n' + out.map(i => JSON.stringify(i)).join(',\n') + '\n]\n');
	return { items: out, fallback };
}

function writeCategories(items, tag)
{
	const { rules, byId } = classify(items);
	const lines = [
		`# Generated by scripts/build.mjs from abextm/osrs-cache ${tag} with scripts/rules.mjs. Do not edit by hand.`,
		'# id\tcategory\tinternal name\tdisplay name\trule',
	];
	const counts = {};
	for (const item of items)
	{
		const at = byId.get(item.id);
		if (at === undefined)
		{
			continue;
		}
		const { category, label } = rules[at];
		lines.push([item.id, category, item.key, item.name, label].join('\t'));
		counts[category] = (counts[category] ?? 0) + 1;
	}
	fs.writeFileSync(path.join(DATA, 'categories.tsv'), lines.join('\n') + '\n');
	return counts;
}

/** What changed against the last commit: items by record, icons by file. Empty lists on the first build. */
function changes(previousItems, items)
{
	const before = new Map((previousItems ?? []).map(i => [i.id, JSON.stringify(i)]));
	const after = new Map(items.map(i => [i.id, JSON.stringify(i)]));
	const itemChanges = { added: [], changed: [], removed: [] };
	for (const [id, rec] of after)
	{
		if (!before.has(id)) itemChanges.added.push(id);
		else if (before.get(id) !== rec) itemChanges.changed.push(id);
	}
	for (const id of before.keys())
	{
		if (!after.has(id)) itemChanges.removed.push(id);
	}

	const iconChanges = { added: [], changed: [], removed: [] };
	const status = run('git', ['status', '--porcelain', '--untracked-files=all', '--', 'icons'], { capture: true });
	for (const line of status.split('\n'))
	{
		const m = /^(..) icons\/(\d+)\.png$/.exec(line);
		if (!m) continue;
		const id = Number(m[2]);
		if (m[1].includes('?') || m[1].includes('A')) iconChanges.added.push(id);
		else if (m[1].includes('D')) iconChanges.removed.push(id);
		else iconChanges.changed.push(id);
	}
	for (const list of [...Object.values(itemChanges), ...Object.values(iconChanges)])
	{
		list.sort((a, b) => a - b);
	}
	return { items: itemChanges, icons: iconChanges };
}

function previousItems()
{
	const res = spawnSync('git', ['show', 'HEAD:data/items.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	return res.status === 0 ? JSON.parse(res.stdout) : null;
}

function zip(out, cwd, entries)
{
	fs.rmSync(out, { force: true });
	// The names go through a list file: 30k of them is past any command line's limit.
	const listFile = out + '.list';
	fs.writeFileSync(listFile, entries.join('\n') + '\n');
	// Info-ZIP on CI; Windows' bsdtar writes zips too (-a picks the format from the extension).
	if (spawnSync('zip', ['-v'], { stdio: 'ignore' }).status === 0)
	{
		run('sh', ['-c', `zip -q -X -@ "${out}" < "${listFile}"`], { cwd });
	}
	else
	{
		// Windows' own bsdtar, by path: Git's GNU tar may come first on PATH and reads "C:" as a remote host.
		const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
		run(tar, ['-a', '-cf', out, '-T', listFile], { cwd });
	}
	fs.rmSync(listFile);
}

function packageRelease(tag, meta, delta)
{
	const dir = path.join(WORK, 'release', tag);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	for (const f of ['items.json', 'categories.tsv', 'meta.json', 'changes.json'])
	{
		fs.copyFileSync(path.join(DATA, f), path.join(dir, f));
	}
	const all = fs.readdirSync(ICONS).filter(f => f.endsWith('.png')).sort((a, b) => parseInt(a) - parseInt(b));
	zip(path.join(dir, 'icons.zip'), ICONS, all);
	const touched = [...delta.icons.added, ...delta.icons.changed].map(id => `${id}.png`);
	if (touched.length && touched.length < all.length) // the first release adds every icon; icons.zip is that zip
	{
		zip(path.join(dir, 'icons-changed.zip'), ICONS, touched);
	}

	const list = ids => ids.length ? (ids.length > 40 ? `${ids.slice(0, 40).join(', ')} … (${ids.length})` : ids.join(', ')) : 'none';
	const notes = [
		`Built from [abextm/osrs-cache ${tag}](https://github.com/abextm/osrs-cache/releases/tag/${tag}) `
			+ `(game revision ${meta.revision}) with RuneLite's cache library ${meta.runelite}.`,
		'',
		`${meta.items} item records, ${meta.icons} icons.`,
		'',
		'| | Added | Changed | Removed |',
		'| --- | --- | --- | --- |',
		`| Items | ${delta.items.added.length} | ${delta.items.changed.length} | ${delta.items.removed.length} |`,
		`| Icons | ${delta.icons.added.length} | ${delta.icons.changed.length} | ${delta.icons.removed.length} |`,
		'',
		`Icons added: ${list(delta.icons.added)}`,
		'',
		`Icons changed: ${list(delta.icons.changed)}`,
		'',
		`Icons removed: ${list(delta.icons.removed)}`,
		'',
		'`icons.zip` has every icon; `icons-changed.zip` only the added and changed ones. `changes.json` lists every id.',
	];
	fs.writeFileSync(path.join(WORK, 'release', `${tag}.md`), notes.join('\n') + '\n');
	return dir;
}

async function main()
{
	const meta0 = readJson(path.join(DATA, 'meta.json'), {});
	// Modes that work on data/ as it stands need no network; everything else starts from the newest cache.
	const offline = flag('--classify-only') || flag('--package-only');
	const tag = option('--tag') ?? (offline ? meta0.cacheTag : await latestCacheTag());

	if (flag('--fingerprint'))
	{
		const blobs = await remoteIndexBlobs(tag);
		console.log(JSON.stringify({ tag, blobs, itemsCrc: await remoteItemArchiveCrc(tag), runelite: await latestRuneLite() }));
		return;
	}
	if (flag('--check'))
	{
		const d = await decide(meta0, tag);
		output({ changed: d.changed, record: d.record === true, tag, reason: d.reason });
		return;
	}
	if (flag('--record'))
	{
		// A cache whose items, models, sprites, textures and gamevals match the current data's: the data is this tag's
		// too, so name it, without rendering or releasing anything.
		const d = await decide(meta0, tag);
		if (!d.record)
		{
			throw new Error(`${tag} can't just be recorded: ${d.reason}`);
		}
		const { date, revision } = parseTag(tag);
		const meta = {
			...meta0,
			cacheTag: tag,
			cacheDate: date,
			revision,
			builtFrom: meta0.builtFrom ?? meta0.cacheTag,
			fingerprint: { ...meta0.fingerprint, blobs: d.blobs },
		};
		fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
		console.log(`recorded ${tag}: ${d.reason}`);
		return;
	}
	if (flag('--classify-only'))
	{
		// The rules changed, the cache didn't: re-run scripts/rules.mjs over the items already here.
		const items = readJson(path.join(DATA, 'items.json'), null);
		if (!items || !meta0.cacheTag)
		{
			throw new Error('data/ holds no build to classify');
		}
		const counts = writeCategories(items, meta0.cacheTag);
		const before = JSON.stringify(meta0.categories);
		fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({ ...meta0, categories: counts }, null, '\t') + '\n');
		console.log(`categories ${JSON.stringify(counts)}${JSON.stringify(counts) === before ? ' (counts unchanged)' : ''}`);
		return;
	}
	if (flag('--package-only'))
	{
		// Re-package what's already built (a failed upload, a changed notes format) without fetching or rendering.
		const delta = readJson(path.join(DATA, 'changes.json'), null);
		if (!delta || meta0.cacheTag !== tag)
		{
			throw new Error(`data/ holds ${meta0.cacheTag ?? 'nothing'}, not ${tag}; build it first`);
		}
		console.log(`release assets -> ${packageRelease(tag, meta0, delta)}`);
		return;
	}
	if (meta0.cacheTag === tag && !flag('--force'))
	{
		console.log(`data/meta.json already names ${tag}; nothing to do (pass --force to rebuild)`);
		return;
	}

	const runelite = option('--runelite') ?? await latestRuneLite();
	console.log(`cache ${tag}, RuneLite cache library ${runelite}`);
	const cacheDir = fetchCache(tag);
	const summary = render(cacheDir, runelite);
	if (summary.failed.length)
	{
		console.warn(`warning: ${summary.failed.length} icons failed to render: ${summary.failed.join(', ')}`);
	}

	const { items, fallback } = await addEquipable(readJson(path.join(DATA, 'items.json'), null));
	const counts = writeCategories(items, tag);
	const { date, revision } = parseTag(tag);
	const meta = {
		cacheTag: tag,
		cacheDate: date,
		revision,
		builtFrom: tag,
		runelite,
		runeliteClient: await runeliteClient(),
		fingerprint: {
			blobs: localIndexBlobs(cacheDir),
			itemsCrc: itemArchiveCrc(fs.readFileSync(path.join(cacheDir, '2.flatcache'), 'utf8')),
			runelite,
		},
		items: summary.items,
		icons: summary.icons,
		iconsFailed: summary.failed,
		// Named items RuneLite's stats file doesn't list yet, whose equipable came from the cache's equip slot.
		equipableFromCache: fallback,
		categories: counts,
		copies: {
			notes: items.filter(i => i.noteOf >= 0).length,
			placeholders: items.filter(i => i.placeholderOf >= 0).length,
			bought: items.filter(i => i.boughtOf >= 0).length,
		},
	};
	fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
	const delta = changes(previousItems(), items);

	console.log(`${summary.items} items, ${summary.icons} icons; categories ${JSON.stringify(counts)}`);
	console.log(`icons +${delta.icons.added.length} ~${delta.icons.changed.length} -${delta.icons.removed.length}; `
		+ `items +${delta.items.added.length} ~${delta.items.changed.length} -${delta.items.removed.length}`);

	// A release is only worth cutting when an item or an icon changed. Otherwise meta.json still records what built
	// the data, and changes.json keeps describing the last release rather than an empty one.
	const release = [...Object.values(delta.items), ...Object.values(delta.icons)].some(list => list.length > 0);
	if (release)
	{
		fs.writeFileSync(path.join(DATA, 'changes.json'), JSON.stringify({ from: meta0.cacheTag ?? null, to: tag, ...delta }) + '\n');
	}
	else
	{
		console.log('no item or icon changed: no release');
	}
	output({ release });

	if (release && flag('--package'))
	{
		console.log(`release assets -> ${packageRelease(tag, meta, delta)}`);
	}
}

main().catch(err =>
{
	console.error(err.message);
	process.exit(1);
});
