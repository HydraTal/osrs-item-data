# osrs-item-data

Every Old School RuneScape item's definition and inventory icon, built straight from the game cache once per game
update and released by game revision. Clone it or download a release, and look items up locally instead of asking an
API for each one.

- **All of them.** Every named item id, notes and placeholders included, with its internal (gameval) name.
- **The icons RuneLite serves.** Each icon is rendered with RuneLite's own cache library using the arguments
  `static.runelite.net` uses, and is byte-identical to its icon for the same id.
- **Small updates.** An icon whose pixels didn't change comes out byte-identical, so each game update's commit holds
  only the icons that update changed.
- **Filterable.** Every item is tagged if it's a game-mode, minigame, player-owned-house, interface, item-set,
  unobtainable or quest-only copy rather than something you'd keep in a bank. One switch gets you just the real
  items.

## What's in it

| Path | What |
| --- | --- |
| `icons/<id>.png` | One inventory icon per named item. Stackables are drawn at their largest stack, as RuneLite's are. |
| `data/items.json` | One record per item id, one record per line. |
| `data/categories.tsv` | The ids that belong to a category: id, category, internal name, display name, rule. |
| `data/meta.json` | What built this: the cache tag and game revision, the RuneLite cache library version, counts. |
| `data/changes.json` | What changed since the previous release, by id, for items and icons separately. |

A record in `items.json`:

```json
{"id":4151,"key":"ABYSSAL_WHIP","name":"Abyssal whip","icon":true,"actions":[null,"Wield",null,null,"Drop"],
 "wearPos":[3,-1,-1],"stackable":false,"members":true,"tradeable":true,"geTradeable":true,"cost":120001,
 "weight":453,"category":150,"noteOf":-1,"placeholderOf":-1,"boughtOf":-1,"params":{"1":82,"10":82,"14":4},
 "equipable":true}
```

| Field | Meaning |
| --- | --- |
| `key` | The internal name, spelled as RuneLite's `net.runelite.api.gameval.ItemID` constant. |
| `name` | Display name; `null` for ids with no name (stack-size models, unused slots), which have no icon. |
| `icon` | Whether `icons/<id>.png` exists. |
| `actions` | The five inventory options, in menu order. |
| `wearPos` | The cache's equip slots (`-1` for none). |
| `noteOf`, `placeholderOf`, `boughtOf` | For a bank note, placeholder or bought copy, the id it stands for; `-1` otherwise. |
| `category` | The cache's own item category number (not the filter categories below). |
| `params` | The cache's item parameters, by parameter id. |
| `equipable` | Whether the item can be worn, from RuneLite's equipment-stats file. |

## Getting it

- **Clone it** to have every icon on disk. Check out a release tag to stay on one game revision.
- **Download a release** if you want files, not a repo: `items.json`, `categories.tsv`, `meta.json`,
  `changes.json`, `icons.zip` (every icon) and `icons-changed.zip` (only what that update added or changed).

If a tool of yours pulls this automatically, pin a release tag, download it once per game update, and keep it. One
download of `icons.zip` replaces tens of thousands of per-icon requests to someone else's server, which is the point.

## Searching and filtering locally

```bash
node scripts/serve.mjs                   # http://localhost:5190
```

A search page served from your clone: no install, nothing fetched from anywhere else. Search by name, by
`#INTERNAL_NAME`, or by id. It opens on every item, and every box under **Copies** is a switch you can combine:

- **gen-gamemode**: every categorised item at once (or untick single categories above it)
- **real items**: the uncategorised items, what you'd keep in a main-game bank. With gen-gamemode and the copies
  off, this is close to the set [Combo Tags](https://github.com/HydraTal/combo-tags)' item search offers.
- **noteOf**, **placeholderOf**, **boughtOf**: bank notes, placeholders and bought copies

**Clear** unticks everything, so a view can be built up from single boxes: tick only **noteOf** to list every
note of a real item, or only **POH** for the house items.

The same filters, for a tool that wants a subset on disk:

```bash
node scripts/filter.mjs --preset real --out subset --icons
node scripts/filter.mjs --preset real --show CONSUMABLE --copies notes --out subset
node scripts/filter.mjs --preset real --no-real --show POH --out subset   # only the house items
```

| Category | What it holds |
| --- | --- |
| `GAMEMODE` | Leagues, Deadman, beta and speedrun worlds |
| `MINIGAME` | Gauntlet and Soul Wars in-game items |
| `PVP` | Last Man Standing and PvP Arena copies |
| `POH` | Player-owned-house furniture and props |
| `INTERFACE` | Guide pictures and guide quest items |
| `GE_SET` | Grand Exchange item-set packs |
| `UNOBTAINABLE` | Copies of real items players can't own |
| `LEFTOVERS` | Quest, event and interface leftovers |
| `BOOK` | Books, notes and maps |
| `LAMP` | Lamps and XP rewards |
| `QUEST` | Quest-only items (Destroy is their only action) |
| `CONSUMABLE` | One-off, raid, minigame and event food and potions; brewed ales |

Permanent rewards you keep in a main-game bank stay uncategorised even when they come from a game mode or minigame:
Trailblazer outfits, trophies, Victor's capes, PvP Arena imbues. The rules are in [scripts/rules.mjs](scripts/rules.mjs),
the same rules Combo Tags uses, and they match internal names first, because display names can't tell an LMS "Rune
scimitar" from the real one.

## How a release is built

This repo keeps its own item lists. [`.github/workflows/update.yml`](.github/workflows/update.yml) runs once a day.
If [abextm/osrs-cache](https://github.com/abextm/osrs-cache) has published a cache newer than `data/meta.json` names
(it publishes one per game update), it:

1. fetches only the five cache indexes the renderer reads (configs, models, sprites, textures, gamevals): a shallow,
   sparse clone of about 110 MB
2. renders every icon and dumps every definition with RuneLite's cache library (`renderer/`)
3. adds `equipable` and classifies the items (`scripts/build.mjs`, `scripts/rules.mjs`)
4. commits what changed, tags the commit with the cache's tag (`2026-10-20-rev241`), and publishes a release with
   the files above

Before any of that, it checks whether the new cache changes anything this repo is built from: the git ids of the five
index files (one API call, no download), then, if only the configs file moved, the CRC of the item archive inside it,
and the version of RuneLite's cache library. A same-day re-tag that only touched NPCs or objects is noted in
`meta.json` and nothing is rendered or released. If a render does run and no item or icon comes out different, there's
no release either.

A day without a game update costs two small requests and builds nothing. When the category rules change, the same
workflow re-runs only the classification and releases the new categories as `<tag>.<n>`.

`meta.json` records the fingerprint the check compares against, the cache tag the data was rendered from
(`builtFrom`), and RuneLite's client version and jar hashes at build time, for provenance.

The filters, rules and search page are developed in a private working repo and arrive here as one commit per change
([`scripts/release-code.mjs`](scripts/release-code.mjs)). That commit never touches `icons/` or `data/`, which only
the workflow writes.

To build locally (Java 11+ and Node 18+):

```bash
node scripts/build.mjs                       # the newest cache
node scripts/build.mjs --tag 2026-10-20-rev241 --package
```

## Sources and credit

- **The game data and sprites** come from the Old School RuneScape cache and belong to Jagex Ltd. This project is not
  affiliated with or endorsed by Jagex or RuneLite.
- **The cache** is [abextm/osrs-cache](https://github.com/abextm/osrs-cache)'s archive of every OSRS cache version.
- **Rendering and decoding** use [RuneLite](https://github.com/runelite/runelite)'s `net.runelite:cache` library
  (BSD 2-Clause).
- **`equipable`** comes from RuneLite's `static.runelite.net/item/stats.ids.min.json`. Only the flag is kept; the
  stats themselves aren't republished here.
- **The category rules** are from [Combo Tags](https://github.com/HydraTal/combo-tags).

The code in this repository is BSD 2-Clause; see [LICENSE](LICENSE), which also says what it does not cover.
