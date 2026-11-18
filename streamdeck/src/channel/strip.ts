import { decodeStrip } from "./decode";
import { findStripCandidates, readCells } from "./locate";
import { HEADER_CELLS, MAX_FIELDS, type RawImage } from "./protocol";

/**
 * Locate and decode the strip in a capture. Every candidate is tried in order and the first that
 * decodes wins: a false candidate before the real strip must not hide it.
 */
export function readStrip(img: RawImage): { version: number; fields: (number | null)[] } | null {
  for (const candidate of findStripCandidates(img)) {
    const strip = decodeStrip(readCells(img, candidate, HEADER_CELLS + 2 * MAX_FIELDS));
    if (strip) return strip;
  }
  return null;
}
