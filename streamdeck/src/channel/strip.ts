import { decodeStrip } from "./decode";
import { findStripCandidates, readCells } from "./locate";
import { HEADER_CELLS, MAX_FIELDS, type RawImage } from "./protocol";

/**
 * Locate and decode the grid in a capture. Every candidate is tried in order and the first that
 * decodes wins: a false candidate before the real grid must not hide it. `origin` is the pixel
 * inside cell 0 that the grid was read from.
 */
export function readStrip(
  img: RawImage,
): { version: number; fields: (number | null)[]; origin: { x: number; y: number } } | null {
  for (const origin of findStripCandidates(img)) {
    const strip = decodeStrip(readCells(img, origin, HEADER_CELLS + 2 * MAX_FIELDS));
    if (strip) return { ...strip, origin };
  }
  return null;
}
