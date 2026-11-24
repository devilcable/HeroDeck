# Minimap Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top-left pixel strip with a draggable HeroDeck minimap button whose icon is a 5×3-key mini Stream Deck; the keys are the channel cells (protocol v2), and the plugin finds the button anywhere in the WoW window.

**Architecture:** Protocol v2 keeps v1's color coding and changes only the version (2), the field count (5) and the geometry (5×3 grid, 4 px cells, 5 px pitch). The addon gets a `MinimapButton` (custom frame on `Minimap`, drag along the circle, saved angle, tooltip, `/herodeck reset`); `Channel` draws the grid as a child of the button, anchored to `WorldFrame` at whole physical pixels. The plugin's finder scans whatever image it is given; the capture crops either the whole game area (full scan) or a region around the last position (tracked).

**Tech Stack:** unchanged — Lua 5.1 subset (tests on wasmoon 5.4), TypeScript, Node 24, `@elgato/streamdeck` 3.0.4, `node-screenshots` 0.2.8, Vitest 5.1.1, `pngjs` 7.0.0.

**Spec:** `docs/superpowers/specs/2026-11-20-minimap-button-design.md` (builds on `docs/superpowers/specs/2026-11-18-durability-design.md`)

## Global Constraints

- Branch `feature/minimap-button`; its PR goes into `develop` after the durability PR is merged. Merge only on the user's yes.
- Lua parses as **Lua 5.1** and behaves the same on 5.4: no `//`, no bitwise operators, no `bit`, no `goto`. **`math.atan2` does not exist on 5.4** and `math.atan` takes one argument on 5.1: use a local `atan2(y, x)` helper that calls `math.atan2` when present, else `math.atan(y, x)`.
- No third-party library code in the addon.
- Protocol v2 (verbatim from spec): levels `0, 85, 170, 255`; 6-bit cells; header `white, black, magenta, version`; field = byte + 4-bit check (`c = hi XOR lo XOR 0xA`); normalization against white/black; tolerance 30 — all unchanged from v1. **Version = 2.** Grid **5 columns × 3 rows**, row-major: cell `i` at column `i % 5`, row `floor(i / 5)`; field n = cells `4+2n`, `5+2n`; **5 fields** (cells 4–13), cell 14 unused. Cell **4×4 physical px**, **1 px gap** (pitch 5 px); grid 24×14 px.
- Idle cells (no registered field, and cell 14) are drawn `(48, 48, 48)`: more than 30 from every level, so they never decode.
- Grid top-left and every cell edge on whole physical pixels, at any button position and UI scale.
- Button: parent `Minimap`, 31×31 UI units, strata `HIGH`, radius `Minimap:GetWidth() / 2 + 10`, default angle **225°**, saved in `HeroDeckDB.minimap.angle` (`## SavedVariables: HeroDeckDB`). Drag with the left button. `/herodeck reset` → default angle.
- Tooltip: line 1 `HeroDeck`; line 2 `Durability 80%` (enUS and every non-French locale) or `Durabilité 80 %` (`frFR`); `?` instead of the number before the first update.
- The top-left `WorldFrame` strip is removed. The plugin accepts **only version 2**.
- Plugin search: full scan of the whole game area when there is no last position or the tracked read fails; otherwise a region of **±64 px** around the last position.
- Hidden or covered button → "no data" after the usual 3 failed reads (accepted by the user).
- Code, commits, docs in English.

## Review Focus

1. The button at a fractional screen position (it moves along a circle) must still put every cell on whole pixels → Task 2 test `snaps the grid to whole pixels at fractional button positions`.
2. Lua 5.1 vs 5.4 `atan` difference → Task 3 test `AngleFrom works with 5.1-style math (atan2, one-arg atan)`.
3. Missing or corrupt saved data (`HeroDeckDB` nil, angle a string or NaN) → default 225°. Task 3 test `corrupt saved angle falls back to 225`.
4. The button is dragged between two reads: the tracked region misses it, and the same grab must find it by a full scan (no grey flash) → Task 5 test `tracked miss falls back to a full scan in the same grab`.
5. UI scale / resolution change while playing → grid re-snapped and still 4 px cells → Task 2 test `re-snaps after UI_SCALE_CHANGED`.

---

## File Structure

```
addon/HeroDeck/HeroDeck.toc            + SavedVariables, IconTexture, new file order
addon/HeroDeck/Core/Codec.lua          VERSION = 2
addon/HeroDeck/Core/Channel.lua        grid layout, idle cells, body, pixel snapping, Init(host)
addon/HeroDeck/Core/MinimapButton.lua  NEW: button, drag, saved angle, tooltip, slash command
addon/HeroDeck/Modules/Durability.lua  login wiring (button + channel), last value for the tooltip
addon/HeroDeck/Media/Icon.tga          NEW: 64×64 addon-list icon (generated)
tools/make-icon.mjs                    NEW: generates Media/Icon.tga and docs/user/img/icon.png
tests/vectors/channel-v2.json          renamed from v1, version cell (0,0,170)
streamdeck/src/channel/protocol.ts     v2 constants + cellOffset()
streamdeck/src/channel/locate.ts       pitch 5, whole-image scan, grid readCells
streamdeck/src/channel/strip.ts        readStrip returns the origin too
streamdeck/src/channel/capture.ts      full vs tracked crop, last position
streamdeck/scripts/probe.ts            prints grid position
docs/user/durability.md, README.md, CLAUDE.md
tests/fixtures/grid-window.png         NEW real capture (replaces strip-window.png)
```

---

### Task 1: Protocol v2 constants and vectors (both sides)

**Files:**
- Rename: `tests/vectors/channel-v1.json` → `tests/vectors/channel-v2.json` (header version cell becomes `[0, 0, 170]`; fields unchanged)
- Modify: `addon/HeroDeck/Core/Codec.lua` (`VERSION = 2`), `streamdeck/src/channel/protocol.ts`, every test that reads the vectors (`addon/tests/{channel,codec,durability}.test.ts`, `streamdeck/src/channel/{decode,locate,strip}.test.ts`)
- Delete: `tests/fixture.test.ts`, `tests/fixtures/strip-window.png` (v1 capture; Task 7 adds the v2 one)

**Interfaces:**
- Produces (`protocol.ts`): `PROTOCOL_VERSION = 2`, `MAX_FIELDS = 5`, `GRID_COLS = 5`, `GRID_ROWS = 3`, `GRID_CELLS = 15`, `CELL_PITCH = 5`, `CELL_PX = 4`, `IDLE = { r: 48, g: 48, b: 48 }`, `cellOffset(i: number): { dx: number; dy: number }` (= `{ dx: (i % 5) * 5, dy: floor(i / 5) * 5 }`).
- Lua: `Codec.VERSION = 2`; `Codec.IDLE = { r = 48, g = 48, b = 48 }`.

Note: changing `CELL_PX` to 4 breaks the v1 locate geometry; this task only changes constants that the decoder and Lua codec use. **Keep `CELL_PX` and the locate code untouched here** (Task 4 changes them); add `CELL_PITCH`, `GRID_*`, `IDLE`, `cellOffset` as new exports.

- [ ] **Step 1:** Rename the vectors file and set the version cell; update every vectors path.
- [ ] **Step 2: Failing tests:** `codec.test.ts` `header matches vectors` (now expects version cell `0,0,170`); `decode.test.ts` `decodes the header: version 2` and `rejects version 1`; `protocol.test.ts` (new) `cellOffset maps 0→(0,0), 4→(20,0), 5→(0,5), 14→(20,10)`; `codec.test.ts` `IDLE never decodes` (feed `Codec.IDLE` as both cells of a field to the TS `decodeField` with pure white/black → `null`).
- [ ] **Step 3:** Run `npm test` → those fail.
- [ ] **Step 4:** Implement the constants. `tests/roundtrip.test.ts` keeps passing unchanged.
- [ ] **Step 5:** Run `npm test` → PASS. **Commit** `feat: protocol v2 version, field count and grid constants`.

### Task 2: Grid layout in the addon (`Channel`)

**Files:**
- Modify: `addon/HeroDeck/Core/Channel.lua`, `addon/tests/harness.ts` (mocks: `WorldFrame` size, frame `GetCenter`/`GetEffectiveScale`, `UIParent`), `addon/tests/channel.test.ts`

**Interfaces:**
- Consumes: `Codec.HeaderCells`, `Codec.EncodeByte`, `Codec.IDLE`.
- Produces (Lua `ns.Channel`):
  - `Channel.CELL_PX = 4`, `Channel.PITCH = 5`, `Channel.COLS = 5`, `Channel.ROWS = 3`, `Channel.CELLS = 15`
  - `Channel.CellOffset(i) -> dx, dy` (physical px, same as TS `cellOffset`)
  - `Channel.SnapOrigin(centerX, centerY) -> left, top` — pure: given the host's center in **physical px** (fractional), returns the grid's top-left in whole physical px: `left = floor(centerX - 24 / 2 + 0.5)`, `top = floor(centerY + 14 / 2 + 0.5)` (y grows upward, as in WoW screen coordinates)
  - `Channel:Init(host)` — idempotent; creates the grid frame as a child of `host` (so it hides with it), `SetIgnoreParentScale(true)`, `SetScale(1)`, strata `HIGH`, frame level `host:GetFrameLevel() + 5`; draws the body (a `(24, 24, 28)` background texture covering the grid plus 2 px on each side, below the cells) and all 15 cells (header + `IDLE`); registers `DISPLAY_SIZE_CHANGED`, `UI_SCALE_CHANGED` → `Layout()`
  - `Channel:Layout()` — computes the host center in physical px (`host:GetCenter()` × `host:GetEffectiveScale()` / unit, where `unit = 768 / physicalHeight`), `SnapOrigin`, then anchors the grid frame with `SetPoint("TOPLEFT", WorldFrame, "BOTTOMLEFT", left * unit, top * unit)` and every cell at `(dx * unit, -dy * unit)`, size `4 * unit`. Called by the button after every move.
  - `Channel:Register(fieldIndex)` errors for `fieldIndex >= 5`; `SetByte` recolors the 2 field cells; unchanged otherwise.
  - Removed: the `WorldFrame` parent and `TOOLTIP` strata.

- [ ] **Step 1: Failing tests** (`channel.test.ts`, replace the v1 strip tests):
  - `grid frame is a child of the host, ignores parent scale, HIGH strata`
  - `draws 15 cells: header from vectors, the rest IDLE`
  - `cells sit at CellOffset positions, 4 px wide` (at physical height 1440: offset `dx * 768/1440`, size `4 * 768/1440`, ±1e-9)
  - `SnapOrigin returns whole pixels`: `(100.0, 50.0) → (88, 57)`, `(100.4, 50.6) → (88, 58)`, `(100.5, 50.5) → (89, 58)`
  - `snaps the grid to whole pixels at fractional button positions`: host center mocked at fractional UI positions and effective scales `0.64`, `0.9`, `1.0`; the grid's anchor offsets divided by `unit` are integers (±1e-9)
  - `re-snaps after UI_SCALE_CHANGED`: change physical height and the host's effective scale, fire the event, anchor and cell sizes updated
  - `SetByte(0, 87) colors cells 4 and 5`; `Register(5) errors`
- [ ] **Step 2:** Run `npm test -- channel` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` → PASS (durability tests may need the new `Init(host)` call: pass a mocked host until Task 3 wires the button). **Commit** `feat(addon): draw the channel as a 5x3 grid on a host frame`.

### Task 3: Minimap button

**Files:**
- Create: `addon/HeroDeck/Core/MinimapButton.lua`, `addon/tests/minimap.test.ts`
- Modify: `addon/HeroDeck/HeroDeck.toc` (add `## SavedVariables: HeroDeckDB`; file order `Init, Codec, Channel, MinimapButton, Durability`), `addon/HeroDeck/Modules/Durability.lua`, `addon/tests/harness.ts` (mocks: `Minimap` with `GetCenter`/`GetWidth`/`GetEffectiveScale`, `GetCursorPosition`, `GameTooltip`, `GetLocale`, `SlashCmdList`), `addon/tests/durability.test.ts`

**Interfaces:**
- Consumes: `Channel:Init(host)`, `Channel:Layout()`, `Channel:Register`, `Channel:SetByte`.
- Produces (Lua `ns.MinimapButton`):
  - `MinimapButton.DEFAULT_ANGLE = 225`, `MinimapButton.OFFSET = 10`
  - `MinimapButton.PositionFor(angleDeg, radius) -> x, y` (pure; `x = cos * r`, `y = sin * r`)
  - `MinimapButton.AngleFrom(cx, cy, px, py) -> deg` (pure; `[0, 360)`; uses the `atan2` helper)
  - `MinimapButton.SavedAngle() -> deg` — reads `HeroDeckDB.minimap.angle`; creates `HeroDeckDB`/`.minimap` if missing; any non-finite or non-number value → `DEFAULT_ANGLE` (and writes it back)
  - `MinimapButton:Init()` — idempotent; `CreateFrame("Button", "HeroDeckMinimapButton", Minimap)`, 31×31, strata `HIGH`; art: background `Interface\Minimap\UI-Minimap-Background` and border `Interface\Minimap\MiniMap-TrackingBorder` (Blizzard's standard minimap-button textures, sized as other buttons use them: background 20×20 centered, border 53×53 at TOPLEFT); `RegisterForDrag("LeftButton")`; drag: `OnUpdate` while dragging sets the angle from the cursor (`GetCursorPosition()` divided by `Minimap:GetEffectiveScale()`, against `Minimap:GetCenter()`), calls `Place(angle)`; `OnDragStop` saves the angle; `OnEnter`/`OnLeave` tooltip
  - `MinimapButton:Place(angleDeg)` — `SetPoint("CENTER", Minimap, "CENTER", PositionFor(angle, Minimap:GetWidth() / 2 + OFFSET))`, then `ns.Channel:Layout()`
  - `MinimapButton:Reset()` — `Place(DEFAULT_ANGLE)` and save it
  - `MinimapButton.TooltipLines(percent, locale) -> line1, line2` (pure): `"HeroDeck"`, and `"Durabilité 80 %"` for `frFR` / `"Durability 80%"` otherwise; `percent == nil` → `?` in place of the number
  - Slash: `SLASH_HERODECK1 = "/herodeck"`; `SlashCmdList.HERODECK(msg)`: `"reset"` → `Reset()`; anything else prints `HeroDeck: /herodeck reset` with `print`
- Durability: keeps `Durability.last` (last computed percent, nil before the first update); its `PLAYER_LOGIN` handler calls `ns.MinimapButton:Init()`, `ns.Channel:Init(ns.MinimapButton.frame)`, `ns.MinimapButton:Place(ns.MinimapButton.SavedAngle())`, `ns.Channel:Register(FIELD)`, in that order.

- [ ] **Step 1: Failing tests** (`minimap.test.ts`):
  - `PositionFor`: `(0, 80) → (80, 0)`, `(90, 80) → (0, 80)`, `(225, 80) → (-56.5685…, -56.5685…)` (±1e-6)
  - `AngleFrom`: `(0,0, 10,0) → 0`, `(0,0, 0,10) → 90`, `(0,0, -10,0) → 180`, `(0,0, 0,-10) → 270`
  - `AngleFrom works with 5.1-style math (atan2, one-arg atan)`: in a fresh Lua state set `math.atan2 = <5.4 math.atan>` and `math.atan = function(x) return <5.4 math.atan>(x) end` before loading; same four results
  - `SavedAngle defaults to 225 and creates HeroDeckDB`; `keeps a saved 40`; `corrupt saved angle falls back to 225` for `"x"`, `0/0`, `math.huge`
  - `drag moves the button and saves on stop`: start drag, mock cursor at an angle of 90° from the minimap center, run `OnUpdate`, stop → `HeroDeckDB.minimap.angle == 90` and the button's CENTER offset is `(0, Minimap:GetWidth()/2 + 10)`
  - `Place re-snaps the channel grid` (Channel:Layout called after Place)
  - `/herodeck reset puts the button back at 225`; `/herodeck foo prints usage`
  - `TooltipLines`: `(80, "frFR") → "Durabilité 80 %"`, `(80, "enUS") → "Durability 80%"`, `(80, "deDE") → "Durability 80%"`, `(nil, "enUS") → "Durability ?%"`
  - `durability.test.ts`: `PLAYER_LOGIN creates the button and the grid on it`; `Durability.last is set by Update`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(addon): add the draggable HeroDeck minimap button`.

### Task 4: Locate the grid anywhere in the image (plugin)

**Files:**
- Modify: `streamdeck/src/channel/protocol.ts` (`CELL_PX = 4`), `streamdeck/src/channel/locate.ts`, `streamdeck/src/channel/strip.ts`, their tests, `streamdeck/src/channel/reader.ts` (only the `readStrip` call shape)

**Interfaces:**
- Consumes: `cellOffset`, `CELL_PITCH`, `GRID_CELLS`, `decodeStrip`.
- Produces:
  - `findStripCandidates(img: RawImage): { x: number; y: number }[]` — scans the **whole image** (the caller decides the area; `SEARCH_W/H` are removed); match = white at `(x, y)`, black at `x + CELL_PITCH`, magenta at `x + 2 * CELL_PITCH` (same thresholds as v1); candidates refined to the centroid of the matches in the cell (`CELL_PX × CELL_PX` window), deduplicated within 3 px; returned point = a pixel inside cell 0 at least 1 px from its edges
  - `readCells(img, origin, count = GRID_CELLS): RGB[]` — reads `origin + cellOffset(i)`; a cell outside the image ends the array (as in v1)
  - `readStrip(img): { version: number; fields: (number | null)[]; origin: { x: number; y: number } } | null` — origin of the strip that decoded

- [ ] **Step 1: Failing tests** (paint helpers in the test files draw a 5×3 grid of 4×4 cells with 1 px gaps, using the v2 vectors and `IDLE` for unused cells):
  - `finds the grid at (0,0)`, `at (1700, 230)` in a 2560×1440 image, `near the bottom-right edge`
  - `decoy before the real grid`: decoy row (white/black/magenta at pitch 5, wrong version) above-left → `readStrip` returns the real one with its origin
  - `idle cells decode as null fields`: grid with only field 0 = 87 → `fields = [87, null, null, null, null]`
  - `1 px blur at cell edges still decodes` (blend borders 50 % with the gap color)
  - `no grid in noise or a plain white image → null`
  - `full 2560×1440 scan of a noisy image takes < 150 ms` (single run, generous bound; log the time)
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; `reader.ts` uses `readStrip(img)?.fields`. **Step 4:** `npm test` + `npx tsc --noEmit` (in `streamdeck/`) → PASS.
- [ ] **Step 5: Commit** `feat(streamdeck): locate the v2 grid anywhere in the capture`.

### Task 5: Full vs tracked capture region (plugin)

**Files:**
- Modify: `streamdeck/src/channel/capture.ts`, `capture.test.ts`, `streamdeck/scripts/probe.ts`

**Interfaces:**
- Consumes: `readStrip` (with origin), `clampCrop`, `captureOrder`.
- Produces:
  - `TRACK_MARGIN = 64`
  - `trackRect(last: { x: number; y: number }, image: { width: number; height: number }): Rect | null` — pure: `x - 64 .. x + 24 + 64`, `y - 64 .. y + 14 + 64`, clamped (`last` = grid origin in the capture's coordinates)
  - `gameRect(path, windowRect, monitorRect, image): Rect | null` — pure: the whole capture for `window`; the window's area inside the monitor capture for `monitor` (same scaling rule as today's `monitorCropRect`, which it replaces; `CROP_W`/`CROP_H`/`STRIP_PX` are removed)
  - `WowWindowSource.grab()`: per path in `captureOrder`, first try the tracked rect (when a last position exists for that path), then the full `gameRect` if the tracked read did not decode; on success store `last = rect origin + readStrip origin` (per path); on full failure clear `last`
  - `CaptureDiagnostics` attempts carry `region: "tracked" | "full"`; the probe prints `region=` and the grid origin
- [ ] **Step 1: Failing tests:** `trackRect` clamps at all four edges; `gameRect` for both paths (incl. a monitor at negative x); `tracked miss falls back to a full scan in the same grab` and `success stores the origin, failure clears it` — drive these through a small injectable capture function (`grab` logic extracted to a pure-ish `readGame(capture: (path) => Promise<RawImage>, state) ` helper, or equivalent, so it is testable without the native module).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(streamdeck): track the grid near its last position`.

### Task 6: Addon icon

**Files:**
- Create: `tools/make-icon.mjs`, `addon/HeroDeck/Media/Icon.tga`, `docs/user/img/icon.png`
- Modify: `addon/HeroDeck/HeroDeck.toc` (`## IconTexture: Interface\AddOns\HeroDeck\Media\Icon`)

**Interfaces:** none consumed by code.

- [ ] **Step 1:** `tools/make-icon.mjs` (Node, uses `pngjs`) draws a 64×64 RGBA image: transparent outside a circle of radius 31; inside, a dark round background `(18, 18, 22)`; centered "device" rounded rectangle `(36, 36, 42)` 46×30; a 5×3 grid of rounded 7×7 keys with 2 px gaps, colors (row-major): `white, (20,20,20), magenta, (0,0,170), (85,85,85), (255,170,0)`, then 9 keys `(70, 70, 78)`. No text, no logo. Writes the PNG and an uncompressed 32-bit TGA (origin bottom-left, BGRA). Add an npm script `"icon": "node tools/make-icon.mjs"` at the root.
- [ ] **Step 2:** Run `npm run icon`; check both files exist; view the PNG.
- [ ] **Step 3:** Add `IconTexture` to the `.toc`; `npm test` (toc test still passes; extend it: `toc declares IconTexture and SavedVariables HeroDeckDB`).
- [ ] **Step 4: Commit** `feat(addon): add the HeroDeck icon`.

### Task 7: In-game check, fixture, docs (with the user)

Run by the controller with the user (needs the game).

- [ ] **Step 1:** Rebuild the plugin (`cd streamdeck && npm run build && npx streamdeck restart com.devilcable.herodeck`); the addon junction already points at the repo — the user does `/reload`.
- [ ] **Step 2:** With the user: the button is on the minimap ring at 225°, drags along the circle, keeps its place after `/reload`; `/herodeck reset` works; the tooltip shows the right text; the icon shows in the AddOns list; the old corner strip is gone; the key shows the right value; dragging the button keeps the key live (no grey flash, Review Focus 4); Alt+Z and the world map give grey then come back.
- [ ] **Step 3:** `npm run probe -- --dump <scratch>`; crop the dump around the grid (no character name) to `tests/fixtures/grid-window.png`; add `tests/fixture.test.ts` → `readStrip` gives version 2 and field 0 = in-game durability.
- [ ] **Step 4:** Update `docs/user/durability.md` (replace "The small strip in the top-left corner" with "The minimap button": what the keys are, drag, reset, tooltip, why it must stay visible; add `img/icon.png`), `README.md` if needed, and `CLAUDE.md` (protocol v2 summary, `/herodeck reset`, `npm run icon`).
- [ ] **Step 5: Commit** `docs: minimap button guide and real v2 capture test`.
