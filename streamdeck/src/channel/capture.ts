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
 * the capture is in physical pixels and the coordinates are not. Null when the window's top-left
 * corner is off that monitor.
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
  if (x < 0 || y < 0) return null;
  return clampCrop(x, y, CROP_W, CROP_H, image.width, image.height);
}

async function toRawImage(img: Image, rect: Rect | null): Promise<RawImage | null> {
  if (!rect) return null;
  const cropped = await img.crop(rect.x, rect.y, rect.width, rect.height);
  const buf = await cropped.toRaw();
  return { width: cropped.width, height: cropped.height, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

/**
 * Captures the top-left corner of the World of Warcraft window with node-screenshots. If the strip
 * is not readable in the window capture (some games capture black), it captures the window's
 * monitor instead and crops at the window's position.
 */
export class WowWindowSource implements FrameSource {
  async grab(): Promise<RawImage | null> {
    try {
      const { Window } = await import("node-screenshots");
      const all = Window.all().map((w) => ({
        title: w.title(),
        minimized: w.isMinimized(),
        focused: w.isFocused(),
        win: w,
      }));
      const picked = pickWowWindow(all);
      if (!picked) return null;
      const win: Window = picked.win;

      const full = await win.captureImage();
      const fromWindow = await toRawImage(full, clampCrop(0, 0, CROP_W, CROP_H, full.width, full.height));
      if (fromWindow && readStrip(fromWindow)) return fromWindow;

      const monitor = win.currentMonitor();
      const monitorImage = await monitor.captureImage();
      const rect = monitorCropRect(
        { x: win.x(), y: win.y() },
        { x: monitor.x(), y: monitor.y(), width: monitor.width(), height: monitor.height() },
        monitorImage,
      );
      return await toRawImage(monitorImage, rect);
    } catch {
      return null;
    }
  }
}
