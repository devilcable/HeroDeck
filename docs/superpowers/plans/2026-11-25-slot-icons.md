# One Icon per Equipment Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durability keys show a drawing of their item (helmet, greaves, sword…) in the existing state colors.

**Architecture:** A root script `tools/make-slot-icons.mjs` holds the palettes and one silhouette per slot and
writes committed SVG files; a test checks the files on disk match it. `view.ts` picks the file from slot + state;
the "Most damaged" key takes its slot from a new `SlotTable.lowest()`.

**Tech Stack:** Node 24 ES module script, TypeScript, Vitest, Stream Deck SDK 3.0.4.

**Spec:** `docs/superpowers/specs/2026-11-25-slot-icons-design.md`

## Global Constraints

- Palettes, background / drawing: ok `#000000` / `#E8E8E8`; warn `#F2C200` / `#1A1A1A`; critical `#C8102E` / `#E8E8E8`; nodata `#4A4A4A` / `#8A8A8A`. Detail lines use the background color.
- Icons are 144×144 SVG, `viewBox="0 0 144 144"`, flat shapes in the style of the current armor; original drawings only (no Blizzard art).
- File layout under `streamdeck/com.devilcable.herodeck.sdPlugin/imgs/actions/durability/`: generic `<state>.svg`, per slot `<slot>/<state>.svg`; slots are exactly `SLOT_KEYS` (`head shoulders chest waist legs feet wrists hands mainhand offhand ranged`).
- Unchanged: `icon.svg`, the manifest, key titles, color thresholds (≥ 50 ok, ≥ 20 warn, else critical).
- "Most damaged" percent and state stay from field 0 (live).

## Review Focus

- Windows checkout with `core.autocrlf=true`: committed SVGs become CRLF on disk; the drift test must compare after normalizing `\r\n` to `\n` (Task 1 test).
- Generator slot list drifting from `SLOT_KEYS` (a new slot without an icon): Task 1 test asserts they are equal.
- "Most damaged" with field 0 = no data but a stale-but-valid table: must show the generic gray armor, not a slot (Task 2 test).
- Table holding only "empty" / "n/a" values: `lowest()` returns null → generic armor (Task 2 test).
- Two slots with the same lowest value: first in `SLOT_KEYS` order wins, so the icon does not flicker between frames (Task 2 test).

---

### Task 1: Icon generator and generated files

**Files:**
- Create: `tools/make-slot-icons.mjs`
- Create: `tests/slot-icons.test.ts`
- Modify: `package.json` (script `"slot-icons": "node tools/make-slot-icons.mjs"`)
- Regenerate: `streamdeck/com.devilcable.herodeck.sdPlugin/imgs/actions/durability/{ok,warn,critical,nodata}.svg`
- Create: `streamdeck/com.devilcable.herodeck.sdPlugin/imgs/actions/durability/<slot>/<state>.svg` (44 files)

**Interfaces:**
- Produces (from `tools/make-slot-icons.mjs`, plain ESM, imported by the test with `// @ts-expect-error` like `tests/icon.test.ts`):
  - `STATES: string[]` = `["ok", "warn", "critical", "nodata"]`
  - `SLOTS: string[]` = the 11 slot keys in `SLOT_KEYS` order
  - `PALETTES: Record<state, { bg: string; fg: string }>`
  - `svgFor(glyph: string /* "armor" | slot */, state: string): string` — full SVG text, ends with `\n`
  - `iconFiles(): { path: string; svg: string }[]` — `path` relative to the `durability/` folder with `/` separators (`"ok.svg"`, `"head/ok.svg"`); 4 generic + 44 slot entries
  - The script writes every `iconFiles()` entry when run directly (same `import.meta.url === pathToFileURL(process.argv[1]).href` guard as `make-icon.mjs`).
- The `armor` and `chest` glyphs are both today's armor paths (`M50 12 Q72 28 94 12 L124 24 L120 50 L104 58 L100 92 Q72 102 44 92 L40 58 L24 50 L20 24 Z` filled fg, detail `M72 28 V94 M44 62 H100` stroked bg width 3 round caps).

- [ ] **Step 1: Write the failing tests** in `tests/slot-icons.test.ts`:
  - `SLOTS` equals `SLOT_KEYS` (import from `../streamdeck/src/durability/slots`).
  - `iconFiles()` has 48 entries, paths unique, and includes `"ok.svg"` and `` `${slot}/${state}.svg` `` for every slot × state.
  - For each state, `svgFor("head", state)` contains `fill="${PALETTES[state].bg}"` on a `<rect width="144" height="144"` and contains `PALETTES[state].fg`; `PALETTES.ok` is `{ bg: "#000000", fg: "#E8E8E8" }` and the other three per Global Constraints.
  - Every slot glyph differs from the others (`new Set(SLOTS.map(s => svgFor(s, "ok"))).size === 11`) and `svgFor("chest", state) === svgFor("armor", state)` for every state.
  - Drift guard: for every `iconFiles()` entry, the file on disk under `streamdeck/com.devilcable.herodeck.sdPlugin/imgs/actions/durability/` read as UTF-8 with `\r\n` → `\n` equals `svg`.

- [ ] **Step 2: Run** `npx vitest run tests/slot-icons.test.ts` — expected FAIL (module not found).

- [ ] **Step 3: Implement `tools/make-slot-icons.mjs`** with the interface above. Silhouettes, one per slot: head helmet, shoulders pair of pauldrons, chest armor, waist belt with buckle, legs greaves, feet boots, wrists bracer, hands gauntlet, mainhand sword, offhand shield, ranged bow. Drawing in fg, details in bg, roughly centered in the upper ~100 px like the armor (leaves room for the title). Add the `slot-icons` npm script.

- [ ] **Step 4: Run** `npm run slot-icons`, then view the generated SVGs (open them in the browser pane, all 11 `ok` and one slot in all 4 states) and adjust paths until each item reads clearly at key size.

- [ ] **Step 5: Run** `npx vitest run tests/slot-icons.test.ts` — expected PASS; then `npm test` — expected all PASS (existing `view.test.ts` paths for generic files unchanged).

- [ ] **Step 6: Commit**

```bash
git add tools/make-slot-icons.mjs tests/slot-icons.test.ts package.json streamdeck/com.devilcable.herodeck.sdPlugin/imgs/actions/durability
git commit -m "feat(streamdeck): generate one durability icon per equipment slot"
```

### Task 2: Pick the slot icon on keys

**Files:**
- Modify: `streamdeck/src/durability/slots.ts` (add `lowest()`)
- Modify: `streamdeck/src/durability/view.ts` (`imageFor`, `viewFor`, `slotViewFor`)
- Modify: `streamdeck/src/actions/key-view.ts`
- Test: `streamdeck/src/durability/slots.test.ts`, `streamdeck/src/durability/view.test.ts`, `streamdeck/src/actions/key-view.test.ts`

**Interfaces:**
- Consumes: files from Task 1 at `imgs/actions/durability/<slot>/<state>.svg`.
- Produces:
  - `SlotTable.lowest(): SlotKey | null` — slot with the smallest numeric `value(slot)`; ties → first in `SLOT_KEYS`; null when no slot has a number.
  - `imageFor(state: DurabilityState, slot?: SlotKey | null): string` — `imgs/actions/durability/${slot}/${state}.svg` with a slot, else `imgs/actions/durability/${state}.svg`.
  - `viewFor(frame: ChannelFrame, showPercent: boolean, slot?: SlotKey | null): KeyView` — state nodata → generic image whatever `slot`.
  - `slotViewFor(value: SlotValue, slot: SlotKey, label: string, showPercent: boolean, t): KeyView` — new `slot` second parameter; every image uses that slot (nodata image for empty / n/a / null).
  - `keyViewFor` (signature unchanged): "lowest" → `viewFor(frame, showPercent, table.lowest())`.

- [ ] **Step 1: Write the failing tests**
  - `slots.test.ts`: `lowest()` returns `"legs"` for page 1 values `[80, 12, 50]`; returns `"head"` when head and legs are both 12 (two pages seen); returns null on a fresh table, and null when only `254`/`253` bytes were seen; returns null after `STALL_MS + 1` without a page change.
  - `view.test.ts`: `imageFor("warn", "head")` is `"imgs/actions/durability/head/warn.svg"`; `imageFor("warn")` and `imageFor("warn", null)` stay `"imgs/actions/durability/warn.svg"`; `viewFor({ fields: [30] }, true, "legs").image` is `"imgs/actions/durability/legs/warn.svg"`; `viewFor(null, true, "legs").image` is `"imgs/actions/durability/nodata.svg"`; update the existing `slotViewFor` cases to pass a slot and expect `.../<slot>/<state>.svg` (empty / n/a / null → `.../<slot>/nodata.svg`).
  - `key-view.test.ts`: "lowest" key with a table whose lowest slot is `feet` and frame field 0 = 12 → image `"imgs/actions/durability/feet/critical.svg"`, title `"12%"`; "lowest" key with an empty table → generic image; a `head` key → `.../head/<state>.svg`.

- [ ] **Step 2: Run** `npx vitest run streamdeck/src` — expected FAIL on the new cases.

- [ ] **Step 3: Implement** `lowest()`, the new `imageFor` / `viewFor` / `slotViewFor` signatures, and pass `item` / `table.lowest()` from `keyViewFor`.

- [ ] **Step 4: Run** `npm test` and `cd streamdeck && npx tsc --noEmit` — expected all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add streamdeck/src
git commit -m "feat(streamdeck): show the item's icon on durability keys"
```

### Task 3: Build, check in game, document

**Files:**
- Modify: `docs/user/durability.md` (icons per item, "Most damaged" shows the most damaged item's drawing, generic armor while no item data; show a few icons via relative links to the SVGs)
- Modify: `CLAUDE.md` (Layout: `tools/make-slot-icons.mjs` and `npm run slot-icons`)

- [ ] **Step 1: Run** `cd streamdeck && npm run build && npx streamdeck validate com.devilcable.herodeck.sdPlugin && npx streamdeck restart com.devilcable.herodeck` — expected build OK, validation with no errors.
- [ ] **Step 2: In-game check with the user:** a Head key shows the helmet, a Legs key the greaves, "Most damaged" shows the most damaged item's drawing; colors follow durability; Alt+Z → gray. Wait for the user's OK.
- [ ] **Step 3: Update the docs** above.
- [ ] **Step 4: Commit**

```bash
git add docs/user/durability.md CLAUDE.md
git commit -m "docs: per-item durability icons"
```
