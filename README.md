# ytta90/gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ytta90/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ytta90/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Viceroy Bay is a complete open-world crime game in the spirit of GTA 6, built
for make.fun's "Make GTA 6" bounty: a sun-soaked fictional city you explore
on foot and by car, with traffic and pedestrians, cars to steal, a wanted
level with VBPD police who chase you, six story missions, combat, shops, a
HUD with a minimap, a start screen and a save — all of it original, all of it
offline from static files.

## The game

You are Dana Reyes, a courier who owes the crew $4,000. Six jobs stand
between her and freedom:

1. **First Fare** — deliver a package to Sunset Pier.
2. **Hot Wheels** — steal the coral Comet GT and bring it to your garage.
3. **Getaway** — pick up Rico by VBPD Central and lose a three-star chase.
4. **Street Justice** — deal with four Harbor Boys at Burger Barn, on foot.
5. **Night Run** — race five checkpoints against the clock.
6. **The Big Score** — hold the floor at Viceroy Trust Bank at five stars,
   then escape.

Between missions the city is yours: steal any parked car, run over the
wrong person and watch the stars climb, outrun interceptors, get busted and
pay the fine, repair and clear your name at Turbo Spray, buy a pistol at
Ironworks Arms, eat at Burger Barn, and pick up cash briefcases. Progress
saves to the browser (press S while paused, or continue with C on the title
screen).

## Controls

- **WASD / arrows** — walk and drive (Shift runs on foot)
- **E** — enter / exit a car
- **F** — punch
- **Mouse + click** — aim and shoot (once you own a pistol)
- **Space** — handbrake
- **R** — start the next mission (at the garage)
- **Q** — use the nearest shop
- **P** — pause, **S** — save, **M** — mute

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080. No build step, no network requests: the
game is plain static files under `game/`, with synthesized WebAudio sound and
music (no audio files).

## Layout

- `game/index.html` — the page; `game/src/main.js` — boot and game loop
- `game/src/city.js` — the seeded city: avenues, blocks, landmarks, beach
- `game/src/world.js` — rules: driving, traffic, pedestrians, police,
  wanted level, combat, shops, missions, save/load
- `game/src/missions.js` — the six-mission story
- `game/src/render.js` — top-down pseudo-3D drawing, HUD, minimap, menus
- `game/src/shots.js` — the four deterministic screenshot scenes
- `game/src/audio.js` — synthesized sound and music (WebAudio, no files)
- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to `/output`
  and writes `dossier.json`

---

<sub>Entered on [make.fun](https://make.fun/?ref=ytta90&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
