# Packaging and README — design

## Intent

Ship HeroDeck to players without the dev setup: one command builds both install packages, the README
explains how to install the addon and the plugin and how each one works, and everything lands on `main`
as release 0.2.0.

## Goals

- `npm run package` (repo root) writes to `dist/`:
  - `com.devilcable.herodeck.streamDeckPlugin` (built plugin, `streamdeck pack`), installed by double-click;
  - `HeroDeck-addon-<version>.zip` holding a top-level `HeroDeck/` folder, unzipped into `AddOns/`.
- Version 0.2.0 in `manifest.json` (`0.2.0.0`) and `HeroDeck.toc` (`0.2.0`); a test keeps them equal.
- CI runs the packaging and uploads both files as a build artifact.
- README (French, like today): install of both parts, how the addon works, how the plugin works, limits,
  developer section, link to `docs/user/durability.md`.
- develop → main, GitHub release v0.2.0 with both packages.

## Non-goals

- Stream Deck Marketplace or CurseForge publication.
- Automatic release on tag.

## Approaches

1. **Node script + `fflate` for the zip** (picked): same behaviour on Windows and on the Ubuntu CI, the zip
   content is testable in Vitest with `unzipSync`.
2. PowerShell `Compress-Archive` / Linux `zip`: two code paths, nothing to test.
3. Hand-written zip writer on `node:zlib`: no dependency, but ~80 lines of format code to maintain.

## Design

- `tools/package.mjs` exports `addonZip(addonDir)` (returns the zip bytes, entries under `HeroDeck/`, sorted,
  forward slashes) and `versions()`; run as a script it builds the plugin (`npm run build` in `streamdeck/`),
  runs `streamdeck pack --force --no-update-check -o ../dist`, and writes the addon zip.
- `tests/package.test.ts`: zip holds `HeroDeck/HeroDeck.toc` and every file listed in the `.toc`, nothing
  outside `HeroDeck/`; manifest version = `.toc` version + `.0`.
- `dist/` is already ignored.
