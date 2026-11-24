import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "streamdeck", "com.devilcable.herodeck.sdPlugin");

describe("release readiness of the Stream Deck plugin", () => {
  it("does not run the plugin in Node debug mode", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN, "manifest.json"), "utf8"));
    expect(manifest.Nodejs.Debug).toBeUndefined();
  });

  it("loads every property inspector script from the plugin folder, not the internet", () => {
    const html = readFileSync(join(PLUGIN, "ui", "durability.html"), "utf8");
    const sources = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src).not.toMatch(/^[a-z]+:\/\//i);
      expect(existsSync(resolve(PLUGIN, "ui", src))).toBe(true);
    }
  });
});
