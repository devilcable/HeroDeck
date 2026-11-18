import { describe, expect, it } from "vitest";
import { clampCrop, CROP_H, CROP_W, monitorCropRect, pickWowWindow, STRIP_PX, WOW_TITLE } from "./capture";

const win = (title: string, minimized = false, focused = false) => ({ title, minimized, focused });

describe("pickWowWindow", () => {
  it("ignores windows with other titles", () => {
    expect(pickWowWindow([win("Notepad"), win("Discord")])).toBeNull();
  });

  it("ignores minimized windows", () => {
    expect(pickWowWindow([win(WOW_TITLE, true)])).toBeNull();
  });

  it("prefers the focused window among two", () => {
    const a = win(WOW_TITLE);
    const b = win(WOW_TITLE, false, true);
    expect(pickWowWindow([a, b])).toBe(b);
    expect(pickWowWindow([b, a])).toBe(b);
  });

  it("takes the first non-minimized window when none is focused", () => {
    const minimized = win(WOW_TITLE, true);
    const a = win(WOW_TITLE);
    const b = win(WOW_TITLE);
    expect(pickWowWindow([minimized, a, b])).toBe(a);
  });

  it("returns null when there are no windows", () => {
    expect(pickWowWindow([])).toBeNull();
  });

  it("matches the title exactly", () => {
    const others = [win("World of Warcraft Launcher"), win("world of warcraft"), win(" World of Warcraft")];
    expect(pickWowWindow(others)).toBeNull();
  });
});

describe("crop geometry", () => {
  it("covers the search region plus the strip", () => {
    expect(STRIP_PX).toBe(36);
    expect(CROP_W).toBe(128 + 36);
    expect(CROP_H).toBe(64 + 3);
  });

  it("keeps the full crop size on a large image", () => {
    expect(clampCrop(0, 0, CROP_W, CROP_H, 1920, 1080)).toEqual({ x: 0, y: 0, width: CROP_W, height: CROP_H });
  });

  it("clamps the crop to a small image", () => {
    expect(clampCrop(0, 0, CROP_W, CROP_H, 100, 40)).toEqual({ x: 0, y: 0, width: 100, height: 40 });
  });

  it("clamps a crop that overhangs the right and bottom edges", () => {
    expect(clampCrop(1900, 1070, CROP_W, CROP_H, 1920, 1080)).toEqual({ x: 1900, y: 1070, width: 20, height: 10 });
  });

  it("returns null for an empty crop", () => {
    expect(clampCrop(0, 0, CROP_W, CROP_H, 0, 0)).toBeNull();
    expect(clampCrop(1920, 0, CROP_W, CROP_H, 1920, 1080)).toBeNull();
  });
});

describe("monitorCropRect", () => {
  const mon = { x: 0, y: 0, width: 1920, height: 1080 };
  const image = { width: 1920, height: 1080 };

  it("offsets by the window position relative to the monitor", () => {
    expect(monitorCropRect({ x: 100, y: 50 }, mon, image)).toEqual({ x: 100, y: 50, width: CROP_W, height: CROP_H });
  });

  it("works on a second monitor with a negative origin", () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(monitorCropRect({ x: -1900, y: 20 }, left, image)).toEqual({
      x: 20,
      y: 20,
      width: CROP_W,
      height: CROP_H,
    });
  });

  it("is null when the window's top-left is off the monitor", () => {
    expect(monitorCropRect({ x: -10, y: 0 }, mon, image)).toBeNull();
    expect(monitorCropRect({ x: 0, y: -10 }, mon, image)).toBeNull();
    expect(monitorCropRect({ x: 1920, y: 0 }, mon, image)).toBeNull();
  });

  it("scales the offset when the monitor image is larger than the monitor size (DPI scaling)", () => {
    expect(monitorCropRect({ x: 100, y: 50 }, mon, { width: 3840, height: 2160 })).toEqual({
      x: 200,
      y: 100,
      width: CROP_W,
      height: CROP_H,
    });
  });
});
