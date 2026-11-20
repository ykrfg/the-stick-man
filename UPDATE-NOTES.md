# THE STICK MAN — update notes

This build adds a day/night cycle with real shadows, luminous lights, seven
money sinks, car ownership, and a small audio director. Everything is still
static, offline and procedural; no new network requests or external assets.

## What changed

### Light and atmosphere

- **A day that runs.** `src/time.js` solves the sky, fog, key/ambient light,
  exposure, window glow, neon glow, stars and sun direction for any hour.
  A day lasts `DAY_SECONDS = 720` (12 minutes) of play.
- **One shadow-casting sun.** A tight orthographic shadow box (±230) follows
  the player. Buildings cast; only ground planes receive. Quality sets the map
  to 2048 / 1536 / 1024.
- **Lit windows.** `world3d` already painted lit panes into an emissive map;
  `gfx.js` now drives `emissiveIntensity` from the clock (0.10 by day, 1.65 at
  night), so the yellow panes actually glow after sundown.
- **Luminous lights without a post chain.** Street lamps, neon shop signs, car
  headlights and the police light bar each get an additive billboard halo (one
  soft radial texture, reused). The patrol bar alternates red/blue in step with
  the flashing lenses, and neighbouring cruisers run out of phase.
- **Sky.** Custom dome shader (radius 3000, inside the 4200 far plane) that
  applies an ACES fit and sRGB itself, because a `ShaderMaterial` bypasses
  three's tone mapping and colour-space conversion. Deeper sea plane so its far
  edge never cuts a hard line on the horizon.
- **Automatic quality.** Two and a half seconds under 42 fps drops one rung
  (shadows off at the bottom). `?shot=` pins the top rung so stills never drift.

### Economy (7 sinks)

| Where | What | Price |
|---|---|---|
| PALMERA MOTORS | compact / sedan / coupe | 800 / 1500 / 2500 |
| PALMERA MOTORS | paint, engine I-III, armour I-III, neon | 60, 200/450/800, 250/500/900, 120 |
| PALMERA MOTORS | recover a stolen car | 150 |
| SURF SHACK | scarf / hat / shades (props only) | 30 / 50 / 80 |
| AMMO HUT | pistol, vest I-II, fight gloves, running shoes | 150, 200/450, 180, 160 |
| SAFEHOUSE | the safehouse itself | 4000 |
| FIXER | clear wanted stars | 100 per star |
| Phone (C / CALL) | bring your own car to the kerb | 30 |

- Three cars fit the garage; a bought car never despawns and never adds steal
  heat. Its grade/upgrades are saved.
- Gear effects are stat patches only: vest = +25/+50 max HP, gloves = +16 punch,
  shoes = 0.75 s dash cooldown, pistol = the existing gun.
- Wardrobe items are attached props (hat, shades, scarf). The white head and
  black outline of the hero never change.
- The safehouse becomes the wasted-run respawn point and offers a free full
  heal at its door. Getting busted still returns you to the PD.

### Theft and delivery

- An owned car left alone for 25 s at 900+ units is taken: flagged `stolen`,
  removed from the world, and its last parking spot becomes a pulsing red map
  pin. Walking within 56 units of the pin recovers it; the Motors desk can also
  fetch it for $150.
- `C` (keyboard) or the CALL touch button spawns the owned car 620 units away
  on the nearest road, out of sight, and rolls it to the kerb at 300 u/s.

### Audio

- `src/audio-director.js` crossfades four loops in `game/audio/`
  (`bgm_title`, `bgm_roam`, `bgm_night`, `bgm_chase`), picks by state
  (title/pause, wanted, night, roam) and mutes on `?shot=`.
- A separate SE bus (`audio.js`) and two volume sliders on the title/pause
  screens. Volumes persist under `the-stick-man-audio-v1`; mute stays
  session-only. Audio unlocks on the first tap/click, phones included.
- Missing files play silence; nothing else breaks.

## Save format

`the-stick-man-save-v1`:

```json
{
  "money": 1840, "earned": 5210,
  "missionsDone": [0, 1], "jobsDone": 3,
  "clock": 612,
  "safehouse": true,
  "gear": { "pistol": true, "vest": 1, "gloves": false, "shoes": true },
  "fit":  { "scarf": true, "hat": false, "shades": true, "color": 2 },
  "owned": [{ "grade": 2, "paint": 1, "engine": 2, "armor": 1, "neon": 2,
              "stolen": false, "stolenX": null, "stolenY": null }]
}
```

Old five-field saves load unchanged: missing `clock` opens at noon, missing
`gear`/`fit` means nothing bought, missing `owned` means an empty garage, and
the legacy `hasPistol` is promoted into `gear.pistol`. Progress reset clears
every new field and removes owned cars from the world.

## New i18n keys

All display text goes through `src/i18n.js`; the tables have matching keys.

`car.compact|sedan|coupe`, `shop.money`, `shop.owned`, `shop.wearing`,
`shop.motors.title|sub|grade.*|paint|engine|armor|neon|call|recover|noCar|ownCar`,
`shop.maxCars`, `shop.ammo.title|sub|pistol|vest|gloves|shoes`,
`shop.outfit.title|sub|scarf|hat|shades|color|colorFree`,
`shop.safehouse.title|sub|buy`, `shop.fixer.title|sub|clear|none`,
`prompt.motors|ammo|outfit|safehouse|safehouse.owned|fixer|bed`,
`banner.broke.title|sub`, `banner.car.title|sub`, `banner.safehouse.*`,
`banner.fixer.*`, `banner.sleep.*`, `banner.call.title|sub|none|here|stolen`,
`banner.stolen.*`, `banner.recovered.*`, `audio.bgm`, `audio.se`, `touch.call`.

## New landmark coordinates (proposal)

- **PALMERA MOTORS** - block (0,4): building `x45 y1700 w240 h200`, desk
  `(165,1930)`, display bays `(60|165|270, 1955)`.
- **SAFEHOUSE** - block (0,1): building `x45 y370 w240 h200`, door `(165,610)`.
- **FIXER** phone booth - `(635,1515)` on the PD block's sidewalk.
- **SURF SHACK wardrobe counter** - `(844,215)`.

## Judgment calls

- Theft and delivery are abstract (no thief AI, no real driving to you).
- Brake SE: long screech above 240 u/s, short one below, 0.35 s slot.
- The clock is saved; the title is pinned to noon; `?shot=` pins 17.33.
- The fixer is on foot only, costs 100 per star, and is the single paid
  instant-clear exception. Police and heat rules are untouched.
- Glow is additive sprites rather than a bloom pass, for 60 fps and phones.

## Measured

- Cover view: **4.8 ms/frame** (570 draw calls, 32.7k triangles).
- `game/`: **11.5 MiB**, 28 files. `game/index.html`: 6.5 KiB.
- All four `?shot=` stills are deterministic, English, 17:20, top quality and
  silent; `screenshots/1..4` are retaken at 1280x720.
