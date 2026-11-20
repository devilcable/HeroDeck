import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureOrder,
  clampCrop,
  CROP_H,
  CROP_W,
  monitorCropRect,
  pickWowWindow,
  STRIP_PX,
  warcraftWindows,
  WOW_TITLE,
} from "./capture";

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
  it("covers the search region plus the grid", () => {
    expect(STRIP_PX).toBe(24);
    expect(CROP_W).toBe(128 + 24);
    expect(CROP_H).toBe(64 + 14);
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

  it("clamps a slightly negative origin to 0 (maximized or borderless window at -8,-8)", () => {
    expect(monitorCropRect({ x: -8, y: -8 }, mon, image)).toEqual({ x: 0, y: 0, width: CROP_W, height: CROP_H });
    expect(monitorCropRect({ x: -10, y: 0 }, mon, image)).toEqual({ x: 0, y: 0, width: CROP_W, height: CROP_H });
    expect(monitorCropRect({ x: 0, y: -10 }, mon, image)).toEqual({ x: 0, y: 0, width: CROP_W, height: CROP_H });
  });

  it("is null when the crop has no area inside the monitor image", () => {
    expect(monitorCropRect({ x: 1920, y: 0 }, mon, image)).toBeNull();
    expect(monitorCropRect({ x: 0, y: 1080 }, mon, image)).toBeNull();
    expect(monitorCropRect({ x: -CROP_W, y: 0 }, mon, image)).toBeNull();
    expect(monitorCropRect({ x: 0, y: -CROP_H }, mon, image)).toBeNull();
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

describe("WowWindowSource error reporting", () => {
  it("passes a swallowed error to onError and returns null", async () => {
    const boom = new Error("capture failed");
    vi.resetModules();
    vi.doMock("node-screenshots", () => ({
      Window: {
        all: () => {
          throw boom;
        },
      },
    }));
    const { WowWindowSource: Source } = await import("./capture");
    const onError = vi.fn();
    expect(await new Source({ onError }).grab()).toBeNull();
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
    vi.doUnmock("node-screenshots");
  });

  it("does not need an onError", async () => {
    vi.resetModules();
    vi.doMock("node-screenshots", () => ({
      Window: {
        all: () => {
          throw new Error("x");
        },
      },
    }));
    const { WowWindowSource: Source } = await import("./capture");
    expect(await new Source().grab()).toBeNull();
    vi.doUnmock("node-screenshots");
  });

  it("does not report anything when WoW is simply not running", async () => {
    vi.resetModules();
    vi.doMock("node-screenshots", () => ({ Window: { all: () => [] } }));
    const { WowWindowSource: Source } = await import("./capture");
    const onError = vi.fn();
    expect(await new Source({ onError }).grab()).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    vi.doUnmock("node-screenshots");
  });
});

describe("warcraftWindows", () => {
  const w = (title: string, appName = "Wow.exe", minimized = false) => ({ title, appName, minimized });

  it("keeps windows whose title contains warcraft, in any case, with their app name", () => {
    const all = [w("Notepad", "notepad.exe"), w("WORLD OF WARCRAFT", "WowB.exe"), w("Warcraft Logs - Chrome", "chrome.exe")];
    expect(warcraftWindows(all)).toEqual([
      { title: "WORLD OF WARCRAFT", appName: "WowB.exe", minimized: false },
      { title: "Warcraft Logs - Chrome", appName: "chrome.exe", minimized: false },
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(warcraftWindows([w("Notepad"), w("")])).toEqual([]);
    expect(warcraftWindows([])).toEqual([]);
  });
});

describe("captureOrder", () => {
  it("tries the window first until the monitor is the one that worked", () => {
    expect(captureOrder(null)).toEqual(["window", "monitor"]);
    expect(captureOrder("window")).toEqual(["window", "monitor"]);
    expect(captureOrder("monitor")).toEqual(["monitor", "window"]);
  });
});

/** A fake node-screenshots Image: crop() returns an image of the crop size; toRaw is opaque black. */
function fakeImage(width: number, height: number, label: string) {
  return {
    width,
    height,
    crop: async (_x: number, _y: number, w: number, h: number) => fakeImage(w, h, label),
    toRaw: async () => Buffer.alloc(width * height * 4),
    toPng: async () => Buffer.from(`png:${label}`),
  };
}

/** Loads a WowWindowSource against a fake WoW window; `decodes` says per path whether its strip decodes. */
async function sourceWithFakes(
  decodes: { window: boolean; monitor: boolean },
  options: Record<string, unknown> = {},
  windows?: unknown[],
) {
  const log: string[] = [];
  const monitor = {
    x: () => 0,
    y: () => 0,
    width: () => 1920,
    height: () => 1080,
    scaleFactor: () => 1,
    captureImage: async () => {
      log.push("monitor");
      return fakeImage(1920, 1080, "monitor");
    },
  };
  const wow = {
    title: () => "World of Warcraft",
    appName: () => "Wow.exe",
    isMinimized: () => false,
    isFocused: () => true,
    x: () => 10,
    y: () => 20,
    width: () => 1900,
    height: () => 1000,
    currentMonitor: () => monitor,
    captureImage: async () => {
      log.push("window");
      return fakeImage(1900, 1000, "window");
    },
  };
  vi.resetModules();
  vi.doMock("node-screenshots", () => ({ Window: { all: () => windows ?? [wow] } }));
  // The strip decodes when the most recent capture was of a path that is allowed to decode.
  vi.doMock("./strip", () => ({
    readStrip: () => (decodes[log[log.length - 1] as "window" | "monitor"] ? { version: 2, fields: [50] } : null),
  }));
  const { WowWindowSource: Source } = await import("./capture");
  return { source: new Source(options), log };
}

describe("WowWindowSource capture path", () => {
  afterEach(() => {
    vi.doUnmock("node-screenshots");
    vi.doUnmock("./strip");
  });

  it("captures only the window while the window path decodes", async () => {
    const { source, log } = await sourceWithFakes({ window: true, monitor: true });
    await source.grab();
    await source.grab();
    expect(log).toEqual(["window", "window"]);
  });

  it("falls back to the monitor, then tries the monitor first on the next grab", async () => {
    const { source, log } = await sourceWithFakes({ window: false, monitor: true });
    expect(await source.grab()).not.toBeNull();
    expect(log).toEqual(["window", "monitor"]);
    log.length = 0;
    await source.grab();
    await source.grab();
    expect(log).toEqual(["monitor", "monitor"]); // one capture per tick, not two
  });

  it("goes back to the window when the remembered monitor path stops decoding", async () => {
    const decodes = { window: true, monitor: false };
    const { source, log } = await sourceWithFakes(decodes);
    await source.grab(); // window decodes
    decodes.window = false;
    decodes.monitor = true;
    await source.grab(); // window fails, monitor works: now preferred
    log.length = 0;
    decodes.window = true;
    decodes.monitor = false;
    await source.grab(); // monitor fails, window works again
    expect(log).toEqual(["monitor", "window"]);
  });
});

describe("WowWindowSource diagnostics", () => {
  afterEach(() => {
    vi.doUnmock("node-screenshots");
    vi.doUnmock("./strip");
  });

  it("lists the warcraft-like windows when there is no exact match", async () => {
    const launcher = { title: () => "World of Warcraft Launcher", appName: () => "Battle.net.exe", isMinimized: () => false, isFocused: () => false };
    const unrelated = { title: () => "Notepad", appName: () => "notepad.exe", isMinimized: () => false, isFocused: () => false };
    const onDiagnostics = vi.fn();
    const { source } = await sourceWithFakes({ window: true, monitor: true }, { onDiagnostics }, [launcher, unrelated]);
    expect(await source.grab()).toBeNull();
    expect(onDiagnostics).toHaveBeenCalledExactlyOnceWith({
      stage: "no-window",
      warcraftWindows: [{ title: "World of Warcraft Launcher", appName: "Battle.net.exe", minimized: false }],
    });
  });

  it("reports the path that produced the image, once per grab, with a png of each attempt", async () => {
    const onDiagnostics = vi.fn();
    const { source } = await sourceWithFakes({ window: false, monitor: true }, { onDiagnostics });
    await source.grab();
    expect(onDiagnostics).toHaveBeenCalledTimes(1);
    const d = onDiagnostics.mock.calls[0][0];
    expect(d.stage).toBe("monitor");
    expect(d.decoded).toBe(true);
    expect(d.attempts.map((a: { path: string }) => a.path)).toEqual(["window", "monitor"]);
    expect((await d.attempts[1].png()).toString()).toBe("png:monitor");
  });

  it("reports decoded=false when no path decodes", async () => {
    const onDiagnostics = vi.fn();
    const { source } = await sourceWithFakes({ window: false, monitor: false }, { onDiagnostics });
    await source.grab();
    expect(onDiagnostics.mock.calls[0][0]).toMatchObject({ stage: "monitor", decoded: false });
  });

  it("reports geometry on the window path too", async () => {
    const onGeometry = vi.fn();
    const { source } = await sourceWithFakes({ window: true, monitor: true }, { onGeometry });
    await source.grab();
    expect(onGeometry).toHaveBeenCalledExactlyOnceWith({
      path: "window",
      window: { x: 10, y: 20, width: 1900, height: 1000 },
      monitor: { x: 0, y: 0, width: 1920, height: 1080 },
      image: { width: 1900, height: 1000 },
      scaleFactor: 1,
    });
  });

  it("a throwing diagnostics hook does not break the read", async () => {
    const onDiagnostics = vi.fn(() => {
      throw new Error("hook");
    });
    const { source } = await sourceWithFakes({ window: true, monitor: true }, { onDiagnostics });
    expect(await source.grab()).not.toBeNull();
  });
});
