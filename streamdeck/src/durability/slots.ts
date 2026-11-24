import type { ChannelFrame } from "../channel/reader";

export const SLOT_KEYS = [
  "head",
  "shoulders",
  "chest",
  "waist",
  "legs",
  "feet",
  "wrists",
  "hands",
  "mainhand",
  "offhand",
  "ranged",
] as const;

export type SlotKey = (typeof SLOT_KEYS)[number];

/** Slots carried by each page (field 1 = page, fields 2-4 = these slots in order). */
export const PAGE_SLOTS: (SlotKey | null)[][] = [
  ["head", "shoulders", "chest"],
  ["waist", "legs", "feet"],
  ["wrists", "hands", "mainhand"],
  ["offhand", "ranged", null],
];

/** number = durability percent, "empty" = nothing equipped, "none" = item without durability, null = no data. */
export type SlotValue = number | "empty" | "none" | null;

/** A stored value older than this is no data. */
export const VALUE_TTL_MS = 10_000;
/** The same page seen for longer than this means the addon stopped rotating: no data. */
export const STALL_MS = 3_000;

const PAGE_FIELD = 1;
const FIRST_SLOT_FIELD = 2;
const NO_DURABILITY_BYTE = 253;
const EMPTY_BYTE = 254;

type Entry = { value: number | "empty" | "none"; seenAt: number };

function slotValueFrom(byte: number | null | undefined): Entry["value"] | null {
  if (typeof byte !== "number") return null;
  if (byte >= 0 && byte <= 100) return byte;
  if (byte === NO_DURABILITY_BYTE) return "none";
  if (byte === EMPTY_BYTE) return "empty";
  return null;
}

/** Slot durabilities rebuilt from the rotating pages of the channel (shared by all keys). */
export class SlotTable {
  private entries = new Map<SlotKey, Entry>();
  private lastPage: number | null = null;
  private lastPageChange = 0;

  constructor(private readonly now: () => number = Date.now) {}

  update(frame: ChannelFrame): void {
    if (frame === null) {
      this.clear();
      return;
    }
    const page = frame.fields[PAGE_FIELD];
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0 || page >= PAGE_SLOTS.length) return;

    const now = this.now();
    if (page !== this.lastPage) {
      this.lastPage = page;
      this.lastPageChange = now;
    }
    PAGE_SLOTS[page].forEach((slot, position) => {
      if (slot === null) return;
      const value = slotValueFrom(frame.fields[FIRST_SLOT_FIELD + position]);
      if (value !== null) this.entries.set(slot, { value, seenAt: now });
    });
  }

  value(slot: SlotKey): SlotValue {
    const now = this.now();
    if (this.lastPage === null || now - this.lastPageChange > STALL_MS) return null;
    const entry = this.entries.get(slot);
    if (!entry || now - entry.seenAt > VALUE_TTL_MS) return null;
    return entry.value;
  }

  /** True while at least one slot has a value (not stalled, not expired). */
  hasData(): boolean {
    return SLOT_KEYS.some((slot) => this.value(slot) !== null);
  }

  clear(): void {
    this.entries.clear();
    this.lastPage = null;
    this.lastPageChange = 0;
  }
}
