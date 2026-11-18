# Equipment Durability Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the durability of the most damaged equipped item on a Stream Deck key, live, through a screen pixel channel drawn by a WoW Forever addon.

**Architecture:** The addon (`addon/HeroDeck`) encodes data as a strip of 3×3 px colored cells at the top-left of the game screen (protocol v1, tolerant to color shifts). The Stream Deck plugin (`streamdeck/`) captures the WoW window about twice a second, locates the strip, normalizes colors against reference cells, decodes fields, and renders one of four key images. Pure logic on both sides is unit tested from one root Vitest run; Lua is executed in tests with `wasmoon`.

**Tech Stack:** Lua 5.1 subset (WoW Forever, `## Interface: 16001`), Node.js 24, TypeScript, `@elgato/streamdeck` 3.0.4, `@elgato/cli` 1.10.4, `node-screenshots` 0.2.8, Vitest 5.1.1, `wasmoon` 1.16.0, `luaparse` 0.3.1.

**Spec:** `docs/superpowers/specs/2026-11-18-durability-design.md`

## Global Constraints

- Branch `feature/durability` (cut from `develop`); PR into `develop`; merge only on the user's yes.
- Addon `.toc`: `## Interface: 16001`. Lua must parse as **Lua 5.1** (no `//`, no bitwise operators, no `goto`, no `<const>`); tests run it on Lua 5.4 (`wasmoon`), so code must behave the same on both (no `bit` library, no reliance on integer/float subtypes).
- The plugin only reads and displays. It never sends keystrokes.
- Protocol v1 (verbatim from spec): 4 levels per channel `0, 85, 170, 255`; cell = 6 bits (R high 2, G middle 2, B low 2); header cells `0 white (255,255,255)`, `1 black (0,0,0)`, `2 magenta (255,0,255)`, `3 version = 1`; field = 2 cells, cell A = `b7..b2`, cell B = `b1 b0 c3..c0`, `c = high nibble XOR low nibble XOR 0xA`; field `n` = cells `4+2n` and `5+2n`; normalization `v' = (v - black) / (white - black) × 255`; tolerance 30; cell size 3×3 physical px; plugin reads the center pixel.
- Durability = `min(current/max)` over equipped slots with durability, integer percent **rounded down**, 100 when no slot has durability. Durability uses field 0.
- States: `ok` 50–100 (black bg), `warn` 20–49 (yellow bg), `critical` 0–19 (red bg), `nodata` (grey bg, title `--`).
- Per-key setting `showPercent`, default `true`. Title below the icon: `87%`; `--` for nodata when on; empty when off.
- Plugin UUID `com.devilcable.herodeck`; action UUID `com.devilcable.herodeck.durability`. UI strings in English and French.
- Polling about 2 times per second (500 ms), only while at least one durability key is visible. Key image/title updated only when they change.
- Windows 11; WoW windowed or borderless. Exclusive fullscreen, minimized game, HDR (if not decodable): `nodata`.
- Code, commits, docs in English.

## Review Focus

1. Float error in the percent: `58/100*100` is `57.999…` in floating point → must show 58. Pinned in Task 4 (`floors exact ratios without float error`).
2. A broken item (`current = 0`) must give 0 % red; a slot reporting `max = 0` must be skipped, not divide by zero. Pinned in Task 4.
3. Loading screens and short hiccups: the strip disappears for a moment; the key must not flash grey on every zone change → `nodata` only after 3 consecutive failed reads. Pinned in Task 8 (`reports nodata only after 3 consecutive failures`).
4. Windowed mode with a title bar / borders, or another window covering WoW: the strip is not at (0,0) of the capture, or not visible at all → locate by scanning, and give `nodata` when not found. Pinned in Task 7.
5. Two WoW clients open, or a minimized one: pick a non-minimized `World of Warcraft` window, preferring the focused one. Pinned in Task 8 (`pickWowWindow`).

---

## File Structure

```
package.json                      root dev tooling: vitest, wasmoon, luaparse; "test" script
vitest.config.ts                  includes addon/tests, streamdeck/src, tests
tests/vectors/channel-v1.json     shared protocol test vectors (Lua + TS)
tests/roundtrip.test.ts           Lua encode → TS decode
addon/HeroDeck/HeroDeck.toc
addon/HeroDeck/Core/Init.lua      namespace setup
addon/HeroDeck/Core/Codec.lua     pure protocol encoding
addon/HeroDeck/Core/Channel.lua   frames + textures for the strip
addon/HeroDeck/Modules/Durability.lua
addon/tests/harness.ts            wasmoon loader + WoW API mocks
addon/tests/*.test.ts
streamdeck/                       created by `streamdeck create`
  src/plugin.ts
  src/channel/protocol.ts         constants + RGB/RawImage types
  src/channel/decode.ts           normalize + decode cells/fields/strip
  src/channel/locate.ts           find strip in a raw image, read cell centers
  src/channel/capture.ts          node-screenshots frame source
  src/channel/reader.ts           polling, subscribers, failure debounce
  src/durability/view.ts          percent → state, image path, title
  src/actions/durability.ts       Stream Deck action
  com.devilcable.herodeck.sdPlugin/
    manifest.json, en.json, fr.json, package.json (runtime deps)
    imgs/actions/durability/{ok,warn,critical,nodata}.svg
    ui/durability.html
```

---

### Task 1: Root tooling and addon skeleton

**Files:**
- Create: `package.json`, `vitest.config.ts`, `addon/HeroDeck/HeroDeck.toc`, `addon/HeroDeck/Core/Init.lua`, `addon/tests/harness.ts`, `addon/tests/syntax.test.ts`
- Modify: `.gitignore` (add `streamdeck/*.sdPlugin/bin/`, `streamdeck/*.sdPlugin/logs/`, `streamdeck/*.sdPlugin/node_modules/`)

**Interfaces:**
- Produces:
  - `createLua(mocks?: Record<string, unknown>): Promise<LuaEngine>` (wasmoon engine with mocks set as globals)
  - `loadAddonFiles(lua: LuaEngine, files: string[]): Promise<void>` — runs each file (path relative to `addon/HeroDeck`) as a chunk called with `("HeroDeck", ns)`, the same `ns` table for all files, exposed to tests as global `HeroDeckNS`
  - `ADDON_FILES: string[]` — the load order, read from `HeroDeck.toc` (non-comment, non-empty lines)
  - Addon namespace: `ns.Codec`, `ns.Channel`, `ns.Durability` (filled by later tasks)

- [ ] **Step 1:** Root `package.json` (`"private": true`, `"type": "module"`, script `"test": "vitest run"`), dev deps pinned: `vitest@5.1.1`, `wasmoon@1.16.0`, `luaparse@0.3.1`, `typescript`. `vitest.config.ts` includes `addon/tests/**/*.test.ts`, `streamdeck/src/**/*.test.ts`, `tests/**/*.test.ts`. Run `npm install`.
- [ ] **Step 2: Write the failing test** `addon/tests/syntax.test.ts`:
  - `toc declares interface 16001`: `HeroDeck.toc` contains the line `## Interface: 16001`, `## Title: HeroDeck`, `## SavedVariables` absent.
  - `every toc file exists and parses as Lua 5.1`: for each of `ADDON_FILES`, `luaparse.parse(src, { luaVersion: "5.1" })` does not throw.
  - `loads all addon files into one namespace`: after `loadAddonFiles(lua, ADDON_FILES)` with default mocks, `HeroDeckNS` is a table.
- [ ] **Step 3: Run** `npm test` → FAIL (files missing).
- [ ] **Step 4:** Write `HeroDeck.toc` (Interface 16001, Title, Notes, Author `devilcable`, Version `0.1.0`, files `Core/Init.lua`, `Core/Codec.lua`, `Core/Channel.lua`, `Modules/Durability.lua`), `Init.lua` (`local addonName, ns = ...`; nothing else), and empty-but-valid placeholder files for the other three (`local _, ns = ...`). Write `harness.ts`; the harness's default mocks are no-op stubs for `CreateFrame`, `WorldFrame`, `GetPhysicalScreenSize` (returns 1920, 1080), `GetInventoryItemDurability` (returns nil) — Task 3 and 4 extend them.
- [ ] **Step 5: Run** `npm test` → PASS.
- [ ] **Step 6: Commit** `chore: add addon skeleton and Lua test harness`.

### Task 2: Protocol codec (Lua) and shared vectors

**Files:**
- Create: `tests/vectors/channel-v1.json`, `addon/tests/codec.test.ts`
- Modify: `addon/HeroDeck/Core/Codec.lua`

**Interfaces:**
- Produces (Lua, on `ns.Codec`):
  - `Codec.LEVELS = {0, 85, 170, 255}`, `Codec.VERSION = 1`
  - `Codec.Xor4(a, b) -> integer` (0–15, arithmetic only)
  - `Codec.CellColor(value6) -> r, g, b` (bytes)
  - `Codec.HeaderCells() -> { {r,g,b} x4 }`
  - `Codec.EncodeByte(byte) -> { {r,g,b}, {r,g,b} }` (errors on non-integer or outside 0–255)
- Produces `tests/vectors/channel-v1.json`: `{ "header": [[r,g,b] x4], "fields": [{ "value": n, "cells": [[r,g,b],[r,g,b]] }] }` with exactly these entries (derived by hand from the spec; they are the contract):

| value | cell A | cell B |
|---|---|---|
| 0 | 0,0,0 | 0,170,170 |
| 19 | 0,85,0 | 255,170,0 |
| 87 | 85,85,85 | 255,170,0 |
| 100 | 85,170,85 | 0,170,0 |
| 255 | 255,255,255 | 255,170,170 |

  header: `255,255,255`, `0,0,0`, `255,0,255`, `0,0,85`.

- [ ] **Step 1:** Write the vectors file.
- [ ] **Step 2: Write the failing tests** in `codec.test.ts` (load `ADDON_FILES`, call through `lua.global`/`doString`):
  - `header matches vectors`
  - `EncodeByte matches every vector`
  - `Xor4 truth samples`: `(5,7)→2`, `(15,15)→0`, `(0,10)→10`, `(6,4)→2`
  - `EncodeByte rejects -1, 256, 1.5`
- [ ] **Step 3: Run** `npm test -- codec` → FAIL.
- [ ] **Step 4:** Implement in `Codec.lua`. `EncodeByte`: cell A value = `floor(byte/4)`, cell B value = `(byte % 4) * 16 + check`, `check = Xor4(Xor4(floor(byte/16), byte % 16), 10)`; `CellColor(v)`: R level index `floor(v/16)`, G `floor(v/4) % 4`, B `v % 4`.
- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `feat(addon): add channel protocol v1 codec`.

### Task 3: Channel strip frames (Lua)

**Files:**
- Modify: `addon/HeroDeck/Core/Channel.lua`, `addon/tests/harness.ts` (frame/texture recording mocks)
- Test: `addon/tests/channel.test.ts`

**Interfaces:**
- Consumes: `ns.Codec.HeaderCells`, `ns.Codec.EncodeByte`.
- Produces (Lua, on `ns.Channel`):
  - `Channel.CELL_PX = 3`
  - `Channel:Init()` — creates the strip frame once (idempotent); draws the 4 header cells
  - `Channel:Register(fieldIndex) -> true` (errors if already registered)
  - `Channel:SetByte(fieldIndex, byte)` (errors if not registered); creates that field's 2 textures on first use
  - `Channel:Layout()` — recomputes sizes/positions; called on `DISPLAY_SIZE_CHANGED` and `UI_SCALE_CHANGED`
- Harness mocks record, per texture: color passed to `SetColorTexture` (stored ×255, rounded), size, and `SetPoint` offsets; per frame: parent, strata, `SetIgnoreParentScale`, registered events, and an `OnEvent` script the test can fire.

- [ ] **Step 1: Write the failing tests:**
  - `strip is parented to WorldFrame, top-left, TOOLTIP strata, ignores parent scale`
  - `draws header cells with exact colors` (from vectors file)
  - `SetByte(0, 87) draws cells 4 and 5 with the vector colors at x offsets of 4 and 5 cells`
  - `cell size is 3 physical pixels`: with `GetPhysicalScreenSize` → `2560, 1440`, cell size in UI units = `3 * 768 / 1440` (±1e-9)
  - `relayouts on UI_SCALE_CHANGED`: change the mocked physical size, fire the event, sizes update
  - `SetByte on an unregistered field errors`; `Register twice errors`
- [ ] **Step 2: Run** `npm test -- channel` → FAIL.
- [ ] **Step 3:** Implement. Frame: `CreateFrame("Frame", nil, WorldFrame)`, `SetIgnoreParentScale(true)`, `SetScale(1)`, `SetFrameStrata("TOOLTIP")`, anchored `TOPLEFT` to `WorldFrame`. Unit per pixel = `768 / physicalHeight`. Cell `i` at `x = i * CELL_PX * unit`, `y = 0`. Each cell is one texture with `SetColorTexture(r/255, g/255, b/255, 1)`; turn off pixel snapping blur where the API allows (`SetSnapToPixelGrid(false)`, `SetTexelSnappingBias(0)`, guarded with `if tex.SetSnapToPixelGrid then`).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(addon): draw channel strip`.

### Task 4: Durability module (Lua)

**Files:**
- Modify: `addon/HeroDeck/Modules/Durability.lua`, `addon/tests/harness.ts` (slot durability mock table)
- Test: `addon/tests/durability.test.ts`

**Interfaces:**
- Consumes: `ns.Channel:Init`, `:Register`, `:SetByte`.
- Produces (Lua, on `ns.Durability`):
  - `Durability.FIELD = 0`
  - `Durability.Compute(readSlot) -> integer` — `readSlot(slot) -> current, max | nil`; slots `1..19`
  - `Durability:Update()` — `Channel:SetByte(FIELD, Compute(GetInventoryItemDurability))`
  - On load: an event frame calls `Channel:Init()`, `Channel:Register(FIELD)` on `PLAYER_LOGIN`, then `Update()` on `PLAYER_ENTERING_WORLD`, `UPDATE_INVENTORY_DURABILITY`, `PLAYER_EQUIPMENT_CHANGED`.

- [ ] **Step 1: Write the failing tests** (`Compute` fed a JS slot table):
  - `no slot with durability → 100`
  - `most damaged item wins`: `{1: [100,100], 16: [10,100]}` → 10
  - `rounds down`: `[296, 1000]` → 29; `[199, 1000]` → 19
  - `floors exact ratios without float error`: `[58,100]` → 58, `[29,100]` → 29, `[7, 25]` → 28
  - `broken item → 0`: `[0, 80]` → 0
  - `skips max = 0`: `{1: [0,0], 2: [50,100]}` → 50
  - `events update field 0`: set slots, fire `PLAYER_LOGIN` then `UPDATE_INVENTORY_DURABILITY`, cells 4–5 show the vector colors for the new value (use 87: `[87,100]`)
- [ ] **Step 2: Run** `npm test -- durability` → FAIL.
- [ ] **Step 3:** Implement. Per slot: `math.floor(current * 100 / max)` (integer multiply first, which is what keeps `58/100` exact), keep the minimum.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(addon): publish equipment durability on the channel`.

### Task 5: Stream Deck plugin scaffold

**Files:**
- Create: `streamdeck/` via the CLI; `streamdeck/com.devilcable.herodeck.sdPlugin/package.json`; `en.json`, `fr.json`
- Modify: generated `manifest.json`, `rollup.config.mjs`, `package.json`, `src/plugin.ts`; delete the generated sample action

**Interfaces:**
- Produces: buildable plugin with `src/plugin.ts` that connects and registers actions; `npm run build` in `streamdeck/` writes `bin/plugin.js` and installs runtime deps into the `.sdPlugin` folder.

- [ ] **Step 1:** Check Stream Deck app version ≥ 7.1 (Stream Deck → Preferences → About, or ask the user). Run `npx @elgato/cli@1.10.4 create` in the repo root, folder `streamdeck`, UUID `com.devilcable.herodeck`, name `HeroDeck`, author `devilcable`. Pin `@elgato/streamdeck@3.0.4`.
- [ ] **Step 2:** Manifest: `Nodejs.Version "24"`, `OS` Windows only, minimum software 7.1, `Category "HeroDeck"`, one action `com.devilcable.herodeck.durability` (name `Durability`, `PropertyInspectorPath "ui/durability.html"`, one state with `Image "imgs/actions/durability/nodata"`, `TitleAlignment "bottom"`, `ShowTitle true`), `Controllers ["Keypad"]`. `en.json`/`fr.json` localize the action name and tooltip (`Durability` / `Durabilité`; `Durability of your most damaged item` / `Durabilité de la pièce la plus abîmée`).
- [ ] **Step 3:** Native module: `rollup.config.mjs` marks `node-screenshots` external; `.sdPlugin/package.json` lists `"node-screenshots": "0.2.8"`; `streamdeck/package.json` `postbuild` runs `npm install --omit=dev --prefix com.devilcable.herodeck.sdPlugin`.
- [ ] **Step 4: Verify:** `cd streamdeck && npm run build` exits 0 and `com.devilcable.herodeck.sdPlugin/node_modules/node-screenshots` exists; `npx @elgato/cli@1.10.4 validate com.devilcable.herodeck.sdPlugin` passes.
- [ ] **Step 5: Commit** `chore(streamdeck): scaffold HeroDeck plugin`.

### Task 6: Strip decoder (TypeScript)

**Files:**
- Create: `streamdeck/src/channel/protocol.ts`, `streamdeck/src/channel/decode.ts`, `streamdeck/src/channel/decode.test.ts`, `tests/roundtrip.test.ts`

**Interfaces:**
- Produces:
  - `protocol.ts`: `export type RGB = { r: number; g: number; b: number }`; `export type RawImage = { width: number; height: number; data: Uint8Array }` (RGBA); `LEVELS = [0, 85, 170, 255]`, `TOLERANCE = 30`, `PROTOCOL_VERSION = 1`, `CELL_PX = 3`, `HEADER_CELLS = 4`, `MAX_FIELDS = 4`, `MIN_CONTRAST = 100`
  - `decode.ts`:
    - `decodeCell(c: RGB, white: RGB, black: RGB): number | null` (6-bit value)
    - `decodeField(a: RGB, b: RGB, white: RGB, black: RGB): number | null` (byte)
    - `decodeStrip(cells: RGB[]): { version: number; fields: (number | null)[] } | null` — `cells[0..3]` header, `fields.length = floor((cells.length - 4) / 2)`

- [ ] **Step 1: Write the failing tests** (`decode.test.ts`, use `tests/vectors/channel-v1.json`):
  - `decodes every vector field`
  - `decodes the header: version 1`
  - `survives a linear shift`: every channel of every cell `→ v * 0.85 + 20` (rounded) still decodes all vectors
  - `survives mild gamma`: `v → 255 * (v/255) ** (1/1.1)` still decodes
  - `rejects a channel halfway between levels`: one data channel set to 128 → that field `null`, others intact
  - `rejects a bad check`: cell B of value 87 with its last check bit flipped → `null`
  - `rejects a strip without contrast`: white `(120,120,120)`, black `(60,60,60)` → `decodeStrip` returns `null`
  - `rejects a wrong marker or version` → `null`
- [ ] **Step 2:** `tests/roundtrip.test.ts`: `Lua EncodeByte(v) decodes to v for every v in 0..255` (loads the addon through the Task 1 harness).
- [ ] **Step 3: Run** `npm test` → FAIL.
- [ ] **Step 4:** Implement. Normalize per channel with that channel's white/black; a channel whose `white - black < MIN_CONTRAST` makes `decodeStrip` return `null`; the marker must decode to value `51` (`magenta = 3,0,3 levels`) and cell 3 to `PROTOCOL_VERSION`; header white/black must decode to 63/0.
- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `feat(streamdeck): decode channel protocol v1`.

### Task 7: Locate the strip in a captured image

**Files:**
- Create: `streamdeck/src/channel/locate.ts`, `streamdeck/src/channel/locate.test.ts`

**Interfaces:**
- Consumes: `RawImage`, `RGB`, `CELL_PX`, `HEADER_CELLS`, `MAX_FIELDS`.
- Produces:
  - `SEARCH_W = 128`, `SEARCH_H = 64` (search region from the image's top-left, covers title bar + borders)
  - `findStrip(img: RawImage): { x: number; y: number } | null` — center pixel of cell 0
  - `readCells(img: RawImage, origin: { x: number; y: number }, count: number): RGB[]` — center of cell `i` at `origin.x + i * CELL_PX`; cells past the image edge are omitted (array stops)

- [ ] **Step 1: Write the failing tests** (build synthetic images: a helper paints 3×3 cells from the vectors onto a noisy background):
  - `finds the strip at 0,0`
  - `finds the strip below a title bar`: strip at `(8, 31)` → origin `(9, 32)`
  - `ignores a blurred 1px edge`: cell borders blended 50 % with neighbors; decode still gives 87
  - `returns null on an image without the strip` (random noise, and a plain white image)
  - `readCells stops at the image edge`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Implement. Scan the search region; candidate center `c` matches when pixel `c` is bright (all channels ≥ 160), `c + CELL_PX` dark (all ≤ 95), `c + 2*CELL_PX` magenta-like (R, B ≥ 160, G ≤ 95); return the first match in row-major order. Final validation is `decodeStrip`'s job.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(streamdeck): locate the channel strip in a capture`.

### Task 8: Capture source and channel reader

**Files:**
- Create: `streamdeck/src/channel/capture.ts`, `streamdeck/src/channel/reader.ts`, `streamdeck/src/channel/reader.test.ts`, `streamdeck/src/channel/capture.test.ts`

**Interfaces:**
- Consumes: `findStrip`, `readCells`, `decodeStrip`.
- Produces:
  - `capture.ts`:
    - `export interface WindowInfo { title: string; minimized: boolean; focused: boolean }`
    - `WOW_TITLE = "World of Warcraft"`
    - `pickWowWindow<T extends WindowInfo>(windows: T[]): T | null`
    - `export interface FrameSource { grab(): Promise<RawImage | null> }`
    - `class WowWindowSource implements FrameSource` — node-screenshots: `Window.all()`, map to `WindowInfo`, `pickWowWindow`, `captureImage()`, `crop(0, 0, min(SEARCH_W + STRIP_PX, w), min(SEARCH_H + CELL_PX, h))` where `STRIP_PX = (HEADER_CELLS + 2 * MAX_FIELDS) * CELL_PX` (36), `toRaw()`; if `findStrip` fails on the window capture, fall back to the window's `currentMonitor().captureImage()` cropped at the window's `x/y` (relative to the monitor); any thrown error → `null`
  - `reader.ts`:
    - `POLL_MS = 500`, `FAILS_BEFORE_NODATA = 3`
    - `type ChannelFrame = { fields: (number | null)[] } | null` (`null` = nodata)
    - `class ChannelReader { constructor(source: FrameSource, timers?: { setInterval; clearInterval }); subscribe(listener: (f: ChannelFrame) => void): () => void; readonly running: boolean; tick(): Promise<void> }`

- [ ] **Step 1: Write the failing tests:**
  - `pickWowWindow`: ignores other titles; ignores minimized; prefers focused among two; `null` when none; title match is exact
  - `starts polling on first subscriber, stops after last unsubscribe` (fake timers)
  - `emits the decoded frame to every subscriber`
  - `reports nodata only after 3 consecutive failures`: good, fail, fail → still last good; third fail → `null`; next good → frame again
  - `a new subscriber gets the last frame immediately` (or `null` before any read)
  - `ticks do not overlap`: a slow `grab()` makes the next tick skip
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Implement. Reader starts in the `nodata` state.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check (needs WoW running, borderless):** a tiny script `streamdeck/scripts/probe.ts` (run with `npx tsx`) prints the decoded frame every 500 ms; record the measured `grab()` time. If window capture returns black for the game, note that the monitor fallback is what works.
- [ ] **Step 6: Commit** `feat(streamdeck): capture and poll the channel`.

### Task 9: Durability key (view, icons, action, property inspector)

**Files:**
- Create: `streamdeck/src/durability/view.ts`, `streamdeck/src/durability/view.test.ts`, `streamdeck/src/actions/durability.ts`, `imgs/actions/durability/{ok,warn,critical,nodata}.svg`, `ui/durability.html` (both under the `.sdPlugin` folder)
- Modify: `streamdeck/src/plugin.ts` (create one `ChannelReader(new WowWindowSource())`, register the action)

**Interfaces:**
- Consumes: `ChannelReader.subscribe`, `ChannelFrame`.
- Produces:
  - `view.ts`:
    - `type DurabilityState = "ok" | "warn" | "critical" | "nodata"`
    - `DURABILITY_FIELD = 0`
    - `percentFrom(frame: ChannelFrame): number | null` (field 0; values > 100 → `null`)
    - `stateFor(percent: number | null): DurabilityState`
    - `imageFor(state: DurabilityState): string` → `imgs/actions/durability/<state>.svg`
    - `titleFor(percent: number | null, showPercent: boolean): string`
    - `type KeyView = { image: string; title: string }`; `viewFor(frame: ChannelFrame, showPercent: boolean): KeyView`
  - `actions/durability.ts`: `@action({ UUID: "com.devilcable.herodeck.durability" }) class DurabilityAction extends SingletonAction<{ showPercent?: boolean }>` — `onWillAppear` subscribes (one reader subscription per visible key, unsubscribed in `onWillDisappear`), `onDidReceiveSettings` re-renders; keeps the last `KeyView` per `action.id` and calls `setImage`/`setTitle` only for the part that changed.

- [ ] **Step 1: Write the failing tests** (`view.test.ts`):
  - `stateFor`: `100→ok`, `50→ok`, `49→warn`, `20→warn`, `19→critical`, `0→critical`, `null→nodata`
  - `titleFor`: `(87,true)→"87%"`, `(87,false)→""`, `(null,true)→"--"`, `(null,false)→""`
  - `percentFrom`: `null` frame → `null`; field 0 `null` → `null`; `101` → `null`; `87` → 87
  - `viewFor(null, true)` → `{ image: "imgs/actions/durability/nodata.svg", title: "--" }`
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implement `view.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5:** Icons: 144×144 SVG, original simple breastplate in the upper ~70 % (room for the title below). Backgrounds `ok #000000`, `warn #F2C200`, `critical #C8102E`, `nodata #4A4A4A`; armor `#E8E8E8` on black/red, `#1A1A1A` on yellow, `#8A8A8A` on grey.
- [ ] **Step 6:** Property inspector `ui/durability.html` with the sdpi-components setup the CLI template uses: one checkbox bound to setting `showPercent`, default checked, label localized `Show percentage` / `Afficher le pourcentage` (use the sdpi-components localization the template supports; if it does not resolve in Stream Deck 7.1, use English and report it).
- [ ] **Step 7:** Implement the action and wire `plugin.ts`. Build.
- [ ] **Step 8: Manual check:** `npx @elgato/cli@1.10.4 link streamdeck/com.devilcable.herodeck.sdPlugin`, restart the plugin, add the key: grey `--` with WoW closed; toggling the checkbox hides/shows the title.
- [ ] **Step 9: Commit** `feat(streamdeck): add durability key`.

### Task 10: In-game verification and project facts

**Files:**
- Modify: `CLAUDE.md` (layout, commands, confirmed facts), possibly `addon/HeroDeck/HeroDeck.toc`, `capture.ts` (`WOW_TITLE`)

Needs the user at the game. Ask them, one at a time, only for what cannot be read from the machine.

- [ ] **Step 1:** Confirm with the user: the AddOns folder path, the interface number (`/dump (select(4, GetBuildInfo()))`), the game window title. Fix `.toc` / `WOW_TITLE` if they differ (re-run `npm test`).
- [ ] **Step 2:** Install the addon as a directory junction: `cmd /c mklink /J "<AddOns>\HeroDeck" "D:\Git\herodeck\addon\HeroDeck"`.
- [ ] **Step 3:** Check with the user, borderless then windowed: the strip is visible top-left; the key shows the right % and color; unequipping the damaged item or repairing updates the key in about 1 s; Alt+Z keeps the strip; changing UI scale keeps it decoding; a loading screen does not flash grey; minimizing gives `--` after about 1.5 s. If HDR is available, try it; if it gives `nodata`, note HDR as unsupported.
- [ ] **Step 4:** Update `CLAUDE.md`: repo layout, `npm test`, `cd streamdeck && npm run build`, link/install commands, the confirmed facts (replace the "not confirmed" lines).
- [ ] **Step 5: Commit** `docs: record confirmed WoW Forever facts and commands`.

### Task 11: User documentation (after the user validates the feature)

**Files:**
- Create: `docs/user/durability.md`
- Modify: `README.md` (link to it)

- [ ] **Step 1:** Wait for the user to say the feature works for them.
- [ ] **Step 2:** Write `docs/user/durability.md`: install the addon (AddOns path, junction or copy), install the plugin, add the Durability key, what each color means (50/20 thresholds, most damaged item, rounded down), the "Show percentage" option, required display mode (windowed or borderless), what `--` means and the usual causes (game closed, minimized, exclusive fullscreen, HDR if unsupported), the small strip in the top-left corner and why it is there.
- [ ] **Step 3: Commit** `docs: add durability key user guide`.
