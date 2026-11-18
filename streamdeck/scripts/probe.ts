/**
 * Manual check against the running game (WoW windowed or borderless, addon loaded):
 *   npx tsx scripts/probe.ts
 * Prints the decoded fields (or "nodata") and the grab time every 500 ms, errors from the capture,
 * and, once, the window/monitor geometry when the monitor fallback is used. Ctrl+C to stop.
 */
import { type CaptureGeometry, WowWindowSource } from "../src/channel/capture";
import { readStrip } from "../src/channel/strip";

let geometryLogged = false;
const source = new WowWindowSource({
  onError: (err) => console.error("grab error:", err),
  onGeometry: (g: CaptureGeometry) => {
    if (geometryLogged) return;
    geometryLogged = true;
    const r = (n: { x: number; y: number; width: number; height: number }) => `x=${n.x} y=${n.y} w=${n.width} h=${n.height}`;
    console.log(
      `monitor fallback used: window ${r(g.window)} | monitor ${r(g.monitor)} | monitor image ${g.monitorImage.width}x${g.monitorImage.height} | scaleFactor=${g.scaleFactor}`,
    );
  },
});

async function probe(): Promise<void> {
  const start = performance.now();
  const img = await source.grab();
  const ms = Math.round(performance.now() - start);
  const strip = img ? readStrip(img) : null;
  console.log(strip ? `fields=${JSON.stringify(strip.fields)}` : "nodata", `grab=${ms}ms`);
}

setInterval(() => void probe(), 500);
void probe();
