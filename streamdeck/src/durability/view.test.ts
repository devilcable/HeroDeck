import { describe, expect, it } from "vitest";
import { diffView, imageFor, percentFrom, slotViewFor, stateFor, titleFor, viewFor } from "./view";

describe("percentFrom", () => {
  it("is null for a nodata frame", () => {
    expect(percentFrom(null)).toBeNull();
  });

  it("is null when field 0 is unreadable", () => {
    expect(percentFrom({ fields: [null] })).toBeNull();
    expect(percentFrom({ fields: [] })).toBeNull();
  });

  it("is null for a value above 100", () => {
    expect(percentFrom({ fields: [101] })).toBeNull();
  });

  it("returns field 0", () => {
    expect(percentFrom({ fields: [87] })).toBe(87);
    expect(percentFrom({ fields: [0] })).toBe(0);
    expect(percentFrom({ fields: [100, 5] })).toBe(100);
  });
});

describe("stateFor", () => {
  it.each([
    [100, "ok"],
    [50, "ok"],
    [49, "warn"],
    [20, "warn"],
    [19, "critical"],
    [0, "critical"],
    [null, "nodata"],
  ] as const)("%s -> %s", (percent, state) => {
    expect(stateFor(percent)).toBe(state);
  });
});

describe("imageFor", () => {
  it("points at the state's svg", () => {
    expect(imageFor("warn")).toBe("imgs/actions/durability/warn.svg");
  });
});

describe("titleFor", () => {
  it("shows the percentage when on", () => {
    expect(titleFor(87, true)).toBe("87%");
    expect(titleFor(null, true)).toBe("--");
  });

  it("is empty when off", () => {
    expect(titleFor(87, false)).toBe("");
    expect(titleFor(null, false)).toBe("");
  });
});

describe("viewFor", () => {
  it("is grey with -- for nodata", () => {
    expect(viewFor(null, true)).toEqual({ image: "imgs/actions/durability/nodata.svg", title: "--" });
  });

  it("combines state image and title", () => {
    expect(viewFor({ fields: [30] }, true)).toEqual({ image: "imgs/actions/durability/warn.svg", title: "30%" });
    expect(viewFor({ fields: [5] }, false)).toEqual({ image: "imgs/actions/durability/critical.svg", title: "" });
  });
});

describe("diffView", () => {
  const a = { image: "imgs/actions/durability/ok.svg", title: "87%" };

  it("sets both on the first render", () => {
    expect(diffView(undefined, a)).toEqual({ image: a.image, title: a.title });
  });

  it("sets nothing for an identical view", () => {
    expect(diffView(a, { ...a })).toEqual({});
  });

  it("sets only the title when only the title changed", () => {
    expect(diffView(a, { ...a, title: "86%" })).toEqual({ title: "86%" });
    expect(diffView(a, { ...a, title: "" })).toEqual({ title: "" });
  });

  it("sets only the image when only the image changed", () => {
    const warn = { image: "imgs/actions/durability/warn.svg", title: "87%" };
    expect(diffView(a, warn)).toEqual({ image: warn.image });
  });
});

describe("slotViewFor", () => {
  const fr = (key: "empty" | "none") => (key === "empty" ? "vide" : "sans");
  const en = (key: "empty" | "none") => (key === "empty" ? "empty" : "n/a");

  it("shows the label and the percent", () => {
    expect(slotViewFor(87, "Arme", true, fr)).toEqual({ image: "imgs/actions/durability/ok.svg", title: "Arme\n87%" });
  });

  it("drops only the percent when the percentage is off", () => {
    expect(slotViewFor(87, "Arme", false, fr)).toEqual({ image: "imgs/actions/durability/ok.svg", title: "Arme" });
  });

  it("empty slot: nodata image and translated word", () => {
    expect(slotViewFor("empty", "Main G.", true, fr)).toEqual({
      image: "imgs/actions/durability/nodata.svg",
      title: "Main G.\nvide",
    });
    expect(slotViewFor("empty", "Off hand", true, en).title).toBe("Off hand\nempty");
  });

  it("item without durability: nodata image and translated word", () => {
    expect(slotViewFor("none", "Main G.", true, fr)).toEqual({
      image: "imgs/actions/durability/nodata.svg",
      title: "Main G.\nsans",
    });
    expect(slotViewFor("none", "Off hand", true, en).title).toBe("Off hand\nn/a");
  });

  it("status words stay when the percentage is off", () => {
    expect(slotViewFor("empty", "Main G.", false, fr).title).toBe("Main G.\nvide");
    expect(slotViewFor("none", "Main G.", false, fr).title).toBe("Main G.\nsans");
  });

  it("no data shows --", () => {
    expect(slotViewFor(null, "Arme", true, fr)).toEqual({
      image: "imgs/actions/durability/nodata.svg",
      title: "Arme\n--",
    });
  });

  it.each([
    [50, "ok"],
    [49, "warn"],
    [20, "warn"],
    [19, "critical"],
    [0, "critical"],
  ] as const)("%s percent uses the %s image", (percent, state) => {
    expect(slotViewFor(percent, "X", true, fr).image).toBe(`imgs/actions/durability/${state}.svg`);
  });
});
