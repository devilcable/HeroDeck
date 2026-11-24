import { describe, expect, it } from "vitest";
import { trackSlots } from "./slot-log";

describe("trackSlots", () => {
  it("logs once when slot data becomes available, then stays quiet", () => {
    const first = trackSlots(false, true, true);
    expect(first).toEqual({ fresh: true, message: "slot data available" });
    expect(trackSlots(first.fresh, true, true)).toEqual({ fresh: true });
  });

  it("logs once when slot data is lost (stall or expiry), then stays quiet", () => {
    const lost = trackSlots(true, false, true);
    expect(lost).toEqual({ fresh: false, message: "slot data lost (stalled, expired or grid lost)" });
    expect(trackSlots(lost.fresh, false, true)).toEqual({ fresh: false });
  });

  it("logs again when the data comes back", () => {
    const lost = trackSlots(true, false, true);
    expect(trackSlots(lost.fresh, true, true).message).toBe("slot data available");
  });

  it("says nothing while no specific-item key is visible, and follows the data silently", () => {
    expect(trackSlots(false, true, false)).toEqual({ fresh: true });
    expect(trackSlots(true, false, false)).toEqual({ fresh: false });
    // a key then starts watching while data is present: no news
    expect(trackSlots(true, true, true)).toEqual({ fresh: true });
  });
});
