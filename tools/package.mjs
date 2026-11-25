// Builds the two install packages into dist/:
//   com.devilcable.herodeck.streamDeckPlugin  (Stream Deck plugin, double-click to install)
//   HeroDeck-addon-<version>.zip              (WoW addon, unzip into Interface\AddOns)
// Usage: npm run package (repo root)

import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADDON = join(ROOT, "addon", "HeroDeck");
const STREAMDECK = join(ROOT, "streamdeck");
const PLUGIN = "com.devilcable.herodeck.sdPlugin";
const DIST = join(ROOT, "dist");

/** Versions written in the addon .toc and the plugin manifest. */
export function versions() {
  const toc = readFileSync(join(ADDON, "HeroDeck.toc"), "utf8").match(/^## Version:\s*(\S+)/m)?.[1];
  const manifest = JSON.parse(readFileSync(join(STREAMDECK, PLUGIN, "manifest.json"), "utf8")).Version;
  return { toc, manifest };
}

/** Every file of the addon folder, keyed by its path in the zip (`HeroDeck/...`, forward slashes). */
export function addonFiles(addonDir) {
  const files = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, name);
      else if (entry.isFile()) files[name] = new Uint8Array(readFileSync(path));
    }
  };
  walk(addonDir, "HeroDeck");
  return files;
}

/** The addon zip: one top-level HeroDeck/ folder, ready to unzip into Interface\AddOns. */
export function addonZip(addonDir) {
  return zipSync(addonFiles(addonDir), { level: 9, mtime: new Date("2026-01-01T00:00:00Z") });
}

function main() {
  const { toc, manifest } = versions();
  if (manifest !== `${toc}.0`) throw new Error(`Version mismatch: .toc ${toc}, manifest ${manifest}`);

  mkdirSync(DIST, { recursive: true });
  const run = (cmd) => execSync(cmd, { cwd: STREAMDECK, stdio: "inherit" });
  run("npm run build");
  run(`npx streamdeck pack ${PLUGIN} --force --no-update-check -o "${DIST}"`);

  const zipName = `HeroDeck-addon-${toc}.zip`;
  writeFileSync(join(DIST, zipName), addonZip(ADDON));
  console.log(`\nPackages in dist/:\n  ${PLUGIN.replace(".sdPlugin", ".streamDeckPlugin")}\n  ${zipName}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
