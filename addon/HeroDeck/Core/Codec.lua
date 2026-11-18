local _, ns = ...

-- Channel protocol v1: pure encoding (no frames).
-- A cell is 6 bits drawn as one RGB color, 2 bits per channel (R high, G middle, B low).
-- A field is one byte spread over 2 cells; see the design spec.

local floor = math.floor

local Codec = {}

Codec.LEVELS = { 0, 85, 170, 255 }
Codec.VERSION = 1

-- 4-bit XOR using arithmetic only (no bit library, no operators): runs on Lua 5.1 and 5.4.
function Codec.Xor4(a, b)
  local result, weight = 0, 1
  for _ = 1, 4 do
    if (a % 2) ~= (b % 2) then
      result = result + weight
    end
    a = floor(a / 2)
    b = floor(b / 2)
    weight = weight * 2
  end
  return result
end

-- value6 (0..63) -> r, g, b bytes.
function Codec.CellColor(value6)
  local levels = Codec.LEVELS
  return levels[floor(value6 / 16) + 1], levels[floor(value6 / 4) % 4 + 1], levels[value6 % 4 + 1]
end

local function cell(value6)
  local r, g, b = Codec.CellColor(value6)
  return { r = r, g = g, b = b }
end

-- Header: white, black, magenta, version.
function Codec.HeaderCells()
  return {
    { r = 255, g = 255, b = 255 },
    { r = 0, g = 0, b = 0 },
    { r = 255, g = 0, b = 255 },
    cell(Codec.VERSION),
  }
end

-- byte (integer 0..255) -> { cellA, cellB }.
-- cell A = b7..b2; cell B = b1 b0 c3..c0 with c = high nibble XOR low nibble XOR 0xA.
function Codec.EncodeByte(byte)
  if type(byte) ~= "number" or byte % 1 ~= 0 or byte < 0 or byte > 255 then
    error("Codec.EncodeByte: expected an integer 0..255, got " .. tostring(byte), 2)
  end
  local check = Codec.Xor4(Codec.Xor4(floor(byte / 16), byte % 16), 10)
  return { cell(floor(byte / 4)), cell((byte % 4) * 16 + check) }
end

ns.Codec = Codec
