import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LuaMultiReturn, type LuaEngine } from "wasmoon";
import { describe, expect, it } from "vitest";
import { ADDON_FILES, createLua, loadAddonFiles } from "./harness";

type Rgb = [number, number, number];
interface Vectors {
  fields: { value: number; cells: [Rgb, Rgb] }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "vectors", "channel-v2.json"),
    "utf8",
  ),
);

type Slots = Record<number, [number, number]>;

/** The JS slot table as the Lua function `readSlot(slot) -> current, max | nil`. */
function readSlotFor(slots: Slots) {
  return (slot: number) => {
    const entry = slots[slot];
    return entry ? LuaMultiReturn.of(entry[0], entry[1]) : undefined;
  };
}

async function withAddon<T>(
  fn: (lua: LuaEngine) => Promise<T>,
  mocks: Record<string, unknown> = {},
): Promise<T> {
  const lua = await createLua(mocks);
  try {
    await loadAddonFiles(lua, ADDON_FILES);
    return await fn(lua);
  } finally {
    lua.global.close();
  }
}

async function compute(slots: Slots): Promise<number> {
  return withAddon(async (lua) => {
    lua.global.set("readSlot", readSlotFor(slots));
    return (await lua.doString("return HeroDeckNS.Durability.Compute(readSlot)")) as number;
  });
}

/** Fire an event on every recorded frame that registered it. */
const fire = (lua: LuaEngine, event: string) =>
  lua.doString(`
    for _, f in ipairs(__frames) do
      if f.events["${event}"] then f.scripts.OnEvent(f, "${event}") end
    end
  `);

const cellColor = async (lua: LuaEngine, cellIndex: number) =>
  lua.doString(
    `local c = HeroDeckNS.Channel.cells[${cellIndex}].color; return {c.r, c.g, c.b}`,
  );

/** Lua: init the channel on a bare host frame (no minimap button). */
const INIT_CHANNEL = `
  local host = CreateFrame("Frame", nil, UIParent)
  HeroDeckNS.Channel:Init(host)
`;

describe("Durability.Compute", () => {
  it("no slot with durability gives 100", async () => {
    expect(await compute({})).toBe(100);
  });

  it("most damaged item wins", async () => {
    expect(await compute({ 1: [100, 100], 16: [10, 100] })).toBe(10);
  });

  it("rounds down", async () => {
    expect(await compute({ 1: [296, 1000] })).toBe(29);
    expect(await compute({ 1: [199, 1000] })).toBe(19);
  });

  it("floors exact ratios without float error", async () => {
    expect(await compute({ 1: [58, 100] })).toBe(58);
    expect(await compute({ 1: [29, 100] })).toBe(29);
    expect(await compute({ 1: [7, 25] })).toBe(28);
  });

  it("broken item gives 0", async () => {
    expect(await compute({ 1: [0, 80] })).toBe(0);
  });

  it("skips max = 0", async () => {
    expect(await compute({ 1: [0, 0], 2: [50, 100] })).toBe(50);
  });

  it("reads slots 1 to 19 inclusive and no others", async () => {
    expect(await compute({ 19: [5, 100] })).toBe(5);
    expect(await compute({ 20: [5, 100], 0: [5, 100] })).toBe(100);
  });
});

describe("Durability events", () => {
  it("events update field 0", async () => {
    const slots: Slots = { 1: [100, 100] };
    await withAddon(
      async (lua) => {
        const vec = vectors.fields.find((f) => f.value === 87)!;
        await fire(lua, "PLAYER_LOGIN");
        slots[1] = [87, 100];
        await fire(lua, "UPDATE_INVENTORY_DURABILITY");
        expect(await cellColor(lua, 4)).toEqual(vec.cells[0]);
        expect(await cellColor(lua, 5)).toEqual(vec.cells[1]);
      },
      { GetInventoryItemDurability: readSlotFor(slots) },
    );
  });

  it("PLAYER_LOGIN draws the current value; the other events refresh it", async () => {
    const slots: Slots = { 1: [87, 100] };
    await withAddon(
      async (lua) => {
        const vec87 = vectors.fields.find((f) => f.value === 87)!;
        const vec100 = vectors.fields.find((f) => f.value === 100)!;
        await fire(lua, "PLAYER_LOGIN");
        expect(await cellColor(lua, 4)).toEqual(vec87.cells[0]);
        expect(await cellColor(lua, 5)).toEqual(vec87.cells[1]);

        slots[1] = [100, 100];
        await fire(lua, "PLAYER_ENTERING_WORLD");
        expect(await cellColor(lua, 4)).toEqual(vec100.cells[0]);
        expect(await cellColor(lua, 5)).toEqual(vec100.cells[1]);

        slots[1] = [87, 100];
        await fire(lua, "PLAYER_EQUIPMENT_CHANGED");
        expect(await cellColor(lua, 4)).toEqual(vec87.cells[0]);
        expect(await cellColor(lua, 5)).toEqual(vec87.cells[1]);
      },
      { GetInventoryItemDurability: readSlotFor(slots) },
    );
  });

  it("registers the four events on one frame", async () => {
    await withAddon(async (lua) => {
      for (const event of [
        "PLAYER_LOGIN",
        "PLAYER_ENTERING_WORLD",
        "UPDATE_INVENTORY_DURABILITY",
        "PLAYER_EQUIPMENT_CHANGED",
      ]) {
        expect(await lua.doString(`return #__frames == 1 and __frames[1].events["${event}"]`)).toBe(true);
      }
    });
  });

  it("PLAYER_LOGIN creates the button and the grid on it", async () => {
    await withAddon(async (lua) => {
      await fire(lua, "PLAYER_LOGIN");
      const ns = "HeroDeckNS";
      expect(await lua.doString(`return ${ns}.MinimapButton.frame ~= nil and ${ns}.MinimapButton.frame.parent == Minimap`)).toBe(true);
      expect(await lua.doString(`return ${ns}.Channel.host == ${ns}.MinimapButton.frame`)).toBe(true);
      expect(await lua.doString(`return ${ns}.Channel.frame.parent == ${ns}.MinimapButton.frame`)).toBe(true);
      expect(await lua.doString(`return #${ns}.Channel.frame.textures`)).toBe(16);
      expect(await lua.doString(`return ${ns}.Channel.fields[0]`)).toBe(true);
    });
  });

  it("PLAYER_LOGIN runs init, grid, place, register in that order, then draws", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`
        local ns = HeroDeckNS
        __log = {}
        local function spy(tbl, key, label)
          local orig = tbl[key]
          tbl[key] = function(...) __log[#__log + 1] = label; return orig(...) end
        end
        spy(ns.MinimapButton, "Init", "button init")
        spy(ns.Channel, "Init", "channel init")
        spy(ns.MinimapButton, "Place", "place")
        spy(ns.Channel, "Register", "register")
        spy(ns.Durability, "Update", "update")
      `);
      await fire(lua, "PLAYER_LOGIN");
      expect(await lua.doString("return __log")).toEqual(["button init", "channel init", "place", "register", "update"]);
    });
  });

  it("PLAYER_LOGIN places the button at the saved angle", async () => {
    await withAddon(async (lua) => {
      await lua.doString("HeroDeckDB = { minimap = { angle = 0 } }");
      await fire(lua, "PLAYER_LOGIN");
      // the offset is in the button's own (scaled) units: times the frame scale it is the on-screen 80, 0
      const [x, y] = (await lua.doString(
        "local b = HeroDeckNS.MinimapButton.frame; local p = b.points[1]; return { p.x * b.scale, p.y * b.scale }",
      )) as number[];
      expect(x).toBeCloseTo(80, 9);
      expect(y).toBeCloseTo(0, 9);
    });
  });

  it("Durability.last is set by Update", async () => {
    const slots: Slots = { 1: [87, 100] };
    await withAddon(
      async (lua) => {
        expect(await lua.doString("return HeroDeckNS.Durability.last")).toBeNull();
        await fire(lua, "PLAYER_LOGIN");
        expect(await lua.doString("return HeroDeckNS.Durability.last")).toBe(87);
        slots[1] = [40, 100];
        await fire(lua, "UPDATE_INVENTORY_DURABILITY");
        expect(await lua.doString("return HeroDeckNS.Durability.last")).toBe(40);
      },
      { GetInventoryItemDurability: readSlotFor(slots) },
    );
  });

  it("events before PLAYER_LOGIN do not touch the channel", async () => {
    await withAddon(async (lua) => {
      for (const event of [
        "PLAYER_ENTERING_WORLD",
        "UPDATE_INVENTORY_DURABILITY",
        "PLAYER_EQUIPMENT_CHANGED",
      ]) {
        await fire(lua, event);
      }
      expect(await lua.doString("return HeroDeckNS.Channel.frame == nil")).toBe(true);
    });
  });

  it("Update reads GetInventoryItemDurability at call time", async () => {
    await withAddon(async (lua) => {
      await lua.doString(INIT_CHANNEL + "HeroDeckNS.Channel:Register(0)");
      lua.global.set("GetInventoryItemDurability", readSlotFor({ 3: [87, 100] }));
      await lua.doString("HeroDeckNS.Durability:Update()");
      const vec = vectors.fields.find((f) => f.value === 87)!;
      expect(await cellColor(lua, 4)).toEqual(vec.cells[0]);
    });
  });

  it("FIELD is 0", async () => {
    await withAddon(async (lua) => {
      expect(await lua.doString("return HeroDeckNS.Durability.FIELD")).toBe(0);
    });
  });
});
