import type { CaptureDiagnostics } from "./capture";

/**
 * Follows whether the grid is visible across grabs, from the diagnostics of each grab. Returns the
 * new state and, only when it changed, the line to log: once when the grid is found, once when it
 * is lost, never on every tick. A capture error says nothing about the grid and keeps the state.
 */
export function trackGrid(found: boolean, d: CaptureDiagnostics): { found: boolean; message?: string } {
  if (d.stage === "error") return { found };
  if (d.stage === "no-window" || d.stage === "no-image") {
    return found ? { found: false, message: `grid lost (${d.stage})` } : { found };
  }
  const last = d.attempts[d.attempts.length - 1];
  const hit = d.attempts.find((a) => a.origin);
  if (d.decoded && hit?.origin) {
    if (found) return { found };
    return { found: true, message: `grid found (path=${hit.path} region=${hit.region} origin=${hit.origin.x},${hit.origin.y})` };
  }
  if (!found) return { found };
  return { found: false, message: `grid lost (path=${last?.path ?? d.stage} region=${last?.region ?? "none"})` };
}
