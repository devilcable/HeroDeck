import type { ChannelFrame } from "../channel/reader";
import type { SlotTable } from "../durability/slots";
import { type KeyView, slotViewFor, viewFor } from "../durability/view";
import type { KeySettings } from "./settings";

/** What a key shows: the most damaged item from field 0, or one equipped item from the slot table. */
export function keyViewFor(
  settings: KeySettings,
  frame: ChannelFrame,
  table: SlotTable,
  translate: (key: string) => string,
): KeyView {
  if (settings.item === "lowest") return viewFor(frame, settings.showPercent);
  const { item } = settings;
  return slotViewFor(table.value(item), translate(`slot.${item}`), settings.showPercent, (k) => translate(`slot.${k}`));
}
