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
/** The button's last anchor offset in Minimap units (the SetPoint offset is in the button's own, scaled units). */
const onMinimap = (lua: LuaEngine) =>
  nums(lua, `${BTN}.points[#${BTN}.points].x * ${BTN}.scale, ${BTN}.points[#${BTN}.points].y * ${BTN}.scale`);

/** Lua: count Channel:Layout calls in the global __layouts. */
const SPY_LAYOUT = `
  __layouts = 0
  local orig = HeroDeckNS.Channel.Layout
  HeroDeckNS.Channel.Layout = function(self) __layouts = __layouts + 1; return orig(self) end
`;

describe("toc", () => {
  it("loads Init, Codec, Channel, MinimapButton, Slots, Durability in that order", () => {
    expect(ADDON_FILES).toEqual([
      "Core/Init.lua",
      "Core/Codec.lua",
      "Core/Channel.lua",
      "Core/MinimapButton.lua",
      "Modules/Slots.lua",
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
        return { p.point, p.relativeTo == Minimap, p.relativePoint }
      `);
      expect(p).toEqual(["CENTER", true, "CENTER"]);
      const [x, y] = await onMinimap(lua);
      expect(x).toBeCloseTo(80, 9);
      expect(y).toBeCloseTo(0, 9);
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
      const [x, y] = await onMinimap(lua);
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
      const [x, y] = await onMinimap(lua);
      expect(x).toBeCloseTo(0, 6);
      expect(y).toBeCloseTo(MINIMAP_HALF + 10, 9);
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
        const [x, y] = await onMinimap(lua);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBeCloseTo(MINIMAP_HALF + 10, 9);
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

describe("MinimapButton scale", () => {
  const QHD = { GetPhysicalScreenSize: () => LuaMultiReturn.of(2560, 1440) };
  const expectedScale = (minimapScale: number, height: number) =>
    Math.max(1, (38 * (768 / height)) / (20 * minimapScale));
  const point = (lua: LuaEngine) => nums(lua, `${BTN}.points[#${BTN}.points].x, ${BTN}.points[#${BTN}.points].y`);

  it("ScaleFor makes the background disc at least 38 physical pixels across", async () => {
    await withAddon(async (lua) => {
      const [a] = await nums(lua, `${MB}.ScaleFor(0.64, 1440)`);
      expect(a).toBeCloseTo((38 * (768 / 1440)) / (20 * 0.64), 9);
      expect(a).toBeCloseTo(1.5833333333, 9);
      const [b] = await nums(lua, `${MB}.ScaleFor(1.0, 1440)`);
      expect(b).toBeCloseTo(1.0133333333, 9);
      expect(await nums(lua, `${MB}.ScaleFor(1.2, 1440)`)).toEqual([1]); // already large enough
    });
  });

  it("ScaleFor falls back to 1 on unusable input", async () => {
    await withAddon(async (lua) => {
      for (const args of ["nil, 1440", "0.64, nil", "0, 1440", "0.64, 0", "-1, 1440", '"x", 1440']) {
        expect(await nums(lua, `${MB}.ScaleFor(${args})`), args).toEqual([1]);
      }
    });
  });

  it("Place applies the scale and keeps the on-screen radius", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); Minimap.effectiveScale = 0.64; ${MB}:Place(225)`);
      const [scale] = await nums(lua, `${BTN}.scale`);
      expect(scale).toBeCloseTo(1.5833333333, 9);
      expect(scale).toBeCloseTo(expectedScale(0.64, 1440), 12);
      const [x, y] = await point(lua);
      const [wantX, wantY] = await nums(lua, `${MB}.PositionFor(225, ${MINIMAP_HALF + 10})`);
      expect(x * scale).toBeCloseTo(wantX, 9);
      expect(y * scale).toBeCloseTo(wantY, 9);
    }, "", QHD);
  });

  it("keeps scale 1 and the plain offset when the disc is already large enough", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); Minimap.effectiveScale = 1.2; ${MB}:Place(0)`);
      expect(await nums(lua, `${BTN}.scale`)).toEqual([1]);
      const [x, y] = await point(lua);
      expect(x).toBeCloseTo(80, 9);
      expect(y).toBeCloseTo(0, 9);
    }, "", QHD);
  });

  it("the button's effective scale is the Minimap's times the frame scale", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); Minimap.effectiveScale = 0.64; ${MB}:Place(225)`);
      const [scale, effective] = await nums(lua, `${BTN}.scale, ${BTN}:GetEffectiveScale()`);
      expect(effective).toBeCloseTo(0.64 * scale, 12);
      // the disc (20 UI units of the button) is 38 physical pixels across
      expect((20 * effective) / (768 / 1440)).toBeCloseTo(38, 9);
    }, "", QHD);
  });

  for (const event of ["UI_SCALE_CHANGED", "DISPLAY_SIZE_CHANGED"]) {
    it(`re-scales on ${event}`, async () => {
      await withAddon(async (lua) => {
        await lua.doString(`${MB}:Init(); HeroDeckNS.Channel:Init(${BTN}); ${MB}:Place(0)`);
        expect((await nums(lua, `${BTN}.scale`))[0]).toBeCloseTo(expectedScale(1, 1440), 9);

        // the user raises the UI scale: the Minimap grows, the button needs less
        await lua.doString("Minimap.effectiveScale = 1.2");
        await lua.doString(SPY_LAYOUT);
        await fire(lua, event);
        expect(await nums(lua, `${BTN}.scale`)).toEqual([1]);
        const [x] = await point(lua);
        expect(x).toBeCloseTo(80, 9);
        expect(await lua.doString("return __layouts")).toBeGreaterThanOrEqual(1);

        // the resolution drops: the disc shrinks, the button grows again
        lua.global.set("GetPhysicalScreenSize", () => LuaMultiReturn.of(1920, 1080));
        await fire(lua, event);
        const [scale] = await nums(lua, `${BTN}.scale`);
        expect(scale).toBeCloseTo(expectedScale(1.2, 1080), 9);
        expect(scale).toBeGreaterThan(1);
        const [x2] = await point(lua);
        expect(x2 * scale).toBeCloseTo(80, 9);
      }, "", QHD);
    });
  }

  it("PLAYER_ENTERING_WORLD alone does not change the scale (it only re-snaps the grid)", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(0); Minimap.effectiveScale = 1.2`);
      await fire(lua, "PLAYER_ENTERING_WORLD");
      expect((await nums(lua, `${BTN}.scale`))[0]).toBeCloseTo(expectedScale(1, 1440), 9);
    }, "", QHD);
  });

  it("re-scales from the follow check when the minimap scale changed", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); HeroDeckNS.Channel:Init(${BTN}); ${MB}:Place(225)`);
      const tick = (dt: number) => lua.doString(`${BTN}.scripts.OnUpdate(${BTN}, ${dt})`);
      await tick(0.3);
      expect((await nums(lua, `${BTN}.scale`))[0]).toBeCloseTo(expectedScale(1, 1440), 9);

      // Edit Mode scales the minimap
      await lua.doString("Minimap.effectiveScale = 0.64");
      await tick(0.1); // throttled
      expect((await nums(lua, `${BTN}.scale`))[0]).toBeCloseTo(expectedScale(1, 1440), 9);
      await tick(0.2);
      const [scale] = await nums(lua, `${BTN}.scale`);
      expect(scale).toBeCloseTo(expectedScale(0.64, 1440), 9);
      const [x, y] = await point(lua);
      const [wantX, wantY] = await nums(lua, `${MB}.PositionFor(225, ${MINIMAP_HALF + 10})`);
      expect(x * scale).toBeCloseTo(wantX, 9);
      expect(y * scale).toBeCloseTo(wantY, 9);
    }, "", QHD);
  });

  it("an unchanged minimap scale does not re-place the button from the follow check", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); ${MB}:Place(225)`);
      await lua.doString(`
        __places = 0
        local orig = ${MB}.Place
        ${MB}.Place = function(self, a) __places = __places + 1; return orig(self, a) end
        ${BTN}.scripts.OnUpdate(${BTN}, 0.3)
        ${BTN}.scripts.OnUpdate(${BTN}, 0.3)
      `);
      expect(await lua.doString("return __places")).toBe(0);
    }, "", QHD);
  });

  it("the grid stays centered on the button (button scale included in the center math)", async () => {
    await withAddon(async (lua) => {
      await lua.doString(`${MB}:Init(); HeroDeckNS.Channel:Init(${BTN}); Minimap.effectiveScale = 0.64; ${MB}:Place(225)`);
      const [scale, px, py] = await nums(lua, `${BTN}.scale, ${BTN}.points[#${BTN}.points].x, ${BTN}.points[#${BTN}.points].y`);
      expect(scale).toBeGreaterThan(1);
      const effective = 0.64 * scale;
      // True screen center in effective-scale-1 units: Minimap center + the anchor offset in the button's units.
      const trueX = 1000 * 0.64 + px * effective;
      const trueY = 500 * 0.64 + py * effective;
      // GetCenter reports the button's own (scaled) units, as in WoW.
      await lua.doString(`${BTN}.center = { x = ${trueX / effective}, y = ${trueY / effective} }`);
      await lua.doString(`${BTN}.scripts.OnUpdate(${BTN}, 0.3)`); // the follow check re-snaps the grid

      const unit = 768 / 1440;
      const [gx, gy] = await nums(
        lua,
        "HeroDeckNS.Channel.frame.points[#HeroDeckNS.Channel.frame.points].x, HeroDeckNS.Channel.frame.points[#HeroDeckNS.Channel.frame.points].y",
      );
      const left = gx / unit;
      const top = gy / unit;
      expect(Math.abs(left - Math.round(left))).toBeLessThan(1e-6);
      expect(Math.abs(top - Math.round(top))).toBeLessThan(1e-6);
      // grid is 24 x 14 physical px: its middle is within half a pixel of the true center
      expect(Math.abs(left + 12 - trueX / unit)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(top - 7 - trueY / unit)).toBeLessThanOrEqual(0.5 + 1e-6);
    }, "", QHD);
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
      const [x] = await onMinimap(lua);
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
