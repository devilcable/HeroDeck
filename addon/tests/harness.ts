import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LuaFactory, LuaMultiReturn, type LuaEngine } from "wasmoon";

export const ADDON_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "HeroDeck",
);

/** Load order, read from HeroDeck.toc (lines that are neither comments nor empty). */
export const ADDON_FILES: string[] = readFileSync(join(ADDON_DIR, "HeroDeck.toc"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

/** Lua-side default mocks: a frame whose methods (and any other key) are no-ops. */
const LUA_DEFAULTS = `
  local noop = function() end
  local frameMeta = { __index = function() return noop end }
  CreateFrame = function() return setmetatable({}, frameMeta) end
  WorldFrame = setmetatable({}, frameMeta)
`;

/** JS-side default mocks. Tests override individual entries through createLua(mocks). */
function jsDefaults(): Record<string, unknown> {
  return {
    GetPhysicalScreenSize: () => LuaMultiReturn.of(1920, 1080),
    GetInventoryItemDurability: () => undefined,
  };
}

const factory = new LuaFactory();

/** Create a Lua engine with the default mocks, overridden by `mocks`, set as globals. */
export async function createLua(mocks: Record<string, unknown> = {}): Promise<LuaEngine> {
  const lua = await factory.createEngine();
  await lua.doString(LUA_DEFAULTS);
  for (const [name, value] of Object.entries({ ...jsDefaults(), ...mocks })) {
    lua.global.set(name, value);
  }
  return lua;
}

/**
 * Run each addon file (path relative to addon/HeroDeck) as a chunk called with
 * ("HeroDeck", ns). The same ns table is shared by all files and exposed as the
 * Lua global HeroDeckNS.
 */
export async function loadAddonFiles(lua: LuaEngine, files: string[]): Promise<void> {
  await lua.doString("HeroDeckNS = HeroDeckNS or {}");
  for (const file of files) {
    lua.global.set("__chunkSrc", readFileSync(join(ADDON_DIR, file), "utf8"));
    lua.global.set("__chunkName", file);
    await lua.doString(`
      local fn, err = load(__chunkSrc, "@" .. __chunkName)
      if not fn then error(err) end
      fn("HeroDeck", HeroDeckNS)
    `);
  }
  lua.global.set("__chunkSrc", undefined);
  lua.global.set("__chunkName", undefined);
}
