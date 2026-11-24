local _, ns = ...

-- Slots module: rotates the durability of each equipped slot through channel fields 1-4.
-- Field 1 = page (0..3); fields 2-4 = the durability byte of the page's three slots.
-- One page per second, so the plugin sees every slot every 4 s.

local Slots = {}

-- Inventory slot ids per page (index = page + 1). Page 3 has only two slots: its third
-- entry is nil and reads as UNUSED.
Slots.PAGES = {
  { 1, 3, 5 }, -- Head, Shoulders, Chest
  { 6, 7, 8 }, -- Waist, Legs, Feet
  { 9, 10, 16 }, -- Wrists, Hands, Main hand
  { 17, 18 }, -- Off hand, Ranged
}

Slots.NO_DURABILITY = 253 -- item equipped but without durability
Slots.EMPTY = 254 -- slot empty
Slots.UNUSED = 255 -- no slot at this position of the page

Slots.PAGE_FIELD = 1
Slots.FIRST_SLOT_FIELD = 2

local SLOTS_PER_PAGE = 3
local PAGE_COUNT = #Slots.PAGES
local TICK_SECONDS = 1

-- itemAt(slot) -> item id | nil (GetInventoryItemID("player", slot)).
-- readSlot(slot) -> current, max | nil (GetInventoryItemDurability).
-- Returns the byte for the slot: 0..100 percent (rounded down), EMPTY or NO_DURABILITY.
function Slots.Value(slot, itemAt, readSlot)
  if not itemAt(slot) then
    return Slots.EMPTY
  end
  local current, max = readSlot(slot)
  if not current or not max or max <= 0 then
    return Slots.NO_DURABILITY
  end
  -- Multiply first: current * 100 is an exact integer, so 58 / 100 gives 58, not 57.99...
  return math.floor(current * 100 / max)
end

-- page (0..3) -> bytes of the page's three slots (UNUSED where the page has no slot).
function Slots.PageBytes(page, itemAt, readSlot)
  local slots = Slots.PAGES[page + 1]
  local bytes = {}
  for position = 1, SLOTS_PER_PAGE do
    local slot = slots[position]
    bytes[position] = slot and Slots.Value(slot, itemAt, readSlot) or Slots.UNUSED
  end
  return bytes[1], bytes[2], bytes[3]
end

local function itemAt(slot)
  return GetInventoryItemID("player", slot)
end

-- Draw the page number and its three slot values with the real API.
function Slots:ShowPage(page)
  ns.Channel:SetByte(self.PAGE_FIELD, page)
  local bytes = { self.PageBytes(page, itemAt, GetInventoryItemDurability) }
  for position = 1, SLOTS_PER_PAGE do
    ns.Channel:SetByte(self.FIRST_SLOT_FIELD + position - 1, bytes[position])
  end
end

-- Next page to show (0..3) and the ticker handle (nil until Start).
Slots.page = 0
Slots.ticker = nil

-- Claim fields 1-4 and show one page per second (first page on the first tick).
-- Does nothing when already started.
function Slots:Start()
  if self.ticker then
    return
  end
  for field = self.PAGE_FIELD, self.FIRST_SLOT_FIELD + SLOTS_PER_PAGE - 1 do
    ns.Channel:Register(field)
  end
  self.ticker = C_Timer.NewTicker(TICK_SECONDS, function()
    self:ShowPage(self.page)
    self.page = (self.page + 1) % PAGE_COUNT
  end)
end

ns.Slots = Slots
