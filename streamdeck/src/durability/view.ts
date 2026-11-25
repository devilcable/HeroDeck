import type { ChannelFrame } from "../channel/reader";
import type { SlotKey, SlotValue } from "./slots";

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

/** The slot's drawing in the state's colors, or the generic armor without a slot. */
export function imageFor(state: DurabilityState, slot?: SlotKey | null): string {
  return slot ? `imgs/actions/durability/${slot}/${state}.svg` : `imgs/actions/durability/${state}.svg`;
}

export function titleFor(percent: number | null, showPercent: boolean): string {
  if (!showPercent) return "";
  return percent === null ? "--" : `${percent}%`;
}

/** View of the most damaged item: field 0's percent, drawn as `slot` (generic armor without one, or for no data). */
export function viewFor(frame: ChannelFrame, showPercent: boolean, slot?: SlotKey | null): KeyView {
  const percent = percentFrom(frame);
  const state = stateFor(percent);
  return { image: imageFor(state, state === "nodata" ? null : slot), title: titleFor(percent, showPercent) };
}

/**
 * View of a key that follows one equipped item: `label` on line 1, then the percent, a status word or `--`.
 * With `showPercent` off only the percent is dropped; the status words stay.
 */
export function slotViewFor(
  value: SlotValue,
  slot: SlotKey,
  label: string,
  showPercent: boolean,
  t: (key: "empty" | "none") => string,
): KeyView {
  if (typeof value === "number") {
    return { image: imageFor(stateFor(value), slot), title: showPercent ? `${label}\n${value}%` : label };
  }
  const word = value === "empty" ? t("empty") : value === "none" ? t("none") : "--";
  return { image: imageFor("nodata", slot), title: `${label}\n${word}` };
}

/** What must be sent to the key to go from `prev` (undefined before the first render) to `next`. */
export function diffView(prev: KeyView | undefined, next: KeyView): { image?: string; title?: string } {
  const change: { image?: string; title?: string } = {};
  if (prev?.image !== next.image) change.image = next.image;
  if (prev?.title !== next.title) change.title = next.title;
  return change;
}
