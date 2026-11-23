import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const toRgb = (c: { r: number; g: number; b: number }): Rgb => [c.r, c.g, c.b];

async function withCodec<T>(fn: (lua: Awaited<ReturnType<typeof createLua>>) => Promise<T>): Promise<T> {
  const lua = await createLua();
  try {
    await loadAddonFiles(lua, ADDON_FILES);
    return await fn(lua);
  } finally {
    lua.global.close();
  }
}

describe("channel protocol v1 codec", () => {
  it("header matches vectors", async () => {
    await withCodec(async (lua) => {
      const cells = await lua.doString("return HeroDeckNS.Codec.HeaderCells()");
      expect(cells.map(toRgb)).toEqual(vectors.header);
    });
  });

  it("EncodeByte matches every vector", async () => {
    await withCodec(async (lua) => {
      for (const { value, cells } of vectors.fields) {
        const got = await lua.doString(`return HeroDeckNS.Codec.EncodeByte(${value})`);
        expect(got.map(toRgb), `value ${value}`).toEqual(cells);
      }
    });
  });

  it("Xor4 truth samples", async () => {
    await withCodec(async (lua) => {
      const samples: [number, number, number][] = [
        [5, 7, 2],
        [15, 15, 0],
        [0, 10, 10],
        [6, 4, 2],
      ];
      for (const [a, b, expected] of samples) {
        expect(await lua.doString(`return HeroDeckNS.Codec.Xor4(${a}, ${b})`)).toBe(expected);
      }
    });
  });

  it("EncodeByte rejects -1, 256, 1.5", async () => {
    await withCodec(async (lua) => {
      for (const bad of ["-1", "256", "1.5"]) {
        await expect(lua.doString(`return HeroDeckNS.Codec.EncodeByte(${bad})`), bad).rejects.toThrow();
      }
    });
  });
});
