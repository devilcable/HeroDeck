# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HeroDeck = two parts that work together:

1. **WoW addon** (Lua + XML) for **World of Warcraft Forever** (launched Nov 2026). It reads the player's character data in game.
2. **Elgato Stream Deck plugin** (TypeScript / Node.js, Stream Deck SDK) that shows that data on keys and can trigger in-game actions.

The repo is new: no code, build, or tests yet. Update this file with real commands and layout as soon as they exist.

## Workflow (user rules: follow every time)

- Branches: `main` (releases) and `develop` (integration, GitHub default branch).
- Each request or issue gets **its own branch cut from `develop`** (`feature/<slug>` or `fix/<slug>`). Never commit feature work straight to `develop` or `main`.
- Use the superpowers skills for each request: brainstorming → writing-plans → test-driven-development / subagent-driven-development → verification-before-completion → finishing-a-development-branch.
- Open a PR into `develop`. Merge only when the user says yes.
- Talk to the user in **caveman** style (French, short), to save tokens. Code, commits, and docs stay normal.
- Remote: `https://github.com/devilcable/HeroDeck` (private).

## WoW Forever addon facts

- `.toc` header: `## Interface: 16001` (game version 1.60.1). Forever-specific `.toc` files may use the `_Camelot` suffix. Classic Era addons (`11509`) do **not** load. These numbers come from community sites, not Blizzard: check them in game with `/dump (select(4, GetBuildInfo()))`.
- Forever uses the modern addon API, so look up APIs for the modern client, not 1.12 vanilla.
- The AddOns folder path for the live client is not confirmed (`_forever_/Interface/AddOns` is the likely one). Confirm it on the user's machine before writing install scripts.

## Cross-component constraint (the core design problem)

The WoW Lua sandbox has **no network, sockets, file I/O, or IPC**. The addon cannot talk to the Stream Deck plugin directly. Every addon ↔ plugin design must go through one of these channels:

- **Game → plugin (data):**
  - `SavedVariables` file. It is written only on `/reload`, logout, or disconnect, so it is not real time.
  - Screen data. The addon draws encoded pixels and the plugin captures the screen and decodes them. This is real time but needs screen capture on the plugin side.
- **Plugin → game (actions):** the plugin sends keystrokes that are bound in game to keybinds or macros. Protected actions need a hardware event, and Blizzard ToS allows **one key press = one game action**: no automation, no sequences that play themselves.

Pick and document the chosen channel in a design spec before building features that depend on it.
