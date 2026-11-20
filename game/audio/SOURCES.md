# Audio sources for THE STICK MAN (staging)

All files in this folder are staged for `game/audio/`. Processed with ffmpeg
(trim / fade / Vorbis encode). Originals are unmodified recordings by the
authors below.

## BGM (user-provided, generated with Suno)
- bgm_title.ogg — "Sunshine Sleuths" (user-supplied m4a, loop-wrapped)
- bgm_roam.ogg — "Cartoon Coast Groove" (user-supplied m4a, loop-wrapped)
- bgm_night.ogg — "Neon Harbor" (user-supplied m4a; source was ~470 s,
  trimmed to the first ~150 s, loop-wrapped)
- bgm_chase.ogg — "Red Light, Green Engine" (user-supplied m4a, loop-wrapped)

## SE (CC0 — BigSoundBank, recorded by Joseph Sardin)
BigSoundBank releases its sounds under CC0 (public-domain equivalent):
commercial use allowed, no attribution required, no account needed.
Source: https://bigsoundbank.com (see each sound's page).

- se_gun.ogg — "Shot in .357 Magnum 9mm", BigSoundBank sound #438,
  https://bigsoundbank.com/shot-in-357-magnum-9-mm-s0438.html
  (stereo studio recording; trimmed to the shot + short tail, 1.45 s)
- se_brake.ogg — "Screeching Tires #3", BigSoundBank sound #2370,
  https://bigsoundbank.com/UPLOAD/mp3/2370.mp3
  (default brake: short "キッ" chirp, 0.42 s cut from the screech attack)
- se_brake_long.ogg — same source #2370, full 2.11 s screech;
  use only for hard stops from high speed
- se_cardoor.ogg — "Car door #3", BigSoundBank sound #1524,
  https://bigsoundbank.com/UPLOAD/mp3/1524.mp3
  (Peugeot 107 door open + close, outside; trimmed to 2.70 s)
- se_punch1.ogg — "Punch #5", BigSoundBank sound #2460 (fight impact)
- se_punch2.ogg — "Punch #6", BigSoundBank sound #2461 (fight impact)
- se_punch3.ogg — "Punch #7", BigSoundBank sound #2462 (fight impact)
- se_punch4.ogg — "Punch #11", BigSoundBank sound #2466 (fight impact)
- se_punch_heavy1.ogg — "Body Fall #1", BigSoundBank sound #2452,
  https://bigsoundbank.com/body-fall-1-s2452.html
  (deep single thud, low-frequency heavy; trimmed to the main impact
  + short tail, 5 ms fade-in / 0.12 s fade-out, 1.05 s)
- se_punch_heavy2.ogg — "Body fall #3", BigSoundBank sound #2454,
  https://bigsoundbank.com/body-fall-3-s2454.html
  (deepest thud of the set; same trim/fade treatment, 1.05 s)
- se_punch_heavy3.ogg — "Body fall #4", BigSoundBank sound #2455,
  https://bigsoundbank.com/body-fall-4-s2455.html
  (hard slam with a crunchy midrange attack; same treatment, 1.05 s)
- se_punch_heavy4.ogg — "Body Fall #2", BigSoundBank sound #2453,
  https://bigsoundbank.com/body-fall-2-s2453.html
  (single crunchy body impact; trimmed to the biggest hit only,
  same treatment, 1.05 s)
  Note: the Body Fall series is a body hitting the floor, used here as
  heavy punch impacts (ドカッ/バキッ). The unused Punch #8/#10/#12/#13
  (#2463/#2465/#2467/#2468) were checked and rejected — same bright,
  slap-like character as Punch #5–#11 already staged, not heavier.
- se_swing1.ogg — "Whoosh #3", BigSoundBank sound #1795 (long rope)
- se_swing2.ogg — "Whoosh #4", BigSoundBank sound #1796 (long rope)
- se_swing3.ogg — "Whoosh #6", BigSoundBank sound #1799 (wooden sheet)
- se_swing4.ogg — "Whoosh #9", BigSoundBank sound #1802 (wooden sheet)

## SE (DailySounds — free-use license, NOT CC0)
- se_crash.ogg — "Car Crash", DailySounds sound #1507,
  https://dailysounds.org/sounds/1507
  (9 s source with three hits; middle/loudest hit cut 2.3–5.0 s,
  -3 dB to remove source clipping, 0.5 s fade-out; 2.70 s, 40 KB)
  License: DailySounds free-use license (https://dailysounds.org/license) —
  free for personal and commercial use in games/apps, editing allowed,
  credit optional ("Sound effects from DailySounds.org"); do NOT resell
  or re-upload the raw file as a sound library. It is used here inside
  the game only, which the license allows.
  Note: BigSoundBank has no car-crash sound (site search 2026-11-19:
  "car crash" 0 results, "crash" only cymbals/glass), so this one comes
  from DailySounds instead. SFXMint "Head-On Car Crash 01" (CC0) was the
  fallback, but its direct download blocks non-browser clients
  (needs a free API key), so it was not used.

Verified 2026-11-19: files downloaded directly from bigsoundbank.com,
license stated as CC0 on the site ("You can download and use it without
paying, without creating an account, and without asking for permission").
