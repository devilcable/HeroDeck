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
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "vectors", "channel-v2.json"),
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

const GRID = "HeroDeckNS.Channel.frame";
const BODY = "HeroDeckNS.Channel.body";
const cell = (i: number) => `HeroDeckNS.Channel.cells[${i}]`;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const CELL_COUNT = 15;
const QHD = { GetPhysicalScreenSize: () => LuaMultiReturn.of(2560, 1440) };

/** Lua: create the host (center in its own units, effective scale) and Init the channel on it. */
const initOn = (cx: number | null, cy: number | null, scale = 1) => `
  host = CreateFrame("Frame", nil, UIParent)
  ${cx === null ? "" : `host.center = { x = ${cx}, y = ${cy} }`}
  host.effectiveScale = ${scale}
  HeroDeckNS.Channel:Init(host)
`;

const rgbOf = (lua: LuaEngine, expr: string) =>
  lua.doString(`local c = ${expr}.color; return {c.r, c.g, c.b}`);

const num = async (lua: LuaEngine, expr: string) => (await lua.doString(`return ${expr}`)) as number;

describe("channel grid", () => {
  it("grid frame is a child of the host, ignores parent scale, HIGH strata", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      expect(await lua.doString(`return ${GRID}.parent == host`)).toBe(true);
      expect(await lua.doString(`return ${GRID}.strata`)).toBe("HIGH");
      expect(await lua.doString(`return ${GRID}.ignoreParentScale`)).toBe(true);
      expect(await lua.doString(`return ${GRID}.scale`)).toBe(1);
      expect(await lua.doString("return HeroDeckNS.Channel.host == host")).toBe(true);
    });
  });

  it("frame level is the host level + 5", async () => {
    await withChannel(async (lua) => {
      await lua.doString(`
        host = CreateFrame("Frame", nil, UIParent); host:SetFrameLevel(7)
        HeroDeckNS.Channel:Init(host)
      `);
      expect(await lua.doString(`return ${GRID}.frameLevel`)).toBe(12);
    });
  });

  it("exposes the grid constants and CellOffset", async () => {
    await withChannel(async (lua) => {
      expect(
        await lua.doString("local C = HeroDeckNS.Channel; return {C.CELL_PX, C.PITCH, C.COLS, C.ROWS, C.CELLS}"),
      ).toEqual([4, 5, 5, 3, 15]);
      expect(await lua.doString("local a, b = HeroDeckNS.Channel.CellOffset(7); return {a, b}")).toEqual([10, 5]);
      expect(await lua.doString("local a, b = HeroDeckNS.Channel.CellOffset(14); return {a, b}")).toEqual([20, 10]);
    });
  });

  it("draws 15 cells: header from vectors, the rest IDLE", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      // One Lua call for all cells: many separate doString calls can crash wasmoon.
      const rows = (await lua.doString(`
        local out, n = {}, 0
        for i = 0, ${CELL_COUNT - 1} do
          local t = HeroDeckNS.Channel.cells[i]
          out[#out + 1] = { t.color.r, t.color.g, t.color.b, t.color.a, t.layer }
        end
        for _ in pairs(HeroDeckNS.Channel.cells) do n = n + 1 end
        out.count = n
        return out
      `)) as Record<string, unknown>;
      for (let i = 0; i < CELL_COUNT; i++) {
        const expected = i < 4 ? vectors.header[i] : [48, 48, 48];
        expect(rows[i + 1]).toEqual([...expected, 1, "OVERLAY"]);
      }
      expect(rows.count).toBe(CELL_COUNT);
    });
  });

  it("draws the body below the cells: (24, 24, 28), 2 px around the grid", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      const unit = 768 / 1440;
      expect(await rgbOf(lua, BODY)).toEqual([24, 24, 28]);
      expect(await lua.doString(`return ${BODY}.color.a`)).toBe(1);
      expect(await lua.doString(`return ${BODY}.layer`)).toBe("BACKGROUND");
      expect(near(await num(lua, `${BODY}.width`), 28 * unit)).toBe(true);
      expect(near(await num(lua, `${BODY}.height`), 18 * unit)).toBe(true);
      expect(await lua.doString(`return ${BODY}.points[1].point`)).toBe("TOPLEFT");
      expect(await lua.doString(`return ${BODY}.points[1].relativeTo == ${GRID}`)).toBe(true);
      expect(await lua.doString(`return ${BODY}.points[1].relativePoint`)).toBe("TOPLEFT");
      expect(near(await num(lua, `${BODY}.points[1].x`), -2 * unit)).toBe(true);
      expect(near(await num(lua, `${BODY}.points[1].y`), 2 * unit)).toBe(true);
      // 15 cells + body, all on the grid frame
      expect(await lua.doString(`return #${GRID}.textures`)).toBe(CELL_COUNT + 1);
    }, QHD);
  });

  it("grid frame is 24 x 14 px", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      const unit = 768 / 1440;
      expect(near(await num(lua, `${GRID}.width`), 24 * unit)).toBe(true);
      expect(near(await num(lua, `${GRID}.height`), 14 * unit)).toBe(true);
    }, QHD);
  });

  it("cells sit at CellOffset positions, 4 px wide", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      const unit = 768 / 1440;
      const rows = (await lua.doString(`
        local out = {}
        for i = 0, ${CELL_COUNT - 1} do
          local t = HeroDeckNS.Channel.cells[i]
          local p = t.points[1]
          out[#out + 1] = { p.point, p.relativeTo == ${GRID}, p.relativePoint, p.x, p.y, t.width, t.height, #t.points }
        end
        return out
      `)) as [string, boolean, string, number, number, number, number, number][];
      for (let i = 0; i < CELL_COUNT; i++) {
        const dx = (i % 5) * 5;
        const dy = Math.floor(i / 5) * 5;
        const [point, rel, relPoint, x, y, w, h, nPoints] = rows[i];
        expect([point, rel, relPoint, nPoints]).toEqual(["TOPLEFT", true, "TOPLEFT", 1]);
        expect(near(x, dx * unit)).toBe(true);
        expect(near(y, -dy * unit)).toBe(true);
        expect(near(w, 4 * unit)).toBe(true);
        expect(near(h, 4 * unit)).toBe(true);
      }
    }, QHD);
  });

  it("SnapOrigin returns whole pixels", async () => {
    await withChannel(async (lua) => {
      const snap = (x: number, y: number) =>
        lua.doString(`local l, t = HeroDeckNS.Channel.SnapOrigin(${x}, ${y}); return {l, t}`);
      expect(await snap(100.0, 50.0)).toEqual([88, 57]);
      expect(await snap(100.4, 50.6)).toEqual([88, 58]);
      expect(await snap(100.5, 50.5)).toEqual([89, 58]);
    });
  });

  it("snaps the grid to whole pixels at fractional button positions", async () => {
    for (const scale of [0.64, 0.9, 1.0]) {
      await withChannel(async (lua) => {
        // Fractional positions in the host's own units, as along the minimap circle.
        await lua.doString(initOn(1234.5678, 321.4321, scale));
        const unit = 768 / 1440;
        const gridX = (await num(lua, `${GRID}.points[1].x`)) / unit;
        const gridY = (await num(lua, `${GRID}.points[1].y`)) / unit;
        expect(near(gridX, Math.round(gridX))).toBe(true);
        expect(near(gridY, Math.round(gridY))).toBe(true);
        expect(await lua.doString(`return ${GRID}.points[1].point`)).toBe("TOPLEFT");
        expect(await lua.doString(`return ${GRID}.points[1].relativeTo == WorldFrame`)).toBe(true);
        expect(await lua.doString(`return ${GRID}.points[1].relativePoint`)).toBe("BOTTOMLEFT");
        // The grid is centered on the host, within half a pixel.
        const px = (1234.5678 * scale) / unit;
        const py = (321.4321 * scale) / unit;
        expect(Math.abs(gridX + 12 - px)).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(gridY - 7 - py)).toBeLessThanOrEqual(0.5 + 1e-9);
        // Every cell edge is on a whole pixel too (offsets are whole pixel multiples).
        const offsets = (await lua.doString(`
          local out = {}
          for i = 0, ${CELL_COUNT - 1} do
            local p = HeroDeckNS.Channel.cells[i].points[1]
            out[#out + 1] = { p.x, p.y }
          end
          return out
        `)) as [number, number][];
        for (const [ox, oy] of offsets) {
          expect(near(ox / unit, Math.round(ox / unit))).toBe(true);
          expect(near(oy / unit, Math.round(oy / unit))).toBe(true);
        }
      }, QHD);
    }
  });

  it("re-snaps after UI_SCALE_CHANGED", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500.3, 400.7, 1));
      const unit1 = 768 / 1440;
      expect(near(await num(lua, `${cell(0)}.width`), 4 * unit1)).toBe(true);

      lua.global.set("GetPhysicalScreenSize", () => LuaMultiReturn.of(1920, 1080));
      await lua.doString(`
        host.effectiveScale = 0.7
        ${GRID}.scripts.OnEvent(${GRID}, "UI_SCALE_CHANGED")
      `);
      const unit2 = 768 / 1080;
      expect(near(await num(lua, `${cell(0)}.width`), 4 * unit2)).toBe(true);
      expect(near(await num(lua, `${GRID}.width`), 24 * unit2)).toBe(true);
      const left = Math.floor((500.3 * 0.7) / unit2 - 12 + 0.5);
      const top = Math.floor((400.7 * 0.7) / unit2 + 7 + 0.5);
      expect(near(await num(lua, `${GRID}.points[1].x`), left * unit2)).toBe(true);
      expect(near(await num(lua, `${GRID}.points[1].y`), top * unit2)).toBe(true);
      expect(await lua.doString(`return #${GRID}.points`)).toBe(1);
    }, QHD);
  });

  it("registers DISPLAY_SIZE_CHANGED and UI_SCALE_CHANGED", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      expect(await lua.doString(`return ${GRID}.events.DISPLAY_SIZE_CHANGED`)).toBe(true);
      expect(await lua.doString(`return ${GRID}.events.UI_SCALE_CHANGED`)).toBe(true);
    });
  });

  it("Layout moves the grid when the host moves", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      const unit = 768 / 1440;
      await lua.doString("host.center = { x = 900, y = 700 }; HeroDeckNS.Channel:Layout()");
      const left = Math.floor(900 / unit - 12 + 0.5);
      const top = Math.floor(700 / unit + 7 + 0.5);
      expect(near(await num(lua, `${GRID}.points[1].x`), left * unit)).toBe(true);
      expect(near(await num(lua, `${GRID}.points[1].y`), top * unit)).toBe(true);
    }, QHD);
  });

  it("Layout does nothing when the host has no center", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      const before = await num(lua, `${GRID}.points[1].x`);
      await lua.doString("host.center = nil; HeroDeckNS.Channel:Layout()");
      expect(await lua.doString(`return #${GRID}.points`)).toBe(1);
      expect(await num(lua, `${GRID}.points[1].x`)).toBe(before);
    }, QHD);
  });

  it("Layout does nothing when the screen size is unusable", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      const x = await num(lua, `${GRID}.points[1].x`);
      const w = await num(lua, `${cell(0)}.width`);
      for (const mock of [() => undefined, () => LuaMultiReturn.of(1920, 0), () => LuaMultiReturn.of(1920, -5)]) {
        lua.global.set("GetPhysicalScreenSize", mock);
        await lua.doString("HeroDeckNS.Channel:Layout()");
        expect(await lua.doString(`return #${GRID}.points`)).toBe(1);
        expect(await num(lua, `${GRID}.points[1].x`)).toBe(x);
        expect(await num(lua, `${cell(0)}.width`)).toBe(w);
      }
    }, QHD);
  });

  it("Init with no host center places the grid on the first Layout", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(null, null));
      expect(await lua.doString(`return #${GRID}.points`)).toBe(0);
      await lua.doString("host.center = { x = 500, y = 400 }; HeroDeckNS.Channel:Layout()");
      expect(await lua.doString(`return #${GRID}.points`)).toBe(1);
    });
  });

  it("Init twice does not create a second frame", async () => {
    await withChannel(async (lua) => {
      const before = (await lua.doString("return #__frames")) as number;
      await lua.doString(initOn(500, 400) + "HeroDeckNS.Channel:Init(host)");
      expect(await lua.doString("return #__frames")).toBe(before + 2); // host + grid
      expect(await lua.doString(`return #${GRID}.textures`)).toBe(CELL_COUNT + 1);
    });
  });

  it("SetByte(0, 87) colors cells 4 and 5", async () => {
    await withChannel(async (lua) => {
      const vec = vectors.fields.find((f) => f.value === 87)!;
      await lua.doString(initOn(500, 400) + "local C = HeroDeckNS.Channel; C:Register(0); C:SetByte(0, 87)");
      expect(await rgbOf(lua, cell(4))).toEqual(vec.cells[0]);
      expect(await rgbOf(lua, cell(5))).toEqual(vec.cells[1]);
      expect(await rgbOf(lua, cell(6))).toEqual([48, 48, 48]);
      expect(await lua.doString(`return #${GRID}.textures`)).toBe(CELL_COUNT + 1);
    });
  });

  it("SetByte on the last field colors cells 12 and 13 and leaves cell 14 idle", async () => {
    await withChannel(async (lua) => {
      const vec = vectors.fields.find((f) => f.value === 255)!;
      await lua.doString(initOn(500, 400) + "local C = HeroDeckNS.Channel; C:Register(4); C:SetByte(4, 255)");
      expect(await rgbOf(lua, cell(12))).toEqual(vec.cells[0]);
      expect(await rgbOf(lua, cell(13))).toEqual(vec.cells[1]);
      expect(await rgbOf(lua, cell(14))).toEqual([48, 48, 48]);
    });
  });

  it("SetByte again recolors the same textures", async () => {
    await withChannel(async (lua) => {
      const vec = vectors.fields.find((f) => f.value === 100)!;
      await lua.doString(
        initOn(500, 400) + "local C = HeroDeckNS.Channel; C:Register(0); C:SetByte(0, 87); C:SetByte(0, 100)",
      );
      expect(await rgbOf(lua, cell(4))).toEqual(vec.cells[0]);
      expect(await rgbOf(lua, cell(5))).toEqual(vec.cells[1]);
      expect(await lua.doString(`return #${GRID}.textures`)).toBe(CELL_COUNT + 1);
    });
  });

  it("SetByte on an unregistered field errors", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      await expect(lua.doString("HeroDeckNS.Channel:SetByte(0, 1)")).rejects.toThrow(/not registered/);
    });
  });

  it("Register twice errors", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      expect(await lua.doString("return HeroDeckNS.Channel:Register(0)")).toBe(true);
      await expect(lua.doString("HeroDeckNS.Channel:Register(0)")).rejects.toThrow(/already registered/);
    });
  });

  it("Register(5) errors, Register(4) is the last valid field", async () => {
    await withChannel(async (lua) => {
      await lua.doString(initOn(500, 400));
      expect(await lua.doString("return HeroDeckNS.Channel:Register(4)")).toBe(true);
      await expect(lua.doString("HeroDeckNS.Channel:Register(5)")).rejects.toThrow(/field index/);
      await expect(lua.doString("HeroDeckNS.Channel:Register(-1)")).rejects.toThrow(/field index/);
    });
  });
});
