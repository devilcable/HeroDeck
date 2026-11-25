# Packaging and README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command builds the addon zip and the Stream Deck plugin package; the README explains install and how both parts work; release 0.2.0 on `main`.

**Architecture:** `tools/package.mjs` (root) exposes pure helpers for tests and, run as a script, builds and packs the plugin with the Elgato CLI and zips the addon with `fflate`.

**Tech Stack:** Node 24 ESM, `fflate` 0.8.2, `@elgato/cli` (`streamdeck pack`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-packaging-design.md`

## Global Constraints

- Output folder `dist/` at the repo root (already git-ignored).
- File names: `com.devilcable.herodeck.streamDeckPlugin`, `HeroDeck-addon-<toc version>.zip`.
- Version 0.2.0: `manifest.json` `"Version": "0.2.0.0"`, `HeroDeck.toc` `## Version: 0.2.0`.
- The zip has exactly one top-level folder `HeroDeck/`, forward-slash paths.
- README in French; code, commits in English.

## Review Focus

- A file listed in the `.toc` but missing from the zip → the addon fails to load in game: test every `.toc` entry is in the zip.
- Stray files (tests, editor files) in the addon folder → only the addon tree is zipped; `addon/tests` is outside `addon/HeroDeck`, nothing else to filter.
- Windows backslashes in zip paths → unzip on Windows creates `HeroDeck\Core\...` names: test no entry contains `\`.
- Versions drifting between manifest and `.toc` → test they match.
- `Media/Icon.tga` (binary) corrupted → test its bytes equal the source file.

---

### Task 1: Packaging script

**Files:**
- Create: `tools/package.mjs`, `tests/package.test.ts`
- Modify: `package.json` (script `package`, devDependency `fflate`), `streamdeck/com.devilcable.herodeck.sdPlugin/manifest.json`, `addon/HeroDeck/HeroDeck.toc`

**Interfaces:**
- Produces: `addonFiles(addonDir: string): Record<string, Uint8Array>` (keys `HeroDeck/<relative path>`), `addonZip(addonDir: string): Uint8Array`, `versions(): { toc: string, manifest: string }`.

- [ ] Write `tests/package.test.ts`: `versions().manifest === versions().toc + ".0"` and `toc === "0.2.0"`; `unzipSync(addonZip(dir))` keys all start with `HeroDeck/`, none contain `\`, contain `HeroDeck/HeroDeck.toc` and every file line of the `.toc` (`HeroDeck/Core/Init.lua` …), and `HeroDeck/Media/Icon.tga` equals the file bytes.
- [ ] Run `npx vitest run tests/package.test.ts` → FAIL (module missing).
- [ ] Implement `tools/package.mjs`; main (when `process.argv[1]` is this file): `npm run build` in `streamdeck/`, `npx streamdeck pack com.devilcable.herodeck.sdPlugin --force --no-update-check -o ../dist`, write the addon zip to `dist/`. Bump both versions.
- [ ] Run `npm test` → PASS; run `npm run package` → both files in `dist/`.
- [ ] Commit.

### Task 2: CI and README

**Files:**
- Modify: `.github/workflows/ci.yml` (after Validate: `npm run package` at root, `actions/upload-artifact@v4` of `dist/*`), `README.md`, `CLAUDE.md` (Commands: `npm run package`)

- [ ] Rewrite `README.md` (French): what HeroDeck is, requirements, install from the release (addon zip → `AddOns`, double-click plugin, drag the key), how the addon works, how the plugin works, limits, developer section (tests, build, link, package, probe), link to `docs/user/durability.md`.
- [ ] Update `docs/user/durability.md` Install section to point to the packages first.
- [ ] Commit, push, PR to develop, wait for green CI, merge; PR develop → main, merge; `gh release create v0.2.0` with both files from `dist/`.
