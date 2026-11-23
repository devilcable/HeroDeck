import { HEADER_CELLS, LEVELS, MIN_CONTRAST, PROTOCOL_VERSION, TOLERANCE, type RGB } from "./protocol";

const WHITE_VALUE = 63; // levels 3,3,3
const BLACK_VALUE = 0;
const MARKER_VALUE = 51; // magenta: levels 3,0,3

/** Normalize one channel with its own white/black references, then snap to a level index. */
function snapChannel(v: number, white: number, black: number): number | null {
  const normalized = ((v - black) / (white - black)) * 255;
  let best = 0;
  for (let i = 1; i < LEVELS.length; i++) {
    if (Math.abs(normalized - LEVELS[i]) < Math.abs(normalized - LEVELS[best])) best = i;
  }
  return Math.abs(normalized - LEVELS[best]) > TOLERANCE ? null : best;
}

/** Decode one cell to its 6-bit value (R high 2 bits, G middle 2, B low 2), or null if ambiguous. */
export function decodeCell(c: RGB, white: RGB, black: RGB): number | null {
  const r = snapChannel(c.r, white.r, black.r);
  const g = snapChannel(c.g, white.g, black.g);
  const b = snapChannel(c.b, white.b, black.b);
  if (r === null || g === null || b === null) return null;
  return r * 16 + g * 4 + b;
}

/** Decode a two-cell field to a byte, or null if a cell is unreadable or the check bits mismatch. */
export function decodeField(a: RGB, b: RGB, white: RGB, black: RGB): number | null {
  const va = decodeCell(a, white, black);
  const vb = decodeCell(b, white, black);
  if (va === null || vb === null) return null;
  const byte = (va << 2) | (vb >> 4);
  const check = vb & 0xf;
  const expected = (byte >> 4) ^ (byte & 0xf) ^ 0xa;
  return check === expected ? byte : null;
}

/** Decode a whole strip (header cells first). Null when the header is not a valid v1 header. */
export function decodeStrip(cells: RGB[]): { version: number; fields: (number | null)[] } | null {
  if (cells.length < HEADER_CELLS) return null;
  const [white, black, marker, version] = cells;
  if (
    white.r - black.r < MIN_CONTRAST ||
    white.g - black.g < MIN_CONTRAST ||
    white.b - black.b < MIN_CONTRAST
  ) {
    return null;
  }
  if (decodeCell(white, white, black) !== WHITE_VALUE) return null;
  if (decodeCell(black, white, black) !== BLACK_VALUE) return null;
  if (decodeCell(marker, white, black) !== MARKER_VALUE) return null;
  const versionValue = decodeCell(version, white, black);
  if (versionValue !== PROTOCOL_VERSION) return null;

  const fields: (number | null)[] = [];
  const count = Math.floor((cells.length - HEADER_CELLS) / 2);
  for (let n = 0; n < count; n++) {
    fields.push(decodeField(cells[HEADER_CELLS + 2 * n], cells[HEADER_CELLS + 1 + 2 * n], white, black));
  }
  return { version: versionValue, fields };
}
