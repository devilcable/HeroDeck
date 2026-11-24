import { describe, expect, it } from "vitest";
import { PAGE_SLOTS, SLOT_KEYS, type SlotKey, SlotTable, STALL_MS, VALUE_TTL_MS } from "./slots";

/** A frame as the reader emits it: field 0 = lowest percent, 1 = page, 2-4 = slot values. */
const frame = (page: number | null, a: number | null, b: number | null, c: number | null) => ({
  fields: [50, page, a, b, c],
});

function makeTable() {
  let now = 1_000;
  const table = new SlotTable(() => now);
  return {
    table,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("slot constants", () => {
  it("lists the 11 slots and their pages", () => {
    expect(SLOT_KEYS).toHaveLength(11);
    expect(PAGE_SLOTS).toEqual([
      ["head", "shoulders", "chest"],
      ["waist", "legs", "feet"],
      ["wrists", "hands", "mainhand"],
      ["offhand", "ranged", null],
    ]);
    expect(VALUE_TTL_MS).toBe(10_000);
    expect(STALL_MS).toBe(3_000);
  });
});

describe("SlotTable", () => {
  it("has no data before any frame", () => {
    const { table } = makeTable();
    expect(table.value("head")).toBeNull();
  });

  it("stores page 1 values for waist, legs, feet", () => {
    const { table } = makeTable();
    table.update(frame(1, 80, 55, 12));
    expect(table.value("waist")).toBe(80);
    expect(table.value("legs")).toBe(55);
    expect(table.value("feet")).toBe(12);
    expect(table.value("head")).toBeNull();
  });

  it("keeps 0 and 100 as numbers", () => {
    const { table } = makeTable();
    table.update(frame(0, 0, 100, 1));
    expect(table.value("head")).toBe(0);
    expect(table.value("shoulders")).toBe(100);
    expect(table.value("chest")).toBe(1);
  });

  it("253 -> none, 254 -> empty", () => {
    const { table } = makeTable();
    table.update(frame(3, 254, 253, 255));
    expect(table.value("offhand")).toBe("empty");
    expect(table.value("ranged")).toBe("none");
  });

  it("does not store 255 or an unreadable field, and keeps the previous entry", () => {
    const { table, advance } = makeTable();
    table.update(frame(0, 70, 60, 50));
    advance(1000);
    table.update(frame(1, 40, 255, null));
    expect(table.value("waist")).toBe(40);
    expect(table.value("legs")).toBeNull();
    expect(table.value("feet")).toBeNull();
    advance(1000);
    table.update(frame(0, 255, null, 101));
    expect(table.value("head")).toBe(70);
    expect(table.value("shoulders")).toBe(60);
    expect(table.value("chest")).toBe(50);
  });

  it.each([null, 4, 255, -1, 1.5])("ignores a frame whose page is %s", (page) => {
    const { table, advance } = makeTable();
    table.update(frame(0, 70, 60, 50));
    advance(1000);
    table.update(frame(page, 1, 2, 3));
    expect(table.value("head")).toBe(70);
    expect(table.value("waist")).toBeNull();
    expect(table.value("offhand")).toBeNull();
  });

  it("an ignored frame does not count as a page change", () => {
    const { table, advance } = makeTable();
    table.update(frame(0, 70, 60, 50));
    advance(2000);
    table.update(frame(null, 1, 2, 3));
    advance(1100); // 3.1 s since the page last changed
    table.update(frame(255, 1, 2, 3));
    expect(table.value("head")).toBeNull();
  });

  it("a frame without a page field is ignored", () => {
    const { table } = makeTable();
    table.update({ fields: [50] });
    expect(table.value("head")).toBeNull();
  });

  it("value expires after 10 s", () => {
    const { table, advance } = makeTable();
    table.update(frame(0, 70, 60, 50));
    // keep the page changing so the stall rule does not interfere
    const pages = [1, 2, 3, 1, 2, 3, 1, 2, 3, 1];
    for (const page of pages) {
      advance(1000);
      table.update(frame(page, null, null, null));
    }
    expect(table.value("head")).toBe(70); // exactly 10 s old: still valid
    advance(1000);
    table.update(frame(2, null, null, null));
    expect(table.value("head")).toBeNull();
  });

  it("a stalled page makes the table stale, a new page makes it fresh again", () => {
    const { table, advance } = makeTable();
    table.update(frame(0, 70, 60, 50));
    advance(3000);
    table.update(frame(0, 70, 60, 50));
    expect(table.value("head")).toBe(70); // exactly STALL_MS: not stalled yet
    advance(100);
    table.update(frame(0, 70, 60, 50));
    expect(table.value("head")).toBeNull();
    table.update(frame(1, 80, 55, 12));
    expect(table.value("waist")).toBe(80);
    expect(table.value("head")).toBe(70); // older entry, still within the TTL
  });

  it("the stall is detected even without a new frame", () => {
    const { table, advance } = makeTable();
    table.update(frame(2, 10, 20, 30));
    advance(3100);
    expect(table.value("wrists")).toBeNull();
  });

  it("the first valid page counts as a change", () => {
    const { table, advance } = makeTable();
    advance(50_000);
    table.update(frame(2, 10, 20, 30));
    expect(table.value("wrists")).toBe(10);
  });

  it("a null frame clears everything", () => {
    const { table } = makeTable();
    table.update(frame(0, 70, 60, 50));
    table.update(null);
    expect(table.value("head")).toBeNull();
    // page tracking is cleared too: the same page counts as a change again
    table.update(frame(0, 11, 22, 33));
    expect(table.value("head")).toBe(11);
  });

  it("hasData is true while any slot has a fresh value", () => {
    const { table, advance } = makeTable();
    expect(table.hasData()).toBe(false);
    table.update(frame(0, 70, 255, 255));
    expect(table.hasData()).toBe(true);
    advance(3100); // stalled
    expect(table.hasData()).toBe(false);
    table.update(frame(1, 255, 255, 255)); // page moves again but carries nothing
    expect(table.hasData()).toBe(true); // head is still within its TTL
    table.clear();
    expect(table.hasData()).toBe(false);
  });

  it("clear() empties the table", () => {
    const { table } = makeTable();
    table.update(frame(0, 70, 60, 50));
    table.clear();
    expect(table.value("head")).toBeNull();
  });
});

/** Small seeded PRNG (mulberry32) so the cadence simulation is reproducible. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("SlotTable with the real cadence", () => {
  it.each([1, 2, 3, 42, 1234])("never flickers to no data over 60 s (seed %i)", (seed) => {
    const rand = seeded(seed);
    // Addon: the page advances every 1000-1030 ms, starting at t = 0 (page 0 first).
    const tickTimes: number[] = [];
    for (let t = 0; t <= 61_000; t += 1000 + rand() * 30) tickTimes.push(t);
    const pageAt = (t: number): number => {
      let n = 0;
      while (n < tickTimes.length && tickTimes[n] <= t) n++;
      return (n - 1) % PAGE_SLOTS.length;
    };
    // Plugin: a read every 500 ms with a random phase and +-100 ms jitter.
    const reads: number[] = [];
    for (let t = rand() * 500; t <= 60_000; t += 500 + (rand() * 200 - 100)) reads.push(t);
    // A few single failed reads once the first cycle is over: nothing is delivered for them.
    const failed = new Set<number>();
    while (failed.size < 4) failed.add(10 + Math.floor(rand() * (reads.length - 12)));

    let now = 0;
    const table = new SlotTable(() => now);
    const value = (slot: SlotKey) => 10 + SLOT_KEYS.indexOf(slot);
    const frameAt = (page: number) => ({
      fields: [50, page, ...PAGE_SLOTS[page].map((s) => (s === null ? 255 : value(s)))],
    });

    const cycleDone = 5_000;
    let checked = 0;
    let readIndex = 0;
    for (let t = 0; t <= 60_000; t += 50) {
      while (readIndex < reads.length && reads[readIndex] <= t) {
        now = reads[readIndex];
        if (!failed.has(readIndex)) table.update(frameAt(pageAt(now)));
        readIndex++;
      }
      now = t;
      if (t < cycleDone) continue;
      for (const slot of SLOT_KEYS) {
        expect(table.value(slot), `${slot} at ${t} ms`).toBe(value(slot));
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
