import { describe, expect, it } from "vitest";
import { SlotTable } from "../durability/slots";
import { slotViewFor, viewFor } from "../durability/view";
import { keyViewFor } from "./key-view";

const translate = (key: string): string => `<${key}>`;

describe("keyViewFor", () => {
  it("renders the most damaged view for item lowest", () => {
    const table = new SlotTable(() => 0);
    const frame = { fields: [42, null, null, null, null] };
    expect(keyViewFor({ showPercent: true, item: "lowest" }, frame, table, translate)).toEqual(viewFor(frame, true));
  });

  it("renders the slot view for a specific item", () => {
    let now = 0;
    const table = new SlotTable(() => now);
    const frame = { fields: [42, 2, 87, 10, 55] };
    table.update(frame);
    now = 100;
    const view = keyViewFor({ showPercent: true, item: "wrists" }, frame, table, translate);
    expect(view).toEqual(slotViewFor(87, "<slot.wrists>", true, translate));
    expect(view.title).toBe("<slot.wrists>\n87%");
  });

  it("shows no data for an item the table has not seen", () => {
    const table = new SlotTable(() => 0);
    const view = keyViewFor({ showPercent: true, item: "head" }, null, table, translate);
    expect(view.title).toBe("<slot.head>\n--");
  });
});
