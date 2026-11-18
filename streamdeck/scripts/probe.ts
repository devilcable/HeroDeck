/**
 * Manual check against the running game (WoW windowed or borderless, addon loaded):
 *   npx tsx scripts/probe.ts
 * Prints the decoded fields (or "nodata") and the grab time every 500 ms. Ctrl+C to stop.
 */
import { WowWindowSource } from "../src/channel/capture";
import { readStrip } from "../src/channel/strip";

const source = new WowWindowSource();

async function probe(): Promise<void> {
  const start = performance.now();
  const img = await source.grab();
  const ms = Math.round(performance.now() - start);
  const strip = img ? readStrip(img) : null;
  console.log(strip ? `fields=${JSON.stringify(strip.fields)}` : "nodata", `grab=${ms}ms`);
}

setInterval(() => void probe(), 500);
void probe();
