local _, ns = ...

-- Channel strip: draws the protocol v1 cells at the top-left of the game screen.
-- Each cell is one texture, CELL_PX x CELL_PX physical pixels, side by side.
-- Cell indexes (0-based): 0..3 header, field n = 4 + 2n and 5 + 2n.

local Channel = {}

Channel.CELL_PX = 3

local UI_HEIGHT = 768 -- UI units of a full-height screen at UI scale 1 (ignoring parent scale)
local HEADER_CELLS = 4

local Codec = ns.Codec

-- Frame, textures by cell index, and registered fields (set by Init / Register).
Channel.frame = nil
Channel.cells = {}
Channel.fields = {}

local function unitPerPixel()
  local _, height = GetPhysicalScreenSize()
  if type(height) ~= "number" or height <= 0 then
    return nil
  end
  return UI_HEIGHT / height
end

local function setColor(texture, cell)
  texture:SetColorTexture(cell.r / 255, cell.g / 255, cell.b / 255, 1)
end

local function placeTexture(self, texture, cellIndex, unit)
  local size = self.CELL_PX * unit
  texture:ClearAllPoints()
  texture:SetSize(size, size)
  texture:SetPoint("TOPLEFT", self.frame, "TOPLEFT", cellIndex * size, 0)
end

-- Size the strip frame to the cells drawn so far (highest cell index + 1, one cell high).
local function sizeFrame(self, unit)
  local count = 0
  for cellIndex in pairs(self.cells) do
    if cellIndex + 1 > count then
      count = cellIndex + 1
    end
  end
  local size = self.CELL_PX * unit
  self.frame:SetSize(count * size, size)
end

local function createCell(self, cellIndex, cell)
  local texture = self.frame:CreateTexture(nil, "OVERLAY")
  if texture.SetSnapToPixelGrid then
    texture:SetSnapToPixelGrid(false)
  end
  if texture.SetTexelSnappingBias then
    texture:SetTexelSnappingBias(0)
  end
  setColor(texture, cell)
  self.cells[cellIndex] = texture
  local unit = unitPerPixel()
  if unit then
    placeTexture(self, texture, cellIndex, unit)
    sizeFrame(self, unit)
  end
  return texture
end

-- Recompute size and position of every existing cell (screen size or UI scale changed).
function Channel:Layout()
  local unit = unitPerPixel()
  if not self.frame or not unit then
    return
  end
  for cellIndex, texture in pairs(self.cells) do
    placeTexture(self, texture, cellIndex, unit)
  end
  sizeFrame(self, unit)
end

-- Create the strip frame once and draw the header cells.
function Channel:Init()
  if self.frame then
    return
  end
  local frame = CreateFrame("Frame", nil, WorldFrame)
  frame:SetIgnoreParentScale(true)
  frame:SetScale(1)
  frame:SetFrameStrata("TOOLTIP")
  frame:SetFrameLevel(10000)
  frame:SetPoint("TOPLEFT", WorldFrame, "TOPLEFT", 0, 0)
  frame:RegisterEvent("DISPLAY_SIZE_CHANGED")
  frame:RegisterEvent("UI_SCALE_CHANGED")
  frame:SetScript("OnEvent", function()
    Channel:Layout()
  end)
  self.frame = frame

  local header = Codec.HeaderCells()
  for i = 1, HEADER_CELLS do
    createCell(self, i - 1, header[i])
  end
end

-- Claim a field index. Errors if it is already taken.
function Channel:Register(fieldIndex)
  if type(fieldIndex) ~= "number" or fieldIndex < 0 or fieldIndex % 1 ~= 0 then
    error("Channel:Register: expected a field index >= 0, got " .. tostring(fieldIndex), 2)
  end
  if self.fields[fieldIndex] then
    error("Channel:Register: field " .. fieldIndex .. " already registered", 2)
  end
  self.fields[fieldIndex] = true
  return true
end

-- Draw `byte` (integer 0..255) in the field's two cells; textures are created on first use.
function Channel:SetByte(fieldIndex, byte)
  if not self.fields[fieldIndex] then
    error("Channel:SetByte: field " .. tostring(fieldIndex) .. " not registered", 2)
  end
  if not self.frame then
    error("Channel:SetByte: Channel:Init() was not called", 2)
  end
  local cells = Codec.EncodeByte(byte)
  for i = 1, 2 do
    local cellIndex = HEADER_CELLS + 2 * fieldIndex + (i - 1)
    local texture = self.cells[cellIndex]
    if texture then
      setColor(texture, cells[i])
    else
      createCell(self, cellIndex, cells[i])
    end
  end
end

ns.Channel = Channel
