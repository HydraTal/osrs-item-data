// The filters, shared by scripts/filter.mjs and the search page (web/app.js), so "Real items" means the same thing in
// both. Pure functions over data/items.json and data/categories.tsv: no fs, no DOM.

/** Every category scripts/rules.mjs can assign, in the order the page lists them. */
export const CATEGORIES = [
	['GAMEMODE', 'Leagues, Deadman, beta and speedrun worlds'],
	['MINIGAME', 'Gauntlet and Soul Wars in-game items'],
	['PVP', 'Last Man Standing and PvP Arena copies'],
	['POH', 'Player-owned-house furniture and props'],
	['INTERFACE', 'Guide pictures and guide quest items'],
	['GE_SET', 'Grand Exchange item-set packs'],
	['UNOBTAINABLE', 'Copies of real items players can\'t own'],
	['LEFTOVERS', 'Quest, event and interface leftovers'],
	['BOOK', 'Books, notes and maps'],
	['LAMP', 'Lamps and XP rewards'],
	['QUEST', 'Quest-only items (Destroy is their only action)'],
	['CONSUMABLE', 'One-off, raid, minigame and event food and potions; brewed ales'],
];

/** Notes, placeholders and bought copies: the same item again under another id. */
export const COPIES = [
	['noteOf', 'Bank notes'],
	['placeholderOf', 'Bank placeholders'],
	['boughtOf', 'Bought copies'],
];

export const PRESETS = {
	// Everything with a name.
	all: { hide: [], copies: COPIES.map(([k]) => k), real: true },
	// What you'd keep in a main-game bank: no category, no copies. Close to the set combo-tags' item search offers.
	real: { hide: CATEGORIES.map(([c]) => c), copies: [], real: true },
};

export function parseCategories(tsv)
{
	const byId = new Map();
	for (const line of tsv.split(/\r?\n/))
	{
		if (!line || line.startsWith('#'))
		{
			continue;
		}
		const [id, category] = line.split('\t');
		byId.set(Number(id), category);
	}
	return byId;
}

/** The id a copy stands for; the item's own id otherwise. */
export function baseOf(item)
{
	for (const [k] of COPIES)
	{
		if (item[k] >= 0)
		{
			return item[k];
		}
	}
	return item.id;
}

/** The kind of copy an item is ('noteOf', ...), or null. */
export function copyKind(item)
{
	const hit = COPIES.find(([k]) => item[k] >= 0);
	return hit ? hit[0] : null;
}

/** An item's category: its own, or for a copy, the category of the item it copies. Null when it has none. */
export function categoryOf(item, categories)
{
	return categories.get(baseOf(item)) ?? null;
}

/**
 * The items a filter keeps. Three independent switches:
 *
 * - `real`: the uncategorised base items, what you'd keep in a bank (default on)
 * - `hide`: categories to leave out; a categorised item shows unless its category is here
 * - `copies`: the copy kinds to keep (notes, placeholders, bought copies). A copy follows its own switch whatever
 *   `real` says, but still drops out with its item's category: turning `real` off and notes on lists just the notes.
 *
 * Unnamed ids (stack-size models, unused slots) are always left out.
 */
export function applyFilter(items, categories, { hide = [], copies = [], real = true } = {})
{
	const hidden = new Set(hide);
	const keptCopies = new Set(copies);
	return items.filter(item =>
	{
		if (!item.name)
		{
			return false;
		}
		const category = categoryOf(item, categories);
		if (category && hidden.has(category))
		{
			return false;
		}
		const kind = copyKind(item);
		if (kind)
		{
			return keptCopies.has(kind);
		}
		return category ? true : real;
	});
}

/**
 * Text search over a filtered list. Plain text matches the display name, "#text" the internal (gameval) name, and a
 * number the id. Names that start with the query sort first.
 */
export function search(items, query, limit = Infinity)
{
	const q = query.trim();
	if (!q)
	{
		return items.slice(0, limit);
	}
	if (/^\d+$/.test(q))
	{
		const id = Number(q);
		return items.filter(i => i.id === id);
	}
	const byKey = q.startsWith('#');
	const needle = byKey ? q.slice(1).toUpperCase() : q.toLowerCase();
	const field = byKey ? i => i.key ?? '' : i => i.name.toLowerCase();
	const hits = items.filter(i => field(i).includes(needle));
	hits.sort((a, b) => (field(b).startsWith(needle) - field(a).startsWith(needle)) || field(a).localeCompare(field(b)) || a.id - b.id);
	return hits.slice(0, limit);
}
