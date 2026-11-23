import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ES module script without type declarations
import { drawIcon, toTga } from "../tools/make-icon.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TGA_PATH = join(ROOT, "addon", "HeroDeck", "Media", "Icon.tga");
const PNG_PATH = join(ROOT, "docs", "user", "img", "icon.png");

type Pixel = [number, number, number, number];
const pixelAt = (rgba: Uint8Array, x: number, y: number): Pixel => {
  const i = (y * 64 + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
};
// Key (col, row) is a 7x7 square on a 9 px pitch; the grid starts at (10, 19).
const keyCenter = (col: number, row: number): [number, number] => [10 + col * 9 + 3, 19 + row * 9 + 3];

describe("addon icon", () => {
  const icon = drawIcon();

  it("draws a 64x64 RGBA image", () => {
    expect(icon.width).toBe(64);
    expect(icon.height).toBe(64);
    expect(icon.rgba.length).toBe(64 * 64 * 4);
  });

  it("is transparent outside the circle and opaque inside", () => {
    expect(pixelAt(icon.rgba, 0, 0)[3]).toBe(0);
    expect(pixelAt(icon.rgba, 63, 63)[3]).toBe(0);
    expect(pixelAt(icon.rgba, 32, 3)).toEqual([18, 18, 22, 255]);
    expect(pixelAt(icon.rgba, 32, 32)[3]).toBe(255);
  });

  it("draws the device body and the first keys with the specified colors", () => {
    expect(pixelAt(icon.rgba, 10, 18)).toEqual([36, 36, 42, 255]);
    const expected: Pixel[] = [
      [255, 255, 255, 255],
      [20, 20, 20, 255],
      [255, 0, 255, 255],
      [0, 0, 170, 255],
      [85, 85, 85, 255],
      [255, 170, 0, 255],
    ];
    expected.forEach((color, i) => {
      const [x, y] = keyCenter(i % 5, Math.floor(i / 5));
      expect(pixelAt(icon.rgba, x, y), `key ${i}`).toEqual(color);
    });
    for (let i = 6; i < 15; i++) {
      const [x, y] = keyCenter(i % 5, Math.floor(i / 5));
      expect(pixelAt(icon.rgba, x, y), `key ${i}`).toEqual([70, 70, 78, 255]);
    }
  });

  it("leaves a 2 px gap between keys", () => {
    const [x, y] = keyCenter(0, 0);
    expect(pixelAt(icon.rgba, x + 4, y)).toEqual([36, 36, 42, 255]);
    expect(pixelAt(icon.rgba, x + 5, y)).toEqual([36, 36, 42, 255]);
  });

  describe("TGA", () => {
    const tga = toTga(icon);

    it("has an uncompressed 32-bit true-color header and the exact size", () => {
      expect(tga.length).toBe(18 + 64 * 64 * 4);
      expect(tga[0]).toBe(0); // no image id
      expect(tga[1]).toBe(0); // no color map
      expect(tga[2]).toBe(2); // uncompressed true-color
      expect(Array.from(tga.subarray(3, 12))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]); // color map spec, x/y origin
      expect(tga[12] | (tga[13] << 8)).toBe(64);
      expect(tga[14] | (tga[15] << 8)).toBe(64);
      expect(tga[16]).toBe(32);
      expect(tga[17]).toBe(0x08);
    });

    it("stores BGRA pixels bottom-to-top", () => {
      for (const [x, y] of [[0, 0], [32, 3], [13, 22], [40, 22], [22, 31], [63, 63]]) {
        const [r, g, b, a] = pixelAt(icon.rgba, x, y);
        const o = 18 + ((63 - y) * 64 + x) * 4;
        expect(Array.from(tga.subarray(o, o + 4)), `(${x}, ${y})`).toEqual([b, g, r, a]);
      }
    });
  });

  describe("generated files", () => {
    it("PNG is 64x64 and matches the drawing", () => {
      const png = PNG.sync.read(readFileSync(PNG_PATH));
      expect(png.width).toBe(64);
      expect(png.height).toBe(64);
      expect(pixelAt(png.data, 0, 0)[3]).toBe(0);
      const [fx, fy] = keyCenter(0, 0);
      const [ax, ay] = keyCenter(3, 0);
      expect(pixelAt(png.data, fx, fy)).toEqual([255, 255, 255, 255]);
      expect(pixelAt(png.data, ax, ay)).toEqual([0, 0, 170, 255]);
      expect(Buffer.from(png.data).equals(Buffer.from(icon.rgba))).toBe(true);
    });

    it("TGA file is the generator output and agrees with the PNG", () => {
      const file = readFileSync(TGA_PATH);
      expect(file.length).toBe(18 + 64 * 64 * 4);
      expect(Buffer.from(toTga(icon)).equals(file)).toBe(true);
      const png = PNG.sync.read(readFileSync(PNG_PATH));
      for (const [x, y] of [[0, 0], [13, 22], [40, 22], [22, 31], [32, 3]]) {
        const [r, g, b, a] = pixelAt(png.data, x, y);
        const o = 18 + ((63 - y) * 64 + x) * 4;
        expect(Array.from(file.subarray(o, o + 4)), `(${x}, ${y})`).toEqual([b, g, r, a]);
      }
    });
  });
});
