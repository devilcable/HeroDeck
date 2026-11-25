import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SLOT_KEYS } from "../streamdeck/src/durability/slots";
// @ts-expect-error plain ES module script without type declarations
import { PALETTES, SLOTS, STATES, iconFiles, svgFor } from "../tools/make-slot-icons.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_DIR = join(ROOT, "streamdeck", "com.devilcable.herodeck.sdPlugin", "imgs", "actions", "durability");

describe("slot icons", () => {
  it("covers exactly the plugin's slots", () => {
    expect(SLOTS).toEqual([...SLOT_KEYS]);
  });

  it("keeps today's palettes", () => {
    expect(STATES).toEqual(["ok", "warn", "critical", "nodata"]);
    expect(PALETTES).toEqual({
      ok: { bg: "#000000", fg: "#E8E8E8" },
      warn: { bg: "#F2C200", fg: "#1A1A1A" },
      critical: { bg: "#C8102E", fg: "#E8E8E8" },
      nodata: { bg: "#4A4A4A", fg: "#8A8A8A" },
    });
  });

  it("lists one generic file per state and one file per slot and state", () => {
    const paths: string[] = iconFiles().map((file: { path: string }) => file.path);
    expect(paths).toHaveLength(48);
    expect(new Set(paths).size).toBe(48);
    for (const state of STATES) {
      expect(paths).toContain(`${state}.svg`);
      for (const slot of SLOTS) expect(paths).toContain(`${slot}/${state}.svg`);
    }
  });

  it("paints the background and the drawing in the state colors", () => {
    for (const state of STATES) {
      const svg: string = svgFor("head", state);
      expect(svg).toContain(`<rect width="144" height="144" fill="${PALETTES[state].bg}"/>`);
      expect(svg).toContain(PALETTES[state].fg);
      expect(svg.endsWith("</svg>\n")).toBe(true);
    }
  });

  it("draws a different item for every slot, the chest being today's armor", () => {
    expect(new Set(SLOTS.map((slot: string) => svgFor(slot, "ok"))).size).toBe(11);
    for (const state of STATES) expect(svgFor("chest", state)).toBe(svgFor("armor", state));
  });

  it("matches the files on disk (run `npm run slot-icons` after a change)", () => {
    for (const { path, svg } of iconFiles() as { path: string; svg: string }[]) {
      const onDisk = readFileSync(join(ICON_DIR, path), "utf8").replace(/\r\n/g, "\n");
      expect(onDisk, path).toBe(svg);
    }
  });
});
