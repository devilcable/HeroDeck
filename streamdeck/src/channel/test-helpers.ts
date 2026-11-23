/** Shared by the channel tests only: protocol vectors, synthetic captures and a grid painter. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CELL_PX, IDLE, MAX_FIELDS, cellOffset, type RawImage } from "./protocol";

export type Triple = [number, number, number];
interface Vectors {
  header: Triple[];
  fields: { value: number; cells: [Triple, Triple] }[];
}

export const vectors: Vectors = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "vectors", "channel-v2.json"),
    "utf8",
  ),
);
export const idle: Triple = [IDLE.r, IDLE.g, IDLE.b];
/** The 15 cells of a full grid: header, the five vector fields, cell 14 idle. */
export const fullGrid: Triple[] = [...vectors.header, ...vectors.fields.flatMap((f) => f.cells), idle];
export const expectedValues = vectors.fields.slice(0, MAX_FIELDS).map((f) => f.value);

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
export function busyImage(width: number, height: number, seed: number): RawImage {
  const rand = prng(seed);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = 96 + Math.floor(rand() * 64);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/**
 * 4x4 cells at cellOffset(i) from (x, y), 1 px gaps keep the background; optional 50 % border blur.
 * Pixels outside the image are clipped.
 */
export function paintGrid(img: RawImage, x: number, y: number, cells: Triple[] = fullGrid, blur = false): void {
  cells.forEach((cell, i) => {
    const { dx: cx, dy: cy } = cellOffset(i);
    for (let dy = 0; dy < CELL_PX; dy++) {
      for (let dx = 0; dx < CELL_PX; dx++) {
        const px = x + cx + dx;
        const py = y + cy + dy;
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
        const o = (py * img.width + px) * 4;
        const isCenter = dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2;
        const k = blur && !isCenter ? 0.5 : 1;
        for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(cell[c] * k + img.data[o + c] * (1 - k));
        img.data[o + 3] = 255;
      }
    }
  });
}
