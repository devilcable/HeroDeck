import { describe, expect, it } from "vitest";
import { ADDON_FILES, createLua, loadAddonFiles } from "../addon/tests/harness";
import { decodeField } from "../streamdeck/src/channel/decode";
import type { RGB } from "../streamdeck/src/channel/protocol";

describe("Lua encoder to TypeScript decoder", () => {
  it("Lua EncodeByte(v) decodes to v for every v in 0..255", async () => {
    const lua = await createLua();
    try {
      await loadAddonFiles(lua, ADDON_FILES);
      const white: RGB = { r: 255, g: 255, b: 255 };
      const black: RGB = { r: 0, g: 0, b: 0 };
      // One Lua call for all bytes: r,g,b of cell A then of cell B, per value.
      const flat = (await lua.doString(`
        local out = {}
        for v = 0, 255 do
          for _, cell in ipairs(HeroDeckNS.Codec.EncodeByte(v)) do
            out[#out + 1] = cell.r
            out[#out + 1] = cell.g
            out[#out + 1] = cell.b
          end
        end
        return out
      `)) as number[];
      expect(flat).toHaveLength(256 * 6);
      for (let v = 0; v <= 255; v++) {
        const o = v * 6;
        const a: RGB = { r: flat[o], g: flat[o + 1], b: flat[o + 2] };
        const b: RGB = { r: flat[o + 3], g: flat[o + 4], b: flat[o + 5] };
        expect(decodeField(a, b, white, black), `value ${v}`).toBe(v);
      }
    } finally {
      lua.global.close();
    }
  });
});
