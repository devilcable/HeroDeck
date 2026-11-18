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
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "vectors", "channel-v1.json"),
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
    `local c = HeroDeckNS.Channel.frame.textures[${cellIndex + 1}].color; return {c.r, c.g, c.b}`,
  );

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
      await lua.doString("HeroDeckNS.Channel:Init(); HeroDeckNS.Channel:Register(0)");
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
