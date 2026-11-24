import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureOrder,
  type CapturePath,
  clampCrop,
  cropRaw,
  gameRect,
  FULL_SCAN_EVERY,
  type GameCapture,
  type GrabState,
  newGrabState,
  pickWowWindow,
  type Rect,
  readGame,
  TRACK_MARGIN,
  trackRect,
  warcraftWindows,
  WOW_TITLE,
} from "./capture";
import type { RawImage } from "./protocol";
import { readStrip } from "./strip";
import { busyImage, expectedValues, paintGrid } from "./test-helpers";

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

describe("clampCrop", () => {
  it("keeps the full crop size on a large image", () => {
    expect(clampCrop(0, 0, 152, 78, 1920, 1080)).toEqual({ x: 0, y: 0, width: 152, height: 78 });
  });

  it("clamps the crop to a small image", () => {
    expect(clampCrop(0, 0, 152, 78, 100, 40)).toEqual({ x: 0, y: 0, width: 100, height: 40 });
  });

  it("clamps a crop that overhangs the right and bottom edges", () => {
    expect(clampCrop(1900, 1070, 152, 78, 1920, 1080)).toEqual({ x: 1900, y: 1070, width: 20, height: 10 });
  });

  it("returns null for an empty crop", () => {
    expect(clampCrop(0, 0, 152, 78, 0, 0)).toBeNull();
    expect(clampCrop(1920, 0, 152, 78, 1920, 1080)).toBeNull();
  });
});

describe("trackRect", () => {
  const image = { width: 2560, height: 1440 };

  it("surrounds the grid by 64 px on every side", () => {
    expect(TRACK_MARGIN).toBe(64);
    expect(trackRect({ x: 1000, y: 500 }, image)).toEqual({ x: 936, y: 436, width: 24 + 128, height: 14 + 128 });
  });

  it("clamps at the left and top edges", () => {
    expect(trackRect({ x: 10, y: 20 }, image)).toEqual({ x: 0, y: 0, width: 10 + 24 + 64, height: 20 + 14 + 64 });
  });

  it("clamps at the right and bottom edges", () => {
    expect(trackRect({ x: 2550, y: 1430 }, image)).toEqual({ x: 2486, y: 1366, width: 74, height: 74 });
  });

  it("clamps in a corner", () => {
    expect(trackRect({ x: 0, y: 0 }, image)).toEqual({ x: 0, y: 0, width: 88, height: 78 });
    expect(trackRect({ x: 2559, y: 1439 }, image)).toEqual({ x: 2495, y: 1375, width: 65, height: 65 });
  });
});

describe("gameRect", () => {
  const mon = { x: 0, y: 0, width: 1920, height: 1080 };
  const image = { width: 1920, height: 1080 };
  const win = (x: number, y: number, width = 800, height = 600) => ({ x, y, width, height });

  it("is the whole capture on the window path", () => {
    expect(gameRect("window", win(100, 50), mon, { width: 1900, height: 1000 })).toEqual({
      x: 0,
      y: 0,
      width: 1900,
      height: 1000,
    });
    expect(gameRect("window", win(0, 0), mon, { width: 0, height: 0 })).toBeNull();
  });

  it("is the window area inside the monitor capture on the monitor path", () => {
    expect(gameRect("monitor", win(100, 50), mon, image)).toEqual({ x: 100, y: 50, width: 800, height: 600 });
  });

  it("works on a second monitor with a negative origin", () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(gameRect("monitor", win(-1900, 20), left, image)).toEqual({ x: 20, y: 20, width: 800, height: 600 });
  });

  it("clamps a slightly negative origin to 0 (maximized or borderless window at -8,-8)", () => {
    expect(gameRect("monitor", win(-8, -8, 1936, 1096), mon, image)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(gameRect("monitor", win(-10, 0), mon, image)).toEqual({ x: 0, y: 0, width: 790, height: 600 });
    expect(gameRect("monitor", win(0, -10), mon, image)).toEqual({ x: 0, y: 0, width: 800, height: 590 });
  });

  it("clamps a window that overhangs the monitor", () => {
    expect(gameRect("monitor", win(1500, 900), mon, image)).toEqual({ x: 1500, y: 900, width: 420, height: 180 });
  });

  it("is null when the window has no area inside the monitor image", () => {
    expect(gameRect("monitor", win(1920, 0), mon, image)).toBeNull();
    expect(gameRect("monitor", win(0, 1080), mon, image)).toBeNull();
    expect(gameRect("monitor", win(-800, 0), mon, image)).toBeNull();
    expect(gameRect("monitor", win(0, -600), mon, image)).toBeNull();
  });

  it("scales the window by capture size / monitor size (DPI scaling)", () => {
    expect(gameRect("monitor", win(100, 50), mon, { width: 3840, height: 2160 })).toEqual({
      x: 200,
      y: 100,
      width: 1600,
      height: 1200,
    });
  });
});

describe("cropRaw", () => {
  it("copies the pixels of the rectangle", () => {
    const img: RawImage = { width: 4, height: 3, data: new Uint8Array(4 * 3 * 4) };
    for (let i = 0; i < 12; i++) img.data.set([i, i, i, 255], i * 4);
    const out = cropRaw(img, { x: 1, y: 1, width: 2, height: 2 });
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(Array.from(out.data.filter((_, i) => i % 4 === 0))).toEqual([5, 6, 9, 10]);
  });
});

/** A fake capture of `images[path]`; `full` defaults to the whole image. Captures and crops are logged. */
function fakeCapture(
  images: Partial<Record<CapturePath, RawImage>>,
  log: string[] = [],
  fulls: Partial<Record<CapturePath, Rect | null>> = {},
) {
  return async (path: CapturePath): Promise<GameCapture> => {
    const img = images[path]!;
    log.push(`capture:${path}`);
    return {
      size: { width: img.width, height: img.height },
      full: fulls[path] !== undefined ? fulls[path]! : { x: 0, y: 0, width: img.width, height: img.height },
      crop: async (rect) => {
        log.push(`crop:${path}:${rect.x},${rect.y},${rect.width}x${rect.height}`);
        return { image: cropRaw(img, rect), png: async () => Buffer.from(`png:${path}`) };
      },
      whole: async () => {
        log.push(`whole:${path}`);
        return { image: img, png: async () => Buffer.from(`png:${path}`) };
      },
    };
  };
}

/** A 600x400 capture with the grid painted at (x, y), or without a grid when `grid` is null. */
function scene(seed: number, grid: { x: number; y: number } | null): RawImage {
  const img = busyImage(600, 400, seed);
  if (grid) paintGrid(img, grid.x, grid.y);
  return img;
}

describe("readGame", () => {
  it("starts from a fresh state", () => {
    const s: GrabState = newGrabState();
    expect(s).toEqual({ lastGood: null, last: { window: null, monitor: null }, lostGrabs: 0, windowDecoded: false });
  });

  it("scans the whole game area first, and returns only the crop around the grid", async () => {
    const state = newGrabState();
    const log: string[] = [];
    const { image, attempts } = await readGame(fakeCapture({ window: scene(1, { x: 300, y: 200 }) }, log), state);
    expect(attempts.map((a) => [a.path, a.region])).toEqual([["window", "full"]]);
    expect(attempts[0].origin).toEqual({ x: 302, y: 202 });
    // the reader decodes the returned image again: it must be small, and still hold the grid
    expect(image).not.toBeNull();
    expect(image!.width).toBe(152);
    expect(image!.height).toBe(142);
    expect(readStrip(image!)?.fields).toEqual(expectedValues);
    expect(log).toEqual(["capture:window", "whole:window"]);
  });

  it("success stores the origin, in the capture's coordinates", async () => {
    const state = newGrabState();
    await readGame(fakeCapture({ window: scene(2, { x: 300, y: 200 }) }), state);
    expect(state.last.window).toEqual({ x: 302, y: 202 });
    expect(state.last.monitor).toBeNull();
    expect(state.lastGood).toBe("window");
  });

  it("scans only the region around the last position when there is one", async () => {
    const state = newGrabState();
    const log: string[] = [];
    const capture = fakeCapture({ window: scene(3, { x: 300, y: 200 }) }, log);
    await readGame(capture, state);
    log.length = 0;
    const { attempts } = await readGame(capture, state);
    expect(attempts.map((a) => a.region)).toEqual(["tracked"]);
    expect(log).toEqual(["capture:window", "crop:window:238,138,152x142"]);
    expect(state.last.window).toEqual({ x: 302, y: 202 });
  });

  it("tracked miss falls back to a full scan in the same grab", async () => {
    const state = newGrabState();
    await readGame(fakeCapture({ window: scene(4, { x: 300, y: 200 }) }), state);
    const log: string[] = [];
    // the button was dragged far away between two reads
    const { image, attempts } = await readGame(fakeCapture({ window: scene(4, { x: 500, y: 40 }) }, log), state);
    expect(attempts.map((a) => [a.path, a.region])).toEqual([
      ["window", "tracked"],
      ["window", "full"],
    ]);
    expect(log.filter((l) => l.startsWith("capture"))).toEqual(["capture:window"]); // one capture, two crops
    expect(attempts[1].origin).toEqual({ x: 502, y: 42 });
    expect(readStrip(image!)?.fields).toEqual(expectedValues);
    expect(state.last.window).toEqual({ x: 502, y: 42 });
  });

  it("failure clears the last position, so the next scan is a full scan", async () => {
    const state = newGrabState();
    await readGame(fakeCapture({ window: scene(5, { x: 300, y: 200 }) }), state);
    const gone = await readGame(fakeCapture({ window: scene(5, null), monitor: scene(5, null) }), state);
    expect(gone.image).toBeNull();
    // the window decoded before, so the monitor is not tried
    expect(gone.attempts.map((a) => [a.path, a.region, a.origin])).toEqual([
      ["window", "tracked", undefined],
      ["window", "full", undefined],
    ]);
    expect(state.last).toEqual({ window: null, monitor: null });
    // the lost grid is scanned again only every FULL_SCAN_EVERY grabs
    for (let i = 1; i < FULL_SCAN_EVERY; i++) await readGame(fakeCapture({ window: scene(5, null) }), state);
    const again = await readGame(fakeCapture({ window: scene(5, { x: 100, y: 100 }) }), state);
    expect(again.attempts.map((a) => a.region)).toEqual(["full"]);
  });

  it("keeps a last position per path, with the game area offset inside the capture", async () => {
    const state = newGrabState();
    const monitor = scene(6, { x: 300, y: 200 });
    const area = { monitor: { x: 100, y: 50, width: 500, height: 300 } };
    const first = await readGame(fakeCapture({ window: scene(6, null), monitor }, [], area), state);
    expect(first.attempts.map((a) => [a.path, a.region])).toEqual([
      ["window", "full"],
      ["monitor", "full"],
    ]);
    expect(first.attempts[1].origin).toEqual({ x: 302, y: 202 }); // capture coordinates, not game-area ones
    expect(state).toMatchObject({ lastGood: "monitor", last: { window: null, monitor: { x: 302, y: 202 } } });
    const log: string[] = [];
    const second = await readGame(fakeCapture({ window: scene(6, null), monitor }, log, area), state);
    expect(second.attempts.map((a) => [a.path, a.region])).toEqual([["monitor", "tracked"]]);
    expect(log).toEqual(["capture:monitor", "crop:monitor:238,138,152x142"]);
  });

  it("a full scan of the whole capture does not copy it with crop", async () => {
    const log: string[] = [];
    await readGame(fakeCapture({ window: scene(8, { x: 300, y: 200 }) }, log), newGrabState());
    expect(log.filter((l) => l.startsWith("crop"))).toEqual([]);
    expect(log).toContain("whole:window");
    // an area that is not the whole capture still goes through crop
    log.length = 0;
    const area = { window: { x: 10, y: 10, width: 500, height: 300 } };
    await readGame(fakeCapture({ window: scene(8, { x: 300, y: 200 }) }, log, area), newGrabState());
    expect(log).toEqual(["capture:window", "crop:window:10,10,500x300"]);
  });

  it("while the grid is lost, scans on grabs 1, 5, 9 and returns null without capturing in between", async () => {
    const state = newGrabState();
    const log: string[] = [];
    const capture = fakeCapture({ window: scene(9, null), monitor: scene(9, null) }, log);
    const captured: boolean[] = [];
    for (let grab = 1; grab <= 9; grab++) {
      log.length = 0;
      const out = await readGame(capture, state);
      expect(out.image).toBeNull();
      captured.push(log.some((l) => l.startsWith("capture")));
      if (!captured[grab - 1]) expect(out.attempts).toEqual([]);
    }
    expect(captured).toEqual([true, false, false, false, true, false, false, false, true]);
  });

  it("a decode resets the throttle: the next loss scans at once, then waits again", async () => {
    const state = newGrabState();
    const log: string[] = [];
    const lostScene = { window: scene(10, null), monitor: scene(10, null) };
    const seen = async (images: Partial<Record<CapturePath, RawImage>>) => {
      log.length = 0;
      const out = await readGame(fakeCapture(images, log), state);
      return { out, captured: log.some((l) => l.startsWith("capture")) };
    };
    expect((await seen(lostScene)).captured).toBe(true); // 1: scan
    for (let i = 2; i <= 4; i++) expect((await seen(lostScene)).captured).toBe(false);
    const found = await seen({ window: scene(10, { x: 300, y: 200 }) }); // 5: scan, decodes
    expect(found.out.image).not.toBeNull();
    expect(state.lostGrabs).toBe(0);
    expect((await seen(lostScene)).captured).toBe(true); // the grid vanished: tracked + full, at once
    for (let i = 0; i < FULL_SCAN_EVERY - 1; i++) expect((await seen(lostScene)).captured).toBe(false);
    expect((await seen(lostScene)).captured).toBe(true);
  });

  it("does not capture the monitor once the window path has decoded", async () => {
    const state = newGrabState();
    const log: string[] = [];
    await readGame(fakeCapture({ window: scene(11, { x: 300, y: 200 }) }), state);
    expect(state.windowDecoded).toBe(true);
    const capture = fakeCapture({ window: scene(11, null), monitor: scene(11, null) }, log);
    for (let grab = 0; grab < 10; grab++) await readGame(capture, state);
    expect(log.filter((l) => l === "capture:window").length).toBeGreaterThan(0);
    expect(log.filter((l) => l.includes("monitor"))).toEqual([]);
  });

  it("still tries the monitor while the window has never decoded", async () => {
    const log: string[] = [];
    await readGame(fakeCapture({ window: scene(12, null), monitor: scene(12, null) }, log), newGrabState());
    expect(log.filter((l) => l.startsWith("capture"))).toEqual(["capture:window", "capture:monitor"]);
  });

  it("returns null and no attempt when there is nothing to crop", async () => {
    const state = newGrabState();
    const none = { window: null, monitor: null };
    const out = await readGame(fakeCapture({ window: scene(7, null), monitor: scene(7, null) }, [], none), state);
    expect(out).toEqual({ image: null, attempts: [] });
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
    readStrip: () => (decodes[log[log.length - 1] as "window" | "monitor"] ? { version: 2, fields: [50], origin: { x: 5, y: 5 } } : null),
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
    const decodes = { window: false, monitor: true };
    const { source, log } = await sourceWithFakes(decodes);
    await source.grab(); // window fails, monitor works: now preferred
    log.length = 0;
    decodes.window = true;
    decodes.monitor = false;
    await source.grab(); // monitor fails, window works
    expect(log).toEqual(["monitor", "window"]);
  });

  it("does not fall back to the monitor once the window has decoded", async () => {
    const decodes = { window: true, monitor: true };
    const { source, log } = await sourceWithFakes(decodes);
    await source.grab(); // window decodes
    decodes.window = false;
    log.length = 0;
    expect(await source.grab()).toBeNull(); // the window lost the grid; the monitor is not tried
    expect(log).toEqual(["window"]);
  });

  it("does not capture while waiting between two full scans of a lost grid", async () => {
    const { source, log } = await sourceWithFakes({ window: false, monitor: false });
    await source.grab(); // scans both paths
    log.length = 0;
    for (let i = 1; i < FULL_SCAN_EVERY; i++) expect(await source.grab()).toBeNull();
    expect(log).toEqual([]);
    await source.grab();
    expect(log).toEqual(["window", "monitor"]);
  });

  it("reports nothing to the diagnostics hook for a throttled grab", async () => {
    const onDiagnostics = vi.fn();
    const { source } = await sourceWithFakes({ window: false, monitor: false }, { onDiagnostics });
    await source.grab();
    onDiagnostics.mockClear();
    await source.grab();
    expect(onDiagnostics).not.toHaveBeenCalled();
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
    expect(d.attempts.map((a: { region: string }) => a.region)).toEqual(["full", "full"]);
    expect(d.attempts[1].origin).toEqual({ x: 15, y: 25 }); // crop origin (window position) + grid origin
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
