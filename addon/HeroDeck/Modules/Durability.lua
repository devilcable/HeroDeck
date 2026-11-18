local _, ns = ...

-- Durability module: publishes the durability percent of the most damaged equipped
-- item (integer, rounded down; 100 when no slot has durability) in channel field 0.

local Durability = {}

Durability.FIELD = 0

local FIRST_SLOT = 1
local LAST_SLOT = 19

-- readSlot(slot) -> current, max | nil (same contract as GetInventoryItemDurability).
function Durability.Compute(readSlot)
  local lowest = 100
  for slot = FIRST_SLOT, LAST_SLOT do
    local current, max = readSlot(slot)
    if current and max and max > 0 then
      -- Multiply first: current * 100 is an exact integer, so 58 / 100 gives 58, not 57.99...
      local percent = math.floor(current * 100 / max)
      if percent < lowest then
        lowest = percent
      end
    end
  end
  return lowest
end

function Durability:Update()
  ns.Channel:SetByte(self.FIELD, self.Compute(GetInventoryItemDurability))
end

-- Set once PLAYER_LOGIN has initialized the channel and claimed the field.
local ready = false

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("UPDATE_INVENTORY_DURABILITY")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
frame:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_LOGIN" then
    ns.Channel:Init()
    ns.Channel:Register(Durability.FIELD)
    ready = true
  end
  if ready then
    Durability:Update()
  end
end)

ns.Durability = Durability
