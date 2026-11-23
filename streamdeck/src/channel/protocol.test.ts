import { describe, expect, it } from "vitest";
import { CELL_PITCH, GRID_CELLS, GRID_COLS, GRID_ROWS, IDLE, MAX_FIELDS, PROTOCOL_VERSION, cellOffset } from "./protocol";

describe("protocol v2 constants", () => {
  it("declares version 2, five fields and a 5x3 grid", () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(MAX_FIELDS).toBe(5);
    expect([GRID_COLS, GRID_ROWS, GRID_CELLS, CELL_PITCH]).toEqual([5, 3, 15, 5]);
    expect(IDLE).toEqual({ r: 48, g: 48, b: 48 });
  });

  it("cellOffset maps 0→(0,0), 4→(20,0), 5→(0,5), 14→(20,10)", () => {
    expect(cellOffset(0)).toEqual({ dx: 0, dy: 0 });
    expect(cellOffset(4)).toEqual({ dx: 20, dy: 0 });
    expect(cellOffset(5)).toEqual({ dx: 0, dy: 5 });
    expect(cellOffset(14)).toEqual({ dx: 20, dy: 10 });
  });
});
