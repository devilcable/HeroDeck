import type { Image, Window } from "node-screenshots";
import { SEARCH_H, SEARCH_W } from "./locate";
import { CELL_PX, HEADER_CELLS, MAX_FIELDS, type RawImage } from "./protocol";
import { readStrip } from "./strip";

export interface WindowInfo {
  title: string;
  minimized: boolean;
  focused: boolean;
}

export const WOW_TITLE = "World of Warcraft";

/** The game window: exact title, not minimized, the focused one first. Null when there is none. */
export function pickWowWindow<T extends WindowInfo>(windows: T[]): T | null {
  const candidates = windows.filter((w) => w.title === WOW_TITLE && !w.minimized);
  return candidates.find((w) => w.focused) ?? candidates[0] ?? null;
}

/** Which capture produced an image: the game window itself, or its monitor cropped at the window. */
export type CapturePath = "window" | "monitor";

/** The path to try first: the one that last produced a decoded strip (window to start with). */
export function captureOrder(lastGood: CapturePath | null): CapturePath[] {
  return lastGood === "monitor" ? ["monitor", "window"] : ["window", "monitor"];
}

export interface WindowTitleInfo {
  title: string;
  appName: string;
  minimized: boolean;
}

/** Windows whose title contains "warcraft" (any case): what to look at when the exact title does not match. */
export function warcraftWindows(windows: WindowTitleInfo[]): WindowTitleInfo[] {
  return windows
    .filter((w) => w.title.toLowerCase().includes("warcraft"))
    .map((w) => ({ title: w.title, appName: w.appName, minimized: w.minimized }));
}

/** The window and monitor geometry, and the size of the full capture of `path`, for diagnostics. */
export interface CaptureGeometry {
  path: CapturePath;
  window: Rect;
  monitor: Rect;
  image: { width: number; height: number };
  scaleFactor: number;
}

/** One capture of a grab: the cropped pixels, and a lazy PNG of the same crop (to save as a fixture). */
export interface CaptureAttempt {
  path: CapturePath;
  image: RawImage;
  png: () => Promise<Buffer>;
}

/** Reported once per grab to the optional `onDiagnostics` hook. `stage` is the path of the image returned. */
export type CaptureDiagnostics =
  | { stage: "no-window"; warcraftWindows: WindowTitleInfo[] }
  | { stage: CapturePath; decoded: boolean; attempts: CaptureAttempt[] }
  | { stage: "no-image" }
  | { stage: "error"; error: unknown };

export interface FrameSource {
  /** A capture of the game's top-left corner (RGBA), or null when there is nothing to read. */
  grab(): Promise<RawImage | null>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Width in physical pixels of the longest strip (header + fields). */
export const STRIP_PX = (HEADER_CELLS + 2 * MAX_FIELDS) * CELL_PX;
/** The region that can hold the strip: the search area plus one strip to its right and one cell below. */
export const CROP_W = SEARCH_W + STRIP_PX;
export const CROP_H = SEARCH_H + CELL_PX;

/** Intersect a rectangle with an image of the given size. Null when nothing is left. */
export function clampCrop(x: number, y: number, width: number, height: number, imgW: number, imgH: number): Rect | null {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const w = Math.min(x + width, imgW) - x0;
  const h = Math.min(y + height, imgH) - y0;
  return w > 0 && h > 0 ? { x: x0, y: y0, width: w, height: h } : null;
}

/**
 * Where the game's top-left corner sits in a capture of its monitor, as a crop rectangle. The
 * window position is in monitor coordinates; it is scaled by (capture size / monitor size) in case
 * the capture is in physical pixels and the coordinates are not. A slightly negative origin (a
 * maximized or borderless window sits at about -8,-8) is clamped to 0: the strip search absorbs
 * the offset. Null only when the crop has no area inside the monitor image.
 */
export function monitorCropRect(
  win: { x: number; y: number },
  monitor: Rect,
  image: { width: number; height: number },
): Rect | null {
  const scaleX = monitor.width > 0 ? image.width / monitor.width : 1;
  const scaleY = monitor.height > 0 ? image.height / monitor.height : 1;
  const x = Math.round((win.x - monitor.x) * scaleX);
  const y = Math.round((win.y - monitor.y) * scaleY);
  if (x + CROP_W <= 0 || y + CROP_H <= 0) return null;
  return clampCrop(Math.max(0, x), Math.max(0, y), CROP_W, CROP_H, image.width, image.height);
}

async function toAttempt(path: CapturePath, img: Image, rect: Rect | null): Promise<CaptureAttempt | null> {
  if (!rect) return null;
  const cropped = await img.crop(rect.x, rect.y, rect.width, rect.height);
  const buf = await cropped.toRaw();
  return {
    path,
    image: { width: cropped.width, height: cropped.height, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) },
    png: () => cropped.toPng(),
  };
}

/** Runs a diagnostics callback; a failing one must not break the read. */
function safely(fn: (() => void) | undefined): void {
  try {
    fn?.();
  } catch {
    // diagnostics must not break the read
  }
}

/**
 * Captures the top-left corner of the World of Warcraft window with node-screenshots. If the strip
 * is not readable in the window capture (some games capture black), it captures the window's
 * monitor instead and crops at the window's position. The path that last decoded a strip is tried
 * first on the next grab, so a game that never shows in a window capture costs one capture per
 * read, not two.
 */
export class WowWindowSource implements FrameSource {
  private readonly onError?: (err: unknown) => void;
  private readonly onGeometry?: (geometry: CaptureGeometry) => void;
  private readonly onDiagnostics?: (diagnostics: CaptureDiagnostics) => void;
  private lastGood: CapturePath | null = null;

  /**
   * `onError` receives every error that `grab` swallows before it returns null. `onGeometry`
   * receives the window and monitor geometry for every capture; `onDiagnostics` is called once
   * per grab with what happened (window not found, path used, whether a strip decoded).
   */
  constructor(
    options: {
      onError?: (err: unknown) => void;
      onGeometry?: (geometry: CaptureGeometry) => void;
      onDiagnostics?: (diagnostics: CaptureDiagnostics) => void;
    } = {},
  ) {
    this.onError = options.onError;
    this.onGeometry = options.onGeometry;
    this.onDiagnostics = options.onDiagnostics;
  }

  async grab(): Promise<RawImage | null> {
    try {
      const { Window } = await import("node-screenshots");
      const all = Window.all().map((w) => ({
        title: w.title(),
        appName: w.appName(),
        minimized: w.isMinimized(),
        focused: w.isFocused(),
        win: w,
      }));
      const picked = pickWowWindow(all);
      if (!picked) {
        safely(() => this.onDiagnostics?.({ stage: "no-window", warcraftWindows: warcraftWindows(all) }));
        return null;
      }
      const win: Window = picked.win;
      const windowRect = { x: win.x(), y: win.y(), width: win.width(), height: win.height() };
      const monitor = win.currentMonitor();
      const monitorRect = { x: monitor.x(), y: monitor.y(), width: monitor.width(), height: monitor.height() };

      const attempts: CaptureAttempt[] = [];
      let decoded = false;
      for (const path of captureOrder(this.lastGood)) {
        const full = path === "window" ? await win.captureImage() : await monitor.captureImage();
        safely(() =>
          this.onGeometry?.({
            path,
            window: windowRect,
            monitor: monitorRect,
            image: { width: full.width, height: full.height },
            scaleFactor: monitor.scaleFactor(),
          }),
        );
        const rect =
          path === "window"
            ? clampCrop(0, 0, CROP_W, CROP_H, full.width, full.height)
            : monitorCropRect(windowRect, monitorRect, full);
        const attempt = await toAttempt(path, full, rect);
        if (!attempt) continue;
        attempts.push(attempt);
        if (readStrip(attempt.image)) {
          this.lastGood = path;
          decoded = true;
          break;
        }
      }
      const last = attempts[attempts.length - 1];
      if (!last) {
        safely(() => this.onDiagnostics?.({ stage: "no-image" }));
        return null;
      }
      // When nothing decoded, the last capture is still returned: the reader counts it as a failure.
      safely(() => this.onDiagnostics?.({ stage: last.path, decoded, attempts }));
      return last.image;
    } catch (err) {
      safely(() => this.onError?.(err));
      safely(() => this.onDiagnostics?.({ stage: "error", error: err }));
      return null;
    }
  }
}
