import { SLOT_KEYS, type SlotKey } from "../durability/slots";

/** Raw settings of a Durability key as stored by Stream Deck (every field may be missing on older keys). */
export type DurabilitySettings = { showPercent?: boolean; item?: string };

export type KeySettings = { showPercent: boolean; item: "lowest" | SlotKey };

export function settingsFrom(raw: DurabilitySettings): KeySettings {
  const item = (SLOT_KEYS as readonly string[]).includes(raw.item ?? "") ? (raw.item as SlotKey) : "lowest";
  return { showPercent: raw.showPercent ?? true, item };
}
