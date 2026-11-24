# Durability key

The **Durability** key shows how worn your gear is in World of Warcraft Forever, live, on your Stream Deck.
It needs two parts: the **HeroDeck addon** in the game and the **HeroDeck plugin** in the Stream Deck app.

## What the key shows

![](../../streamdeck/com.devilcable.herodeck.sdPlugin/imgs/actions/durability/ok.svg)

- A small armor icon whose **background color** tells you when to repair.
- The **percentage** below the icon (you can hide it, see [Options](#options)).

The value is the durability of your **most damaged equipped item**, not the average: if your weapon is at
10 % and everything else at 100 %, the key shows 10 %. The percentage is rounded down (29.6 % shows 29 %).
With no item that has durability (nothing equipped), the key shows 100 %.

| Durability | Background |
|---|---|
| 50 % – 100 % | black |
| 20 % – 49 % | yellow |
| 0 % – 19 % | red |
| no data | grey, `--` |

The key updates about once a second after your gear changes (damage, repair, equip, unequip).

### One specific item

A key can show **one equipped item** instead of the most damaged one: pick it in the key's **Item** setting
(see [Options](#options)). The key then shows the item's short name on the first line and its durability
below, with the same colors:

| Setting | Name on the key (EN / FR) |
|---|---|
| Head | Head / Tête |
| Shoulders | Shoulders / Épaules |
| Chest | Chest / Torse |
| Waist | Waist / Taille |
| Legs | Legs / Jambes |
| Feet | Feet / Pieds |
| Wrists | Wrists / Poignets |
| Hands | Hands / Mains |
| Main hand | Main hand / Arme |
| Off hand | Off hand / Main G. |
| Ranged | Ranged / Distance |

- **`empty`** (`vide`): nothing is equipped in that slot (e.g. the off hand with a two-handed weapon).
- **`n/a`** (`sans`): the item there has no durability (e.g. an item held in the off hand).
- **`--`**: no data yet. The addon sends the items in turn, three at a time, one group per second, so a
  specific-item key needs **up to about 4 seconds** to show its value when it first appears, and follows a
  change (damage, repair) within about 4 seconds. The "most damaged" key is not delayed.

## Install

Requirements: Windows 10/11, Stream Deck app 7.1 or newer, WoW Forever in **windowed** or **windowed
(fullscreen)** mode.

### 1. The addon

Copy the `addon/HeroDeck` folder into the game's AddOns folder, so that you get:

```
<WoW folder>\_forever_\Interface\AddOns\HeroDeck\HeroDeck.toc
```

For example `D:\Games\World of Warcraft\_forever_\Interface\AddOns\HeroDeck`.

Developers can link the folder instead of copying it, so the game always loads the code from the repo:

```bash
cmd /c mklink /J "D:\Games\World of Warcraft\_forever_\Interface\AddOns\HeroDeck" "D:\Git\herodeck\addon\HeroDeck"
```

Start the game. On the character screen, open **AddOns** and check that **HeroDeck** is enabled. If it is
marked out of date, tick **Load out of date AddOns**.

### 2. The plugin

Build and link it from the repo:

```bash
cd streamdeck
npm install
npm run build
npx streamdeck link com.devilcable.herodeck.sdPlugin
```

Then **quit the Stream Deck app completely and start it again** (a new plugin is only found when the app
starts).

### 3. The key

In the Stream Deck app, open the **HeroDeck** category in the action list and drag **Durability**
(**Durabilité** in French) onto a key.

## Options

Select the key in the Stream Deck app to see its settings:

- **Item** (default: **Most damaged**). Choose **Most damaged**, or one of the 11 items above to follow
  that item only. (The settings panel is in English; the text on the key follows the Stream Deck
  language.)
- **Show percentage** (default: on). Turn it off to see only the colored icon. On a specific-item key the
  item name and the `empty` / `n/a` / `--` words stay; only the percentage is hidden.

## The HeroDeck minimap button

![](img/icon.png)

The addon adds a round **HeroDeck button** on the edge of the minimap. Its icon is a small Stream Deck
with 15 keys.

- **Move it:** hold the left mouse button on it and drag: it slides along the minimap's circle. Its place
  is kept between sessions.
- **Reset it:** type `/herodeck reset` to put it back at its starting place (lower left).
- **Hover it:** the tooltip shows `HeroDeck` and your durability (`Durability 80%`, French client
  `Durabilité 80 %`).
- The button is a little bigger than other minimap buttons on some screens: it grows so its keys fit
  inside the ring.

**Why the keys change color:** the addon cannot talk to the Stream Deck directly (WoW addons have no
network or file access). The colored keys of the icon *are* the data: the plugin finds the button in a
capture of the game window and reads their colors. The button must therefore stay visible on screen for
the key to update. You can put it anywhere along the minimap's edge.

The plugin only **reads** the game window. It never presses keys or acts in the game.

## When the key shows `--` (grey)

The plugin could not read the strip. Usual causes:

- WoW is not running, or it is **minimized** to the taskbar.
- The **minimap button is hidden or covered**: interface hidden (Alt+Z), the big world map, a full-screen
  panel (collections, talents, adventure guide), or another window over the minimap. The key comes back by
  itself about 2 seconds after the button is visible again.
- A **loading screen** is showing: the key turns grey for the length of the loading screen and comes back
  by itself. Short loading screens (under about 1.5 s) are not visible.
- The game runs in **exclusive fullscreen**: switch to windowed or windowed (fullscreen).
- The HeroDeck addon is not enabled (check the **AddOns** list on the character screen).
- **Windows HDR** or a display scaling other than 100 % has not been tested yet; if the key stays grey with
  one of them on, try turning it off.

When WoW is only **in the background** (another window on top, but not minimized), the game keeps running
and the key keeps showing the live value.

## Troubleshooting for developers

With the game running, the probe prints what the plugin sees twice a second:

```bash
cd streamdeck
npm run probe
```

It shows the decoded values, the capture path (`window` or `monitor`), the region (`full` scan or
`tracked` around the last position), the button's position (`origin`), the capture time, and, when nothing
is decoded, why: no window titled `World of Warcraft`, or the raw colors of the header it found. Add
`-- --dump <folder>` to save the captured image as a PNG.
