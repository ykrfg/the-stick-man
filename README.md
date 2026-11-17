# the-stick-man

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ykrfg/the-stick-man/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ykrfg/the-stick-man/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**THE STICK MAN** is an original open-world crime game in full 3D with a bright toon look, set in the sunny city of Palmera. You are the white stick man: a grinning, supple-limbed nobody in a city of black stick figures. Explore Palmera on foot and by car, steal anything with wheels, run three jobs for Bruno of Bruno's Diner — a package pickup, a getaway with the silent Shade, and a rent-collection tour of three shops — and mind the stars: Palmera PD answers crimes with patrol cars and officers who will bust you if they corner you. Lose the heat by escaping, or hold still in the Spray 'n Go bay and buy a fresh paint job. Everything is procedural: the low-poly city, the two-segment-limbed stick figures with eased procedural animation (walk and run cycles, a punch with anticipation and follow-through, a crouch into the driver's seat), the traffic, and every sound, synthesized live with WebAudio. Three.js is vendored under `game/vendor/`; the game itself makes no network requests and plays offline.

## 日本語の紹介

**THE STICK MAN** は、トゥーン調の完全3Dで描くオリジナルのオープンワールド犯罪ゲームです。舞台は陽光の街パルメラ。主人公は白塗りの棒人間で、黒塗りの棒人間たちが暮らす街を、徒歩と車で自由に走り回ります。車は近づいてEキーで盗めます。ダイナーの店主ブルーノから受ける3つの仕事（荷物の受け取り、相棒シェイドとの逃走劇、3軒の店への集金）が物語の軸で、犯罪を重ねると指名手配の星が増え、パトカーと警官が追ってきます。熱を冷ますには逃げ切るか、「スプレー＆ゴー」のガレージで塗装を変えるのが近道です。棒人間は関節の曲がる二節の手足を持ち、歩行・走行・パンチ・車への乗り込みまで、すべて手続き型アニメーションでしなやかに動きます。

起動方法は下の「Run it」の通りです。

Controls: WASD or arrow keys to move, Shift to sprint, E to enter/exit a car and to talk, F or J to punch, K or mouse click to shoot (once you have the pistol), P to pause, M to mute. Money and mission progress save to localStorage between visits. Get busted or wasted and you wake up at the police station or the hospital, a little poorer.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

Any static file server pointed at `game/` works just as well. To hand the entry in the way the bounty does, run `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1b5ny4cj&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
