import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LuaMultiReturn, type LuaEngine } from "wasmoon";
import { describe, expect, it } from "vitest";
import { ADDON_FILES, createLua, loadAddonFiles } from "./harness";

type Rgb = [number, number, number];
interface Vectors {
  header: Rgb[];
  fields: { value: number; cells: [Rgb, Rgb] }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "vectors", "channel-v1.json"),
    "utf8",
  ),
);

async function withChannel<T>(
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

/** Lua expression of the i-th (0-based cell index) recorded texture of the strip. */
const STRIP = "HeroDeckNS.Channel.frame";
const tex = (cellIndex: number) => `${STRIP}.textures[${cellIndex + 1}]`;

describe("channel strip", () => {
  it("strip is parented to WorldFrame, top-left, TOOLTIP strata, ignores parent scale", async () => {
    await withChannel(async (lua) => {
      await lua.doString("HeroDeckNS.Channel:Init()");
      expect(await lua.doString(`return ${STRIP}.parent == WorldFrame`)).toBe(true);
      expect(await lua.doString(`return ${STRIP}.strata`)).toBe("TOOLTIP");
      expect(await lua.doString(`return ${STRIP}.frameLevel`)).toBe(10000);
      expect(await lua.doString(`return ${STRIP}.ignoreParentScale`)).toBe(true);
      expect(await lua.doString(`return ${STRIP}.scale`)).toBe(1);
      expect(await lua.doString(`return ${STRIP}.points[1].point`)).toBe("TOPLEFT");
      expect(await lua.doString(`return ${STRIP}.points[1].relativeTo == WorldFrame`)).toBe(true);
      expect(await lua.doString(`return ${STRIP}.points[1].relativePoint`)).toBe("TOPLEFT");
    });
  });

  it("Init twice does not create a second frame", async () => {
    await withChannel(async (lua) => {
      const before = (await lua.doString("return #__frames")) as number;
      await lua.doString("HeroDeckNS.Channel:Init(); HeroDeckNS.Channel:Init()");
      expect(await lua.doString("return #__frames")).toBe(before + 1);
      expect(await lua.doString(`return #${STRIP}.textures`)).toBe(4);
    });
  });

  it("draws header cells with exact colors", async () => {
    await withChannel(async (lua) => {
      await lua.doString("HeroDeckNS.Channel:Init()");
      for (let i = 0; i < 4; i++) {
        const c = await lua.doString(`local c = ${tex(i)}.color; return {c.r, c.g, c.b}`);
        expect(c).toEqual(vectors.header[i]);
      }
    });
  });

  it("SetByte(0, 87) draws cells 4 and 5 with the vector colors at x offsets of 4 and 5 cells", async () => {
    await withChannel(async (lua) => {
      const vec = vectors.fields.find((f) => f.value === 87)!;
      await lua.doString("local C = HeroDeckNS.Channel; C:Init(); C:Register(0); C:SetByte(0, 87)");
      expect(await lua.doString(`return #${STRIP}.textures`)).toBe(6);
      for (const [n, cell] of [[4, vec.cells[0]], [5, vec.cells[1]]] as const) {
        const c = await lua.doString(`local c = ${tex(n)}.color; return {c.r, c.g, c.b}`);
        expect(c).toEqual(cell);
        const x = (await lua.doString(`return ${tex(n)}.points[1].x`)) as number;
        const unit = 768 / 1080;
        expect(Math.abs(x - n * 3 * unit)).toBeLessThan(1e-9);
        expect(await lua.doString(`return ${tex(n)}.points[1].y`)).toBe(0);
        expect(await lua.doString(`return ${tex(n)}.points[1].point`)).toBe("TOPLEFT");
        expect(await lua.doString(`return ${tex(n)}.points[1].relativeTo == ${STRIP}`)).toBe(true);
      }
    });
  });

  it("SetByte again recolors the same textures", async () => {
    await withChannel(async (lua) => {
      const vec = vectors.fields.find((f) => f.value === 100)!;
      await lua.doString("local C = HeroDeckNS.Channel; C:Init(); C:Register(0); C:SetByte(0, 87); C:SetByte(0, 100)");
      expect(await lua.doString(`return #${STRIP}.textures`)).toBe(6);
      for (const [n, cell] of [[4, vec.cells[0]], [5, vec.cells[1]]] as const) {
        const c = await lua.doString(`local c = ${tex(n)}.color; return {c.r, c.g, c.b}`);
        expect(c).toEqual(cell);
      }
    });
  });

  it("cell size is 3 physical pixels", async () => {
    await withChannel(
      async (lua) => {
        await lua.doString("local C = HeroDeckNS.Channel; C:Init(); C:Register(0); C:SetByte(0, 87)");
        expect(await lua.doString("return HeroDeckNS.Channel.CELL_PX")).toBe(3);
        const expected = (3 * 768) / 1440;
        for (const n of [0, 3, 4, 5]) {
          const w = (await lua.doString(`return ${tex(n)}.width`)) as number;
          const h = (await lua.doString(`return ${tex(n)}.height`)) as number;
          expect(Math.abs(w - expected)).toBeLessThan(1e-9);
          expect(Math.abs(h - expected)).toBeLessThan(1e-9);
        }
      },
      { GetPhysicalScreenSize: () => LuaMultiReturn.of(2560, 1440) },
    );
  });

  it("relayouts on DISPLAY_SIZE_CHANGED and UI_SCALE_CHANGED", async () => {
    await withChannel(async (lua) => {
      await lua.doString("local C = HeroDeckNS.Channel; C:Init(); C:Register(0); C:SetByte(0, 87)");
      expect(await lua.doString(`return ${STRIP}.events.DISPLAY_SIZE_CHANGED`)).toBe(true);
      expect(await lua.doString(`return ${STRIP}.events.UI_SCALE_CHANGED`)).toBe(true);

      lua.global.set("GetPhysicalScreenSize", () => LuaMultiReturn.of(2560, 1440));
      for (const event of ["UI_SCALE_CHANGED", "DISPLAY_SIZE_CHANGED"]) {
        // reset to the old size, then fire the event with the new one
        await lua.doString(`
          local C = HeroDeckNS.Channel
          for _, t in ipairs(HeroDeckNS.Channel.frame.textures) do t.width = 0; t.height = 0 end
          local f = HeroDeckNS.Channel.frame
          f.scripts.OnEvent(f, "${event}")
        `);
        const expected = (3 * 768) / 1440;
        for (const n of [0, 3, 4, 5]) {
          const w = (await lua.doString(`return ${tex(n)}.width`)) as number;
          expect(Math.abs(w - expected)).toBeLessThan(1e-9);
          const x = (await lua.doString(`return ${tex(n)}.points[1].x`)) as number;
          expect(Math.abs(x - n * expected)).toBeLessThan(1e-9);
        }
      }
    });
  });

  it("SetByte on an unregistered field errors", async () => {
    await withChannel(async (lua) => {
      await lua.doString("HeroDeckNS.Channel:Init()");
      await expect(lua.doString("HeroDeckNS.Channel:SetByte(0, 1)")).rejects.toThrow(/not registered/);
    });
  });

  it("Register twice errors", async () => {
    await withChannel(async (lua) => {
      await lua.doString("HeroDeckNS.Channel:Init()");
      expect(await lua.doString("return HeroDeckNS.Channel:Register(0)")).toBe(true);
      await expect(lua.doString("HeroDeckNS.Channel:Register(0)")).rejects.toThrow(/already registered/);
    });
  });
});
