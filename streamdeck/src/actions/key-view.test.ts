import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { I18nProvider } from "@elgato/utils/i18n";
import { describe, expect, it } from "vitest";
import { SlotTable } from "../durability/slots";
import { slotViewFor, viewFor } from "../durability/view";
import { keyViewFor } from "./key-view";

const PLUGIN_DIR = fileURLToPath(new URL("../../com.devilcable.herodeck.sdPlugin/", import.meta.url));

const translate = (key: string): string => `<${key}>`;

/** The SDK's own translate(), fed from the plugin's real en.json / fr.json. */
function realTranslate(language: "en" | "fr"): (key: string) => string {
  const provider = new I18nProvider<"en" | "fr">(language, (lang) => JSON.parse(readFileSync(`${PLUGIN_DIR}${lang}.json`, "utf8")).Localization);
  return (key) => provider.translate(key);
}

/** A table that has seen one frame, as the plugin would just after reading it. */
function tableWith(frame: { fields: (number | null)[] }): SlotTable {
  const table = new SlotTable(() => 0);
  table.update(frame);
  return table;
}

describe("keyViewFor", () => {
  it("renders the most damaged view for item lowest", () => {
    const table = new SlotTable(() => 0);
    const frame = { fields: [42, null, null, null, null] };
    expect(keyViewFor({ showPercent: true, item: "lowest" }, frame, table, translate)).toEqual(viewFor(frame, true));
  });

  it("renders the slot view for a specific item with dot-free translation keys", () => {
    const frame = { fields: [42, 2, 87, 10, 55] };
    const view = keyViewFor({ showPercent: true, item: "wrists" }, frame, tableWith(frame), translate);
    expect(view).toEqual(slotViewFor(87, "<Wrists>", true, translate));
    expect(view.title).toBe("<Wrists>\n87%");
  });

  it("asks for the status words by their dot-free keys", () => {
    const frame = { fields: [42, 3, 254, 253, 255] };
    const table = tableWith(frame);
    expect(keyViewFor({ showPercent: true, item: "offhand" }, frame, table, translate).title).toBe("<Off hand>\n<empty>");
    expect(keyViewFor({ showPercent: true, item: "ranged" }, frame, table, translate).title).toBe("<Ranged>\n<n/a>");
  });

  it("only ever asks for keys without a dot (the SDK resolves dotted keys as nested paths)", () => {
    const asked = new Set<string>();
    const spy = (key: string): string => {
      asked.add(key);
      return key;
    };
    const frame = { fields: [42, 3, 254, 253, 255] };
    const table = tableWith(frame);
    for (const item of ["head", "shoulders", "chest", "waist", "legs", "feet", "wrists", "hands", "mainhand", "offhand", "ranged"] as const) {
      keyViewFor({ showPercent: true, item }, frame, table, spy);
    }
    expect(asked.size).toBe(13);
    for (const key of asked) expect(key).not.toContain(".");
  });

  it("shows no data for an item the table has not seen", () => {
    const table = new SlotTable(() => 0);
    const view = keyViewFor({ showPercent: true, item: "head" }, null, table, translate);
    expect(view.title).toBe("<Head>\n--");
  });
});

describe("keyViewFor with the real i18n provider and the plugin's language files", () => {
  const show = (language: "en" | "fr", item: Parameters<typeof keyViewFor>[0]["item"], fields: number[]) => {
    const frame = { fields: [42, ...fields] };
    return keyViewFor({ showPercent: true, item }, frame, tableWith(frame), realTranslate(language)).title;
  };

  it("French titles", () => {
    expect(show("fr", "mainhand", [2, 255, 255, 87])).toBe("Arme\n87%");
    expect(show("fr", "offhand", [3, 254, 255, 255])).toBe("Main G.\nvide");
    expect(show("fr", "offhand", [3, 253, 255, 255])).toBe("Main G.\nsans");
    expect(keyViewFor({ showPercent: true, item: "head" }, null, new SlotTable(() => 0), realTranslate("fr")).title).toBe("Tête\n--");
  });

  it("English titles", () => {
    expect(show("en", "mainhand", [2, 255, 255, 87])).toBe("Main hand\n87%");
    expect(show("en", "offhand", [3, 254, 255, 255])).toBe("Off hand\nempty");
    expect(show("en", "offhand", [3, 253, 255, 255])).toBe("Off hand\nn/a");
  });
});
