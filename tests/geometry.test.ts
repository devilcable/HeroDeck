import { describe, expect, it } from "vitest";
import { LuaMultiReturn } from "wasmoon";
import { ADDON_FILES, createLua, loadAddonFiles } from "../addon/tests/harness";
import { CELL_PITCH, CELL_PX, GRID_CELLS, type RawImage } from "../streamdeck/src/channel/protocol";
import { readStrip } from "../streamdeck/src/channel/strip";
import { busyImage } from "../streamdeck/src/channel/test-helpers";

const SCREEN = { width: 2560, height: 1440 };
const UI_HEIGHT = 768; // UI units of a full-height screen at effective scale 1
const HOST_CENTER = { x: 1700.3, y: 900.6 }; // fractional, in the host's own units
const HOST_SCALE = 0.75;
const VALUE = 87;

interface Placed {
  /** Anchor offset (UI units, TOPLEFT of the grid frame from BOTTOMLEFT of the screen / of the frame). */
  x: number;
  y: number;
  width: number;
  height: number;
  color: [number, number, number] | null;
}

/** Fill a rectangle given in physical pixels (top-left origin, whole pixels). */
function fill(img: RawImage, left: number, top: number, width: number, height: number, [r, g, b]: [number, number, number]): void {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
}

describe("Lua grid geometry to TypeScript locator", () => {
  it("a grid laid out by Channel.lua at a fractional position and UI scale is found and decoded", async () => {
    const lua = await createLua({ GetPhysicalScreenSize: () => LuaMultiReturn.of(SCREEN.width, SCREEN.height) });
    try {
      await loadAddonFiles(lua, ADDON_FILES);
      // One Lua call: lay the grid out for the host, then read every anchor, size and color from the mocks.
      const flat = (await lua.doString(`
        local Channel = HeroDeckNS.Channel
        local host = CreateFrame("Frame", nil, UIParent)
        host.center = { x = ${HOST_CENTER.x}, y = ${HOST_CENTER.y} }
        host.effectiveScale = ${HOST_SCALE}
        Channel:Init(host)
        Channel:Register(0)
        Channel:SetByte(0, ${VALUE})
        Channel:Layout()

        local function anchor(obj)
          local p = obj.points[#obj.points]
          return p.x, p.y
        end
        local out = {}
        local function add(obj)
          local x, y = anchor(obj)
          local c = obj.color
          out[#out + 1] = x
          out[#out + 1] = y
          out[#out + 1] = obj.width
          out[#out + 1] = obj.height
          out[#out + 1] = c and c.r or -1
          out[#out + 1] = c and c.g or -1
          out[#out + 1] = c and c.b or -1
        end
        add(Channel.frame)
        add(Channel.body)
        for i = 0, ${GRID_CELLS - 1} do add(Channel.cells[i]) end
        return out
      `)) as number[];
      expect(flat).toHaveLength(7 * (2 + GRID_CELLS));

      const placed: Placed[] = [];
      for (let i = 0; i < flat.length; i += 7) {
        const [x, y, width, height, r, g, b] = flat.slice(i, i + 7);
        placed.push({ x, y, width, height, color: r < 0 ? null : [r, g, b] });
      }
      const [frame, body, ...cells] = placed;

      // UI units -> physical px. y of the frame anchor is up from the bottom of the screen.
      const px = (units: number) => (units * SCREEN.height) / UI_HEIGHT;
      const whole = (value: number) => {
        expect(Math.abs(value - Math.round(value)), `${value} is not a whole pixel`).toBeLessThan(1e-6);
        return Math.round(value);
      };
      const gridLeft = whole(px(frame.x));
      const gridTop = SCREEN.height - whole(px(frame.y)); // flip to the top-left image origin

      const img = busyImage(SCREEN.width, SCREEN.height, 42);
      // The body is anchored TOPLEFT to the grid TOPLEFT; the cells too, downwards (negative y).
      fill(img, gridLeft + whole(px(body.x)), gridTop - whole(px(body.y)), whole(px(body.width)), whole(px(body.height)), body.color!);
      cells.forEach((cell, i) => {
        const left = gridLeft + whole(px(cell.x));
        const top = gridTop - whole(px(cell.y));
        expect(whole(px(cell.width)), `cell ${i} width`).toBe(CELL_PX);
        expect(whole(px(cell.height)), `cell ${i} height`).toBe(CELL_PX);
        expect(left - gridLeft, `cell ${i} x`).toBe((i % 5) * CELL_PITCH);
        expect(top - gridTop, `cell ${i} y`).toBe(Math.floor(i / 5) * CELL_PITCH);
        fill(img, left, top, CELL_PX, CELL_PX, cell.color!);
      });

      const strip = readStrip(img);
      expect(strip).not.toBeNull();
      expect(strip!.version).toBe(2);
      expect(strip!.fields[0]).toBe(VALUE);
      // the origin the locator reports lies inside cell 0
      expect(strip!.origin.x).toBeGreaterThanOrEqual(gridLeft);
      expect(strip!.origin.x).toBeLessThan(gridLeft + CELL_PX);
      expect(strip!.origin.y).toBeGreaterThanOrEqual(gridTop);
      expect(strip!.origin.y).toBeLessThan(gridTop + CELL_PX);
    } finally {
      lua.global.close();
    }
  });
});
