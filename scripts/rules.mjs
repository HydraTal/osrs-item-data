// The item categories: which ids are game-mode, minigame, player-owned-house, interface, item-set, unobtainable or
// quest-only copies rather than items you'd keep in a bank. Each item gets the first rule it matches.
//
// The rules are combo-tags' scripts/gen-gamemode-items.mjs (github.com/HydraTal/combo-tags), unchanged: they match
// Jagex's internal item names (the cache's gamevals), because display names can't tell an LMS "Rune scimitar" from
// the real one, then inventory actions for items that are neither wearable nor consumable. Keep the two in step.
//
// Only base items are classified. A note, placeholder or bought copy takes its item's category (see itemCategory).

const READ_ACTIONS = new Set(['Read', 'Study', 'Look-at', 'Inspect', 'Check steps']);
const QUIET_ACTIONS = new Set(['Destroy', 'Use', 'Examine']);

/** A note, placeholder or bought copy of another item, rather than the item itself. */
export const isCopy = i => i.noteOf >= 0 || i.placeholderOf >= 0 || i.boughtOf >= 0;

/** The item a copy stands for (itself if it isn't one). */
export const baseOf = i => i.noteOf >= 0 ? i.noteOf : i.placeholderOf >= 0 ? i.placeholderOf : i.boughtOf >= 0 ? i.boughtOf : i.id;

/**
 * Classifies every named base item. Returns the rules ({ category, label }) and a Map of id -> rule index for the
 * items that matched one.
 */
export function classify(items)
{
	const named = items.filter(i => i.name && i.name !== 'Null' && i.key && !isCopy(i));
	// Display names of items outside the PvP Arena, for "is this PVPA_ item a copy of a normal item?".
	const normalNames = new Set(named.filter(i => !i.key.startsWith('PVPA_')).map(i => i.name.toLowerCase()));
	const actionsOf = i => (i.actions ?? []).filter(Boolean);
	const isConsumable = i => actionsOf(i).some(a => /^(eat|drink)$/i.test(a));
	// "Wearable" is items.json's equipable: RuneLite's equipment-stats file, as combo-tags reads it. The cache's equip
	// slot disagrees both ways (no slot on the Snowman ring, a slot on CERT_ display copies), so it's only a fallback.
	const isMisc = i => !(i.equipable ?? i.wearPos[0] >= 0) && !isConsumable(i);

	const RULES = [
		// ---- GAMEMODE: league / deadman / beta / speedrun worlds
		['GAMEMODE', 'point counters (display as "Cabbage")', i => /(^|_)(LEAGUE(_\d)?|TRAILBLAZER(_RELOADED)?|TWISTED|DEADMAN|GRIDMASTER|SPEEDRUN)_POINTS(_NEGATIVE)?$|^SPEEDRUN_TROPHIES_/.test(i.key)],
		['GAMEMODE', 'league scroll boxes', i => /^LEAGUE_CLUE_BOX_/.test(i.key)],
		// Shattered Relics sigils (attuned and unattuned); every SIGIL_OF_* key is one, no main-game item shares the prefix.
		['GAMEMODE', 'league sigils', i => /^SIGIL_OF_/.test(i.key)],
		['GAMEMODE', 'league relic / league-world tools', i => new RegExp('^(' + [
			'LEAGUE_TRAILBLAZER_(FAIRYS_FLIGHT|LAST_RECALL)_TELEPORT', 'LEAGUE_SECOND_INVENTORY(_OPEN)?',
			'LEAGUE_TRAILBLAZER_(AXE|PICKAXE|HARPOON)', 'LEAGUE_TOMATO', 'LEAGUE_3_FRAGMENT_.*', 'LEAGUE_3_KEY_AREA_TELEPORT',
			'LEAGUE_3_MAGIC_BOOK', 'LEAGUE_3_CARDTHROW', 'LEAGUE_TRAILBLAZER_GLOBETROTTER_NECKLACE', 'LEAGUE_BANKERS_NOTE',
			'LEAGUE_GUARDIAN_SUMMON', 'LEAGUE_RELIC_AGILITY_BOOTS', 'LEAGUE_EXECUTIONER_WEAPON', 'LEAGUE_RUINOUS_POWERS_BOOK',
			'LEAGUE_BANK_HEIST_TELEPORT', 'LEAGUE_CLUE_COMPASS_TELEPORT', 'LEAGUE_RELIC_POCKET_KINGDOM_ITEM',
			'LEAGUES_MEGARARE_VOUCHER', 'LEAGUE_BARBARIAN_ARM', 'LEAGUE_EVIL_EYE_NECKLACE', 'LEAGUE_TRANSMUTE_BOOK',
			'LEAGUE_SOUL_SHARD', 'LEAGUE_AGILITY_MAP', 'LEAGUE_CLUE_CONTRACT', 'LEAGUE_BUTLERS_BELL',
			'LEAGUE_FLASK_OF_FERVOUR(_EMPTY)?', 'LEAGUE_6_DEMONIC_QUILL', 'LEAGUE_6_THRALL_CONTRACT',
		].join('|') + ')$').test(i.key)],
		// Deadman-world items, except the permanent cosmetics and unlock scrolls you keep after the season, and the
		// "(Deadman)" versions those scrolls make of main-game items ("Voidwaker (Deadman)", "Imbued Zamorak cape
		// (Deadman)"). The deadman-world copies of gear are "Corrupted ..." (DEADMAN_BLIGHTED_*) and stay excluded.
		['GAMEMODE', 'deadman-world items', i => /^DEADMAN/.test(i.key)
			&& !/^DEADMAN_(BODY|LEGS|CAPE|RUG|SKULL)$|^DEADMAN_20\d\d_(WEAPON_ORNAMENT|CAPE_ORNAMENT|POH_ORNAMENT|HOME_TELEPORT)_SCROLL$/.test(i.key)
			&& !/ \(Deadman\)$/.test(i.name)],
		['GAMEMODE', 'beta-world copies', i => /^(BETA_|WBR_)/.test(i.key)],
		['GAMEMODE', 'speedrun / PvP tutorial worlds', i => /^(SPEEDY_TELEPORT_SCROLL|PVPTUT_.*)$/.test(i.key)],
	
		// ---- MINIGAME: items that never leave their minigame
		// The Gauntlet's crystal and corrupted gear, tools and resources (and the Raging Echoes copy of its perfected
		// dagger, ECHO_GAUNTLET_*). The Gauntlet cape is a reward you keep; the Youngllef pets are GAUNTLETPET, no match.
		['MINIGAME', 'Gauntlet items (GAUNTLET_), not the Gauntlet cape',
			i => /GAUNTLET_/.test(i.key) && i.key !== 'GAUNTLET_CRYSTALLINE_CAPE'],
		// Soul Wars in-game items by id: team capes, bones, bandages, barricades, potions and the 33 team icons. Its
		// rewards come after the range (Ectoplasmator 25340, Spoils of War 25342) and stay.
		['MINIGAME', 'Soul Wars in-game items and team icons (ids 25195-25243)', i => i.id >= 25195 && i.id <= 25243],
	
		// ---- PVP: Last Man Standing and PvP Arena
		// LMS gear never leaves the minigame; its reward-shop items (Victor's capes, the Deadman's set) are kept.
		['PVP', 'Last Man Standing items', i => /^BR_/.test(i.key) && !/^BR_(CAPE_\d+|DEADMAN_.*)$/.test(i.key)],
		// PvP Arena: its imbues are real ("Slayer helmet (i)" PVPA_SLAYER_HELM_I, "Salve amulet(ei)") and stay, as imbue
		// variants beside their Nightmare Zone / Soul Wars twins. The rest are rewards that failed their poll (Saika's,
		// Koriff's, Maoma's and Calamity armour, Wristbands of the Arena, ornament kits) or loadout copies (Rune pouch).
		['PVP', 'PvP Arena items, except its imbues',
			i => /^PVPA_/.test(i.key) && !(/\([er]?i\d*\)$/i.test(i.name) && normalNames.has(i.name.toLowerCase()))],
		// What the PvP Arena's ornament kits would have made. Not PVPA_ themselves: DRAGON_CLAWS_ORNAMENT,
		// BANDOS_CHESTPLATE_ORNAMENT, ELDERCHAOS_TOP_PRETTY, DAGONHAI_HAT_PRETTY.
		['PVP', 'PvP Arena ornament-kit items (Dragon claws, warhammer, Heavy ballista, Elder maul, Armadyl, Bandos, Elder chaos, Dagon\'hai (or))',
			i => /^(DRAGON_CLAWS|DRAGON_WARHAMMER|HEAVY_BALLISTA|ELDER_MAUL|ARMADYL_(HELMET|CHESTPLATE|SKIRT)|BANDOS_(CHESTPLATE|SKIRT|BOOTS))_ORNAMENT$|^(ELDERCHAOS_(TOP|BOTTOM|HOOD)|DAGONHAI_(HAT|ROBE_TOP|ROBE_BOTTOM))_PRETTY$/.test(i.key)],
	
		// ---- POH: player-owned-house items: furniture and other interactables, interface items, games-room props, kitchen
		// drinks and single-use blueprints. The heraldry room's helms, kiteshields and banners are real gear and stay.
		['POH', 'player-owned-house items (not the heraldic helms, kiteshields and banners)',
			i => /(^|_)POH(_|$)/.test(i.key) && !/^POH_(HELMET|SHIELD|BANNER)_/.test(i.key)],
	
		// ---- INTERFACE: guide pictures that only exist inside an interface: the skill guides (SAILING_SKILLGUIDE_*,
		// SEEDS_SKILLGUIDE), SLAYERGUIDE_*, HUNTGUIDE_*, PICKPOCKET_GUIDE_*, plus Recipe for Disaster's guide-cake quest
		// items and their display dummies (_100GUIDE_*: Cake of Guidance, Enchanted egg, the _DUM rune and seed pictures).
		['INTERFACE', 'guide pictures and guide quest items', i => /SKILLGUIDE|GUIDE_/.test(i.key)],
	
		// ---- GE_SET: Grand Exchange item-set packs (Dharok's armour set, Dwarf cannon set), opened into their pieces
		['GE_SET', 'Grand Exchange item sets', i => /^SET_/.test(i.key)],
	
		// ---- UNOBTAINABLE: copies of real items players can't own, under the real item's exact name
		// The rest of ROTTEN_* is real rotten food (Rotten tomato, Rotten stymphike tartare), so the copies are listed.
		['UNOBTAINABLE', "ROTTEN_* copies (Scythe of Vitur, Armadyl godsword, Rubber chicken, Dinh's blazing bulwark, Venator bow)",
			i => /^ROTTEN_(SCYTHE|AGS|CHICKEN|DINHS_BULWARK|VENATOR_BOW)$/.test(i.key)],
		// FAKE_* copies of Coins, the runes, the arrows and Wine of Zamorak. Prefix only: "Fake man" (EADGAR_FAKE_MAN),
		// "Fake beak" and the Easter fake eggs are items in their own right.
		['UNOBTAINABLE', 'FAKE_* copies (Coins, runes, arrows, Wine of Zamorak)', i => /^FAKE_/.test(i.key)],
	
		// ---- LEFTOVERS: quest, event and interface families by internal-name prefix: EYEGLO_ (quest shapes), PATTERN_
		// (interface pictures), RAG_ (Rag and Bone Man bones), EASTER17_ and XM21_ (event items), CERT_ (reused ids shown as
		// diary rewards and other pictures). Anything wearable or consumable stays: the Ram skull helm, Bonesack, Easter egg
		// helm, Festive elf hat and slippers, Snowman ring and Secret santa presents are rewards you keep.
		['LEFTOVERS', 'quest / event / interface prefixes (EYEGLO_ PATTERN_ RAG_ EASTER17_ XM21_ CERT_), not wearable or consumable',
			i => /^(EYEGLO|PATTERN|RAG|EASTER17|XM21|CERT)_/.test(i.key) && isMisc(i)],
	
		// ---- MISC: by inventory action, only for items that are neither wearable nor consumable (untradeable gear such
		// as the Fire cape also has Destroy instead of Drop). Quest-only means Destroy and nothing else to do with it, so
		// pouches, sacks and keys with other actions stay.
		['BOOK', 'books, notes and maps (Read, Study, Look-at, Inspect, Check steps)',
			i => isMisc(i) && actionsOf(i).some(a => READ_ACTIONS.has(a))],
		['LAMP', 'lamps and XP rewards (Rub)', i => isMisc(i) && actionsOf(i).includes('Rub')],
		['QUEST', 'quest-only items (Destroy is their only action)',
			i => isMisc(i) && actionsOf(i).includes('Destroy') && actionsOf(i).every(a => QUIET_ACTIONS.has(a))],
	
		// ---- CONSUMABLE: food and potions you can't bank or that never leave their activity. The Nightmare Zone potions
		// (NZONE*: Absorption, Overload, Super magic/ranging) bank, so they stay.
		['CONSUMABLE', 'untradeable consumables (Destroy, no Drop): Sailing bottles, quest and one-off food and potions',
			i => isConsumable(i) && actionsOf(i).includes('Destroy') && !actionsOf(i).includes('Drop')],
		['CONSUMABLE', 'raid and minigame supplies (RAIDS_ TOA_ GAUNTLET_ WINT_ SOUL_WARS_ PEST_ CASTLEWARS)',
			i => isConsumable(i) && /^(RAIDS|TOA|GAUNTLET|WINT|SOUL_WARS|PEST|CASTLEWARS)_|^_\dDOSE_CASTLEWARS/.test(i.key)],
		['CONSUMABLE', 'holiday event treats (HW*, EASTER*, XMAS*, XM*, OS_)',
			i => isConsumable(i) && /^(HW\d*|EASTER\d*|XMAS\d*|XM\d+|OS)_/.test(i.key)],
		// The brewery's ten drinks, every version: the plain drink, mature (m) and the kegs (KEG_ / KEG_MATURE_ ..._1-4).
		// Trouble Brewing's BREW_ items (Rum, the monkeys, naval clothes) aren't ales and stay.
		['CONSUMABLE', 'brewed ales and their mature and keg versions',
			i => /^(KEG_)?(MATURE_)?(ASGARNIAN_ALE|AXEMANS_FOLLY|CHEFS_DELIGHT|CIDER|DRAGON_BITTER|DWARVEN_STOUT|GREENMANS_ALE|WIZARDS_MIND_BOMB|MOONLIGHT_MEAD|SLAYERS_RESPITE)(_\d)?$/.test(i.key)],
	];

	const byId = new Map();
	for (const item of named)
	{
		const at = RULES.findIndex(([, , test]) => test(item));
		if (at >= 0)
		{
			byId.set(item.id, at);
		}
	}
	return { rules: RULES.map(([category, label]) => ({ category, label })), byId };
}
