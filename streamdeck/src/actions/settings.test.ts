import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { settingsFrom } from "./settings";

const PLUGIN_DIR = fileURLToPath(new URL("../../com.devilcable.herodeck.sdPlugin/", import.meta.url));

function localization(lang: "en" | "fr"): Record<string, string> {
  return JSON.parse(readFileSync(`${PLUGIN_DIR}${lang}.json`, "utf8")).Localization;
}

describe("settingsFrom", () => {
  it("defaults to the percent shown and the most damaged item", () => {
    expect(settingsFrom({})).toEqual({ showPercent: true, item: "lowest" });
  });

  it("keeps a valid item and an explicit showPercent", () => {
    expect(settingsFrom({ item: "mainhand", showPercent: false })).toEqual({ showPercent: false, item: "mainhand" });
  });

  it("falls back to lowest for an unknown item", () => {
    expect(settingsFrom({ item: "ring" }).item).toBe("lowest");
  });

  it("accepts every slot key", () => {
    for (const item of ["head", "shoulders", "chest", "waist", "legs", "feet", "wrists", "hands", "mainhand", "offhand", "ranged"]) {
      expect(settingsFrom({ item }).item).toBe(item);
    }
  });
});

const EXPECTED_FR: Record<string, string> = {
  Item: "Pièce",
  "Most damaged": "La plus abîmée",
  "Show percentage": "Afficher le pourcentage",
  empty: "vide",
  "n/a": "sans",
  Head: "Tête",
  Shoulders: "Épaules",
  Chest: "Torse",
  Waist: "Taille",
  Legs: "Jambes",
  Feet: "Pieds",
  Wrists: "Poignets",
  Hands: "Mains",
  "Main hand": "Arme",
  "Off hand": "Main G.",
  Ranged: "Distance",
};

const EXPECTED_EN: Record<string, string> = {
  Item: "Item",
  "Most damaged": "Most damaged",
  "Show percentage": "Show percentage",
  empty: "empty",
  "n/a": "n/a",
  Head: "Head",
  Shoulders: "Shoulders",
  Chest: "Chest",
  Waist: "Waist",
  Legs: "Legs",
  Feet: "Feet",
  Wrists: "Wrists",
  Hands: "Hands",
  "Main hand": "Main hand",
  "Off hand": "Off hand",
  Ranged: "Ranged",
};

describe("localization files", () => {
  it("en.json and fr.json define every Localization key", () => {
    expect(localization("en")).toEqual(EXPECTED_EN);
    expect(localization("fr")).toEqual(EXPECTED_FR);
  });

  it("Localization is flat with dot-free keys (the SDK resolves a dotted key as a nested path)", () => {
    for (const lang of ["en", "fr"] as const) {
      for (const [key, value] of Object.entries(localization(lang))) {
        expect(key, `key ${key}`).not.toContain(".");
        expect(typeof value, `value of ${key}`).toBe("string");
      }
    }
  });

  it("the property inspector only uses labels that are Localization keys", () => {
    const html = readFileSync(`${PLUGIN_DIR}ui/durability.html`, "utf8");
    const labels = [
      ...[...html.matchAll(/<sdpi-item label="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]),
    ];
    expect(labels.length).toBe(14);
    for (const label of labels) {
      expect(Object.keys(EXPECTED_EN)).toContain(label);
    }
  });

  it("the property inspector keeps plain Localization texts, not __MSG_ strings", () => {
    // sdpi-components v4 resolves __MSG_key__ only from SDPIComponents.i18n.locales, which it never loads from
    // the plugin's <lang>.json; without that table it would show the raw "__MSG_key__" text.
    const html = readFileSync(`${PLUGIN_DIR}ui/durability.html`, "utf8");
    expect(html).not.toContain("__MSG_");
  });

  it("the property inspector offers the item values in order", () => {
    const html = readFileSync(`${PLUGIN_DIR}ui/durability.html`, "utf8");
    const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(values).toEqual([
      "lowest", "head", "shoulders", "chest", "waist", "legs", "feet", "wrists", "hands", "mainhand", "offhand", "ranged",
    ]);
  });
});
