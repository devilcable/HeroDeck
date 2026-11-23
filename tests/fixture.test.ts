import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { RawImage } from "../streamdeck/src/channel/protocol";
import { readStrip } from "../streamdeck/src/channel/strip";

function loadFixture(name: string): RawImage {
  const png = PNG.sync.read(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

describe("real WoW Forever capture", () => {
  // Window capture of the live client (2560x1440, D3D12, maximized), cropped to the top-left
  // corner. The character's most damaged item was at 85 % when it was taken.
  it("decodes durability 85 from a saved window capture", () => {
    const strip = readStrip(loadFixture("strip-window.png"));
    expect(strip).not.toBeNull();
    expect(strip!.version).toBe(1);
    expect(strip!.fields[0]).toBe(85);
  });
});
