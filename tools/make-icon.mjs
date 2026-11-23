// Generates the HeroDeck addon icon: a round 64x64 image of a dark mini Stream Deck
// (5x3 keys). Writes the TGA for the addon list and a PNG for the user docs.
// Run with `npm run icon`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const SIZE = 64;
const CENTER = 32;
const RADIUS = 31;
const SAMPLES = 4; // anti-aliasing: SAMPLES x SAMPLES subsamples on the circle edge only

const BACKGROUND = [18, 18, 22];
const BODY = [36, 36, 42];
const IDLE_KEY = [70, 70, 78];
const KEY_COLORS = [
  [255, 255, 255],
  [20, 20, 20],
  [255, 0, 255],
  [0, 0, 170],
  [85, 85, 85],
  [255, 170, 0],
];

const BODY_W = 46;
const BODY_H = 30;
const BODY_RADIUS = 4;
const KEY_SIZE = 7;
const KEY_GAP = 2;
const COLS = 5;
const ROWS = 3;
// The 43x25 key grid cannot be centered exactly on the 46x30 body (1.5 and 2.5 px
// margins), so it is rounded down to whole pixels: (10, 19).
const GRID_W = COLS * KEY_SIZE + (COLS - 1) * KEY_GAP;
const GRID_H = ROWS * KEY_SIZE + (ROWS - 1) * KEY_GAP;
const BODY_X = (SIZE - BODY_W) / 2;
const BODY_Y = (SIZE - BODY_H) / 2;
const GRID_X = BODY_X + Math.floor((BODY_W - GRID_W) / 2);
const GRID_Y = BODY_Y + Math.floor((BODY_H - GRID_H) / 2);

/** True when the pixel (x, y) lies in the rounded rectangle; keys use radius 1. */
function inRoundedRect(x, y, left, top, width, height, radius) {
  const px = x + 0.5;
  const py = y + 0.5;
  if (px < left || px > left + width || py < top || py > top + height) return false;
  const cx = px < left + radius ? left + radius : px > left + width - radius ? left + width - radius : px;
  const cy = py < top + radius ? top + radius : py > top + height - radius ? top + height - radius : py;
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

/** Fraction (0..1) of the pixel covered by the circle, by regular subsampling. */
function circleCoverage(x, y) {
  let inside = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const dx = x + (sx + 0.5) / SAMPLES - CENTER;
      const dy = y + (sy + 0.5) / SAMPLES - CENTER;
      if (dx * dx + dy * dy <= RADIUS * RADIUS) inside++;
    }
  }
  return inside / (SAMPLES * SAMPLES);
}

function keyColor(index) {
  return index < KEY_COLORS.length ? KEY_COLORS[index] : IDLE_KEY;
}

function colorAt(x, y) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const left = GRID_X + col * (KEY_SIZE + KEY_GAP);
      const top = GRID_Y + row * (KEY_SIZE + KEY_GAP);
      if (inRoundedRect(x, y, left, top, KEY_SIZE, KEY_SIZE, 1)) return keyColor(row * COLS + col);
    }
  }
  if (inRoundedRect(x, y, BODY_X, BODY_Y, BODY_W, BODY_H, BODY_RADIUS)) return BODY;
  return BACKGROUND;
}

/** Draws the icon. Returns tightly packed top-to-bottom RGBA rows. */
export function drawIcon() {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const coverage = circleCoverage(x, y);
      if (coverage === 0) continue;
      const [r, g, b] = colorAt(x, y);
      const i = (y * SIZE + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(coverage * 255);
    }
  }
  return { width: SIZE, height: SIZE, rgba };
}

/**
 * Encodes an uncompressed true-color 32-bit TGA: 18-byte header (no id, no color map),
 * descriptor 0x08 (8 alpha bits, origin bottom-left), BGRA pixels, rows bottom-to-top.
 */
export function toTga({ width, height, rgba }) {
  const out = new Uint8Array(18 + width * height * 4);
  out[2] = 2;
  out[12] = width & 0xff;
  out[13] = width >> 8;
  out[14] = height & 0xff;
  out[15] = height >> 8;
  out[16] = 32;
  out[17] = 0x08;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = 18 + ((height - 1 - y) * width + x) * 4;
      out[dst] = rgba[src + 2];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return out;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const icon = drawIcon();
  const tgaPath = join(root, "addon", "HeroDeck", "Media", "Icon.tga");
  const pngPath = join(root, "docs", "user", "img", "icon.png");
  mkdirSync(dirname(tgaPath), { recursive: true });
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(tgaPath, toTga(icon));
  const png = new PNG({ width: icon.width, height: icon.height });
  png.data = Buffer.from(icon.rgba);
  writeFileSync(pngPath, PNG.sync.write(png));
  console.log(`wrote ${tgaPath}\nwrote ${pngPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
