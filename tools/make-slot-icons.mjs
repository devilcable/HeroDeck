// Generates the Durability key images: one flat silhouette per equipment slot (plus the generic armor)
// in each of the 4 state palettes. Writes them under the plugin's imgs/actions/durability/ folder:
// <state>.svg (generic armor) and <slot>/<state>.svg. Run with `npm run slot-icons`.
// tests/slot-icons.test.ts checks the committed files match this script.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STATES = ["ok", "warn", "critical", "nodata"];

/** Same order as SLOT_KEYS in streamdeck/src/durability/slots.ts. */
export const SLOTS = [
  "head",
  "shoulders",
  "chest",
  "waist",
  "legs",
  "feet",
  "wrists",
  "hands",
  "mainhand",
  "offhand",
  "ranged",
];

/** Key background and drawing color of each state; detail lines are drawn in the background color. */
export const PALETTES = {
  ok: { bg: "#000000", fg: "#E8E8E8" },
  warn: { bg: "#F2C200", fg: "#1A1A1A" },
  critical: { bg: "#C8102E", fg: "#E8E8E8" },
  nodata: { bg: "#4A4A4A", fg: "#8A8A8A" },
};

// Shape helpers. FG / BG are replaced by the state's colors in svgFor().
const fill = (d) => `<path d="${d}" fill="FG"/>`;
const hole = (d) => `<path d="${d}" fill="BG"/>`;
const detail = (d, width = 3) =>
  `<path d="${d}" fill="none" stroke="BG" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const stroke = (d, width) =>
  `<path d="${d}" fill="none" stroke="FG" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const rect = (x, y, w, h, r = 0, color = "FG") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r ? ` rx="${r}"` : ""} fill="${color}"/>`;
const circle = (cx, cy, r, color = "FG") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;

// Every drawing stays in the top ~105 px of the 144 px key so the title below stays readable.
const ARMOR = [
  fill("M50 12 Q72 28 94 12 L124 24 L120 50 L104 58 L100 92 Q72 102 44 92 L40 58 L24 50 L20 24 Z"),
  detail("M72 28 V94 M44 62 H100"),
];

const GLYPHS = {
  armor: ARMOR,
  // Great helm: dome, eye slit, breathing line.
  head: [
    fill("M32 98 V56 Q32 14 72 14 Q112 14 112 56 V98 Q72 108 32 98 Z"),
    detail("M44 56 H100", 7),
    detail("M72 16 V44 M72 66 V96"),
  ],
  // Pauldrons joined by a collar, with a neck opening and layered plates on each side.
  shoulders: [
    fill("M6 92 Q4 32 50 26 Q58 44 72 44 Q86 44 94 26 Q140 32 138 92 Q120 78 100 80 L98 64 Q72 74 46 64 L44 80 Q24 78 6 92 Z"),
    detail("M14 62 Q28 46 46 44 M130 62 Q116 46 98 44"),
    detail("M10 80 Q26 64 44 64 M134 80 Q118 64 100 64"),
  ],
  chest: ARMOR,
  // Belt with a buckle and holes.
  waist: [
    rect(8, 44, 128, 28, 4),
    rect(48, 32, 44, 52, 6),
    rect(56, 40, 28, 36, 3, "BG"),
    stroke("M56 58 H86", 5),
    circle(108, 58, 4, "BG"),
    circle(122, 58, 4, "BG"),
  ],
  // Leggings: waistband and two legs with knee plates.
  legs: [
    fill("M32 6 H112 L110 22 H34 Z"),
    fill("M34 26 H70 L64 108 H46 Z"),
    fill("M74 26 H110 L98 108 H80 Z"),
    detail("M38 58 Q53 70 68 58 M76 58 Q91 70 106 58"),
    detail("M44 84 H66 M78 84 H100"),
  ],
  // One boot seen from the side.
  feet: [
    fill("M38 10 H82 V66 L116 76 Q128 80 128 92 V100 H38 Z"),
    detail("M38 28 H82"),
    detail("M40 90 H126", 4),
  ],
  // Bracer: wide at the elbow, narrow at the wrist, laced down the middle.
  wrists: [
    fill("M26 14 Q72 6 118 14 L102 104 Q72 110 42 104 Z"),
    detail("M62 24 L82 40 L62 56 L82 72 L62 88 M82 24 L62 40 L82 56 L62 72 L82 88"),
  ],
  // Gauntlet: cuff, palm, four fingers, thumb.
  hands: [
    rect(36, 80, 64, 22, 3),
    rect(38, 44, 58, 38, 4),
    rect(38, 18, 12, 32, 6),
    rect(54, 10, 12, 40, 6),
    rect(70, 12, 12, 38, 6),
    rect(86, 22, 10, 30, 5),
    fill("M92 60 L112 40 Q122 42 120 52 L100 76 Z"),
    detail("M40 48 H94"),
    detail("M36 80 H100"),
  ],
  // Sword, point up.
  mainhand: [
    fill("M72 4 L86 20 V68 H58 V20 Z"),
    rect(36, 68, 72, 11, 4),
    rect(65, 79, 14, 18, 2),
    circle(72, 102, 8),
    detail("M72 22 V62"),
  ],
  // Heater shield with a cross.
  offhand: [
    fill("M72 8 L120 20 V52 Q120 88 72 106 Q24 88 24 52 V20 Z"),
    detail("M72 16 V98 M30 48 H114"),
  ],
  // Bow with its string and an arrow.
  ranged: [
    stroke("M48 10 Q120 56 48 102", 9),
    stroke("M48 10 V102", 3),
    stroke("M24 56 H104", 4),
    fill("M102 48 L120 56 L102 64 Z"),
    stroke("M24 56 L16 48 M24 56 L16 64 M32 56 L24 48 M32 56 L24 64", 3),
  ],
};

/** Full SVG text of `glyph` ("armor" or a slot) in the colors of `state`. */
export function svgFor(glyph, state) {
  const { bg, fg } = PALETTES[state];
  const shapes = GLYPHS[glyph].map((shape) => `  ${shape.replaceAll("FG", fg).replaceAll("BG", bg)}\n`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">\n` +
    `  <rect width="144" height="144" fill="${bg}"/>\n` +
    shapes +
    `</svg>\n`
  );
}

/** Every image file, with its path relative to imgs/actions/durability/. */
export function iconFiles() {
  const files = STATES.map((state) => ({ path: `${state}.svg`, svg: svgFor("armor", state) }));
  for (const slot of SLOTS) {
    for (const state of STATES) files.push({ path: `${slot}/${state}.svg`, svg: svgFor(slot, state) });
  }
  return files;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "streamdeck", "com.devilcable.herodeck.sdPlugin", "imgs", "actions", "durability");
  for (const { path, svg } of iconFiles()) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, svg);
  }
  console.log(`wrote ${iconFiles().length} images to ${dir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
