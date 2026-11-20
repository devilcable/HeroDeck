# Minimap button carrying the channel — design

Date: 2026-11-20
Branch: `feature/minimap-button` (cut from `feature/durability`, which is not merged into `develop` yet).
Its PR goes into `develop` after the durability PR is merged (my call: the durability PR is opened and
merged first, so this PR only carries the minimap work).
Status: approved by the user on 2026-11-20. Every decision below is final for this feature.
Builds on: `docs/superpowers/specs/2026-11-18-durability-design.md` (screen pixel channel, protocol v1)

## Intent

The protocol v1 strip is a row of bare colored pixels at the top-left of the game screen. The user finds it
ugly. They want it replaced by a **round minimap button**, like the buttons of other addons, that they can
**drag along the minimap's edge**. The data cells must stay on screen (they are the only way the addon can
pass data to the plugin), so they move **inside the button** and become part of its icon: the icon is a
small Stream Deck whose keys are the data cells.

## Goals

- A round HeroDeck button attached to the minimap's edge.
- Drag it along the minimap circle (left button held); the position is kept between sessions.
- Its icon is an original drawing of a small Stream Deck with **15 keys (5 columns × 3 rows)**; the keys
  are the channel cells.
- Tooltip on hover: `HeroDeck` and the current durability (e.g. `Durability 80%`, French client
  `Durabilité 80 %`).
- `/herodeck reset` puts the button back at its default position.
- The plugin finds the button anywhere in the WoW window, then tracks it near its last position.
- The top-left strip is removed.
- Updated user documentation once implemented and validated.

## Non-goals

- Square or custom-shaped minimaps (only round, as on the user's client). Later if needed.
- Minimap-modifying or button-collecting addons (ElvUI, SexyMap, button bags). None is installed on the
  user's client (checked 2026-11-20: Auctionator, Bagnon, BigWigs, LittleWigs, Questie, TomTom); if one
  reparents or hides the button, the key shows "no data".
- Using the Elgato logo or brand. The icon only evokes a key-grid controller.
- LibDBIcon / LibDataBroker integration, addon-compartment entry, "minimap button bag" support.
- Click actions on the button (left/right click do nothing except drag).
- Any change to the Stream Deck key's look or behavior (the user has a separate Stream Deck request).

## Anti-goals

- Cells that are blurred or misaligned so the plugin cannot read them reliably.
- Reading a stale value as live (unchanged from v1: no data → grey key).
- Any third-party library code in the addon.

## Constraints

- Same as the v1 spec: Lua 5.1 subset that behaves the same on 5.4 (tests run on wasmoon), `## Interface: 16001`,
  no network/file I/O, plugin only reads and displays.
- The minimap is a child of `UIParent`, so the button (and its cells) is **hidden when the UI is hidden
  (Alt+Z)** and during loading screens → the key shows "no data" then. This replaces the v1 behavior where
  the strip survived Alt+Z (accepted by the user, see "Hidden or covered button").
- The first SavedVariables of the addon: `HeroDeckDB` (account-wide).

## Approaches considered

| | Approach | Trade-offs | Verdict |
|---|---|---|---|
| A | **Own minimap button** (custom frame, own drag code) | Full control over every pixel of the icon (needed for readable cells); no third-party code; testable in the existing Lua harness. We write the drag-along-the-circle math ourselves. | **Picked by the user** |
| B | LibDBIcon (standard minimap-button library) | Same feel as other addons, square minimaps handled; but 4 embedded libraries, "button bag" addons can swallow the button (cells hidden), and the library sizes/masks the icon its own way (blurred cells). | Rejected |

## Decisions

### Protocol v2 (grid layout)

Only the **geometry** and the **version** change; the color coding is identical to v1.

- Levels, 6-bit cells, header colors, field encoding (byte + 4-bit check), normalization against the
  white/black reference cells, tolerance 30: **unchanged** from v1.
- Version cell value: **2**.
- Cells are laid out in a **5 × 3 grid**, row-major: cell index `i` is at column `i % 5`, row `floor(i / 5)`.
  - Row 1: cell 0 white, 1 black, 2 magenta, 3 version, 4 field 0 cell A.
  - Row 2: cell 5 field 0 cell B, cells 6–9 fields 1–2.
  - Row 3: cells 10–13 fields 3–4, cell 14 unused.
  - So the grid carries the header + **5 fields** (field n = cells 4+2n and 5+2n, as in v1). Durability
    stays field 0.
- Each cell is **4 × 4 physical pixels**, with a **1-pixel gap** between cells (pitch 5 px). The grid is
  24 × 14 physical pixels.
- Unused cells (no registered field) are drawn as "idle keys" in a dark grey that the decoder treats as
  "no data" for that field (a field is only valid if its check matches).
- The grid's top-left corner must sit on a **whole physical pixel**, and every cell edge too, wherever the
  button is on the circle and whatever the UI scale. The addon snaps the grid position to the physical
  pixel grid (my call: compute the button's on-screen position in physical pixels and offset the grid by
  the fractional part).

### Button

- Parent: `Minimap`. Size: the usual minimap button size (31 × 31 UI units at the minimap's scale, my call:
  it then looks like the other addons' buttons), round border/background drawn by the addon (original art,
  see Icon).
- Size vs grid (my call): the button scales with the UI like the others, while the grid stays 24 × 14
  physical pixels. The art keeps the grid area centered and works from a button of **32 physical pixels**
  upward (1080p at a small UI scale); on larger buttons the device body simply has more margin. Tests cover
  physical heights 1080 and 1440 and UI scales 0.64–1.0. The art is drawn so the grid sits on the device
  body at any of those sizes (the body is stretched art; the cells are separate textures on top).
- Position: on a circle centered on the minimap, radius = minimap radius + a small offset so it sits on the
  edge like other buttons (my call: same radius formula other minimap buttons use, `width/2 + 10` UI units,
  adjusted visually during the in-game check).
- Drag: left button held → the button follows the cursor's angle around the minimap center; on release the
  angle (degrees) is saved in `HeroDeckDB.minimap.angle`.
- Default angle: my call, a free spot the user picks in the in-game check (start at 225°, lower-left).
- `/herodeck reset`: angle back to default, saved.
- The grid must never be covered by the button's own art: the icon art is drawn **below** the cell
  textures; cells are on the top layer.
- Tooltip: `GameTooltip` anchored so it does not cover the grid (e.g. `ANCHOR_LEFT`/`ANCHOR_RIGHT` depending
  on the side of the minimap).
- Frame strata: `HIGH` (see "Hidden or covered button"). The v1 `WorldFrame` strip and its `TOOLTIP`
  strata are removed.

### Icon

- Original art, no Elgato logo: a dark, rounded "device" body inside the round button, with the 5 × 3 key
  grid in the middle. The keys are the channel cells (their colors change with the data); everything around
  them is fixed art.
- Made as a small texture (TGA or BLP, my call TGA 64×64) for the body/border, plus the 15 cell textures
  created in Lua. Also export a PNG of the icon for the docs/README.

### Plugin

- Protocol constants: `PROTOCOL_VERSION = 2`, cell size 4, pitch 5, grid 5 × 3, `MAX_FIELDS = 5`. The decoder
  accepts only version 2 (v1 is dropped: both sides ship together).
- Locate: the header is still a horizontal run (white, black, magenta at pitch 5), so the coarse finder
  keeps its logic with the new pitch; `readCells` reads the 15 cell centers from the grid geometry; the
  "try every candidate" rule (`readStrip`) is kept.
- Search area: the first time (or after the grid is lost) scan the **whole captured window**; after a
  successful read, scan only a region around the last position (my call: ±64 px), falling back to a full
  scan when that fails. Performance target: a tracked read costs about what v1 costs; a full scan stays
  under ~100 ms.
- The capture crop (v1 cropped the top-left 164×67) becomes "the whole window" for a full scan or "the
  tracked region" otherwise.
- Probe/diagnostics: still work, and print the grid's position.

## Testing

- Lua: grid positions (cell index → column/row → pixel offsets), pixel snapping at fractional button
  positions and several UI scales, angle ↔ position math, drag saves the angle, `/herodeck reset`, tooltip
  text, SavedVariables defaults.
- Shared vectors updated for v2 (header version cell = 2) and a v2 round trip Lua → TS.
- Plugin: locate the grid in synthetic images at any position (incl. far from the top-left), tracked search
  vs full scan, decoy before the real grid, grid partially covered → field null / no data.
- A new real-capture fixture taken in game with the button on the minimap (replaces the v1 fixture).

## Hidden or covered button (decided with the user, 2026-11-20)

Whenever the button is hidden or covered, the key shows "no data" (grey) after the usual 1.5 s and comes
back by itself: Alt+Z, loading screens, a maximized world map, full-screen panels (collections, talents,
adventure guide), or another addon frame on top. Accepted by the user. To limit the "covered" cases, the
button uses a **higher strata than other minimap buttons** (`HIGH`, my call); everything that hides
`UIParent` still gives grey.

## Left to the builder

- Exact drag math and radius tweak, exact art, texture format details, the pixel-snapping technique, and the
  tracked search window size, within the decisions above.
