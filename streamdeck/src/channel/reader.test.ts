import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawImage } from "./protocol";
import { ChannelReader, FAILS_BEFORE_NODATA, POLL_MS, type ChannelFrame } from "./reader";
import { readStrip } from "./strip";

type Strip = { version: number; fields: (number | null)[] };

/** The reader decodes through readStrip; the tests script its results. */
vi.mock("./strip", () => ({ readStrip: vi.fn() }));
const mockedReadStrip = vi.mocked(readStrip);

const IMG: RawImage = { width: 1, height: 1, data: new Uint8Array(4) };
const strip = (...fields: (number | null)[]): Strip => ({ version: 1, fields });

/**
 * A source whose grab() plays the next scripted outcome: a decodable strip, "blank" (an image
 * with no strip), "none" (no image at all) or an Error to throw. Past the script: no image.
 */
type Outcome = Strip | "blank" | "none" | Error;
function scripted(outcomes: Outcome[]) {
  const queue = [...outcomes];
  const grab = vi.fn(async (): Promise<RawImage | null> => {
    const next = queue.shift() ?? "none";
    if (next instanceof Error) throw next;
    if (next === "none") return null;
    mockedReadStrip.mockReturnValueOnce(next === "blank" ? null : next);
    return IMG;
  });
  return { source: { grab }, grab };
}

describe("ChannelReader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedReadStrip.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling on first subscriber, stops after last unsubscribe", async () => {
    const { source, grab } = scripted([]);
    const reader = new ChannelReader(source);
    expect(reader.running).toBe(false);

    const off1 = reader.subscribe(() => {});
    const off2 = reader.subscribe(() => {});
    expect(reader.running).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(grab).toHaveBeenCalledTimes(1); // the first read starts at once
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(grab).toHaveBeenCalledTimes(2);

    off1();
    expect(reader.running).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(grab).toHaveBeenCalledTimes(3);

    off2();
    expect(reader.running).toBe(false);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(grab).toHaveBeenCalledTimes(3);
  });

  it("unsubscribing twice does not stop another subscriber's polling", () => {
    const reader = new ChannelReader(scripted([]).source);
    const off1 = reader.subscribe(() => {});
    reader.subscribe(() => {});
    off1();
    off1();
    expect(reader.running).toBe(true);
  });

  it("emits the decoded frame to every subscriber", async () => {
    const reader = new ChannelReader(scripted([strip(87, null, 12)]).source);
    const a: ChannelFrame[] = [];
    const b: ChannelFrame[] = [];
    reader.subscribe((f) => a.push(f));
    reader.subscribe((f) => b.push(f));
    await vi.advanceTimersByTimeAsync(0);
    expect(a.at(-1)).toEqual({ fields: [87, null, 12] });
    expect(b.at(-1)).toEqual({ fields: [87, null, 12] });
  });

  it("reports nodata only after 3 consecutive failures", async () => {
    expect(FAILS_BEFORE_NODATA).toBe(3);
    const reader = new ChannelReader(scripted([strip(87), "blank", "blank", "blank", strip(60)]).source);
    const seen: ChannelFrame[] = [];
    reader.subscribe((f) => seen.push(f));
    await vi.advanceTimersByTimeAsync(0); // good
    expect(seen.at(-1)).toEqual({ fields: [87] });
    await vi.advanceTimersByTimeAsync(POLL_MS); // fail 1
    expect(seen.at(-1)).toEqual({ fields: [87] });
    await vi.advanceTimersByTimeAsync(POLL_MS); // fail 2
    expect(seen.at(-1)).toEqual({ fields: [87] });
    await vi.advanceTimersByTimeAsync(POLL_MS); // fail 3
    expect(seen.at(-1)).toBeNull();
    await vi.advanceTimersByTimeAsync(POLL_MS); // good again
    expect(seen.at(-1)).toEqual({ fields: [60] });
  });

  it("counts a grab with no image, and a grab that throws, as failures", async () => {
    const reader = new ChannelReader(scripted([strip(50), "none", new Error("boom"), new Error("boom")]).source);
    const seen: ChannelFrame[] = [];
    reader.subscribe((f) => seen.push(f));
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(seen.at(-1)).toEqual({ fields: [50] }); // two failures so far
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen.at(-1)).toBeNull();
    expect(reader.running).toBe(true); // the interval survived the throws
  });

  it("restarts the failure streak after a good read", async () => {
    const reader = new ChannelReader(scripted([strip(1), "blank", "blank", strip(2), "blank", "blank"]).source);
    const seen: ChannelFrame[] = [];
    reader.subscribe((f) => seen.push(f));
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(seen.at(-1)).toEqual({ fields: [2] });
    expect(seen.slice(1)).not.toContain(null); // seen[0] is the initial nodata
  });

  it("a new subscriber gets the last frame immediately (null before any read)", async () => {
    const reader = new ChannelReader(scripted([strip(42)]).source);
    const first = vi.fn();
    reader.subscribe(first);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenLastCalledWith(null); // nodata before any read
    await vi.advanceTimersByTimeAsync(0);

    const late = vi.fn();
    reader.subscribe(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith({ fields: [42] });
  });

  it("ticks do not overlap", async () => {
    let release: (img: RawImage | null) => void = () => {};
    const grab = vi.fn(() => new Promise<RawImage | null>((resolve) => (release = resolve)));
    const reader = new ChannelReader({ grab });
    reader.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(POLL_MS * 3); // the first grab is still pending
    expect(grab).toHaveBeenCalledTimes(1);

    mockedReadStrip.mockReturnValueOnce(strip(9));
    release(IMG);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(grab).toHaveBeenCalledTimes(2); // polling resumed
  });

  it("counts ticks skipped behind a grab that never returns as failures", async () => {
    let release: (img: RawImage | null) => void = () => {};
    const grab = vi.fn(() => new Promise<RawImage | null>((resolve) => (release = resolve)));
    const reader = new ChannelReader({ grab });
    const listener = vi.fn();
    reader.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1); // the initial nodata
    await vi.advanceTimersByTimeAsync(POLL_MS * 2); // skipped ticks 1 and 2
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS); // skipped tick 3: nodata is reported
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);
    expect(grab).toHaveBeenCalledTimes(1); // still only one grab in flight

    mockedReadStrip.mockReturnValueOnce(strip(9));
    release(IMG);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenLastCalledWith({ fields: [9] }); // a late good frame is shown again
  });

  it("a good read after skipped ticks restarts the failure streak", async () => {
    let release: (img: RawImage | null) => void = () => {};
    const grab = vi.fn(() => new Promise<RawImage | null>((resolve) => (release = resolve)));
    const reader = new ChannelReader({ grab });
    const seen: ChannelFrame[] = [];
    reader.subscribe((f) => seen.push(f));
    await vi.advanceTimersByTimeAsync(POLL_MS * 2); // 2 skipped ticks
    mockedReadStrip.mockReturnValueOnce(strip(5));
    release(IMG);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)).toEqual({ fields: [5] });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3); // a new grab starts, then 2 skipped ticks: not 3 in a row in total
    expect(seen.at(-1)).toEqual({ fields: [5] });
  });

  it("starts from nodata again after every subscriber left", async () => {
    const reader = new ChannelReader(scripted([strip(42)]).source);
    const off = reader.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    off();
    const again = vi.fn();
    reader.subscribe(again);
    expect(again).toHaveBeenCalledWith(null);
  });

  it("drops a late result that arrives after the last unsubscribe", async () => {
    let release: (img: RawImage | null) => void = () => {};
    const grab = vi.fn(() => new Promise<RawImage | null>((resolve) => (release = resolve)));
    const reader = new ChannelReader({ grab });
    const off = reader.subscribe(() => {});
    off();
    mockedReadStrip.mockReturnValueOnce(strip(77));
    release(IMG);
    await vi.advanceTimersByTimeAsync(0);
    const again = vi.fn();
    reader.subscribe(again);
    expect(again).toHaveBeenCalledWith(null);
  });
});
