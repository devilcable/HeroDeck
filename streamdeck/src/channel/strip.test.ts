import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CELL_PX, IDLE, MAX_FIELDS, cellOffset, type RawImage } from "./protocol";
import { readStrip } from "./strip";

type Triple = [number, number, number];
interface Vectors {
  header: Triple[];
  fields: { value: number; cells: [Triple, Triple] }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "vectors", "channel-v2.json"),
    "utf8",
  ),
);
const idle: Triple = [IDLE.r, IDLE.g, IDLE.b];
const fullGrid: Triple[] = [...vectors.header, ...vectors.fields.flatMap((f) => f.cells), idle];
const expectedValues = vectors.fields.slice(0, MAX_FIELDS).map((f) => f.value);

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

/** Seeded mid-grey noise (96..159 per channel): busy like a scene, never matches the finder. */
function busyImage(width: number, height: number, seed: number): RawImage {
  const rand = prng(seed);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = 96 + Math.floor(rand() * 64);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** 4x4 cells at cellOffset(i) from (x, y), 1 px gaps keep the background; optional 50 % border blur. */
function paintGrid(img: RawImage, x: number, y: number, cells: Triple[] = fullGrid, blur = false): void {
  cells.forEach((cell, i) => {
    const { dx: cx, dy: cy } = cellOffset(i);
    for (let dy = 0; dy < CELL_PX; dy++) {
      for (let dx = 0; dx < CELL_PX; dx++) {
        const o = ((y + cy + dy) * img.width + x + cx + dx) * 4;
        const isCenter = dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2;
        const k = blur && !isCenter ? 0.5 : 1;
        for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(cell[c] * k + img.data[o + c] * (1 - k));
        img.data[o + 3] = 255;
      }
    }
  });
}

/** White, black, magenta, then a white version cell: matches the finder, is not a valid header. */
const decoy: Triple[] = [...vectors.header.slice(0, 3), [255, 255, 255]];

describe("readStrip", () => {
  it("decodes a grid and returns its origin", () => {
    const img = busyImage(200, 100, 1);
    paintGrid(img, 8, 31);
    const strip = readStrip(img);
    expect(strip?.version).toBe(2);
    expect(strip?.fields).toEqual(expectedValues);
    expect(strip?.origin).toEqual({ x: 10, y: 33 });
  });

  it("decodes a grid at (1700, 230) in a 2560x1440 image", () => {
    const img = busyImage(2560, 1440, 2);
    paintGrid(img, 1700, 230);
    const strip = readStrip(img);
    expect(strip?.fields).toEqual(expectedValues);
    expect(strip?.origin).toEqual({ x: 1702, y: 232 });
  });

  it("decodes a grid near the bottom-right edge", () => {
    const img = busyImage(2560, 1440, 3);
    paintGrid(img, 2560 - 24, 1440 - 14);
    const strip = readStrip(img);
    expect(strip?.fields).toEqual(expectedValues);
    expect(strip?.origin).toEqual({ x: 2538, y: 1428 });
  });

  it("decodes the real grid, and returns its origin, when a decoy comes first", () => {
    const img = busyImage(200, 100, 4);
    paintGrid(img, 2, 5, decoy);
    paintGrid(img, 8, 31);
    const strip = readStrip(img);
    expect(strip?.fields).toEqual(expectedValues);
    expect(strip?.origin).toEqual({ x: 10, y: 33 });
  });

  it("decodes idle cells as null fields", () => {
    const img = busyImage(200, 100, 5);
    const only87: Triple[] = [...vectors.header, ...vectors.fields.find((f) => f.value === 87)!.cells];
    while (only87.length < 15) only87.push(idle);
    paintGrid(img, 20, 40, only87);
    expect(readStrip(img)?.fields).toEqual([87, null, null, null, null]);
  });

  it("still decodes with 1 px blur at the cell edges", () => {
    const img = busyImage(200, 100, 6);
    paintGrid(img, 8, 31, fullGrid, true);
    const strip = readStrip(img);
    expect(strip?.fields).toEqual(expectedValues);
    expect(strip?.origin).toEqual({ x: 10, y: 33 });
  });

  it("returns null in noise or a plain white image", () => {
    expect(readStrip(busyImage(2560, 1440, 7))).toBeNull();
    expect(readStrip({ width: 200, height: 100, data: new Uint8Array(200 * 100 * 4).fill(255) })).toBeNull();
  });

  it("returns null when only a decoy is present", () => {
    const img = busyImage(200, 100, 8);
    paintGrid(img, 2, 5, decoy);
    expect(readStrip(img)).toBeNull();
  });
});
