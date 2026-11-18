import streamDeck from "@elgato/streamdeck";

// Trace logging records all messages between Stream Deck and the plugin.
streamDeck.logger.setLevel("trace");

// Actions are registered here as they are implemented.

// Finally, connect to the Stream Deck.
streamDeck.connect();
