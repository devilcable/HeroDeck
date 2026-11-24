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

/**
 * Lua-side default mocks: recording frames and textures. Any method (CamelCase name)
 * that is not implemented below is a no-op, so code that only calls such methods keeps
 * working. Unset data fields (lowercase names) read as nil.
 *
 * Recorded per frame (in the global list __frames, creation order): parent, strata,
 * scale, frameLevel, ignoreParentScale, events (set of registered names), scripts (by name),
 * points, textures (creation order).
 * Globals: Minimap (140 wide, center 1000,500), __cursor / GetCursorPosition, __locale /
 * GetLocale, GameTooltip (owner, anchor, lines, shown), SlashCmdList = {}, print captured
 * in __printed, C_Timer.NewTicker records tickers in __tickers. Frames answer GetWidth / GetHeight; textures record texturePath (SetTexture).
 * Settable per frame by tests: center = {x, y} (returned by GetCenter, nil when unset) and
 * effectiveScale (returned by GetEffectiveScale; when unset: parent effective scale x the SetScale
 * value for a scaled child that does not ignore its parent's scale, else 1); GetFrameLevel returns
 * frameLevel (0 when unset).
 * Recorded per texture: layer, color = {r,g,b,a} (rgb stored x255 and rounded), width,
 * height, points = { {point, relativeTo, relativePoint, x, y}, ... }.
 */
const LUA_DEFAULTS = `
  local noop = function() end
  local function newObject(methods)
    local obj = {}
    return setmetatable(obj, {
      __index = function(_, key)
        if methods[key] then
          return methods[key]
        end
        -- WoW methods are CamelCase (Show, SetSize...). Anything else is a data field
        -- (color, width, scripts...): unset means nil, like on the real objects.
        if type(key) == "string" and key:match("^%u") then
          return noop
        end
        return nil
      end,
    })
  end

  local function recordPoint(self, point, relativeTo, relativePoint, x, y)
    -- Supports SetPoint(point), SetPoint(point, x, y) and the full 5-argument form.
    if type(relativeTo) == "number" then
      x, y, relativeTo, relativePoint = relativeTo, relativePoint, nil, nil
    end
    self.points[#self.points + 1] = {
      point = point,
      relativeTo = relativeTo,
      relativePoint = relativePoint or point,
      x = x or 0,
      y = y or 0,
    }
  end

  local textureMethods = {
    SetColorTexture = function(self, r, g, b, a)
      self.color = {
        r = math.floor(r * 255 + 0.5),
        g = math.floor(g * 255 + 0.5),
        b = math.floor(b * 255 + 0.5),
        a = a,
      }
    end,
    SetTexture = function(self, path) self.texturePath = path end,
    SetSize = function(self, w, h) self.width = w; self.height = h end,
    SetWidth = function(self, w) self.width = w end,
    SetHeight = function(self, h) self.height = h end,
    ClearAllPoints = function(self) self.points = {} end,
    SetPoint = recordPoint,
  }

  local frameMethods = {
    CreateTexture = function(self, _, layer)
      local texture = newObject(textureMethods)
      texture.layer = layer
      texture.points = {}
      self.textures[#self.textures + 1] = texture
      return texture
    end,
    SetParent = function(self, parent) self.parent = parent end,
    SetFrameStrata = function(self, strata) self.strata = strata end,
    SetFrameLevel = function(self, level) self.frameLevel = level end,
    GetFrameLevel = function(self) return self.frameLevel or 0 end,
    GetEffectiveScale = function(self)
      if self.effectiveScale then return self.effectiveScale end
      -- A scaled child follows its parent: parent effective scale x own SetScale value.
      if self.scale and self.parent and not self.ignoreParentScale then
        return self.parent:GetEffectiveScale() * self.scale
      end
      return 1
    end,
    GetCenter = function(self)
      if self.center then return self.center.x, self.center.y end
    end,
    SetScale = function(self, scale) self.scale = scale end,
    SetIgnoreParentScale = function(self, ignore) self.ignoreParentScale = ignore end,
    RegisterEvent = function(self, event) self.events[event] = true end,
    SetScript = function(self, name, fn) self.scripts[name] = fn end,
    SetSize = function(self, w, h) self.width = w; self.height = h end,
    GetWidth = function(self) return self.width or 0 end,
    GetHeight = function(self) return self.height or 0 end,
    ClearAllPoints = function(self) self.points = {} end,
    SetPoint = recordPoint,
  }

  local function newFrame(parent)
    local frame = newObject(frameMethods)
    frame.parent = parent
    frame.events = {}
    frame.scripts = {}
    frame.points = {}
    frame.textures = {}
    return frame
  end

  __frames = {}
  CreateFrame = function(_, _, parent)
    local frame = newFrame(parent)
    __frames[#__frames + 1] = frame
    return frame
  end
  WorldFrame = newFrame(nil)
  UIParent = newFrame(nil)

  -- Minimap: 140 wide, centered at (1000, 500), scale 1 (tests may change center/effectiveScale).
  Minimap = newFrame(UIParent)
  Minimap.width = 140
  Minimap.height = 140
  Minimap.center = { x = 1000, y = 500 }

  -- Cursor position in screen units; tests set __cursor.x / __cursor.y.
  __cursor = { x = 0, y = 0 }
  GetCursorPosition = function() return __cursor.x, __cursor.y end

  -- Locale; tests set __locale.
  __locale = "enUS"
  GetLocale = function() return __locale end

  -- GameTooltip records owner, anchor, lines (AddLine text) and shown.
  GameTooltip = newObject({
    SetOwner = function(self, owner, anchor) self.owner = owner; self.anchor = anchor; self.lines = {} end,
    AddLine = function(self, text) self.lines[#self.lines + 1] = text end,
    Show = function(self) self.shown = true end,
    Hide = function(self) self.shown = false end,
  })
  GameTooltip.lines = {}

  SlashCmdList = {}

  -- C_Timer.NewTicker records each ticker in __tickers (seconds, callback, cancelled); tests
  -- simulate a tick by calling ticker.callback(ticker). The handle has Cancel().
  __tickers = {}
  C_Timer = {
    NewTicker = function(seconds, callback)
      local ticker = { seconds = seconds, callback = callback, cancelled = false }
      function ticker:Cancel() self.cancelled = true end
      __tickers[#__tickers + 1] = ticker
      return ticker
    end,
  }

  -- print records its output in __printed (tostring of the arguments joined by a space).
  __printed = {}
  print = function(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
    __printed[#__printed + 1] = table.concat(parts, " ")
  end
`;

/** JS-side default mocks. Tests override individual entries through createLua(mocks). */
function jsDefaults(): Record<string, unknown> {
  return {
    GetPhysicalScreenSize: () => LuaMultiReturn.of(1920, 1080),
    GetInventoryItemDurability: () => undefined,
    GetInventoryItemID: () => undefined,
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
