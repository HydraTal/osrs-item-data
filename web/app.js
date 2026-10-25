import { CATEGORIES, COPIES, PRESETS, applyFilter, categoryOf, copyKind, parseCategories, search } from '/scripts/filter-core.mjs';

const MAX_RESULTS = 300;
const STORE = 'osrs-item-search-v2'; // v1 opened on "Real items"; a fresh key so old saved state doesn't override that
const ALL_CATEGORIES = CATEGORIES.map(([c]) => c);
// One switch for every category scripts/rules.mjs assigns (combo-tags' gen-gamemode set), listed first under Copies.
const GAMEMODE = 'gamemode';
const $ = id => document.getElementById(id);

const [items, tsv, meta] = await Promise.all([
	fetch('/data/items.json').then(r => r.json()),
	fetch('/data/categories.tsv').then(r => r.text()),
	fetch('/data/meta.json').then(r => r.json()).catch(() => ({})),
]);
const categories = parseCategories(tsv);

$('meta').textContent = `Game revision ${meta.revision ?? '?'} (cache ${meta.cacheTag ?? '?'}), `
	+ `${items.length.toLocaleString()} ids, ${(meta.icons ?? 0).toLocaleString()} icons.`;

// Per-category counts over named base items, so each toggle says how much it hides.
const counts = {};
for (const item of items)
{
	if (!item.name || copyKind(item))
	{
		continue;
	}
	const c = categoryOf(item, categories);
	if (c)
	{
		counts[c] = (counts[c] ?? 0) + 1;
	}
}
const copyCounts = Object.fromEntries(COPIES.map(([k]) => [k, items.filter(i => i[k] >= 0).length]));
copyCounts[GAMEMODE] = Object.values(counts).reduce((a, b) => a + b, 0);

// Opens on everything; the game-mode set and the copies are there to untick.
let state = load() ?? { ...PRESETS.all, query: '' };

function load()
{
	try
	{
		return JSON.parse(localStorage.getItem(STORE));
	}
	catch
	{
		return null;
	}
}

function save()
{
	try
	{
		localStorage.setItem(STORE, JSON.stringify(state));
	}
	catch
	{
		// A private window or blocked storage: the page still works, it just won't remember.
	}
}

/** Checkbox rows: [key, tooltip, shown text?]. isOn may return 'mixed' for a partly-on switch. */
function toggles(container, entries, isOn, onChange, countOf)
{
	container.replaceChildren(...entries.map(([key, label, shown]) =>
	{
		const row = document.createElement('label');
		row.title = label;
		const box = document.createElement('input');
		box.type = 'checkbox';
		const on = isOn(key);
		box.checked = on === true;
		box.indeterminate = on === 'mixed';
		box.addEventListener('change', () => onChange(key, box.checked));
		const text = document.createElement('span');
		text.textContent = `${shown ?? key.replace(/Of$/, '')} `;
		const n = document.createElement('small');
		n.textContent = (countOf(key) ?? 0).toLocaleString();
		row.append(box, text, n);
		return row;
	}));
}

function renderToggles()
{
	// A ticked category is shown; unticking hides it.
	toggles($('categories'), CATEGORIES, c => !state.hide.includes(c), (c, on) =>
	{
		state.hide = on ? state.hide.filter(h => h !== c) : [...state.hide, c];
		update();
	}, c => counts[c]);
	const gamemode = [GAMEMODE, 'Every item in a category above: game-mode, minigame, POH, interface, item-set, '
		+ 'unobtainable and quest-only copies', 'gen-gamemode'];
	toggles($('copies'), [gamemode, ...COPIES], k =>
	{
		if (k === GAMEMODE)
		{
			return state.hide.length === 0 ? true : state.hide.length === ALL_CATEGORIES.length ? false : 'mixed';
		}
		return state.copies.includes(k);
	}, (k, on) =>
	{
		if (k === GAMEMODE)
		{
			state.hide = on ? [] : [...ALL_CATEGORIES];
		}
		else
		{
			state.copies = on ? [...state.copies, k] : state.copies.filter(x => x !== k);
		}
		update();
	}, k => copyCounts[k]);
}

function renderResults()
{
	const kept = applyFilter(items, categories, state);
	const hits = search(kept, state.query);
	$('count').textContent = `${hits.length.toLocaleString()} of ${kept.length.toLocaleString()} shown items match`
		+ (hits.length > MAX_RESULTS ? ` (first ${MAX_RESULTS} listed)` : '');
	$('results').replaceChildren(...hits.slice(0, MAX_RESULTS).map(item =>
	{
		const li = document.createElement('li');
		const img = document.createElement('img');
		img.loading = 'lazy';
		img.width = 36;
		img.height = 32;
		img.alt = '';
		if (item.icon)
		{
			img.src = `/icons/${item.id}.png`;
		}
		const name = document.createElement('span');
		name.className = 'name';
		name.textContent = item.name;
		const detail = document.createElement('span');
		detail.className = 'detail';
		const kind = copyKind(item);
		detail.textContent = `${item.id} · ${item.key ?? '—'}` + (kind ? ` · ${kind.replace(/Of$/, '')} of ${item[kind]}` : '');
		li.append(img, name, detail);
		const c = categoryOf(item, categories);
		if (c)
		{
			const tag = document.createElement('span');
			tag.className = 'tag';
			tag.textContent = c;
			li.append(tag);
		}
		return li;
	}));
}

function update()
{
	save();
	renderToggles();
	renderResults();
}

$('q').value = state.query;
$('q').addEventListener('input', () =>
{
	state.query = $('q').value;
	save();
	renderResults();
});
for (const button of document.querySelectorAll('[data-preset]'))
{
	button.addEventListener('click', () =>
	{
		state = { ...PRESETS[button.dataset.preset], query: state.query };
		update();
	});
}
update();
