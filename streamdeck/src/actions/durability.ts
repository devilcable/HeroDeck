import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { ChannelFrame, ChannelReader } from "../channel/reader";
import { diffView, type KeyView, viewFor } from "../durability/view";

const logger = streamDeck.logger.createScope("durability");

type Settings = { showPercent?: boolean };

type KeyState = {
  key: KeyAction<Settings>;
  frame: ChannelFrame;
  showPercent: boolean;
  shown?: KeyView;
  unsubscribe: () => void;
};

/** Shows the durability of the most damaged equipped item; one reader subscription per visible key. */
@action({ UUID: "com.devilcable.herodeck.durability" })
export class DurabilityAction extends SingletonAction<Settings> {
  private readonly keys = new Map<string, KeyState>();

  constructor(private readonly reader: ChannelReader) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    if (!ev.action.isKey()) return;
    const key = ev.action;
    const id = key.id;
    this.keys.get(id)?.unsubscribe();
    const state: KeyState = {
      key,
      frame: null,
      showPercent: ev.payload.settings.showPercent ?? true,
      unsubscribe: () => {},
    };
    this.keys.set(id, state);
    // subscribe() delivers the current frame at once, so the key is drawn right away.
    state.unsubscribe = this.reader.subscribe((frame) => {
      state.frame = frame;
      this.render(state);
    });
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.keys.get(ev.action.id)?.unsubscribe();
    this.keys.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    const state = this.keys.get(ev.action.id);
    if (!state) return;
    state.showPercent = ev.payload.settings.showPercent ?? true;
    this.render(state);
  }

  /** Sends only the part of the view that changed since the last render of this key. */
  private render(state: KeyState): void {
    const next = viewFor(state.frame, state.showPercent);
    const change = diffView(state.shown, next);
    state.shown = next;
    // A rejected update must not become an unhandled rejection (it can crash the plugin on Node 24).
    if (change.image !== undefined) {
      state.key.setImage(change.image).catch((err: unknown) => logger.warn("setImage failed:", err));
    }
    if (change.title !== undefined) {
      state.key.setTitle(change.title).catch((err: unknown) => logger.warn("setTitle failed:", err));
    }
  }
}
