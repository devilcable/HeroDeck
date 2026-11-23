# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HeroDeck = two parts that work together:

1. **WoW addon** (Lua + XML) for **World of Warcraft Forever** (launched Nov 2026). It reads the player's character data in game.
2. **Elgato Stream Deck plugin** (TypeScript / Node.js, Stream Deck SDK) that shows that data on keys and can trigger in-game actions.

## Layout

```
addon/HeroDeck/            WoW addon (HeroDeck.toc, Core/Codec.lua, Core/Channel.lua, Core/MinimapButton.lua,
                           Modules/Durability.lua, Media/Icon.tga; SavedVariables HeroDeckDB)
tools/make-icon.mjs        generates Media/Icon.tga and docs/user/img/icon.png (`npm run icon`)
addon/tests/               Vitest tests that run the addon's Lua through wasmoon (harness.ts mocks the WoW API)
streamdeck/                Stream Deck plugin (@elgato/streamdeck 3.0.4, Node 24)
  src/channel/             screen pixel channel: protocol, decode, locate, strip, capture, reader
  src/durability/view.ts   percent → key state, image, title
  src/actions/             Stream Deck actions
  com.devilcable.herodeck.sdPlugin/   manifest, en/fr strings, icons, property inspector
  scripts/probe.ts         in-game diagnostic (prints decoded fields, capture path, grab time)
tests/                     cross-component tests: shared vectors, Lua→TS round trip, real-capture fixtures
docs/superpowers/          specs and plans
```

## Commands

- All tests (addon Lua + plugin TS + cross-component), from the repo root: `npm test`
- Build the plugin: `cd streamdeck && npm run build` (also installs the native `node-screenshots` into the `.sdPlugin` folder)
- Validate the plugin: `cd streamdeck && npx streamdeck validate com.devilcable.herodeck.sdPlugin`
- Install for development:
  - addon: `cmd /c mklink /J "<AddOns>\HeroDeck" "D:\Git\herodeck\addon\HeroDeck"`
  - plugin: `cd streamdeck && npx streamdeck link com.devilcable.herodeck.sdPlugin`, then quit and restart the Stream Deck app once (a newly linked plugin is only discovered at app start); after rebuilds `npx streamdeck restart com.devilcable.herodeck` is enough
- In-game diagnostic (WoW running): `cd streamdeck && npm run probe` (add `-- --dump <dir>` to save the captured image as PNG)
- Regenerate the addon icon: `npm run icon` (root)

## Channel (decided, see `docs/superpowers/specs/2026-11-18-durability-design.md` and `2026-11-20-minimap-button-design.md`)

Game → plugin uses the **screen pixel channel**, protocol **v2**: a 5×3 grid of 4×4 physical-pixel cells (pitch 5, row-major) drawn inside the HeroDeck **minimap button** (drag along the minimap edge, `/herodeck reset`, angle saved in `HeroDeckDB.minimap.angle`; the button auto-scales so the grid fits its ring). Cells: header white/black/magenta/version(2), then up to 5 fields of 2 cells (1 byte + 4-bit check), idle cells `(48,48,48)`; 4 levels per color channel, normalized against the white/black reference cells. The grid is snapped to whole physical pixels and anchored to `WorldFrame`. The plugin captures the WoW window (falls back to the monitor), finds the grid anywhere (full scan, then tracked ±64 px around the last position; full scans throttled to every 4th read while lost), and decodes it. Hidden or covered button (Alt+Z, world map, loading screen) → "no data". Lua and TS must stay in sync: `tests/vectors/channel-v2.json`, `tests/roundtrip.test.ts` (encoding), `tests/geometry.test.ts` (grid layout) and `tests/fixture.test.ts` (real capture) guard that.

## Workflow (user rules: follow every time)

- Branches: `main` (releases) and `develop` (integration, GitHub default branch).
- Each request or issue gets **its own branch cut from `develop`** (`feature/<slug>` or `fix/<slug>`). Never commit feature work straight to `develop` or `main`.
- Use the superpowers skills for each request: brainstorming → writing-plans → test-driven-development / subagent-driven-development → verification-before-completion → finishing-a-development-branch.
- Open a PR into `develop`. Merge only when the user says yes.
- Talk to the user in **caveman** style (French, short), to save tokens. Code, commits, and docs stay normal.
- Remote: `https://github.com/devilcable/HeroDeck` (private).

## WoW Forever addon facts

- `.toc` header: `## Interface: 16001` — confirmed in game on 2026-11-20 with `/run print((select(4, GetBuildInfo())))` (the `/dump` form printed nothing). Forever-specific `.toc` files may use the `_Camelot` suffix. Classic Era addons (`11509`) do **not** load.
- Forever uses the modern addon API, so look up APIs for the modern client, not 1.12 vanilla.
- On the user's machine: AddOns folder `D:\Games\World of Warcraft\_forever_\Interface\AddOns`, executable `_forever_\Wow.exe`, window title `World of Warcraft`, D3D12, maximized window 2560×1440. Window capture of the game works (about 100 ms per grab).
- Addon Lua must parse as Lua 5.1 and behave the same on 5.4 (tests run it on wasmoon 5.4): no `//`, no bitwise operators, no `bit` library, no `goto`.

## Cross-component constraint (the core design problem)

The WoW Lua sandbox has **no network, sockets, file I/O, or IPC**. The addon cannot talk to the Stream Deck plugin directly. Every addon ↔ plugin design must go through one of these channels:

- **Game → plugin (data):**
  - `SavedVariables` file. It is written only on `/reload`, logout, or disconnect, so it is not real time.
  - Screen data. The addon draws encoded pixels and the plugin captures the screen and decodes them. This is real time but needs screen capture on the plugin side.
- **Plugin → game (actions):** the plugin sends keystrokes that are bound in game to keybinds or macros. Protected actions need a hardware event, and Blizzard ToS allows **one key press = one game action**: no automation, no sequences that play themselves.

Pick and document the chosen channel in a design spec before building features that depend on it.
