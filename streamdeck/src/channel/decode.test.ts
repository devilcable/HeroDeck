import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeField, decodeStrip } from "./decode";
import type { RGB } from "./protocol";

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

const rgb = ([r, g, b]: Triple): RGB => ({ r, g, b });
const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
const mapCell = (c: Triple, fn: (v: number) => number): Triple => [fn(c[0]), fn(c[1]), fn(c[2])];

/** Full strip: header then every vector field, with `fn` applied to every channel. */
function buildStrip(fn: (v: number) => number = (v) => v): RGB[] {
  const cells: Triple[] = [...vectors.header, ...vectors.fields.flatMap((f) => f.cells)];
  return cells.map((c) => rgb(mapCell(c, fn)));
}

const expectedValues = vectors.fields.map((f) => f.value);

describe("channel strip decoder", () => {
  it("decodes every vector field", () => {
    const strip = decodeStrip(buildStrip());
    expect(strip?.fields).toEqual(expectedValues);
  });

  it("decodes the header: version 2", () => {
    const strip = decodeStrip(buildStrip());
    expect(strip?.version).toBe(2);
  });

  it("rejects version 1", () => {
    const v1 = buildStrip();
    v1[3] = rgb([0, 0, 85]);
    expect(decodeStrip(v1)).toBeNull();
  });

  it("survives a linear shift", () => {
    const strip = decodeStrip(buildStrip((v) => clamp(v * 0.85 + 20)));
    expect(strip?.fields).toEqual(expectedValues);
  });

  it("survives mild gamma", () => {
    const strip = decodeStrip(buildStrip((v) => clamp(255 * (v / 255) ** (1 / 1.1))));
    expect(strip?.fields).toEqual(expectedValues);
  });

  it("rejects a channel halfway between levels", () => {
    const cells = buildStrip();
    // field 2 (value 87) starts at cell 4 + 2*2; set one data channel of its cell A to 128
    cells[8] = { ...cells[8], g: 128 };
    const strip = decodeStrip(cells);
    expect(strip).not.toBeNull();
    expect(strip?.fields).toEqual(expectedValues.map((v, i) => (i === 2 ? null : v)));
  });

  it("rejects a bad check", () => {
    const white = rgb([255, 255, 255]);
    const black = rgb([0, 0, 0]);
    const good = vectors.fields[2];
    expect(decodeField(rgb(good.cells[0]), rgb(good.cells[1]), white, black)).toBe(87);
    // cell B of 87 is [255,170,0] (56); flipping the lowest check bit gives 57 = [255,170,85]
    expect(decodeField(rgb(good.cells[0]), rgb([255, 170, 85]), white, black)).toBeNull();
  });

  it("rejects a strip without contrast", () => {
    const cells = buildStrip((v) => 60 + (v / 255) * 60);
    expect(cells[0]).toEqual(rgb([120, 120, 120]));
    expect(cells[1]).toEqual(rgb([60, 60, 60]));
    expect(decodeStrip(cells)).toBeNull();
  });

  it("rejects a wrong marker or version", () => {
    const badMarker = buildStrip();
    badMarker[2] = rgb([255, 0, 0]);
    expect(decodeStrip(badMarker)).toBeNull();

    const badVersion = buildStrip();
    badVersion[3] = rgb([0, 0, 255]);
    expect(decodeStrip(badVersion)).toBeNull();
  });

  it("rejects a strip with too few cells or a wrong header reference", () => {
    expect(decodeStrip(buildStrip().slice(0, 3))).toBeNull();
    const notWhite = buildStrip();
    notWhite[0] = rgb([255, 255, 170]);
    expect(decodeStrip(notWhite)).toBeNull();
  });
});
