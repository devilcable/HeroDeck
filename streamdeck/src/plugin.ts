import streamDeck from "@elgato/streamdeck";
import { DurabilityAction } from "./actions/durability";
import { WowWindowSource } from "./channel/capture";
import { trackGrid } from "./channel/grid-log";
import { ChannelReader } from "./channel/reader";

streamDeck.logger.setLevel("info");

// One reader for all keys: it polls only while at least one key is visible.
const logger = streamDeck.logger.createScope("capture");
let lastError = "";
let gridFound = false;
const reader = new ChannelReader(
  new WowWindowSource({
    // The reader polls twice a second: log a repeating error once, not on every tick.
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (message === lastError) return;
      lastError = message;
      logger.warn("capture failed:", message);
    },
    // A grab that completed without an error ends the streak: the same error later is logged again.
    // The grid going from found to lost (and back) is logged once, not on every tick.
    onDiagnostics: (d) => {
      if (d.stage !== "error") lastError = "";
      const tracked = trackGrid(gridFound, d);
      gridFound = tracked.found;
      if (tracked.message) logger.info(tracked.message);
    },
  }),
);

streamDeck.actions.registerAction(new DurabilityAction(reader));

// Finally, connect to the Stream Deck.
streamDeck.connect();
