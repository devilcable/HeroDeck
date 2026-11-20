local _, ns = ...

-- Channel grid: draws the protocol v2 cells as a 5 x 3 grid on a host frame (the minimap button).
-- Each cell is one texture, CELL_PX x CELL_PX physical pixels, PITCH px apart (1 px gap).
-- Cell indexes (0-based, row-major): 0..3 header, field n = 4 + 2n and 5 + 2n, last cell unused.

local Channel = {}

Channel.CELL_PX = 4
Channel.PITCH = 5
Channel.COLS = 5
Channel.ROWS = 3
Channel.CELLS = Channel.COLS * Channel.ROWS

local UI_HEIGHT = 768 -- UI units of a full-height screen at UI scale 1 (ignoring parent scale)
local HEADER_CELLS = 4
local BODY_MARGIN = 2 -- px of body around the grid, on every side
local BODY_COLOR = { r = 24, g = 24, b = 28 }

-- Grid size in physical px: cells span (COLS - 1) pitches plus one cell; same for rows.
local GRID_W = (Channel.COLS - 1) * Channel.PITCH + Channel.CELL_PX
local GRID_H = (Channel.ROWS - 1) * Channel.PITCH + Channel.CELL_PX

local Codec = ns.Codec

-- Number of fields the grid holds (2 cells each, after the header).
Channel.FIELDS = math.floor((Channel.CELLS - HEADER_CELLS) / 2)

-- Grid frame (child of the host), host, body texture, textures by cell index, registered fields.
Channel.frame = nil
Channel.host = nil
Channel.body = nil
Channel.cells = {}
Channel.fields = {}

-- Offset in physical px of cell `i` from the grid's top-left corner.
function Channel.CellOffset(i)
  return (i % Channel.COLS) * Channel.PITCH, math.floor(i / Channel.COLS) * Channel.PITCH
end

-- Pure: host center in physical px (fractional, y up) -> grid top-left in whole physical px.
function Channel.SnapOrigin(centerX, centerY)
  return math.floor(centerX - GRID_W / 2 + 0.5), math.floor(centerY + GRID_H / 2 + 0.5)
end

local function setColor(texture, cell)
  texture:SetColorTexture(cell.r / 255, cell.g / 255, cell.b / 255, 1)
end

local function disableSnapping(texture)
  if texture.SetSnapToPixelGrid then
    texture:SetSnapToPixelGrid(false)
  end
  if texture.SetTexelSnappingBias then
    texture:SetTexelSnappingBias(0)
  end
end

-- Recompute size and position of the grid, the body and every cell from the host's position.
-- Does nothing when the screen size or the host position is not available.
function Channel:Layout()
  local host = self.host
  if not self.frame or not host then
    return
  end
  local _, height = GetPhysicalScreenSize()
  if type(height) ~= "number" or height <= 0 then
    return
  end
  local centerX, centerY = host:GetCenter()
  if type(centerX) ~= "number" or type(centerY) ~= "number" then
    return
  end
  local unit = UI_HEIGHT / height
  -- GetCenter is in the host's own units: scale to effective scale 1, then to physical px.
  local factor = host:GetEffectiveScale() / unit
  local left, top = self.SnapOrigin(centerX * factor, centerY * factor)

  local frame = self.frame
  frame:ClearAllPoints()
  frame:SetSize(GRID_W * unit, GRID_H * unit)
  frame:SetPoint("TOPLEFT", WorldFrame, "BOTTOMLEFT", left * unit, top * unit)

  local body = self.body
  body:ClearAllPoints()
  body:SetSize((GRID_W + 2 * BODY_MARGIN) * unit, (GRID_H + 2 * BODY_MARGIN) * unit)
  body:SetPoint("TOPLEFT", frame, "TOPLEFT", -BODY_MARGIN * unit, BODY_MARGIN * unit)

  local size = self.CELL_PX * unit
  for cellIndex, texture in pairs(self.cells) do
    local dx, dy = self.CellOffset(cellIndex)
    texture:ClearAllPoints()
    texture:SetSize(size, size)
    texture:SetPoint("TOPLEFT", frame, "TOPLEFT", dx * unit, -dy * unit)
  end
end

local function createCell(self, cellIndex, cell)
  local texture = self.frame:CreateTexture(nil, "OVERLAY")
  disableSnapping(texture)
  setColor(texture, cell)
  self.cells[cellIndex] = texture
end

-- Create the grid frame once as a child of `host`, draw the body and all cells, and place them.
function Channel:Init(host)
  if self.frame then
    return
  end
  local frame = CreateFrame("Frame", nil, host)
  frame:SetIgnoreParentScale(true)
  frame:SetScale(1)
  frame:SetFrameStrata("HIGH")
  frame:SetFrameLevel(host:GetFrameLevel() + 5)
  frame:RegisterEvent("DISPLAY_SIZE_CHANGED")
  frame:RegisterEvent("UI_SCALE_CHANGED")
  frame:SetScript("OnEvent", function()
    Channel:Layout()
  end)
  self.frame = frame
  self.host = host

  local body = frame:CreateTexture(nil, "BACKGROUND")
  disableSnapping(body)
  setColor(body, BODY_COLOR)
  self.body = body

  local header = Codec.HeaderCells()
  for cellIndex = 0, self.CELLS - 1 do
    createCell(self, cellIndex, header[cellIndex + 1] or Codec.IDLE)
  end
  self:Layout()
end

-- Claim a field index. Errors if it is out of range or already taken.
function Channel:Register(fieldIndex)
  if type(fieldIndex) ~= "number" or fieldIndex < 0 or fieldIndex % 1 ~= 0 or fieldIndex >= self.FIELDS then
    error(
      "Channel:Register: expected a field index 0.." .. (self.FIELDS - 1) .. ", got " .. tostring(fieldIndex),
      2
    )
  end
  if self.fields[fieldIndex] then
    error("Channel:Register: field " .. fieldIndex .. " already registered", 2)
  end
  self.fields[fieldIndex] = true
  return true
end

-- Draw `byte` (integer 0..255) in the field's two cells.
function Channel:SetByte(fieldIndex, byte)
  if not self.fields[fieldIndex] then
    error("Channel:SetByte: field " .. tostring(fieldIndex) .. " not registered", 2)
  end
  if not self.frame then
    error("Channel:SetByte: Channel:Init() was not called", 2)
  end
  local cells = Codec.EncodeByte(byte)
  for i = 1, 2 do
    setColor(self.cells[HEADER_CELLS + 2 * fieldIndex + (i - 1)], cells[i])
  end
end

ns.Channel = Channel
