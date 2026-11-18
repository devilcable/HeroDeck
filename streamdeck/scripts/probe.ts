/**
 * Manual check against the running game (WoW windowed or borderless, addon loaded):
 *   npm run probe [-- --dump <dir>]
 * Every 500 ms it prints the decoded fields (or "nodata"), the capture path that produced the
 * image (window or monitor) and the grab time. Capture errors are printed as they happen, and the
 * window/monitor geometry once per path. When there is nothing to decode it says why:
 *   - no window titled exactly "World of Warcraft": lists the windows with "warcraft" in the title;
 *   - strip candidates found but rejected: prints their count and the 4 raw header colors (r,g,b)
 *     of the first one. Expected: 255,255,255 | 0,0,0 | 255,0,255 | 0,0,85. A red/blue swap shows
 *     up as a version cell of 85,0,0.
 * --dump <dir> saves the cropped capture(s) of the first tick that has any as PNG files in <dir>
 * (window.png, monitor.png), to turn a real capture into a test fixture. Ctrl+C to stop.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type CaptureAttempt, type CaptureDiagnostics, type CaptureGeometry, WowWindowSource } from "../src/channel/capture";
import { findStripCandidates, readCells } from "../src/channel/locate";
import { HEADER_CELLS, type RawImage } from "../src/channel/protocol";
import { readStrip } from "../src/channel/strip";

const dumpFlag = process.argv.indexOf("--dump");
const dumpDir = dumpFlag >= 0 ? process.argv[dumpFlag + 1] : undefined;
if (dumpFlag >= 0 && (!dumpDir || dumpDir.startsWith("--"))) {
  console.error("usage: npm run probe [-- --dump <dir>]");
  process.exit(1);
}

const geometryLogged = new Set<string>();
let lastDiagnostics: CaptureDiagnostics | undefined;
let dumped = false;

const source = new WowWindowSource({
  onError: (err) => console.error("grab error:", err),
  onGeometry: (g: CaptureGeometry) => {
    if (geometryLogged.has(g.path)) return;
    geometryLogged.add(g.path);
    const r = (n: { x: number; y: number; width: number; height: number }) => `x=${n.x} y=${n.y} w=${n.width} h=${n.height}`;
    console.log(
      `geometry (${g.path} capture): window ${r(g.window)} | monitor ${r(g.monitor)} | image ${g.image.width}x${g.image.height} | scaleFactor=${g.scaleFactor}`,
    );
  },
  onDiagnostics: (d) => {
    lastDiagnostics = d;
  },
});

const rgb = (c: { r: number; g: number; b: number }) => `${c.r},${c.g},${c.b}`;

/** Why a capture did not decode: candidate count and the raw header colors of the first one. */
function explainRejected(img: RawImage): string {
  const candidates = findStripCandidates(img);
  if (candidates.length === 0) return `no strip candidate in ${img.width}x${img.height} image`;
  const header = readCells(img, candidates[0], HEADER_CELLS).map(rgb).join(" | ");
  return `${candidates.length} candidate(s) rejected; first at (${candidates[0].x},${candidates[0].y}) header: ${header}`;
}

async function dump(dir: string, attempts: CaptureAttempt[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const a of attempts) {
    const file = resolve(join(dir, `${a.path}.png`));
    await writeFile(file, await a.png());
    console.log(`dumped ${a.path} crop (${a.image.width}x${a.image.height}) to ${file}`);
  }
}

let running = false;

async function probe(): Promise<void> {
  if (running) return; // a slow grab must not overlap the next tick
  running = true;
  try {
    lastDiagnostics = undefined;
    const start = performance.now();
    const img = await source.grab();
    const ms = Math.round(performance.now() - start);
    const strip = img ? readStrip(img) : null;
    const d = lastDiagnostics as CaptureDiagnostics | undefined;
    const path = d && (d.stage === "window" || d.stage === "monitor") ? ` path=${d.stage}` : "";
    console.log(strip ? `fields=${JSON.stringify(strip.fields)}` : "nodata", `grab=${ms}ms${path}`);
    if (!strip) {
      if (d?.stage === "no-window") {
        const list = d.warcraftWindows.map((w) => `"${w.title}" (${w.appName}${w.minimized ? ", minimized" : ""})`);
        console.log(
          `  no window titled exactly "World of Warcraft"; windows with "warcraft" in the title: ${list.length ? list.join(", ") : "none"}`,
        );
      } else if (d?.stage === "no-image") {
        console.log("  the window has no area to crop (check the geometry line)");
      } else if (d && (d.stage === "window" || d.stage === "monitor")) {
        for (const a of d.attempts) console.log(`  ${a.path}: ${explainRejected(a.image)}`);
      }
    }
    if (dumpDir && !dumped && d && (d.stage === "window" || d.stage === "monitor")) {
      dumped = true;
      await dump(dumpDir, d.attempts);
    }
  } catch (err) {
    console.error("probe error:", err);
  } finally {
    running = false;
  }
}

setInterval(() => void probe(), 500);
void probe();
