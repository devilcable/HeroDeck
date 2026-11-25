import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM tool script, no type declarations
import { addonZip, versions, withFileRestored } from "../tools/package.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADDON = join(ROOT, "addon", "HeroDeck");

describe("release packages", () => {
  it("uses the same version in the plugin manifest and the addon .toc", () => {
    const v = versions();
    expect(v.toc).toBe("0.2.0");
    expect(v.manifest).toBe(`${v.toc}.0`);
  });

  it("puts back a file that a step rewrote (streamdeck pack drops the manifest's final newline)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "herodeck-")), "manifest.json");
    writeFileSync(file, '{\n\t"a": 1\n}\n');
    const result = withFileRestored(file, () => {
      writeFileSync(file, '{\n\t"a": 1\n}');
      return 42;
    });
    expect(result).toBe(42);
    expect(readFileSync(file, "utf8")).toBe('{\n\t"a": 1\n}\n');
  });

  it("puts the file back even when the step fails", () => {
    const file = join(mkdtempSync(join(tmpdir(), "herodeck-")), "manifest.json");
    writeFileSync(file, "before\n");
    expect(() =>
      withFileRestored(file, () => {
        writeFileSync(file, "after");
        throw new Error("pack failed");
      }),
    ).toThrow("pack failed");
    expect(readFileSync(file, "utf8")).toBe("before\n");
  });

  describe("addon zip", () => {
    const entries = unzipSync(addonZip(ADDON));
    const names = Object.keys(entries);

    it("holds everything under a single HeroDeck/ folder with forward slashes", () => {
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name.startsWith("HeroDeck/")).toBe(true);
        expect(name).not.toContain("\\");
      }
    });

    it("holds the .toc and every file it loads", () => {
      const toc = readFileSync(join(ADDON, "HeroDeck.toc"), "utf8");
      const files = toc
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
      expect(files.length).toBeGreaterThan(0);
      expect(names).toContain("HeroDeck/HeroDeck.toc");
      for (const file of files) expect(names).toContain(`HeroDeck/${file.replace(/\\/g, "/")}`);
    });

    it("keeps binary files byte for byte", () => {
      const icon = new Uint8Array(readFileSync(join(ADDON, "Media", "Icon.tga")));
      expect(entries["HeroDeck/Media/Icon.tga"]).toEqual(icon);
    });
  });
});
