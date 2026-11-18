import { describe, expect, it } from "vitest";
import { createLua } from "./harness";

describe("lua harness", () => {
  it("default mocks behave as documented", async () => {
    const lua = await createLua();
    try {
      expect(await lua.doString("return select('#', GetPhysicalScreenSize())")).toBe(2);
      expect(await lua.doString("local w, h = GetPhysicalScreenSize(); return w + h")).toBe(3000);
      expect(await lua.doString("return GetInventoryItemDurability(1)")).toBeUndefined();
      expect(await lua.doString("local f = CreateFrame('Frame'); f:Show(); f:SetSize(1, 1); return type(f)")).toBe("table");
      expect(await lua.doString("WorldFrame:Anything(); return type(WorldFrame)")).toBe("table");
    } finally {
      lua.global.close();
    }
  });

  it("unset data fields read as nil, unknown methods stay callable", async () => {
    const lua = await createLua();
    try {
      await lua.doString("f = CreateFrame('Frame'); t = f:CreateTexture()");
      expect(await lua.doString("return f.ignoreParentScale == nil")).toBe(true);
      expect(await lua.doString("return f.scale == nil and f.strata == nil and f.frameLevel == nil")).toBe(true);
      expect(await lua.doString("return t.color == nil and t.width == nil")).toBe(true);
      expect(await lua.doString("return f.scripts.OnEvent == nil")).toBe(true);
      expect(await lua.doString("return type(f.Show) == 'function' and f:Show() == nil")).toBe(true);
    } finally {
      lua.global.close();
    }
  });

  it("mocks override the defaults", async () => {
    const lua = await createLua({ GetInventoryItemDurability: () => 7 });
    try {
      expect(await lua.doString("return GetInventoryItemDurability(1)")).toBe(7);
    } finally {
      lua.global.close();
    }
  });
});
