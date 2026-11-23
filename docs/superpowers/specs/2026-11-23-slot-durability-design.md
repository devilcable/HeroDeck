# Durability of one equipped item on a Stream Deck key — design

Date: 2026-11-23
Branch: `feature/slot-durability` (from `develop`)
Status: draft, waiting for user approval
Builds on: `2026-11-18-durability-design.md` (durability key) and `2026-11-20-minimap-button-design.md`
(protocol v2 grid in the minimap button)

## Intent

Today the Durability key shows the durability of the **most damaged** equipped item, live. (The user calls
it "the average key"; it is in fact the most damaged item, and it stays as it is.) The user wants a key to
be able to show **one specific equipped item** instead — e.g. one key for the weapon, one for the chest —
**without a bigger minimap button and without any new pixels on screen**.

## Goals

- A per-key setting **"Item"** on the Durability key:
  - **Most damaged** (default; today's behavior, live, unchanged);
  - **Head, Shoulders, Chest, Waist, Legs, Feet, Wrists, Hands, Main hand, Off hand, Ranged** (the 11
    equipment slots that can have durability).
- A specific-item key shows that item's durability with the same armor icon and colors, plus the item's
  short name, updated within about **4 seconds** of a change.
- Reuse the existing minimap button grid (protocol v2): no new grid, no bigger button.
- User documentation updated once implemented and validated.

## Non-goals

- An "average" mode (the user confirmed the current key is the one they meant).
- Item names, icons or quality colors from the game (only the slot's short name).
- Opening the character sheet to refresh (rejected: the rotation below is fresher and needs nothing).
- Rings, neck, trinkets, back, shirt, tabard (no durability).

## Anti-goals

- Slowing down or changing the "Most damaged" key (it stays live in field 0).
- Showing an old per-item value as if it were current: a slot not refreshed recently shows "no data".

## Approaches considered

| | Approach | Trade-offs | Verdict |
|---|---|---|---|
| A | Bigger grid (5×6, protocol v3) carrying all 11 slots every read | Fully live; but a ~20 % bigger button and a new format | Rejected: the user wants the button to stay small |
| B | Second grid drawn on the character sheet while it is open | Small button; but new pixels on screen and only a snapshot between openings | Rejected by the user ("avoid another pixel frame") |
| C | **Rotation through the 4 free fields of the existing grid** | No visual change, near-live (≤ 4 s); a little more logic, 4 s to fill after start | **Picked by the user** |
| D | Pack 2 slots per field (4 bits each) | Only 8 slots, ~7 % steps | Rejected |

## Decisions

### Data on the channel (addon → plugin)

Protocol v2 is unchanged (geometry, version 2, encoding). Only the use of the fields is defined:

- **Field 0:** most-damaged percent (unchanged).
- **Field 1:** page number `0..3`.
- **Fields 2, 3, 4:** values of the 3 slots of that page:

  | Page | Field 2 | Field 3 | Field 4 |
  |---|---|---|---|
  | 0 | Head (1) | Shoulders (3) | Chest (5) |
  | 1 | Waist (6) | Legs (7) | Feet (8) |
  | 2 | Wrists (9) | Hands (10) | Main hand (16) |
  | 3 | Off hand (17) | Ranged (18) | unused (255) |

  (numbers = WoW inventory slot ids)
- Slot value: `0..100` = percent, `floor(current * 100 / max)` as for field 0; **`253`** = item equipped
  but it has no durability (e.g. an off-hand "held in off-hand" item); **`254`** = nothing equipped in
  that slot; **`255`** = unused.
- The page advances every **1 second** (my call, `C_Timer.NewTicker(1, …)`), so the full cycle is 4 s. The
  plugin reads about twice a second, so every page is read at least once per cycle.
- Fields 1–4 are written together on each page change, and recomputed from the current gear each time (so
  a value is never older than its page's last display).
- The addon registers fields 1–4 at login with field 0, but draws them only from the first ticker tick
  on; until then they stay idle cells, which decode as "no field" (never as page 0).

### Plugin

- **One shared slot table** for the whole plugin (my call), fed by every decoded frame from the channel
  reader: when field 1 is a valid page (0–3) and its fields decode, store each slot's value with the time
  it was seen. A key that appears while other keys are already visible reads the full table at once; the
  table is cleared when the reader stops (no visible key), so after that the first keys need up to one
  cycle (~4 s) and show `--` meanwhile.
- A slot value older than **10 seconds** (my call: 2.5 cycles) counts as "no data". When the grid is lost
  (reader emits no data), every slot is "no data" too.
- **Stalled rotation = stale** (my call): the page must keep changing. If the plugin has seen the same page
  for more than **3 seconds** in a row (addon ticker stopped, frozen game still showing the grid), the
  whole slot table counts as "no data" until the page changes again. No protocol change: the rotation
  itself is the heartbeat. (The "Most damaged" key is not affected by this rule.)
- Key setting `item`: `"lowest"` (default) or a slot key (`head`, `shoulders`, `chest`, `waist`, `legs`,
  `feet`, `wrists`, `hands`, `mainhand`, `offhand`, `ranged`). Property inspector: a dropdown **Item**
  (French **Pièce**) with "Most damaged" (**La plus abîmée**) first, then the 11 slots.
- Display of a specific-item key:
  - title on two lines: short slot name, then the percent (`Main hand` / `87%`); with "Show percentage"
    off, only the percent is hidden — the status words below (`empty`, `n/a`, `--`) still show (my call);
  - image: same 4 states and thresholds as today (ok ≥ 50, warn 20–49, critical < 20, nodata grey);
  - `254` (empty slot): grey image, second line **`empty`** (**`vide`**);
  - `253` (no durability): grey image, second line **`n/a`** (**`sans`**);
  - no data yet / stale: grey image, `--`.
- Short slot names (EN / FR): Head/Tête, Shoulders/Épaules, Chest/Torse, Waist/Taille, Legs/Jambes,
  Feet/Pieds, Wrists/Poignets, Hands/Mains, Main hand/Arme, Off hand/Main G., Ranged/Distance. Language:
  the Stream Deck app's language (`fr` → French, otherwise English), my call.
- The "Most damaged" key is unchanged (field 0, live).
- The action tooltip (manifest, `en.json`, `fr.json`) is reworded to cover both modes, e.g.
  "Durability of your most damaged item or of one equipped item" / "Durabilité de la pièce la plus abîmée
  ou d'une pièce équipée".
- Two-handed weapon users will see their Off hand key as `empty`; accepted.
- Updates to the key image/title still only when they change.

## Testing

- Addon: page contents for each page (slot ids, values, 253/254/255), page advance every second (mock
  ticker), floor formula, fields registered at login, field 0 unchanged.
- Plugin: slot table (valid page stored, invalid page / null field ignored, 10 s expiry, grid lost →
  all no data), view for each slot state (percent / empty / n/a / no data) and title lines in both
  languages, settings default `lowest`.
- Cross-component: a Lua→TS test that renders pages 0–3 through the channel and checks the plugin's slot
  table ends up with the 11 expected values.

## Left to the builder

- Where the ticker lives (Durability module), the exact property-inspector markup, and how the plugin
  learns the Stream Deck language, within the decisions above.
