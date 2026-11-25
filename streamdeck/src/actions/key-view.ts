import type { ChannelFrame } from "../channel/reader";
import type { SlotKey, SlotTable } from "../durability/slots";
import { type KeyView, percentFrom, slotViewFor, viewFor } from "../durability/view";
import type { KeySettings } from "./settings";

/**
 * Localization key of each slot's short name. The SDK resolves a key by splitting it on ".", so every
 * key must be dot-free: these reuse the English text, like the labels of the property inspector.
 */
const SLOT_NAME_KEY: Record<SlotKey, string> = {
  head: "Head",
  shoulders: "Shoulders",
  chest: "Chest",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  wrists: "Wrists",
  hands: "Hands",
  mainhand: "Main hand",
  offhand: "Off hand",
  ranged: "Ranged",
};

/** Localization keys of the status words of a specific-item key. */
const STATUS_KEY = { empty: "empty", none: "n/a" } as const;

/**
 * What a key shows: the most damaged item from field 0, or one equipped item from the slot table. The most damaged
 * item is drawn as the slot holding field 0's exact percent, so the drawing never contradicts the shown percent;
 * the generic armor stands in when nothing is damaged (100 %) or no slot holds that percent yet.
 */
export function keyViewFor(
  settings: KeySettings,
  frame: ChannelFrame,
  table: SlotTable,
  translate: (key: string) => string,
): KeyView {
  if (settings.item === "lowest") {
    const percent = percentFrom(frame);
    const slot = percent !== null && percent < 100 ? table.slotWith(percent) : null;
    return viewFor(frame, settings.showPercent, slot);
  }
  const { item } = settings;
  return slotViewFor(table.value(item), item, translate(SLOT_NAME_KEY[item]), settings.showPercent, (word) =>
    translate(STATUS_KEY[word]),
  );
}
