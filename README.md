# the-stick-man

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ykrfg/the-stick-man/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ykrfg/the-stick-man/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**THE STICK MAN** is an original open-world crime game in full 3D with a bright toon look, set in the sunny city of Palmera. You are the white stick man: a grinning, supple-limbed nobody in a city of black stick figures. Explore Palmera on foot and by car, steal anything with wheels, run three jobs for Bruno of Bruno's Diner — a package pickup, a getaway with the silent Shade, and a rent-collection tour of three shops — and mind the stars: Palmera PD answers crimes with patrol cars and officers who will bust you if they corner you. Lose the heat by escaping, or hold still in the Spray 'n Go bay and buy a fresh paint job. Everything is procedural: the low-poly city, the two-segment-limbed stick figures with eased procedural animation (walk and run cycles, a punch with anticipation and follow-through, a crouch into the driver's seat), the traffic, and every sound, synthesized live with WebAudio. Three.js is vendored under `game/vendor/`; the game itself makes no network requests and plays offline.

## 日本語の紹介

**THE STICK MAN** は、トゥーン調の完全3Dで描くオリジナルのオープンワールド犯罪ゲームです。舞台は陽光の街パルメラ。主人公は白塗りの棒人間で、黒塗りの棒人間たちが暮らす街を、徒歩と車で自由に走り回ります。車は近づいてEキーで盗めます。ダイナーの店主ブルーノから受ける3つの仕事（荷物の受け取り、相棒シェイドとの逃走劇、3軒の店への集金）が物語の軸で、犯罪を重ねると指名手配の星が増え、パトカーと警官が追ってきます。熱を冷ますには逃げ切るか、「スプレー＆ゴー」のガレージで塗装を変えるのが近道です。棒人間は関節の曲がる二節の手足を持ち、歩行・走行・パンチ・車への乗り込みまで、すべて手続き型アニメーションでしなやかに動きます。

起動方法は下の「Run it」の通りです。

Controls: WASD or arrow keys to move, Shift to sprint, E to enter/exit a car and to talk, F or J to punch, K or mouse click to shoot (once you have the pistol), C to call your own car to the kerb, P to pause, M to mute. Money and mission progress save to localStorage between visits. Get busted or wasted and you wake up at the police station or the hospital, a little poorer.

## New in this update

- **A day that runs.** Palmera now lives through a 12-minute day: golden hour, dusk, a star-lit night, dawn. One shadow-casting sun follows the clock, windows light up after sundown, and street lamps, neon signs and headlights carry the dark.
- **Seven ways to spend money.** PALMERA MOTORS sells three grades of car and tunes paint, engine, armour and neon; the Surf Shack sells a hat, shades and a scarf; the Ammo Hut sells the pistol, body armour, fight gloves and running shoes; there is a safehouse to buy (it becomes your respawn point and a free bed), a fixer who erases wanted stars for cash, and a phone call that brings your car to the kerb.
- **Cars that stay yours.** A bought car never despawns and never adds steal heat. Left alone far from you for a while it gets stolen, and its last parking spot becomes a map pin: walk back to it, or pay the Motors desk to fetch it.
- **Everything is tappable.** The shop trays are plain DOM rows, so a phone tap, a mouse click and the number keys all buy the same thing. Volume sliders for music and effects sit on the title and pause screens and persist on their own key.

`C` キー（スマホは CALL ボタン）で自分の車を路肩へ呼び出せます。

## 今回の追加

- **時間が流れる街。** パルメラに12分で一巡する一日が入りました。夕暮れ、夜、夜明け。影を落とす太陽は時計に従って動き、日が落ちると窓が灯り、街灯・ネオン・ヘッドライトが夜を支えます。
- **7つのお金の使い道。** パルメラモータースで車を買い、塗装・エンジン・装甲・ネオンを弄る。サーフシャックで帽子・サングラス・スカーフ。アモハットでピストル・防弾ベスト・グローブ・シューズ。セーフハウス（買うと死亡時の復帰地点と無料のベッドになる）、手配を消すフィクサー、車を呼ぶ電話。
- **買った車はあなたのもの。** 購入した車は消えず、盗難の手配も増えません。ただし長時間放っておくと盗まれ、最後に停めた場所が地図にピンで残ります。歩いて取り戻すか、モータースで有料で回収を。
- **すべてタップで操作。** 店のメニューは DOM の行なので、スマホのタップ・マウスのクリック・数字キーが同じように働きます。音楽と効果音の音量スライダーはタイトルとポーズ画面にあり、専用キーで保存されます。


## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

Any static file server pointed at `game/` works just as well. To hand the entry in the way the bounty does, run `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1b5ny4cj&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
