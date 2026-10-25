package osrsitemdata;

import java.awt.image.BufferedImage;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import javax.imageio.ImageIO;
import net.runelite.cache.IndexType;
import net.runelite.cache.ItemManager;
import net.runelite.cache.SpriteManager;
import net.runelite.cache.TextureManager;
import net.runelite.cache.definitions.ItemDefinition;
import net.runelite.cache.definitions.loaders.ModelLoader;
import net.runelite.cache.definitions.providers.ModelProvider;
import net.runelite.cache.fs.Archive;
import net.runelite.cache.fs.ArchiveFiles;
import net.runelite.cache.fs.FSFile;
import net.runelite.cache.fs.Index;
import net.runelite.cache.fs.Store;
import net.runelite.cache.fs.flat.FlatStorage;
import net.runelite.cache.item.ItemSpriteFactory;

/**
 * Reads an OSRS flatcache (abextm/osrs-cache's format) and writes, into the output directory:
 *
 * <ul>
 * <li>{@code icons/<id>.png}: every named item's inventory icon, rendered by RuneLite's cache library with the
 *   arguments static.runelite.net's icons are made with. PNG output is deterministic, so an icon whose pixels didn't change is byte-identical to the
 *   previous release and git sees no change.</li>
 * <li>{@code data/items.json}: one record per item id, one per line so a game update's diff is readable.</li>
 * </ul>
 *
 * <p>Only the configs (2), models (7), sprites (8), textures (9) and gamevals (24) indexes are read; the build fetches
 * just those files.
 *
 * <p>Usage: {@code Dump <flatcache dir> <output dir>}. Prints one summary line of JSON.
 */
public final class Dump
{
	// A 1px outline and the standard drop shadow, as the client draws an inventory icon. Stackables are drawn at their
	// largest stack (Coins as a pile, not one coin), which is what static.runelite.net serves: with these arguments
	// the icons are byte-identical to it. Quantity changes nothing for an item without stack models.
	private static final int QUANTITY = Integer.MAX_VALUE;
	private static final int BORDER = 1;
	private static final int SHADOW = 0x302020;
	private static final int GAMEVAL_ITEMS = 0;

	public static void main(String[] args) throws IOException
	{
		if (args.length != 2)
		{
			System.err.println("usage: Dump <flatcache dir> <output dir>");
			System.exit(2);
		}
		File cacheDir = new File(args[0]);
		File out = new File(args[1]);
		File iconDir = new File(out, "icons");
		File dataDir = new File(out, "data");
		Files.createDirectories(iconDir.toPath());
		Files.createDirectories(dataDir.toPath());

		try (Store store = new Store(new FlatStorage(cacheDir)))
		{
			store.load();

			ItemManager items = new ItemManager(store);
			items.load();
			// Notes, bought copies and placeholders take their item's name and model, as in the client.
			items.link();

			SpriteManager sprites = new SpriteManager(store);
			sprites.load();
			TextureManager textures = new TextureManager(store);
			textures.load();
			Map<Integer, String> keys = gameValNames(store, GAMEVAL_ITEMS);

			Index models = store.getIndex(IndexType.MODELS);
			ModelLoader modelLoader = new ModelLoader();
			ModelProvider modelProvider = modelId ->
			{
				Archive archive = models.getArchive(modelId);
				byte[] data = archive.decompress(store.getStorage().loadArchive(archive));
				return modelLoader.load(modelId, data);
			};

			List<ItemDefinition> defs = new ArrayList<>(items.getItems());
			defs.sort(Comparator.comparingInt(d -> d.id));

			int rendered = 0;
			List<Integer> failed = new ArrayList<>();
			File json = new File(dataDir, "items.json");
			try (Writer w = new BufferedWriter(new OutputStreamWriter(Files.newOutputStream(json.toPath()), StandardCharsets.UTF_8)))
			{
				w.write("[\n");
				boolean first = true;
				for (ItemDefinition d : defs)
				{
					boolean named = d.name != null && !d.name.equalsIgnoreCase("null") && !d.name.isEmpty();
					boolean icon = false;
					if (named)
					{
						try
						{
							BufferedImage img = ItemSpriteFactory.createSprite(items, modelProvider, sprites, textures,
								d.id, QUANTITY, BORDER, SHADOW, false);
							if (img != null)
							{
								ImageIO.write(img, "png", new File(iconDir, d.id + ".png"));
								icon = true;
								rendered++;
							}
						}
						catch (Exception | StackOverflowError ex)
						{
							failed.add(d.id);
						}
					}
					if (!first)
					{
						w.write(",\n");
					}
					first = false;
					w.write(record(d, keys.get(d.id), named, icon));
				}
				w.write("\n]\n");
			}

			System.out.println("{\"items\":" + defs.size() + ",\"icons\":" + rendered + ",\"failed\":" + failed + "}");
		}
	}

	/** The gameval names of one gameval table (items are table 0), by id. */
	private static Map<Integer, String> gameValNames(Store store, int table) throws IOException
	{
		Map<Integer, String> names = new HashMap<>();
		Index index = store.getIndex(IndexType.GAMEVALS);
		if (index == null)
		{
			return names; // a cache from before the gamevals index existed
		}
		Archive archive = index.getArchive(table);
		ArchiveFiles files = archive.getFiles(store.getStorage().loadArchive(archive));
		for (FSFile f : files.getFiles())
		{
			names.put(f.getFileId(), new String(f.getContents(), StandardCharsets.UTF_8));
		}
		return names;
	}

	/**
	 * One item as a single JSON line. {@code key} is the gameval name in RuneLite's {@code ItemID} spelling: upper case,
	 * non-identifier characters as underscores, and a leading underscore when it would start with a digit.
	 */
	private static String record(ItemDefinition d, String gameval, boolean named, boolean icon)
	{
		StringBuilder b = new StringBuilder(160);
		b.append("{\"id\":").append(d.id);
		b.append(",\"key\":").append(gameval == null ? "null" : str(constantName(gameval)));
		b.append(",\"name\":").append(named ? str(d.name) : "null");
		b.append(",\"icon\":").append(icon);
		b.append(",\"actions\":").append(strs(d.interfaceOptions));
		b.append(",\"wearPos\":[").append(d.wearPos1).append(',').append(d.wearPos2).append(',').append(d.wearPos3).append(']');
		b.append(",\"stackable\":").append(d.stackable != 0);
		b.append(",\"members\":").append(d.members);
		b.append(",\"tradeable\":").append(d.tradeable);
		b.append(",\"geTradeable\":").append(d.geTradeable);
		b.append(",\"cost\":").append(d.cost);
		b.append(",\"weight\":").append(d.weight);
		b.append(",\"category\":").append(d.category);
		// What this id is a copy of: a bank note, a placeholder, or a "bought" (trade-only) copy. -1 when it's the item.
		b.append(",\"noteOf\":").append(d.notedTemplate != -1 ? d.notedID : -1);
		b.append(",\"placeholderOf\":").append(d.placeholderTemplateId != -1 ? d.placeholderId : -1);
		b.append(",\"boughtOf\":").append(d.boughtTemplateId != -1 ? d.boughtId : -1);
		b.append(",\"params\":").append(params(d.params));
		return b.append('}').toString();
	}

	static String constantName(String gameval)
	{
		// RuneLite's generator: anything that can't be in a Java identifier ("poh_altar_marble+gilt") becomes "_".
		String upper = gameval.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9_]", "_");
		return !upper.isEmpty() && Character.isDigit(upper.charAt(0)) ? "_" + upper : upper;
	}

	private static String params(Map<Integer, Object> params)
	{
		if (params == null || params.isEmpty())
		{
			return "{}";
		}
		StringBuilder b = new StringBuilder("{");
		for (Map.Entry<Integer, Object> e : new TreeMap<>(params).entrySet())
		{
			if (b.length() > 1)
			{
				b.append(',');
			}
			b.append('"').append(e.getKey()).append("\":");
			Object v = e.getValue();
			b.append(v instanceof Number ? v.toString() : str(String.valueOf(v)));
		}
		return b.append('}').toString();
	}

	private static String strs(String[] a)
	{
		if (a == null)
		{
			return "[]";
		}
		StringBuilder b = new StringBuilder("[");
		for (int i = 0; i < a.length; i++)
		{
			if (i > 0)
			{
				b.append(',');
			}
			b.append(a[i] == null ? "null" : str(a[i]));
		}
		return b.append(']').toString();
	}

	private static String str(String s)
	{
		StringBuilder b = new StringBuilder(s.length() + 2).append('"');
		for (char c : s.toCharArray())
		{
			switch (c)
			{
				case '"':
					b.append("\\\"");
					break;
				case '\\':
					b.append("\\\\");
					break;
				case '\n':
					b.append("\\n");
					break;
				case '\r':
					b.append("\\r");
					break;
				case '\t':
					b.append("\\t");
					break;
				default:
					if (c < 0x20)
					{
						b.append(String.format("\\u%04x", (int) c));
					}
					else
					{
						b.append(c);
					}
			}
		}
		return b.append('"').toString();
	}

	private Dump()
	{
	}
}
