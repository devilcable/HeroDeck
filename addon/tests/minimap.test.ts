import { LuaMultiReturn, type LuaEngine } from "wasmoon";
import { describe, expect, it } from "vitest";
import { ADDON_FILES, createLua, loadAddonFiles } from "./harness";

async function withAddon<T>(
  fn: (lua: LuaEngine) => Promise<T>,
  setup = "",
  mocks: Record<string, unknown> = {},
): Promise<T> {
  const lua = await createLua(mocks);
  try {
    if (setup) {
      await lua.doString(setup);
    }
    await loadAddonFiles(lua, ADDON_FILES);
    return await fn(lua);
  } finally {
    lua.global.close();
  }
}

const MINIMAP_HALF = 70; // default Minimap mock: 140 wide
const MB = "HeroDeckNS.MinimapButton";
const BTN = `${MB}.frame`;
const fire = (lua: LuaEngine, event: string) =>
  lua.doString(`
    for _, f in ipairs(__frames) do
      if f.events["${event}"] then f.scripts.OnEvent(f, "${event}") end
    end
  `);
const nums = async (lua: LuaEngine, expr: string) => (await lua.doString(`return {${expr}}`)) as number[];

/** Lua: count Channel:Layout calls in the global __layouts. */
const SPY_LAYOUT = `
  __layouts = 0
  local orig = HeroDeckNS.Channel.Layout
  HeroDeckNS.Channel.Layout = function(self) __layouts = __layouts + 1; return orig(self) end
`;

describe("toc", () => {
  it("loads Init, Codec, Channel, MinimapButton, Durability in that order", () => {
    expect(ADDON_FILES).toEqual([
      "Core/Init.lua",
      "Core/Codec.lua",
      "Core/Channel.lua",
      "Core/MinimapButton.lua",
      "Modules/Durability.lua",
    ]);
  });
});

describe("MinimapButton pure helpers", () => {
  it("constants", async () => {
    await withAddon(async (lua) => {
      expect(await nums(lua, `${MB}.DEFAULT_ANGLE, ${MB}.OFFSET`)).toEqual([225, 10]);
    });
  });

  it("PositionFor", async () => {
    await withAddon(async (lua) => {
      const at = (a: number, r: number) => nums(lua, `${MB}.PositionFor(${a}, ${r})`);
      const [x0, y0] = await at(0, 80);
      expect(x0).toBeCloseTo(80, 6);
      expect(y0).toBeCloseTo(0, 6);
      const [x90, y90] = await at(90, 80);
      expect(x90).toBeCloseTo(0, 6);
      expect(y90).toBeCloseTo(80, 6);
      const [x225, y225] = await at(225, 80);
      expect(x225).toBeCloseTo(-56.5685424949, 6);
      expect(y225).toBeCloseTo(-56.5685424949, 6);
    });
  });

  const ANGLES: [string, number][] = [
    ["0, 0, 10, 0", 0],
    ["0, 0, 0, 10", 90],
    ["0, 0, -10, 0", 180],
    ["0, 0, 0, -10", 270],
  ];

  it("AngleFrom", async () => {
    await withAddon(async (lua) => {
      for (const [args, deg] of ANGLES) {
        const [got] = await nums(lua, `${MB}.AngleFrom(${args})`);
        expect(got, args).toBeCloseTo(deg, 9);
        expect(got).toBeGreaterThanOrEqual(0);
        expect(got).toBeLessThan(360);
      }
    });
  });

  it("AngleFrom works with 5.1-style math (atan2, one-arg atan)", async () => {
    await withAddon(
      async (lua) => {
        for (const [args, deg] of ANGLES) {
          const [got] = await nums(lua, `${MB}.AngleFrom(${args})`);
          expect(got, args).toBeCloseTo(deg, 9);
        }
      },
      "local atan = math.atan; math.atan2 = atan; math.atan = function(x) return atan(x) end",
    );
  });

  it("AngleFrom works without math.atan2 (5.4-style math)", async () => {
    await withAddon(async (lua) => {
      for (const [args, deg] of ANGLES) {
        const [got] = await nums(lua, `${MB}.AngleFrom(${args})`);
        expect(got, args).toBeCloseTo(deg, 9);
      }
    }, "math.atan2 = nil");
  });

  it("TooltipLines", async () => {
    await withAddon(async (lua) => {
      const lines = (percent: string, locale: string) =>
        lua.doString(`return {${MB}.TooltipLines(${percent}, "${locale}")}`);
      expect(await lines("80", "frFR")).toEqual(["HeroDeck", "Durabilité 80 %"]);
      expect(await lines("80", "enUS")).toEqual(["HeroDeck", "Durability 80%"]);
      expect(await lines("80", "deDE")).toEqual(["HeroDeck", "Durability 80%"]);
      expect(await lines("nil", "enUS")).toEqual(["HeroDeck", "Durability ?%"]);
      expect(await lines("nil", "frFR")).toEqual(["HeroDeck", "Durabilité ? %"]);
    });
  });
});

describe("MinimapButton.SavedAngle", () => {
  it("defaults to 225 and creates HeroDeckDB", async () => {
    await withAddon(async (lua) => {
      expect(await lua.doString("return HeroDeckDB")).toBeNull();
      expect(await lua.doString(`return ${MB}.SavedAngle()`)).toBe(225);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(225);
    });
  });

  it("keeps a saved 40", async () => {
    await withAddon(async (lua) => {
      await lua.doString("HeroDeckDB = { minimap = { angle = 40 } }");
      expect(await lua.doString(`return ${MB}.SavedAngle()`)).toBe(40);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(40);
    });
  });

  it("corrupt saved angle falls back to 225", async () => {
    await withAddon(async (lua) => {
      for (const corrupt of ['"x"', "0/0", "math.huge", "-math.huge", "true", "{}"]) {
        await lua.doString(`HeroDeckDB = { minimap = { angle = ${corrupt} } }`);
        expect(await lua.doString(`return ${MB}.SavedAngle()`), corrupt).toBe(225);
        expect(await lua.doString("return HeroDeckDB.minimap.angle"), corrupt).toBe(225);
      }
      await lua.doString('HeroDeckDB = { minimap = "oops" }');
      expect(await lua.doString(`return ${MB}.SavedAngle()`)).toBe(225);
      await lua.doString('HeroDeckDB = "oops"');
      expect(await lua.doString(`return ${MB}.SavedAngle()`)).toBe(225);
    });
  });
});

describe("MinimapButton frame", () => {
  it("Init creates the 31 x 31 HIGH button on the Minimap with its art; idempotent", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); first = ${BTN}; ${MB}:Init()`);
      expect(await lua.doString(`return ${BTN} == first`)).toBe(true);
      expect(await lua.doString(`return ${BTN}.parent == Minimap`)).toBe(true);
      expect(await nums(lua, `${BTN}.width, ${BTN}.height`)).toEqual([31, 31]);
      expect(await lua.doString(`return ${BTN}.strata`)).toBe("HIGH");
      expect(await lua.doString(`return ${BTN}.frameLevel > Minimap:GetFrameLevel()`)).toBe(true);
      expect(await lua.doString("return #__frames")).toBe(2); // Durability frame, button (the Minimap mock is not recorded)
      const art = await lua.doString(`
        local out = {}
        for _, t in ipairs(${BTN}.textures) do
          local p = t.points[1]
          out[#out + 1] = { t.layer, t.texturePath, t.width, t.height, p.point, p.x, p.y }
        end
        return out
      `);
      expect(art).toEqual([
        ["BACKGROUND", "Interface\\Minimap\\UI-Minimap-Background", 20, 20, "CENTER", 0, 0],
        ["OVERLAY", "Interface\\Minimap\\MiniMap-TrackingBorder", 53, 53, "TOPLEFT", 0, 0],
      ]);
    });
  });

  it("Place anchors CENTER on the Minimap at the polar offset", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(0)`);
      const p = await lua.doString(`
        local p = ${BTN}.points[#${BTN}.points]
        return { p.point, p.relativeTo == Minimap, p.relativePoint, p.x, p.y }
      `);
      expect(p).toEqual(["CENTER", true, "CENTER", 80, 0]);
    });
  });

  it("Place re-snaps the channel grid", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); HeroDeckNS.Channel:Init(${BTN})`);
      await lua.doString(`
        __order = {}
        local orig = HeroDeckNS.Channel.Layout
        HeroDeckNS.Channel.Layout = function(self)
          __order[#__order + 1] = #${BTN}.points
          return orig(self)
        end
        ${MB}:Place(45)
      `);
      // Layout ran once, after the new point was set.
      expect(await lua.doString("return #__order")).toBe(1);
      expect(await lua.doString(`return __order[1] == #${BTN}.points`)).toBe(true);
    });
  });

  it("Reset places the button at 225 and saves it", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(10); ${MB}:Reset()`);
      const [x, y] = await nums(lua, `${BTN}.points[#${BTN}.points].x, ${BTN}.points[#${BTN}.points].y`);
      expect(x).toBeCloseTo(-56.5685424949, 6);
      expect(y).toBeCloseTo(-56.5685424949, 6);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(225);
    });
  });
});

describe("MinimapButton drag", () => {
  it("drag moves the button and saves on stop", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(225)`);
      await lua.doString(`
        __cursor.x, __cursor.y = 1000, 600 -- straight above the Minimap center (1000, 500)
        ${BTN}.scripts.OnDragStart(${BTN})
        ${BTN}.scripts.OnUpdate(${BTN}, 0.016)
      `);
      // Not saved yet while dragging.
      expect(await lua.doString("return HeroDeckDB == nil or HeroDeckDB.minimap == nil or HeroDeckDB.minimap.angle ~= 90")).toBe(true);
      await lua.doString(`${BTN}.scripts.OnDragStop(${BTN})`);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(90);
      const [x, y] = await nums(lua, `${BTN}.points[#${BTN}.points].x, ${BTN}.points[#${BTN}.points].y`);
      expect(x).toBeCloseTo(0, 6);
      expect(y).toBe(MINIMAP_HALF + 10);
    });
  });

  it("divides the cursor by the Minimap effective scale", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init()`);
      await lua.doString(`
        Minimap.effectiveScale = 2
        __cursor.x, __cursor.y = 2200, 1000 -- (1100, 500) in Minimap units: right of the center (1000, 500)
        ${BTN}.scripts.OnDragStart(${BTN})
        ${BTN}.scripts.OnUpdate(${BTN}, 0.016)
        ${BTN}.scripts.OnDragStop(${BTN})
      `);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(0);
    });
  });

  // OnDragStop does not fire when the button is hidden or the mouse is released elsewhere.
  for (const script of ["OnHide", "OnMouseUp"]) {
    it(`${script} ends a drag that never got OnDragStop: the angle is saved and the button stays put`, async () => {
      await withAddon(async (lua) => {
        await lua.doString(`${MB}:Init(); ${MB}:Place(225)`);
        await lua.doString(`
          __cursor.x, __cursor.y = 1000, 600 -- straight above the Minimap center (1000, 500)
          ${BTN}.scripts.OnDragStart(${BTN})
          ${BTN}.scripts.OnUpdate(${BTN}, 0.016)
          ${BTN}.scripts.${script}(${BTN})
        `);
        expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(90);
        // the cursor moves on: the button no longer follows it
        await lua.doString(`
          __cursor.x, __cursor.y = 1100, 500
          ${BTN}.scripts.OnUpdate(${BTN}, 0.016)
        `);
        expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(90);
        const [x, y] = await nums(lua, `${BTN}.points[#${BTN}.points].x, ${BTN}.points[#${BTN}.points].y`);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBe(MINIMAP_HALF + 10);
      });
    });
  }

  it("OnHide and OnMouseUp without a drag do not touch the saved angle", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(225)`);
      await lua.doString(`${BTN}.scripts.OnHide(${BTN}); ${BTN}.scripts.OnMouseUp(${BTN}, "LeftButton")`);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(40);
    }, "HeroDeckDB = { minimap = { angle = 40 } }");
  });

  it("Layout runs on every drag step", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); HeroDeckNS.Channel:Init(${BTN})`);
      await lua.doString(SPY_LAYOUT);
      await lua.doString(`
        ${BTN}.scripts.OnDragStart(${BTN})
        __cursor.x, __cursor.y = 1100, 500
        ${BTN}.scripts.OnUpdate(${BTN}, 0.001)
        __cursor.x, __cursor.y = 1000, 600
        ${BTN}.scripts.OnUpdate(${BTN}, 0.001)
      `);
      expect(await lua.doString("return __layouts")).toBe(2);
    });
  });
});

describe("MinimapButton keeps the grid on the button", () => {
  const LOGIN_SETUP = "HeroDeckDB = { minimap = { angle = 40 } }";

  it("PLAYER_ENTERING_WORLD re-snaps the grid", async () => {
    await withAddon(async (lua) => {
      await fire(lua, "PLAYER_LOGIN");
      await lua.doString(SPY_LAYOUT);
      await fire(lua, "PLAYER_ENTERING_WORLD");
      expect(await lua.doString("return __layouts")).toBe(1);
    }, LOGIN_SETUP);
  });

  it("a moved button re-snaps the grid within 0.25 s; an unmoved one does not", async () => {
    await withAddon(async (lua) => {
      await fire(lua, "PLAYER_LOGIN");
      await lua.doString(`${BTN}.center = { x = 300, y = 300 }`);
      await lua.doString(SPY_LAYOUT);
      const tick = (dt: number) => lua.doString(`${BTN}.scripts.OnUpdate(${BTN}, ${dt}); return __layouts`);

      expect(await tick(0.1)).toBe(0); // throttled
      expect(await tick(0.1)).toBe(0);
      expect(await tick(0.1)).toBe(1); // 0.3 s elapsed, center changed
      expect(await tick(0.3)).toBe(1); // nothing moved
      await lua.doString(`${BTN}.center = { x = 310.5, y = 300 }`);
      expect(await tick(0.1)).toBe(1); // throttled again
      expect(await tick(0.2)).toBe(2);
      await lua.doString(`${BTN}.effectiveScale = 2`);
      expect(await tick(0.3)).toBe(3); // same center, different scale
      expect(await tick(0.3)).toBe(3);
    }, LOGIN_SETUP);
  });
});

describe("MinimapButton tooltip", () => {
  const tooltip = (lua: LuaEngine) =>
    lua.doString("return { GameTooltip.lines[1], GameTooltip.lines[2], GameTooltip.anchor, GameTooltip.shown }");

  it("shows HeroDeck and the last durability, owned by the button", async () => {
    await withAddon(
      async (lua) => {
        await fire(lua, "PLAYER_LOGIN");
        await lua.doString(`${BTN}.scripts.OnEnter(${BTN})`);
        expect(await lua.doString(`return GameTooltip.owner == ${BTN}`)).toBe(true);
        expect(await tooltip(lua)).toEqual(["HeroDeck", "Durability 80%", "ANCHOR_LEFT", true]);
        await lua.doString(`${BTN}.scripts.OnLeave(${BTN})`);
        expect(await lua.doString("return GameTooltip.shown")).toBe(false);
      },
      "HeroDeckDB = { minimap = { angle = 40 } }",
      { GetInventoryItemDurability: (slot: number) => (slot === 1 ? LuaMultiReturn.of(80, 100) : undefined) },
    );
  });

  it("reads Durability.last and the locale at hover time", async () => {
    await withAddon(async (lua) => {
      await fire(lua, "PLAYER_LOGIN");
      await lua.doString(`${BTN}.scripts.OnEnter(${BTN})`);
      expect((await tooltip(lua))[1]).toBe("Durability 100%");
      await lua.doString(`HeroDeckNS.Durability.last = nil; __locale = "frFR"; ${BTN}.scripts.OnEnter(${BTN})`);
      expect((await tooltip(lua))[1]).toBe("Durabilité ? %");
      await lua.doString(`HeroDeckNS.Durability.last = 62; ${BTN}.scripts.OnEnter(${BTN})`);
      expect((await tooltip(lua))[1]).toBe("Durabilité 62 %");
    });
  });

  it("opens away from the minimap: LEFT on the right half, RIGHT on the left half", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init()`);
      const anchorAt = async (angle: number) => {
        await lua.doString(`${MB}:Place(${angle}); ${BTN}.scripts.OnEnter(${BTN})`);
        return lua.doString("return GameTooltip.anchor");
      };
      expect(await anchorAt(0)).toBe("ANCHOR_LEFT");
      expect(await anchorAt(40)).toBe("ANCHOR_LEFT");
      expect(await anchorAt(300)).toBe("ANCHOR_LEFT");
      expect(await anchorAt(90)).toBe("ANCHOR_RIGHT");
      expect(await anchorAt(225)).toBe("ANCHOR_RIGHT");
      expect(await anchorAt(270)).toBe("ANCHOR_RIGHT");
    });
  });
});

describe("/herodeck", () => {
  it("registers the slash command", async () => {
    await withAddon(async (lua) => {
      expect(await lua.doString("return SLASH_HERODECK1")).toBe("/herodeck");
      expect(await lua.doString('return type(SlashCmdList.HERODECK)')).toBe("function");
    });
  });

  it("/herodeck reset puts the button back at 225", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(40); SlashCmdList.HERODECK("reset")`);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(225);
      const [x] = await nums(lua, `${BTN}.points[#${BTN}.points].x`);
      expect(x).toBeCloseTo(-56.5685424949, 6);
      await lua.doString(`${MB}:Place(40); SlashCmdList.HERODECK("  RESET ")`);
      expect(await lua.doString("return HeroDeckDB.minimap.angle")).toBe(225);
    });
  });

  it("/herodeck foo prints usage and does not move the button", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(40); SlashCmdList.HERODECK("foo"); SlashCmdList.HERODECK("")`);
      expect(await lua.doString("return __printed")).toEqual(["HeroDeck: /herodeck reset", "HeroDeck: /herodeck reset"]);
      expect(await lua.doString("return HeroDeckDB == nil or HeroDeckDB.minimap == nil or HeroDeckDB.minimap.angle ~= 225")).toBe(true);
    });
  });
});
