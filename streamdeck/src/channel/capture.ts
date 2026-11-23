import type { Image, Window } from "node-screenshots";
import { CELL_PITCH, CELL_PX, GRID_COLS, GRID_ROWS, type RawImage } from "./protocol";
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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The window and monitor geometry, and the size of the full capture of `path`, for diagnostics. */
export interface CaptureGeometry {
  path: CapturePath;
  window: Rect;
  monitor: Rect;
  image: { width: number; height: number };
  scaleFactor: number;
}

/**
 * One read of a grab: the pixels of a region of a capture, and a lazy PNG of the same pixels (to
 * save as a fixture). `region` says whether it is the area around the last position or the whole
 * game area; `rect` is where it sits in the capture; `origin` is the grid origin in the capture
 * coordinates, set only on the attempt that decoded.
 */
export interface CaptureAttempt {
  path: CapturePath;
  region: "tracked" | "full";
  rect: Rect;
  image: RawImage;
  png: () => Promise<Buffer>;
  origin?: Point;
}

/** Reported once per grab to the optional `onDiagnostics` hook. `stage` is the path of the last attempt. */
export type CaptureDiagnostics =
  | { stage: "no-window"; warcraftWindows: WindowTitleInfo[] }
  | { stage: CapturePath; decoded: boolean; attempts: CaptureAttempt[] }
  | { stage: "no-image" }
  | { stage: "error"; error: unknown };

export interface FrameSource {
  /** The pixels around the grid (RGBA) once it decoded, or null when there is nothing to read. */
  grab(): Promise<RawImage | null>;
}

/** Margin in physical pixels kept around the last grid position when looking for the grid again. */
export const TRACK_MARGIN = 64;
/** Width and height in physical pixels of the 5x3 grid. */
const GRID_W = (GRID_COLS - 1) * CELL_PITCH + CELL_PX;
const GRID_H = (GRID_ROWS - 1) * CELL_PITCH + CELL_PX;

/** Intersect a rectangle with an image of the given size. Null when nothing is left. */
export function clampCrop(x: number, y: number, width: number, height: number, imgW: number, imgH: number): Rect | null {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const w = Math.min(x + width, imgW) - x0;
  const h = Math.min(y + height, imgH) - y0;
  return w > 0 && h > 0 ? { x: x0, y: y0, width: w, height: h } : null;
}

/** The region searched around a grid last seen at `last` (capture coordinates), clamped to the capture. */
export function trackRect(last: Point, image: { width: number; height: number }): Rect | null {
  return clampCrop(
    last.x - TRACK_MARGIN,
    last.y - TRACK_MARGIN,
    GRID_W + 2 * TRACK_MARGIN,
    GRID_H + 2 * TRACK_MARGIN,
    image.width,
    image.height,
  );
}

/**
 * The area to scan in full, in a capture of `path`. The window capture is the game: the whole
 * image. In a monitor capture it is the window area; the window rectangle is in monitor
 * coordinates and is scaled by (capture size / monitor size) in case the capture is in physical
 * pixels and the coordinates are not. A slightly negative origin (a maximized or borderless window
 * sits at about -8,-8) is clamped to 0. Null only when the area is empty inside the image.
 */
export function gameRect(
  path: CapturePath,
  windowRect: Rect,
  monitorRect: Rect,
  image: { width: number; height: number },
): Rect | null {
  if (path === "window") return clampCrop(0, 0, image.width, image.height, image.width, image.height);
  const scaleX = monitorRect.width > 0 ? image.width / monitorRect.width : 1;
  const scaleY = monitorRect.height > 0 ? image.height / monitorRect.height : 1;
  return clampCrop(
    Math.round((windowRect.x - monitorRect.x) * scaleX),
    Math.round((windowRect.y - monitorRect.y) * scaleY),
    Math.round(windowRect.width * scaleX),
    Math.round(windowRect.height * scaleY),
    image.width,
    image.height,
  );
}

/** A copy of the pixels of `rect`, which must lie inside `img`. */
export function cropRaw(img: RawImage, rect: Rect): RawImage {
  const data = new Uint8Array(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * img.width + rect.x) * 4;
    data.set(img.data.subarray(start, start + rect.width * 4), row * rect.width * 4);
  }
  return { width: rect.width, height: rect.height, data };
}

/** One capture of a path, as `readGame` sees it: its size, the area to scan in full, and a way to read a region. */
export interface GameCapture {
  size: { width: number; height: number };
  full: Rect | null;
  crop(rect: Rect): Promise<{ image: RawImage; png: () => Promise<Buffer> }>;
}

/** What `readGame` remembers between grabs: the path that last decoded, and per path the grid origin in that capture. */
export interface GrabState {
  lastGood: CapturePath | null;
  last: Record<CapturePath, Point | null>;
}

export function newGrabState(): GrabState {
  return { lastGood: null, last: { window: null, monitor: null } };
}

/**
 * One grab. Per path, in `captureOrder`: capture it once, read the region around the last position
 * when there is one, then the whole game area if that did not decode. On a decode it remembers the
 * grid origin (capture coordinates) and returns only the pixels around the grid, so the caller
 * decodes a small image, not the whole capture. When neither region of a path decodes, the last
 * position of that path is forgotten. `image` is null when nothing decoded; `attempts` lists every
 * read made.
 */
export async function readGame(
  capture: (path: CapturePath) => Promise<GameCapture>,
  state: GrabState,
): Promise<{ image: RawImage | null; attempts: CaptureAttempt[] }> {
  const attempts: CaptureAttempt[] = [];
  for (const path of captureOrder(state.lastGood)) {
    const cap = await capture(path);
    const previous = state.last[path];
    const tracked = previous ? trackRect(previous, cap.size) : null;
    const regions: { region: "tracked" | "full"; rect: Rect }[] = [];
    if (tracked) regions.push({ region: "tracked", rect: tracked });
    if (cap.full) regions.push({ region: "full", rect: cap.full });
    for (const { region, rect } of regions) {
      const { image, png } = await cap.crop(rect);
      const attempt: CaptureAttempt = { path, region, rect, image, png };
      attempts.push(attempt);
      const strip = readStrip(image);
      if (!strip) continue;
      const origin = { x: rect.x + strip.origin.x, y: rect.y + strip.origin.y };
      attempt.origin = origin;
      state.last[path] = origin;
      state.lastGood = path;
      const around = trackRect(origin, cap.size);
      const inside =
        around && clampCrop(around.x - rect.x, around.y - rect.y, around.width, around.height, image.width, image.height);
      return { image: inside ? cropRaw(image, inside) : image, attempts };
    }
    state.last[path] = null;
  }
  return { image: null, attempts };
}

async function cropImage(img: Image, rect: Rect): Promise<{ image: RawImage; png: () => Promise<Buffer> }> {
  const cropped = await img.crop(rect.x, rect.y, rect.width, rect.height);
  const buf = await cropped.toRaw();
  return {
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
 * Captures the World of Warcraft window with node-screenshots and looks for the grid in the whole
 * game area or, once it has been found, in a region around where it was (it moves when the minimap
 * button is dragged; a miss there falls back to a full scan in the same grab). If the grid is not
 * readable in the window capture (some games capture black), it captures the window monitor
 * instead and scans the window area. The path that last decoded is tried first on the next grab,
 * so a game that never shows in a window capture costs one capture per read, not two.
 */
export class WowWindowSource implements FrameSource {
  private readonly onError?: (err: unknown) => void;
  private readonly onGeometry?: (geometry: CaptureGeometry) => void;
  private readonly onDiagnostics?: (diagnostics: CaptureDiagnostics) => void;
  private readonly state = newGrabState();

  /**
   * `onError` receives every error that `grab` swallows before it returns null. `onGeometry`
   * receives the window and monitor geometry for every capture; `onDiagnostics` is called once
   * per grab with what happened (window not found, reads made, whether the grid decoded).
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

      const { image, attempts } = await readGame(async (path) => {
        const full = path === "window" ? await win.captureImage() : await monitor.captureImage();
        const size = { width: full.width, height: full.height };
        safely(() =>
          this.onGeometry?.({ path, window: windowRect, monitor: monitorRect, image: size, scaleFactor: monitor.scaleFactor() }),
        );
        return { size, full: gameRect(path, windowRect, monitorRect, size), crop: (rect) => cropImage(full, rect) };
      }, this.state);
      const last = attempts[attempts.length - 1];
      if (!last) {
        safely(() => this.onDiagnostics?.({ stage: "no-image" }));
        return null;
      }
      // When nothing decoded, `image` is null: the reader counts that as a failed read.
      safely(() => this.onDiagnostics?.({ stage: last.path, decoded: image !== null, attempts }));
      return image;
    } catch (err) {
      safely(() => this.onError?.(err));
      safely(() => this.onDiagnostics?.({ stage: "error", error: err }));
      return null;
    }
  }
}
