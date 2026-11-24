import { LuaMultiReturn } from "wasmoon";
import { describe, expect, it } from "vitest";
import { ADDON_FILES, createLua, loadAddonFiles } from "../addon/tests/harness";
import { decodeField } from "../streamdeck/src/channel/decode";
import type { RGB } from "../streamdeck/src/channel/protocol";
import { SLOT_KEYS, SlotTable, type SlotKey, type SlotValue } from "../streamdeck/src/durability/slots";

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** slot id -> [item id, current, max]; no current/max = equipped without durability; absent = empty. */
const INVENTORY: Record<number, [number] | [number, number, number]> = {
  1: [10, 87, 100],
  3: [11, 0, 50],
  5: [12, 100, 100],
  6: [13, 49, 100],
  7: [14, 296, 1000],
  8: [15, 50, 100],
  9: [16, 19, 100],
  // 10 (hands): empty
  16: [17, 20, 100],
  17: [18], // off hand without durability
  // 18 (ranged): empty
};

const EXPECTED: Record<SlotKey, SlotValue> = {
  head: 87,
  shoulders: 0,
  chest: 100,
  waist: 49,
  legs: 29,
  feet: 50,
  wrists: 19,
  hands: "empty",
  mainhand: 20,
  offhand: "none",
  ranged: "empty",
};

describe("Lua slot pages to TypeScript slot table", () => {
  it("the 4 pages shown by Slots:ShowPage fill the table with the 11 slot values", async () => {
    const lua = await createLua({
      GetInventoryItemID: (_unit: string, slot: number) => INVENTORY[slot]?.[0],
      GetInventoryItemDurability: (slot: number) => {
        const entry = INVENTORY[slot];
        return entry && entry.length === 3 ? LuaMultiReturn.of(entry[1], entry[2]) : undefined;
      },
    });
    try {
      await loadAddonFiles(lua, ADDON_FILES);
      // One Lua call: draw every page on a bare host frame and read cells 4..13 (fields 0..4) after each.
      const flat = (await lua.doString(`
        local ns = HeroDeckNS
        ns.Channel:Init(CreateFrame("Frame", nil, UIParent))
        ns.Channel:Register(0)
        ns.Channel:SetByte(0, 42)
        ns.Slots:Start()
        local out = {}
        for page = 0, 3 do
          ns.Slots:ShowPage(page)
          for i = 4, 13 do
            local c = ns.Channel.cells[i].color
            out[#out + 1] = c.r
            out[#out + 1] = c.g
            out[#out + 1] = c.b
          end
        end
        return out
      `)) as number[];
      expect(flat).toHaveLength(4 * 10 * 3);

      let now = 0;
      const table = new SlotTable(() => now);
      for (let page = 0; page < 4; page++) {
        const cells: RGB[] = [];
        for (let i = 0; i < 10; i++) {
          const o = (page * 10 + i) * 3;
          cells.push({ r: flat[o], g: flat[o + 1], b: flat[o + 2] });
        }
        const fields: (number | null)[] = [];
        for (let n = 0; n < 5; n++) {
          fields.push(decodeField(cells[2 * n], cells[2 * n + 1], WHITE, BLACK));
        }
        expect(fields.slice(0, 2), `page ${page}`).toEqual([42, page]);
        now += 1000;
        table.update({ fields });
      }

      const actual = Object.fromEntries(SLOT_KEYS.map((key) => [key, table.value(key)]));
      expect(actual).toEqual(EXPECTED);
    } finally {
      lua.global.close();
    }
  });
});
