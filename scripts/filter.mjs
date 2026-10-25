#!/usr/bin/env node
// Writes a filtered subset of the data, for a tool that only wants some of the items.
//
//   node scripts/filter.mjs --preset real --out subset --icons
//
//   --preset all|real        start from everything (default) or from main-game bank items only
//   --hide CAT[,CAT...]      also leave out these categories (see data/categories.tsv)
//   --show CAT[,CAT...]      put these categories back
//   --copies notes,placeholders,bought   keep these copy kinds (--copies none keeps none)
//   --no-real                leave out the uncategorised items, to keep only categories and copies
//   --out DIR                write DIR/items.json and DIR/ids.txt (default: print counts only)
//   --icons                  also copy each kept item's icon into DIR/icons/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CATEGORIES, PRESETS, applyFilter, categoryOf, parseCategories } from './filter-core.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name =>
{
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const list = value => (value ?? '').split(',').map(s => s.trim()).filter(Boolean);

const presetName = option('--preset') ?? 'all';
const preset = PRESETS[presetName];
if (!preset)
{
	console.error(`unknown preset ${presetName}; use ${Object.keys(PRESETS).join(' or ')}`);
	process.exit(2);
}
const known = new Set(CATEGORIES.map(([c]) => c));
for (const c of [...list(option('--hide')), ...list(option('--show'))])
{
	if (!known.has(c))
	{
		console.error(`unknown category ${c}; one of ${[...known].join(', ')}`);
		process.exit(2);
	}
}
const COPY_FLAGS = { notes: 'noteOf', placeholders: 'placeholderOf', bought: 'boughtOf' };
let copies = preset.copies;
if (option('--copies') !== undefined)
{
	const names = list(option('--copies')).filter(n => n !== 'none');
	const bad = names.filter(n => !COPY_FLAGS[n]);
	if (bad.length)
	{
		console.error(`unknown copy kind ${bad.join(', ')}; use ${Object.keys(COPY_FLAGS).join(', ')} or none`);
		process.exit(2);
	}
	copies = names.map(n => COPY_FLAGS[n]);
}
const show = new Set(list(option('--show')));
const hide = [...new Set([...preset.hide, ...list(option('--hide'))])].filter(c => !show.has(c));

const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'items.json'), 'utf8'));
const categories = parseCategories(fs.readFileSync(path.join(ROOT, 'data', 'categories.tsv'), 'utf8'));
const real = !args.includes('--no-real');
const kept = applyFilter(items, categories, { hide, copies, real });

const byCategory = {};
for (const item of kept)
{
	const c = categoryOf(item, categories) ?? '(none)';
	byCategory[c] = (byCategory[c] ?? 0) + 1;
}
console.log(`${kept.length} of ${items.length} items (preset ${presetName}; hiding ${hide.join(', ') || 'nothing'})`);
for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1]))
{
	console.log(String(n).padStart(7), c);
}

const out = option('--out');
if (out)
{
	const dir = path.resolve(out);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'items.json'), '[\n' + kept.map(i => JSON.stringify(i)).join(',\n') + '\n]\n');
	fs.writeFileSync(path.join(dir, 'ids.txt'), kept.map(i => i.id).join('\n') + '\n');
	let copied = 0;
	if (args.includes('--icons'))
	{
		fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
		for (const item of kept)
		{
			const src = path.join(ROOT, 'icons', `${item.id}.png`);
			if (item.icon && fs.existsSync(src))
			{
				fs.copyFileSync(src, path.join(dir, 'icons', `${item.id}.png`));
				copied++;
			}
		}
	}
	console.log(`wrote ${dir}${copied ? ` (${copied} icons)` : ''}`);
}
