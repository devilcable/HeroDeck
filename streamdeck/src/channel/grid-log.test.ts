import { describe, expect, it } from "vitest";
import type { CaptureAttempt, CaptureDiagnostics } from "./capture";
import { trackGrid } from "./grid-log";

const attempt = (path: "window" | "monitor", region: "tracked" | "full", origin?: { x: number; y: number }): CaptureAttempt => ({
  path,
  region,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  image: { width: 10, height: 10, data: new Uint8Array(400) },
  png: async () => Buffer.alloc(0),
  origin,
});
const decoded = (a: CaptureAttempt[]): CaptureDiagnostics => ({ stage: a[a.length - 1].path, decoded: true, attempts: a });
const missed = (a: CaptureAttempt[]): CaptureDiagnostics => ({ stage: a[a.length - 1].path, decoded: false, attempts: a });

describe("trackGrid", () => {
  it("logs once when the grid is found, with path, region and origin", () => {
    const first = trackGrid(false, decoded([attempt("window", "full", { x: 302, y: 202 })]));
    expect(first).toEqual({ found: true, message: "grid found (path=window region=full origin=302,202)" });
    expect(trackGrid(first.found, decoded([attempt("window", "tracked", { x: 302, y: 202 })]))).toEqual({ found: true });
  });

  it("logs once when the grid is lost, with the path and region of the last read", () => {
    const lost = trackGrid(true, missed([attempt("window", "tracked"), attempt("window", "full")]));
    expect(lost).toEqual({ found: false, message: "grid lost (path=window region=full)" });
    expect(trackGrid(lost.found, missed([attempt("window", "full")]))).toEqual({ found: false });
  });

  it("does not log a loss before the grid was ever found", () => {
    expect(trackGrid(false, missed([attempt("window", "full"), attempt("monitor", "full")]))).toEqual({ found: false });
    expect(trackGrid(false, { stage: "no-window", warcraftWindows: [] })).toEqual({ found: false });
  });

  it("treats a vanished window or area as a loss, and an error as no news", () => {
    expect(trackGrid(true, { stage: "no-window", warcraftWindows: [] })).toEqual({ found: false, message: "grid lost (no-window)" });
    expect(trackGrid(true, { stage: "no-image" })).toEqual({ found: false, message: "grid lost (no-image)" });
    expect(trackGrid(true, { stage: "error", error: new Error("x") })).toEqual({ found: true });
    expect(trackGrid(false, { stage: "error", error: new Error("x") })).toEqual({ found: false });
  });

  it("logs found again after a loss", () => {
    const lost = trackGrid(true, missed([attempt("window", "full")]));
    expect(trackGrid(lost.found, decoded([attempt("monitor", "full", { x: 5, y: 6 })])).message).toBe(
      "grid found (path=monitor region=full origin=5,6)",
    );
  });
});
