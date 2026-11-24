import { describe, expect, it } from "vitest";
import { readStrip } from "./strip";
import { busyImage, expectedValues, fullGrid, idle, paintGrid, type Triple, vectors } from "./test-helpers";

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
