import { LuaMultiReturn, type LuaEngine } from "wasmoon";
import { describe, expect, it } from "vitest";
import { decodeField } from "../../streamdeck/src/channel/decode";
import { ADDON_FILES, createLua, loadAddonFiles } from "./harness";

type Rgb = { r: number; g: number; b: number };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const IDLE: Rgb = { r: 48, g: 48, b: 48 };

/** Per-test inventory: slot -> [item id, current, max]; current/max absent = no durability. */
type Inventory = Record<number, [number] | [number, number, number]>;

const itemIdFor = (inventory: Inventory) => (_unit: string, slot: number) => inventory[slot]?.[0];
const durabilityFor = (inventory: Inventory) => (slot: number) => {
  const entry = inventory[slot];
  return entry && entry.length === 3 ? LuaMultiReturn.of(entry[1], entry[2]) : undefined;
};

async function withAddon<T>(
  fn: (lua: LuaEngine) => Promise<T>,
  inventory: Inventory = {},
): Promise<T> {
  const lua = await createLua({
    GetInventoryItemID: itemIdFor(inventory),
    GetInventoryItemDurability: durabilityFor(inventory),
  });
  try {
    await loadAddonFiles(lua, ADDON_FILES);
    return await fn(lua);
  } finally {
    lua.global.close();
  }
}

/** Lua: init the channel on a bare host frame (no minimap button), then start the slots. */
const INIT_AND_START = `
  local host = CreateFrame("Frame", nil, UIParent)
  HeroDeckNS.Channel:Init(host)
  HeroDeckNS.Channel:Register(0)
  HeroDeckNS.Slots:Start()
`;

const fire = (lua: LuaEngine, event: string) =>
  lua.doString(`
    for _, f in ipairs(__frames) do
      if f.events["${event}"] then f.scripts.OnEvent(f, "${event}") end
    end
  `);

/** Colors of cells 6..13 (fields 1..4) as they are drawn right now. */
async function fieldCells(lua: LuaEngine): Promise<Rgb[]> {
  return (await lua.doString(`
    local out = {}
    for i = 6, 13 do
      local c = HeroDeckNS.Channel.cells[i].color
      out[#out + 1] = { r = c.r, g = c.g, b = c.b }
    end
    return out
  `)) as Rgb[];
}

/** Decoded bytes of fields 1..4 (null where the cells do not decode). */
async function fieldBytes(lua: LuaEngine): Promise<(number | null)[]> {
  const cells = await fieldCells(lua);
  const bytes: (number | null)[] = [];
  for (let n = 0; n < 4; n++) {
    bytes.push(decodeField(cells[2 * n], cells[2 * n + 1], WHITE, BLACK));
  }
  return bytes;
}

const tick = (lua: LuaEngine) =>
  lua.doString("local t = __tickers[1]; t.callback(t)");

describe("Slots.Value", () => {
  const value = async (inventory: Inventory, slot: number) =>
    withAddon(async (lua) => {
      lua.global.set("slot", slot);
      return (await lua.doString(`
        return HeroDeckNS.Slots.Value(slot,
          function(s) return GetInventoryItemID("player", s) end,
          GetInventoryItemDurability)
      `)) as number;
    }, inventory);

  it("floors current * 100 / max", async () => {
    expect(await value({ 1: [100, 58, 100] }, 1)).toBe(58);
    expect(await value({ 1: [100, 296, 1000] }, 1)).toBe(29);
    expect(await value({ 1: [100, 0, 80] }, 1)).toBe(0);
  });

  it("empty off hand gives 254", async () => {
    expect(await value({}, 17)).toBe(254);
  });

  it("item without durability gives 253", async () => {
    expect(await value({ 17: [4000] }, 17)).toBe(253);
    expect(await value({ 17: [4000, 0, 0] }, 17)).toBe(253);
  });
});

describe("Slots.PageBytes", () => {
  it("page 3 has a third value of 255", async () => {
    await withAddon(async (lua) => {
      const bytes = (await lua.doString(`
        local a, b, c = HeroDeckNS.Slots.PageBytes(3,
          function(s) return GetInventoryItemID("player", s) end,
          GetInventoryItemDurability)
        return { a, b, c }
      `)) as number[];
      expect(bytes).toEqual([254, 254, 255]);
    });
  });

  it("page 2 reads slots 9, 10, 16 in that order", async () => {
    await withAddon(async (lua) => {
      const calls = (await lua.doString(`
        local calls = {}
        local function itemAt(s) calls[#calls + 1] = s; return 1 end
        HeroDeckNS.Slots.PageBytes(2, itemAt, function() return 50, 100 end)
        return calls
      `)) as number[];
      expect(calls).toEqual([9, 10, 16]);
    });
  });

  it("returns the slot values of the page", async () => {
    await withAddon(
      async (lua) => {
        const bytes = (await lua.doString(`
          local a, b, c = HeroDeckNS.Slots.PageBytes(0,
            function(s) return GetInventoryItemID("player", s) end,
            GetInventoryItemDurability)
          return { a, b, c }
        `)) as number[];
        expect(bytes).toEqual([87, 253, 254]);
      },
      { 1: [10, 87, 100], 3: [11] },
    );
  });

  it("constants and page table", async () => {
    await withAddon(async (lua) => {
      expect(
        await lua.doString(`
          local S = HeroDeckNS.Slots
          return { S.NO_DURABILITY, S.EMPTY, S.UNUSED, S.PAGE_FIELD, S.FIRST_SLOT_FIELD,
            #S.PAGES, S.PAGES[1][1], S.PAGES[2][3], S.PAGES[3][3], S.PAGES[4][2], S.PAGES[4][3] == nil and 1 or 0 }
        `),
      ).toEqual([253, 254, 255, 1, 2, 4, 1, 8, 16, 18, 1]);
    });
  });
});

describe("Slots:Start", () => {
  it("registers fields 1-4 and draws nothing before the first tick", async () => {
    await withAddon(async (lua) => {
      await lua.doString(INIT_AND_START);
      expect(await lua.doString("return { HeroDeckNS.Channel.fields[1], HeroDeckNS.Channel.fields[2], HeroDeckNS.Channel.fields[3], HeroDeckNS.Channel.fields[4] }")).toEqual([true, true, true, true]);
      expect(await lua.doString("return #__tickers")).toBe(1);
      expect(await lua.doString("return __tickers[1].seconds")).toBe(1);
      expect(await fieldCells(lua)).toEqual(Array(8).fill(IDLE));
    });
  });

  it("ticks show pages 0,1,2,3,0", async () => {
    await withAddon(async (lua) => {
      await lua.doString(INIT_AND_START);
      const pages: (number | null)[] = [];
      for (let i = 0; i < 5; i++) {
        await tick(lua);
        pages.push((await fieldBytes(lua))[0]);
      }
      expect(pages).toEqual([0, 1, 2, 3, 0]);
    });
  });

  it("each tick draws the slot values of its page in fields 2-4", async () => {
    await withAddon(
      async (lua) => {
        await lua.doString(INIT_AND_START);
        const seen: (number | null)[][] = [];
        for (let i = 0; i < 4; i++) {
          await tick(lua);
          seen.push(await fieldBytes(lua));
        }
        expect(seen).toEqual([
          [0, 87, 253, 254],
          [1, 100, 0, 254],
          [2, 254, 254, 40],
          [3, 254, 254, 255],
        ]);
      },
      { 1: [10, 87, 100], 3: [11], 6: [12, 100, 100], 7: [13, 0, 50], 16: [14, 40, 100] },
    );
  });

  it("recomputes from the current gear each time a page is shown", async () => {
    const inventory: Inventory = { 1: [10, 87, 100], 3: [11, 50, 100] };
    await withAddon(async (lua) => {
      await lua.doString(INIT_AND_START);
      await tick(lua); // page 0
      expect((await fieldBytes(lua)).slice(0, 3)).toEqual([0, 87, 50]);
      // gear changes while the other pages are shown: head worn down, shoulders unequipped
      inventory[1] = [10, 12, 100];
      delete inventory[3];
      for (let i = 0; i < 3; i++) await tick(lua); // pages 1, 2, 3
      await tick(lua); // page 0 again
      expect((await fieldBytes(lua)).slice(0, 3)).toEqual([0, 12, 254]);
    }, inventory);
  });

  it("Start twice creates one ticker", async () => {
    await withAddon(async (lua) => {
      await lua.doString(INIT_AND_START);
      await lua.doString("HeroDeckNS.Slots:Start()");
      expect(await lua.doString("return #__tickers")).toBe(1);
    });
  });
});

describe("login", () => {
  it("calls Slots:Start after registering field 0", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`
        local ns = HeroDeckNS
        __log = {}
        local registerOrig = ns.Channel.Register
        ns.Channel.Register = function(self, field)
          __log[#__log + 1] = "register " .. field
          return registerOrig(self, field)
        end
        local startOrig = ns.Slots.Start
        ns.Slots.Start = function(self)
          __log[#__log + 1] = "slots start"
          return startOrig(self)
        end
      `);
      await fire(lua, "PLAYER_LOGIN");
      expect(await lua.doString("return __log")).toEqual([
        "register 0",
        "slots start",
        "register 1",
        "register 2",
        "register 3",
        "register 4",
      ]);
      expect(await lua.doString("return #__tickers")).toBe(1);
    });
  });
});
