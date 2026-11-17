// Boot and the one loop: input every frame, the world in fixed 1/60 s steps,
// the renderer painting what is there. Screens: title, play, paused, busted,
// wasted. ?seed=N fixes the city. ?shot=start|chase|mission|heist (with
// &seed=N) stages that scene instead of running the loop, paints it twice and
// sets window.__shotReady for a screenshot.
import { createWorld, STEP, SAVE_KEY, EVENT_BUSTED, EVENT_WASTED, EVENT_MISSION_DONE, EVENT_MISSION_FAIL, EVENT_PICKUP, EVENT_SHOT, EVENT_CRASH, EVENT_HIT_PED, EVENT_CRIME } from './world.js';
import { Input } from './input.js';
import { createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED, SCREEN_OVER, SCREEN_BUSTED } from './render.js';
import { stageShot } from './shots.js';
import { SoundBank } from './audio.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
const renderer = createRenderer(canvas);
const sound = new SoundBank();

function bestSummary() {
  return { missionsDone: world.state.stats.missionsDone, cash: world.state.cash };
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, world.city, scene.screen, scene.best);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = new Input(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let sirenTimer = 0;

  function announce(message) {
    status.textContent = message;
  }

  function handleEvents(events) {
    if (events & EVENT_MISSION_DONE) sound.missionDone();
    if (events & EVENT_MISSION_FAIL) sound.busted();
    if (events & EVENT_PICKUP) sound.pickup();
    if (events & EVENT_SHOT) sound.gunshot();
    if (events & EVENT_CRASH) sound.crash();
    if (events & EVENT_HIT_PED) sound.crash();
    if (events & EVENT_BUSTED) {
      sound.busted();
      screen = SCREEN_BUSTED;
      announce('Busted by the VBPD. Fine paid.');
    }
    if (events & EVENT_WASTED) {
      sound.busted();
      screen = SCREEN_OVER;
      announce('Wasted. The story ends here — for now.');
    }
  }

  function startNewGame() {
    sound.ensure();
    world.reset();
    screen = SCREEN_PLAY;
    announce('Playing. Press R at the garage to start the first mission.');
  }

  function continueGame() {
    sound.ensure();
    if (world.load()) {
      screen = SCREEN_PLAY;
      announce('Save loaded. Welcome back, Dana.');
    } else {
      startNewGame();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    // Title / panel keys.
    if (screen === SCREEN_TITLE) {
      if (input.wasPressed('enter') || input.mouseClicked) startNewGame();
      else if (input.wasPressed('c') && world.hasSave()) continueGame();
    } else if (screen === SCREEN_BUSTED) {
      if (input.wasPressed('enter') || input.mouseClicked) {
        world.resumeAfterBusted();
        screen = SCREEN_PLAY;
      }
    } else if (screen === SCREEN_OVER) {
      if (input.wasPressed('enter') || input.mouseClicked) startNewGame();
      else if (input.wasPressed('c') && world.hasSave()) continueGame();
    } else if (screen === SCREEN_PLAY) {
      if (input.wasPressed('p') || input.wasPressed('escape')) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
    } else if (screen === SCREEN_PAUSED) {
      if (input.wasPressed('p') || input.wasPressed('escape') || input.wasPressed('enter')) screen = SCREEN_PLAY;
      else if (input.wasPressed('s')) {
        world.save();
        world.state.missionMessage = 'Game saved.';
        world.state.messageTimer = 3;
      }
    }

    if (input.wasPressed('m')) {
      sound.ensure();
      sound.setMuted(!sound.muted);
      world.state.missionMessage = sound.muted ? 'Sound muted.' : 'Sound on.';
      world.state.messageTimer = 2;
    }

    if (screen === SCREEN_TITLE) {
      while (accumulator >= STEP) {
        world.step(STEP, input);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      sound.ensure();
      while (accumulator >= STEP) {
        const events = world.step(STEP, input);
        handleEvents(events);
        accumulator -= STEP;
      }
      // Engine + siren ambience.
      const p = world.state.player;
      sound.setEngine(p.onFoot ? 0 : Math.abs(p.car ? p.car.speed : 0) / 600, !p.onFoot);
      sirenTimer -= 1 / 60;
      if (world.state.wantedStars > 0 && sirenTimer <= 0) {
        sound.siren();
        sirenTimer = 1.6;
      }
    } else {
      accumulator = 0;
    }

    renderer.draw(world.state, world.city, screen, bestSummary());
    input.endFrame();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Viceroy Bay. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
