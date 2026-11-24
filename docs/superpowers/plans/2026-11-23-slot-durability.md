# Per-Item Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Durability key show one chosen equipped item (11 slots) next to today's "most damaged" mode, by rotating per-slot values through the 4 free fields of the existing minimap grid.

**Architecture:** The addon adds a `Slots` module: every second it shows one of 4 pages (field 1 = page, fields 2–4 = three slot values). The plugin keeps one shared slot table fed by every decoded frame (with a 10 s expiry and a "page stalled > 3 s" rule) and the Durability action gains an `item` setting (dropdown) that picks "lowest" (field 0, unchanged) or a slot.

**Tech Stack:** unchanged — Lua 5.1 subset (tests on wasmoon 5.4), TypeScript, `@elgato/streamdeck` 3.0.4, sdpi-components v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-slot-durability-design.md`

## Global Constraints

- Branch `feature/slot-durability` (from `develop`); PR into `develop`; merge only on the user's yes.
- Protocol v2 unchanged (geometry, version 2, encoding). Field 0 = most-damaged percent, live, unchanged.
- Field 1 = page `0..3`; fields 2–4 = page slots: page 0 Head(1) Shoulders(3) Chest(5); page 1 Waist(6) Legs(7) Feet(8); page 2 Wrists(9) Hands(10) Main hand(16); page 3 Off hand(17) Ranged(18) unused.
- Slot value: `0..100` = `floor(current * 100 / max)`; `253` = item equipped without durability; `254` = slot empty; `255` = unused.
- Page advances every **1 s** (`C_Timer.NewTicker(1, …)`); fields 1–4 stay idle cells until the first tick.
- Plugin: one shared slot table; value expires after **10 s**; same page seen for more than **3 s** → whole table "no data"; grid lost (reader frame `null`) → table cleared; table cleared when no key is visible.
- Setting `item`: `"lowest"` (default) or `head`, `shoulders`, `chest`, `waist`, `legs`, `feet`, `wrists`, `hands`, `mainhand`, `offhand`, `ranged`. Existing keys without `item` behave as `"lowest"`.
- Specific-item title: line 1 short name, line 2 `87%` / `empty` (`vide`) / `n/a` (`sans`) / `--`; with "Show percentage" off only the percent is hidden (status words stay). Image: same thresholds (ok ≥ 50, warn 20–49, critical < 20); empty / n/a / no data → nodata image.
- Short names EN/FR: Head/Tête, Shoulders/Épaules, Chest/Torse, Waist/Taille, Legs/Jambes, Feet/Pieds, Wrists/Poignets, Hands/Mains, Main hand/Arme, Off hand/Main G., Ranged/Distance; dropdown first entry Most damaged/La plus abîmée; dropdown label Item/Pièce. Language = Stream Deck app language through the SDK's i18n (`en.json` / `fr.json` `Localization`).
- Action tooltip: "Durability of your most damaged item or of one equipped item" / "Durabilité de la pièce la plus abîmée ou d'une pièce équipée".
- Key image/title updated only when they change. Lua 5.1/5.4 rules as before (no `//`, bit ops, `goto`).

## Review Focus

1. Two-handed weapon: the off-hand slot is empty → `254` → key `Main G.` / `vide`. Pinned in Task 1 (`empty off hand gives 254`) and Task 2 (`empty slot view`).
2. Off-hand holdable or other item without durability → `253` → `sans`. Pinned in Task 1 and Task 2.
3. Addon ticker stopped or game frozen with the grid still drawn → after 3 s every slot is "no data". Pinned in Task 2 (`stalled page makes the table stale`).
4. A frame whose page field is null or out of range (e.g. idle cells before the first tick, or 255) must not write anything. Pinned in Task 2.
5. Keys created before this feature (no `item` setting) keep showing "most damaged". Pinned in Task 3 (`settingsFrom` defaults).

---

## File Structure

```
addon/HeroDeck/Modules/Slots.lua        NEW: pages, slot values, ticker
addon/HeroDeck/Modules/Durability.lua   login wiring calls Slots:Start()
addon/HeroDeck/HeroDeck.toc             + Modules/Slots.lua (after Durability.lua)
addon/tests/slots.test.ts               NEW
streamdeck/src/durability/slots.ts      NEW: slot keys, pages, SlotTable
streamdeck/src/durability/slots.test.ts NEW
streamdeck/src/durability/view.ts       + slotViewFor
streamdeck/src/actions/durability.ts    item setting, shared table
streamdeck/src/actions/settings.ts      NEW: settingsFrom (pure)
streamdeck/com.devilcable.herodeck.sdPlugin/{manifest.json,en.json,fr.json,ui/durability.html}
tests/slots-roundtrip.test.ts           NEW: Lua pages → TS slot table
docs/user/durability.md, CLAUDE.md
```

---

### Task 1: Slot pages in the addon

**Files:** Create `addon/HeroDeck/Modules/Slots.lua`, `addon/tests/slots.test.ts`; modify `HeroDeck.toc`, `Modules/Durability.lua`, `addon/tests/harness.ts` (mocks `C_Timer.NewTicker` returning a handle with `Cancel`, `GetInventoryItemID(unit, slot)`), `addon/tests/durability.test.ts` if login wiring changes its expectations.

**Interfaces:**
- Consumes: `ns.Channel:Register(field)`, `ns.Channel:SetByte(field, byte)`.
- Produces (Lua `ns.Slots`):
  - `Slots.PAGES = { {1,3,5}, {6,7,8}, {9,10,16}, {17,18,nil} }` (index = page + 1)
  - `Slots.NO_DURABILITY = 253`, `Slots.EMPTY = 254`, `Slots.UNUSED = 255`, `Slots.PAGE_FIELD = 1`, `Slots.FIRST_SLOT_FIELD = 2`
  - `Slots.Value(slot, itemAt, readSlot) -> byte` (pure): `itemAt(slot)` → item id or nil (`GetInventoryItemID("player", slot)`); `readSlot(slot)` → current, max or nil; empty → 254; no durability (nil or max ≤ 0) → 253; else floor formula
  - `Slots.PageBytes(page, itemAt, readSlot) -> b2, b3, b4` (pure; unused → 255)
  - `Slots:ShowPage(page)` — `SetByte(1, page)` then fields 2–4 from `PageBytes` with the real API
  - `Slots:Start()` — idempotent; registers fields 1–4, starts `C_Timer.NewTicker(1, …)` that shows page 0, 1, 2, 3, 0, … (first page shown on the first tick, not at start)
- `Durability.lua` PLAYER_LOGIN: after `Channel:Register(Durability.FIELD)` call `ns.Slots:Start()`.

- [ ] **Step 1: Failing tests** (`slots.test.ts`): `Value: 58/100 → 58, 29.6 % → 29, 0/80 → 0`; `empty off hand gives 254` (`itemAt(17) = nil`); `item without durability gives 253` (item present, `readSlot` nil, and max 0); `PageBytes(3, …)` third value `255`; `PageBytes(2, …)` reads slots 9, 10, 16 in that order; `Start registers fields 1-4 and draws nothing before the first tick` (cells 6–13 still `IDLE`); `ticks show pages 0,1,2,3,0` (fire the mocked ticker callback 5 times, decode cells 6–7 → page via the vectors/codec); `Start twice creates one ticker`; `login calls Slots:Start after registering field 0`.
- [ ] **Step 2:** Run `npm test -- slots` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(addon): rotate per-slot durability through the free channel fields`.

### Task 2: Slot table and slot view in the plugin (+ Lua→TS round trip)

**Files:** Create `streamdeck/src/durability/slots.ts`, `slots.test.ts`, `tests/slots-roundtrip.test.ts`; modify `streamdeck/src/durability/view.ts`, `view.test.ts`.

**Interfaces:**
- Consumes: `ChannelFrame` (`{ fields: (number | null)[] } | null`), `stateFor`, `imageFor`.
- Produces:
  - `SLOT_KEYS = ["head","shoulders","chest","waist","legs","feet","wrists","hands","mainhand","offhand","ranged"] as const`; `type SlotKey = typeof SLOT_KEYS[number]`
  - `PAGE_SLOTS: (SlotKey | null)[][]` = `[["head","shoulders","chest"],["waist","legs","feet"],["wrists","hands","mainhand"],["offhand","ranged",null]]`
  - `type SlotValue = number | "empty" | "none" | null` (`null` = no data)
  - `VALUE_TTL_MS = 10_000`, `STALL_MS = 3_000`
  - `class SlotTable { constructor(now: () => number = Date.now); update(frame: ChannelFrame): void; value(slot: SlotKey): SlotValue; clear(): void }` — `update(null)` clears; a frame whose field 1 is not an integer 0–3 changes nothing; otherwise stores fields 2–4 for that page's slots (`0..100` → number, `253` → `"none"`, `254` → `"empty"`, `null`/other → not stored) with the time; tracks the time the page last **changed**; `value` returns `null` if the slot's entry is older than `VALUE_TTL_MS` or if the page has not changed for more than `STALL_MS`
  - `view.ts`: `slotViewFor(value: SlotValue, label: string, showPercent: boolean, t: (key: "empty" | "none") => string): KeyView` — title `label + "\n" + second` where second = `87%`, `t("empty")`, `t("none")`, or `--`; with showPercent off only a percent is dropped (title = `label`), the status words stay; image = `imageFor(stateFor(percent))` for numbers, `imageFor("nodata")` otherwise
- [ ] **Step 1: Failing tests** (`slots.test.ts`, fake clock): `stores page 1 values for waist, legs, feet`; `253 → "none", 254 → "empty"`; `ignores a frame whose page is null, 4 or 255` (Review Focus 4); `value expires after 10 s`; `stalled page makes the table stale` (same page for 3.1 s → all `null`; a new page → fresh again) (Review Focus 3); `null frame clears`. (`view.test.ts`) `slotViewFor(87, "Arme", true)` → `{ image: ok.svg, title: "Arme\n87%" }`; `(87, "Arme", false)` → title `"Arme"`; `("empty", …)` → nodata image, `"Main G.\nvide"` with a French `t`; `("none", …)` → `"…\nsans"`; `(null, …)` → `"…\n--"`; thresholds 50/49/20/19 map to ok/warn/warn/critical images.
- [ ] **Step 2: Failing cross-component test** `tests/slots-roundtrip.test.ts`: load the addon in the harness with mocked gear for all 11 slots (one empty, one without durability), call `Slots:ShowPage(p)` for p = 0..3; after each, read cells 4–13 colors from the mocks, decode with the TS `decodeField` (pure white/black refs) into a `ChannelFrame`, feed a `SlotTable` with an advancing fake clock; assert the 11 expected `value()`s.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** `npm test` + `cd streamdeck && npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit** `feat(streamdeck): slot table and per-item key view`.

### Task 3: Item setting on the Durability key

**Files:** Create `streamdeck/src/actions/settings.ts`, `settings.test.ts`; modify `streamdeck/src/actions/durability.ts`, `com.devilcable.herodeck.sdPlugin/ui/durability.html`, `en.json`, `fr.json`, `manifest.json` (tooltip).

**Interfaces:**
- Consumes: `SlotTable`, `slotViewFor`, `viewFor`, `diffView`, `SLOT_KEYS`.
- Produces:
  - `type DurabilitySettings = { showPercent?: boolean; item?: string }`; `settingsFrom(raw: DurabilitySettings): { showPercent: boolean; item: "lowest" | SlotKey }` — defaults `true` / `"lowest"`; unknown `item` → `"lowest"`
  - `DurabilityAction` owns **one** `SlotTable`; every key subscription callback calls `table.update(frame)` before rendering; when the last key disappears the table is `clear()`ed; a key with `item = "lowest"` renders `viewFor` exactly as today; otherwise `slotViewFor(table.value(item), label, showPercent, t)` with `label` and `t` from `streamDeck.i18n.translate` (keys below)
  - Localization keys in `en.json` / `fr.json` `Localization`: `Item`, `Most damaged`, `Show percentage`, the 11 short names keyed `slot.head` … `slot.ranged`, `slot.empty`, `slot.none` (values per Global Constraints)
  - Property inspector: `sdpi-select setting="item"` (label `Item`, default `lowest`, first option `Most damaged`, then the 11 slots) above the existing checkbox
- [ ] **Step 1: Failing tests:** `settingsFrom({})` → `{ showPercent: true, item: "lowest" }` (Review Focus 5); `settingsFrom({ item: "mainhand", showPercent: false })`; `settingsFrom({ item: "ring" })` → `"lowest"`; `en.json and fr.json define every Localization key` (read both files; the key set equals the expected list and FR values match the spec).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run build`, `npx streamdeck validate com.devilcable.herodeck.sdPlugin` → PASS.
- [ ] **Step 5: Commit** `feat(streamdeck): choose the item shown by a durability key`.

### Task 4: In-game check and docs (with the user)

Run by the controller with the user.

- [ ] **Step 1:** `cd streamdeck && npm run build && npx streamdeck restart com.devilcable.herodeck`; the user `/reload`s.
- [ ] **Step 2:** With the user: a key set to Main hand shows the weapon's % and name; Off hand with a two-handed weapon shows `vide`; repairing updates a slot key within ~4 s; "La plus abîmée" unchanged; the dropdown and its French labels; a new slot key added while another HeroDeck key is visible shows its value at once; Alt+Z → `--` then back.
- [ ] **Step 3:** Update `docs/user/durability.md` (Item setting, the 11 slots, `vide`/`sans`/`--`, up to ~4 s delay) and `CLAUDE.md` (fields 1–4 page map).
- [ ] **Step 4: Commit** `docs: per-item durability key`.
