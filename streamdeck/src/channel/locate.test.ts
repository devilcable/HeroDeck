import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeStrip } from "./decode";
import { findStrip, findStripCandidates, readCells, SEARCH_H, SEARCH_W } from "./locate";
import { CELL_PX, HEADER_CELLS, MAX_FIELDS, type RawImage } from "./protocol";

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
const expectedValues = vectors.fields.map((f) => f.value);

/** Deterministic PRNG (mulberry32) so noise is stable between runs. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded background noise, per channel uniform in [lo, hi). The default is full-range noise. A
 * narrow mid-grey range (BUSY) is busy like a game scene but can never satisfy the finder's
 * bright/dark thresholds, so tests of the strip itself cannot hit a chance false match.
 */
const BUSY: [number, number] = [96, 160];
function noiseImage(width: number, height: number, seed: number, [lo, hi] = [0, 256]): RawImage {
  const rand = prng(seed);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = lo + Math.floor(rand() * (hi - lo));
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function solidImage(width: number, height: number, v: number): RawImage {
  const data = new Uint8Array(width * height * 4).fill(v);
  return { width, height, data };
}

/**
 * Paint the strip with its top-left pixel at (x, y); cells past the right edge are
 * clipped. With `blur`, the 8 border pixels of each cell are blended 50 % with whatever was behind them; the center pixel stays exact.
 */
function paintStrip(img: RawImage, x: number, y: number, blur = false, cells: Triple[] = allCells): void {
  cells.forEach((cell, i) => {
    for (let dy = 0; dy < CELL_PX; dy++) {
      for (let dx = 0; dx < CELL_PX; dx++) {
        if (x + i * CELL_PX + dx >= img.width) continue;
        const o = ((y + dy) * img.width + x + i * CELL_PX + dx) * 4;
        const isCenter = dx === 1 && dy === 1;
        const k = blur && !isCenter ? 0.5 : 1;
        for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(cell[c] * k + img.data[o + c] * (1 - k));
        img.data[o + 3] = 255;
      }
    }
  });
}

describe("strip locator", () => {
  it("finds the strip at 0,0", () => {
    const img = noiseImage(200, 100, 1, BUSY);
    paintStrip(img, 0, 0);
    expect(findStrip(img)).toEqual({ x: 1, y: 1 });
  });

  it("finds the strip below a title bar", () => {
    const img = noiseImage(200, 100, 2, BUSY);
    paintStrip(img, 8, 31);
    expect(findStrip(img)).toEqual({ x: 9, y: 32 });
  });

  it("ignores a blurred 1px edge", () => {
    const img = noiseImage(200, 100, 3, BUSY);
    paintStrip(img, 8, 31, true);
    const origin = findStrip(img);
    expect(origin).toEqual({ x: 9, y: 32 });
    const strip = decodeStrip(readCells(img, origin!, allCells.length));
    expect(strip?.fields[2]).toBe(87); // vector field 2 carries the value 87
    expect(strip?.fields).toEqual(expectedValues);
  });

  it("returns no candidate on an image without the strip", () => {
    expect(findStrip(solidImage(200, 100, 255))).toBeNull();
    expect(findStripCandidates(solidImage(200, 100, 255))).toEqual([]);
    expect(findStrip(noiseImage(200, 100, 4, BUSY))).toBeNull();
  });

  it("rejects every candidate found in full-range noise", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const img = noiseImage(200, 100, seed);
      for (const c of findStripCandidates(img)) {
        expect(decodeStrip(readCells(img, c, HEADER_CELLS + 2 * MAX_FIELDS))).toBeNull();
      }
    }
  });

  it("returns exactly one candidate for a single valid strip", () => {
    for (const blur of [false, true]) {
      const img = noiseImage(200, 100, 8, BUSY);
      paintStrip(img, 8, 31, blur);
      expect(findStripCandidates(img)).toEqual([{ x: 9, y: 32 }]);
    }
  });

  it("finds the real strip behind a decoy above and left of it", () => {
    const img = noiseImage(200, 100, 9, BUSY);
    // white, black, magenta at 3 px spacing, but the version cell is white: not a valid strip
    const decoy: Triple[] = [...vectors.header.slice(0, 3), [255, 255, 255]];
    paintStrip(img, 2, 5, false, decoy);
    paintStrip(img, 8, 31);
    const candidates = findStripCandidates(img);
    expect(candidates).toEqual([
      { x: 3, y: 6 },
      { x: 9, y: 32 },
    ]);
    expect(findStrip(img)).toEqual({ x: 3, y: 6 });
    const strips = candidates
      .map((c) => decodeStrip(readCells(img, c, HEADER_CELLS + 2 * MAX_FIELDS)))
      .filter((s) => s !== null);
    expect(strips).toHaveLength(1);
    expect(strips[0].fields).toEqual(expectedValues.slice(0, MAX_FIELDS)); // MAX_FIELDS cells are read
  });

  it("does not look outside the search region", () => {
    const img = noiseImage(400, 300, 5, BUSY);
    paintStrip(img, 0, SEARCH_H + 20);
    expect(findStrip(img)).toBeNull();
    const img2 = noiseImage(400, 300, 6, BUSY);
    paintStrip(img2, SEARCH_W + 20, 0);
    expect(findStrip(img2)).toBeNull();
  });

  it("readCells stops at the image edge", () => {
    const img = noiseImage(20, 10, 7, BUSY);
    paintStrip(img, 0, 0);
    // centers at x = 1, 4, 7, 10, 13, 16, 19 (7 cells); the next one is past the edge
    const cells = readCells(img, { x: 1, y: 1 }, 12);
    expect(cells).toHaveLength(7);
    expect(cells[0]).toEqual({ r: 255, g: 255, b: 255 });
    expect(cells[1]).toEqual({ r: 0, g: 0, b: 0 });
    expect(cells[2]).toEqual({ r: 255, g: 0, b: 255 });
  });
});
