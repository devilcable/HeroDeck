import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CELL_PX, MAX_FIELDS, type RawImage } from "./protocol";
import { readStrip } from "./strip";

type Triple = [number, number, number];
interface Vectors {
  header: Triple[];
  fields: { value: number; cells: [Triple, Triple] }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "vectors", "channel-v1.json"),
    "utf8",
  ),
);
const allCells: Triple[] = [...vectors.header, ...vectors.fields.flatMap((f) => f.cells)];
const expectedValues = vectors.fields.slice(0, MAX_FIELDS).map((f) => f.value);

/** Flat mid-grey background: a real image that never matches the finder. */
function greyImage(width: number, height: number): RawImage {
  return { width, height, data: new Uint8Array(width * height * 4).fill(128) };
}

function paintStrip(img: RawImage, x: number, y: number, cells: Triple[] = allCells): void {
  cells.forEach((cell, i) => {
    for (let dy = 0; dy < CELL_PX; dy++) {
      for (let dx = 0; dx < CELL_PX; dx++) {
        const o = ((y + dy) * img.width + x + i * CELL_PX + dx) * 4;
        for (let c = 0; c < 3; c++) img.data[o + c] = cell[c];
        img.data[o + 3] = 255;
      }
    }
  });
}

/** White, black, magenta, then a white version cell: matches the finder, is not a valid strip. */
const decoy: Triple[] = [...vectors.header.slice(0, 3), [255, 255, 255]];

describe("readStrip", () => {
  it("decodes a single strip", () => {
    const img = greyImage(200, 100);
    paintStrip(img, 8, 31);
    const strip = readStrip(img);
    expect(strip?.version).toBe(1);
    expect(strip?.fields).toEqual(expectedValues);
  });

  it("decodes the real strip when a decoy candidate comes first", () => {
    const img = greyImage(200, 100);
    paintStrip(img, 2, 5, decoy);
    paintStrip(img, 8, 31);
    expect(readStrip(img)?.fields).toEqual(expectedValues);
  });

  it("returns null when there is no strip", () => {
    expect(readStrip(greyImage(200, 100))).toBeNull();
  });

  it("returns null when only a decoy is present", () => {
    const img = greyImage(200, 100);
    paintStrip(img, 2, 5, decoy);
    expect(readStrip(img)).toBeNull();
  });
});
