# Equipment durability on a Stream Deck key — design

Issue: [devilcable/HeroDeck#1](https://github.com/devilcable/HeroDeck/issues/1)
Date: 2026-11-18
Status: draft, waiting for user approval. Once approved, every decision below is final for this feature.

## Intent

The player wants to see how worn their gear is, at any moment of play (dungeon, raid, open world, town),
on a Stream Deck key, without opening the character sheet. The key shows a small armor icon whose
background color warns when a repair is needed, with the durability percentage below it.

This is also the first feature of HeroDeck, so it lays down the two skeletons (WoW addon and
Stream Deck plugin) and the **game → plugin data channel** that later features will reuse.

## Goals

- WoW Forever addon skeleton that loads in the live client.
- Stream Deck plugin skeleton (Node.js / TypeScript, official SDK).
- A reusable, real-time game → plugin channel (screen pixel channel, see Approaches).
- A "Durability" Stream Deck action:
  - armor icon, background color by durability;
  - durability percentage shown below the icon, can be turned off per key;
  - updates live while playing (target: under ~1 s after the in-game change).
- User documentation, written once the implementation is finished and validated.

## Non-goals

- Plugin → game actions (keystrokes, macros). Not in this feature.
- Per-slot breakdown, repair cost, or a list of damaged items.
- Support for macOS, or for clients other than WoW Forever.
- Configurable thresholds or colors (fixed for now).

## Anti-goals (failure even if it "works")

- Anything that breaks Blizzard ToS: memory reading, injecting into the game process, or the plugin
  pressing keys on its own based on what it reads. The plugin only **reads and displays**.
- A key that shows a stale value as if it were live. If the plugin cannot read fresh data, it must say so
  (the "no data" state), never keep showing the last value.
- A visible, distracting marker in the game UI. The channel must be a few pixels in a corner.

## Constraints

- WoW Lua sandbox: no network, sockets, file I/O, or IPC (see `CLAUDE.md`).
- `SavedVariables` are written only on `/reload`, logout, or disconnect: not real time.
- WoW Forever: `.toc` `## Interface: 16001`, modern addon API. Verify in game with
  `/dump (select(4, GetBuildInfo()))`. The AddOns folder path and the game executable name are not
  confirmed yet; confirm them on the user's machine before writing install scripts or window lookup.
- Platform: Windows 11.
- The channel needs WoW to be visible on screen: windowed or borderless ("fullscreen windowed").
  Exclusive fullscreen and a minimized game are not supported; the key shows "no data" in those cases.
- Windows HDR may change the capture format. The builder checks it; if it cannot be decoded reliably,
  HDR is listed as unsupported in the user docs and the key shows "no data".

## Approaches considered

| | Approach | Trade-offs | Verdict |
|---|---|---|---|
| A | **Screen pixel channel.** The addon draws a few colored cells in a corner of the game screen; the plugin captures that region and decodes the colors. | Real time. Reusable for every future live feature. Needs WoW visible and screen-capture code in the plugin. | **Picked** |
| B | `SavedVariables` file read by the plugin. | Very simple, but only updates on `/reload` or logout: the key would be frozen during a dungeon. | Rejected: the user looks at the key at any time during play. |
| C | Chat log trick (addon prints to chat, plugin tails `WoWChatLog.txt`). | Hacky, delayed file flush, pollutes chat. | Rejected. |
| D | Read Blizzard's own durability doll on screen. | Same capture cost as A, but only 3 states with Blizzard thresholds, only visible when damaged, user can move it. | Rejected. |
| E | Read game memory. | ToS violation, ban risk. | Excluded. |

The user picked **A**.

## Decisions made with the user

### Durability value

- The value is the durability of the **most damaged equipped item**: `min(current / max)` over all
  equipped slots that have durability. (Not the average: an average hides the one item about to break.)
- Shown as an integer percentage, **rounded down** (29.6 % → 29 %).
- If no equipped item has durability (naked character, or only items without durability): 100 %.

### Key states

| Durability | Background | Image |
|---|---|---|
| 50 % – 100 % (50 included) | black | armor on black |
| 20 % – 49 % (20 included) | yellow | armor on yellow |
| 0 % – 19 % | red | armor on red |
| no data | grey | grey armor, title `--` |

"No data" means: WoW not running, minimized, not found, or the channel cells cannot be read or fail
validation.

### Percentage display

- The percentage is shown **below** the icon (Stream Deck title, bottom position), e.g. `87%`.
- Each key has a setting **"Show percentage"** (checkbox, default on). When off, only the colored icon
  is shown. In the "no data" state, `--` is shown when the setting is on, nothing when off.

### Icon

- An original, simple armor (breastplate) icon, drawn by us, in 4 background variants (black, yellow,
  red, grey). Exported at Stream Deck sizes (72×72 and 144×144 @2x).

## Design

### Repository layout (proposal)

```
addon/HeroDeck/            WoW addon (copied/linked into the game's AddOns folder)
  HeroDeck.toc
  Core/Channel.lua         reusable pixel channel
  Modules/Durability.lua   durability module
  tests/                   busted tests for pure Lua logic
streamdeck/                Stream Deck plugin (created with the Elgato CLI)
  src/                     TypeScript sources
  com.devilcable.herodeck.sdPlugin/
    manifest.json
    imgs/                  icons (4 durability variants, plugin/category icons)
    ui/                    property inspector
docs/                      specs, plans, user docs
```

### WoW addon

**Channel (`Core/Channel.lua`)** — reusable by later features.

- Draws a horizontal strip of square cells at the top-left corner of the game screen.
- **Tolerant to color shifts** (my call). Captured colors may differ from drawn colors (WoW gamma /
  brightness, Windows Night Light or color filters, GPU "vibrance", ReShade). An exact-byte format would
  leave the key grey forever for those users, and this format is the base of every later feature, so
  protocol version 1 is built to survive moderate shifts:
  - each channel (R, G, B) uses only **4 levels**: 0, 85, 170, 255, so it carries 2 bits and a cell
    carries 6 bits (R = high 2 bits, G = middle, B = low);
  - **header cells** (fixed):
    - cell 0: white `(255,255,255)`, reference;
    - cell 1: black `(0,0,0)`, reference;
    - cell 2: marker magenta `(255,0,255)`;
    - cell 3: protocol version as a 6-bit value (`1`).
  - the plugin normalizes every channel against the white and black reference cells
    (`v' = (v - black) / (white - black) × 255`), then snaps to the nearest level. If any channel is
    more than 30 away from its nearest level after normalization, the read fails ("no data").
- **Fields.** Data is carried in fields of **2 cells = 12 bits = 1 byte + 4-bit check**:
  - bits: cell A = `b7 b6 b5 b4 b3 b2`, cell B = `b1 b0 c3 c2 c1 c0`;
  - check `c = (high nibble XOR low nibble XOR 0xA)`; a field whose check fails is "no data".
- Modules claim a field at load time (`Channel:Register(fieldIndex)`) and write a byte with
  `Channel:SetByte(fieldIndex, value)`. Field 0 = cells 4–5, field 1 = cells 6–7, and so on.
- Cells must map to exact physical screen pixels, whatever the UI scale and resolution (pixel-perfect
  sizing; cell size in physical pixels is a constant, my call: 3×3 px). The plugin reads the center
  pixel, so a 1 px edge blur is harmless.
- Cells must stay visible when the UI is hidden (Alt+Z) and above other frames
  (parent outside `UIParent`, e.g. `WorldFrame`, high frame strata).
- Colors are solid, no alpha, no texture filtering.

**Durability module (`Modules/Durability.lua`)**

- Uses field 0.
- Recomputes on `PLAYER_ENTERING_WORLD`, `UPDATE_INVENTORY_DURABILITY`, and `PLAYER_EQUIPMENT_CHANGED`.
- Reads every equipped slot with `GetInventoryItemDurability(slot)`; skips slots that return `nil`.
- Computes the value as in "Durability value" above (pure function, unit tested outside the game).
- Writes the percentage (0–100) as the field's byte.

### Stream Deck plugin

- Node.js / TypeScript, official Elgato Stream Deck SDK (`@elgato/streamdeck`), scaffolded with the
  Elgato CLI.
- Plugin UUID `com.devilcable.herodeck`, action UUID `com.devilcable.herodeck.durability`.
- **Channel reader** (shared service, reusable):
  - finds the WoW window and its client area (my call: anchor to the client area top-left, so it works
    on any monitor and in windowed mode);
  - captures only the small strip region, about **2 times per second**, only while at least one
    HeroDeck key is visible;
  - reads the **center pixel** of each cell;
  - checks that the reference cells look like white and black (white clearly brighter than black),
    the marker decodes to magenta, and the version is `1`; normalizes and decodes the fields as
    described in the addon's channel section; on any failure, reports "no data".
- **Durability action:**
  - decodes field 0; rejects it if the check fails or the value is over 100 (→ "no data");
  - maps the percentage to one of the 4 states (table above);
  - calls `setImage` / `setTitle` **only when the displayed state or text changes**;
  - property inspector with the "Show percentage" checkbox (per-key setting, default on).
- UI text in English and French (Stream Deck localization), my call.

### Testing

- Addon: pure Lua logic (durability computation, encoding) unit tested with `busted`, outside the game.
  Frame drawing checked in game.
- Plugin: decoding, validation, and threshold mapping unit tested (e.g. with Vitest). Capture is
  tested manually against the running game, plus one test that decodes a saved screenshot of the strip.
- Threshold edge cases to test: 100, 50, 49, 20, 19, 0, rounding 29.6 → 29, 19.9 → 19, no items → 100.
- Channel round-trip tests: encode in Lua and decode in TypeScript from the same fixture values
  (shared test vectors), including shifted colors (e.g. all channels ×0.85 + 20) that must still
  decode, and colors too far off that must give "no data".

## Left to the builder

- Screen-capture library or native API for Node on Windows, and how to find the WoW window
  (process / window class), once the executable name is confirmed.
- Exact pixel-perfect sizing technique in the addon.
- Icon drawing details (style, line weight), within "simple original breastplate".
- Build, packaging, and dev-install scripts for both parts (after confirming the AddOns path).
- User documentation content (install addon, install plugin, add the key, game display mode
  requirement), written after validation.
