import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import luaparse from "luaparse";
import { ADDON_DIR, ADDON_FILES, createLua, loadAddonFiles } from "./harness";

describe("addon skeleton", () => {
  it("toc declares interface 16001", () => {
    const toc = readFileSync(join(ADDON_DIR, "HeroDeck.toc"), "utf8");
    const lines = toc.split(/\r?\n/);
    expect(lines).toContain("## Interface: 16001");
    expect(lines).toContain("## Title: HeroDeck");
  });

  it("toc declares IconTexture and SavedVariables HeroDeckDB", () => {
    const toc = readFileSync(join(ADDON_DIR, "HeroDeck.toc"), "utf8");
    const lines = toc.split(/\r?\n/);
    expect(lines).toContain("## SavedVariables: HeroDeckDB");
    expect(lines).toContain("## IconTexture: Interface\\AddOns\\HeroDeck\\Media\\Icon");
    expect(existsSync(join(ADDON_DIR, "Media", "Icon.tga"))).toBe(true);
    expect(ADDON_FILES.some((file) => file.startsWith("#") || file.includes("IconTexture"))).toBe(false);
  });

  it("every toc file exists and parses as Lua 5.1", () => {
    expect(ADDON_FILES.length).toBeGreaterThan(0);
    for (const file of ADDON_FILES) {
      const src = readFileSync(join(ADDON_DIR, file), "utf8");
      expect(() => luaparse.parse(src, { luaVersion: "5.1" }), file).not.toThrow();
    }
  });

  it("loads all addon files into one namespace", async () => {
    const lua = await createLua();
    try {
      await loadAddonFiles(lua, ADDON_FILES);
      expect(await lua.doString("return type(HeroDeckNS)")).toBe("table");
    } finally {
      lua.global.close();
    }
  });
});
