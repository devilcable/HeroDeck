local _, ns = ...

-- Minimap button: a round HeroDeck button the user drags along the minimap's edge.
-- It is the host of the channel grid (the grid is drawn on top of it and follows it).
-- The angle (degrees, 0 = right, 90 = up) is saved in HeroDeckDB.minimap.angle.

local MinimapButton = {}

MinimapButton.DEFAULT_ANGLE = 225
MinimapButton.OFFSET = 10 -- UI units between the minimap edge and the button center

local SIZE = 31
local FOLLOW_INTERVAL = 0.25 -- s between checks that the button moved without our drag
local BACKGROUND_TEXTURE = "Interface\\Minimap\\UI-Minimap-Background"
local BORDER_TEXTURE = "Interface\\Minimap\\MiniMap-TrackingBorder"

MinimapButton.frame = nil

-- Current angle, whether the button is being dragged, and the center the grid was laid out for.
local angle = MinimapButton.DEFAULT_ANGLE
local dragging = false
local sinceCheck = 0
local laidX, laidY

-- math.atan2 exists on Lua 5.1 only; on 5.4 math.atan takes two arguments.
local function atan2(y, x)
  if math.atan2 then
    return math.atan2(y, x)
  end
  return math.atan(y, x)
end

-- Pure: offset from the minimap center for an angle in degrees and a radius.
function MinimapButton.PositionFor(angleDeg, radius)
  local rad = math.rad(angleDeg)
  return math.cos(rad) * radius, math.sin(rad) * radius
end

-- Pure: angle in degrees, in [0, 360), of the point (px, py) seen from the center (cx, cy).
function MinimapButton.AngleFrom(cx, cy, px, py)
  local deg = math.deg(atan2(py - cy, px - cx))
  if deg < 0 then
    deg = deg + 360
  end
  if deg >= 360 then
    deg = deg - 360
  end
  return deg
end

local function isFiniteNumber(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

-- HeroDeckDB.minimap, created when missing or not a table.
local function savedTable()
  if type(HeroDeckDB) ~= "table" then
    HeroDeckDB = {}
  end
  if type(HeroDeckDB.minimap) ~= "table" then
    HeroDeckDB.minimap = {}
  end
  return HeroDeckDB.minimap
end

-- Saved angle; a missing, non-number or non-finite value becomes (and is saved as) the default.
function MinimapButton.SavedAngle()
  local saved = savedTable()
  if not isFiniteNumber(saved.angle) then
    saved.angle = MinimapButton.DEFAULT_ANGLE
  end
  return saved.angle
end

local function saveAngle()
  savedTable().angle = angle
end

-- Pure: the two tooltip lines. `percent` is nil before the first durability update.
function MinimapButton.TooltipLines(percent, locale)
  local number = percent == nil and "?" or string.format("%d", percent)
  if locale == "frFR" then
    return "HeroDeck", "Durabilité " .. number .. " %"
  end
  return "HeroDeck", "Durability " .. number .. "%"
end

-- Lay the grid out again and remember the button center (in effective-scale-1 units) it was done for.
local function relayout(self)
  ns.Channel:Layout()
  local x, y = self.frame:GetCenter()
  if type(x) == "number" and type(y) == "number" then
    local scale = self.frame:GetEffectiveScale()
    laidX, laidY = x * scale, y * scale
  else
    laidX, laidY = nil, nil
  end
end

-- Put the button on the minimap edge at `angleDeg`, then re-snap the grid to it.
function MinimapButton:Place(angleDeg)
  angle = angleDeg
  local frame = self.frame
  if not frame then
    return
  end
  frame:ClearAllPoints()
  frame:SetPoint("CENTER", Minimap, "CENTER", self.PositionFor(angleDeg, Minimap:GetWidth() / 2 + self.OFFSET))
  relayout(self)
end

function MinimapButton:Reset()
  self:Place(self.DEFAULT_ANGLE)
  saveAngle()
end

-- During a drag: follow the cursor. Otherwise, every FOLLOW_INTERVAL: re-snap the grid if the
-- button moved for another reason (for example Edit Mode moving the minimap).
local function onUpdate(self, elapsed)
  if dragging then
    local cx, cy = Minimap:GetCenter()
    if type(cx) ~= "number" or type(cy) ~= "number" then
      return
    end
    local scale = Minimap:GetEffectiveScale()
    local cursorX, cursorY = GetCursorPosition()
    MinimapButton:Place(MinimapButton.AngleFrom(cx, cy, cursorX / scale, cursorY / scale))
    return
  end
  sinceCheck = sinceCheck + elapsed
  if sinceCheck < FOLLOW_INTERVAL then
    return
  end
  sinceCheck = 0
  local x, y = self:GetCenter()
  local scale = self:GetEffectiveScale()
  if type(x) == "number" and type(y) == "number" then
    x, y = x * scale, y * scale
  else
    x, y = nil, nil
  end
  if x ~= laidX or y ~= laidY then
    relayout(MinimapButton)
  end
end

-- End a drag: stop following the cursor and save the angle. A no-op when no drag is running.
local function endDrag()
  if not dragging then
    return
  end
  dragging = false
  saveAngle()
end

local function onEnter(self)
  -- Open toward the minimap side, away from the screen edge, so the tooltip stays on screen.
  local degrees = angle % 360
  local onRightHalf = degrees < 90 or degrees > 270
  GameTooltip:SetOwner(self, onRightHalf and "ANCHOR_LEFT" or "ANCHOR_RIGHT")
  local line1, line2 = MinimapButton.TooltipLines(ns.Durability and ns.Durability.last, GetLocale())
  GameTooltip:AddLine(line1)
  GameTooltip:AddLine(line2)
  GameTooltip:Show()
end

-- Create the button once: art, drag, tooltip. It is not placed until Place() is called.
function MinimapButton:Init()
  if self.frame then
    return
  end
  local button = CreateFrame("Button", "HeroDeckMinimapButton", Minimap)
  button:SetSize(SIZE, SIZE)
  button:SetFrameStrata("HIGH")
  button:SetFrameLevel(Minimap:GetFrameLevel() + 8)

  local background = button:CreateTexture(nil, "BACKGROUND")
  background:SetTexture(BACKGROUND_TEXTURE)
  background:SetSize(20, 20)
  background:SetPoint("CENTER", button, "CENTER", 0, 0)

  local border = button:CreateTexture(nil, "OVERLAY")
  border:SetTexture(BORDER_TEXTURE)
  border:SetSize(53, 53)
  border:SetPoint("TOPLEFT", button, "TOPLEFT", 0, 0)

  button:RegisterForDrag("LeftButton")
  button:SetScript("OnDragStart", function()
    dragging = true
    GameTooltip:Hide()
  end)
  button:SetScript("OnDragStop", endDrag)
  -- OnDragStop does not fire when the button is hidden mid-drag or the mouse is released elsewhere:
  -- end the drag here too, or the button would follow the cursor forever.
  button:SetScript("OnHide", endDrag)
  button:SetScript("OnMouseUp", endDrag)
  button:SetScript("OnUpdate", onUpdate)
  button:SetScript("OnEnter", onEnter)
  button:SetScript("OnLeave", function()
    GameTooltip:Hide()
  end)
  -- Positions are resolved by the time the world is entered: re-snap the grid then.
  button:RegisterEvent("PLAYER_ENTERING_WORLD")
  button:SetScript("OnEvent", function()
    relayout(MinimapButton)
  end)
  self.frame = button
end

SLASH_HERODECK1 = "/herodeck"
SlashCmdList.HERODECK = function(msg)
  local command = string.lower(string.match(msg or "", "^%s*(%S*)"))
  if command == "reset" then
    MinimapButton:Reset()
  else
    print("HeroDeck: /herodeck reset")
  end
end

ns.MinimapButton = MinimapButton
