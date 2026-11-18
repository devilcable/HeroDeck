import type { FrameSource } from "./capture";
import { readStrip } from "./strip";

export const POLL_MS = 500;
export const FAILS_BEFORE_NODATA = 3;

/** Decoded field values; `null` means nodata (no readable strip). */
export type ChannelFrame = { fields: (number | null)[] } | null;
type Listener = (frame: ChannelFrame) => void;
type Timers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: any) => void;
};

/**
 * Polls a FrameSource while at least one listener is subscribed. A single read failure (loading
 * screen, hiccup) keeps the last frame; nodata is reported after FAILS_BEFORE_NODATA failures in a row.
 */
export class ChannelReader {
  private readonly listeners = new Set<Listener>();
  private last: ChannelFrame = null;
  private failures = 0;
  private busy = false;
  private handle: unknown = undefined;
  /** Bumped on every stop, so a read still in flight from a previous run is dropped. */
  private epoch = 0;

  constructor(
    private readonly source: FrameSource,
    private readonly timers: Timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h) },
  ) {}

  get running(): boolean {
    return this.handle !== undefined;
  }

  /** Calls `listener` at once with the last frame (null before any read); returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.deliver(listener, this.last);
    if (!this.running) this.start();
    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** One read. Skipped while a previous read is still running. Never throws. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const epoch = this.epoch;
    let fields: (number | null)[] | null = null;
    try {
      const img = await this.source.grab();
      fields = img ? (readStrip(img)?.fields ?? null) : null;
    } catch {
      fields = null;
    } finally {
      this.busy = false;
    }
    if (epoch !== this.epoch) return;

    if (fields) {
      this.failures = 0;
      this.emit({ fields });
    } else if (++this.failures >= FAILS_BEFORE_NODATA) {
      this.emit(null);
    }
  }

  private start(): void {
    this.handle = this.timers.setInterval(() => void this.tick(), POLL_MS);
    void this.tick();
  }

  /** Stops polling and forgets the frame: a later subscriber must not be shown stale data. */
  private stop(): void {
    this.timers.clearInterval(this.handle);
    this.handle = undefined;
    this.epoch++;
    this.last = null;
    this.failures = 0;
  }

  private emit(frame: ChannelFrame): void {
    this.last = frame;
    for (const listener of [...this.listeners]) this.deliver(listener, frame);
  }

  private deliver(listener: Listener, frame: ChannelFrame): void {
    try {
      listener(frame);
    } catch {
      // a failing listener must not break the others or the polling loop
    }
  }
}
