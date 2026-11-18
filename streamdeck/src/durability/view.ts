import type { ChannelFrame } from "../channel/reader";

export type DurabilityState = "ok" | "warn" | "critical" | "nodata";

/** Channel field that carries the durability percent. */
export const DURABILITY_FIELD = 0;

export type KeyView = { image: string; title: string };

/** Durability percent from the frame; null for nodata, an unreadable field, or a value above 100. */
export function percentFrom(frame: ChannelFrame): number | null {
  const value = frame?.fields[DURABILITY_FIELD];
  return typeof value === "number" && value <= 100 ? value : null;
}

export function stateFor(percent: number | null): DurabilityState {
  if (percent === null) return "nodata";
  if (percent >= 50) return "ok";
  if (percent >= 20) return "warn";
  return "critical";
}

export function imageFor(state: DurabilityState): string {
  return `imgs/actions/durability/${state}.svg`;
}

export function titleFor(percent: number | null, showPercent: boolean): string {
  if (!showPercent) return "";
  return percent === null ? "--" : `${percent}%`;
}

export function viewFor(frame: ChannelFrame, showPercent: boolean): KeyView {
  const percent = percentFrom(frame);
  return { image: imageFor(stateFor(percent)), title: titleFor(percent, showPercent) };
}

/** What must be sent to the key to go from `prev` (undefined before the first render) to `next`. */
export function diffView(prev: KeyView | undefined, next: KeyView): { image?: string; title?: string } {
  const change: { image?: string; title?: string } = {};
  if (prev?.image !== next.image) change.image = next.image;
  if (prev?.title !== next.title) change.title = next.title;
  return change;
}
