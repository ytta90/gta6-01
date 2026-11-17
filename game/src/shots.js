// The screenshot scenes behind ?shot=start|chase|mission|heist. Each one plays
// the real rules forward from a fresh world, steered by a scripted input (the
// same keys a player would press), so the frame is what real play looks like
// and the same seed always gives the same frame.
import { STEP } from './world.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { angleDiff, angleTo, dist } from './rng.js';

const START_SECONDS = 5;
const CHASE_SECONDS = 4;
const MISSION_SECONDS = 2.5;
const HEIST_SECONDS = 0.6;

// An input object that presses scripted keys: down() reads the held set,
// wasPressed() fires once per frame for a key the script tapped.
class ScriptInput {
  constructor() {
    this.held = new Set();
    this.tapped = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.mouseClicked = false;
    this.canvas = null;
  }
  down(key) { return this.held.has(key); }
  wasPressed(key) {
    if (this.tapped.has(key)) { this.tapped.delete(key); return true; }
    return false;
  }
  axis(neg, pos) {
    return (this.held.has(pos) ? 1 : 0) - (this.held.has(neg) ? 1 : 0);
  }
  hold(key) { this.held.add(key); }
  release(key) { this.held.delete(key); }
  tap(key) { this.tapped.add(key); }
  clear() { this.held.clear(); this.tapped.clear(); }
}

// Drive the player's car toward the next intersection straight ahead,
// turning at the grid's edges: the same steering a player uses.
function driveScript(world, input) {
  const s = world.state;
  const car = s.player.car;
  if (!car) return;
  const city = world.city;
  const node = city.nearestNode(car.x, car.y);
  const d = dist(car.x, car.y, node.x, node.y);
  if (d < 50) {
    // Pick the next node: keep going straight when the road continues.
    const dx = Math.round(Math.cos(car.angle));
    const dy = Math.round(Math.sin(car.angle));
    let nx = node.x + dx * 400;
    let ny = node.y + dy * 400;
    if (nx < 160 || nx > 2960 || ny < 160 || ny > 2960) {
      // Turn: head for the neighbour most aligned with our heading.
      const options = city.nodes.filter((n) => Math.abs(n.x - node.x) + Math.abs(n.y - node.y) === 400);
      let next = options[0];
      let bestDot = -2;
      for (const o of options) {
        const dot = Math.cos(car.angle) * (o.x - node.x) / 400 + Math.sin(car.angle) * (o.y - node.y) / 400;
        if (dot > bestDot) { bestDot = dot; next = o; }
      }
      nx = next.x;
      ny = next.y;
    }
    driveScript.target = { x: nx, y: ny };
  }
  const target = driveScript.target || node;
  const want = angleTo(car.x, car.y, target.x, target.y);
  const diff = angleDiff(car.angle, want);
  // Brake for a sharp turn: a 400 px grid corner needs a slow car.
  input.release('w');
  input.release('s');
  input.release('a');
  input.release('d');
  if (Math.abs(diff) > 0.45 && Math.abs(car.speed) > 170) {
    input.hold('s');
  } else {
    input.hold('w');
  }
  if (diff > 0.12) input.hold('d');
  else if (diff < -0.12) input.hold('a');
}

// Walk toward a point, punching when close to an enemy.
function walkScript(world, input, tx, ty, punchNear) {
  const s = world.state;
  const p = s.player;
  const d = dist(p.x, p.y, tx, ty);
  const want = angleTo(p.x, p.y, tx, ty);
  const dx = Math.cos(want);
  const dy = Math.sin(want);
  input.release('w');
  input.release('a');
  input.release('s');
  input.release('d');
  if (d > 26) {
    if (dx > 0.3) input.hold('d');
    if (dx < -0.3) input.hold('a');
    if (dy > 0.3) input.hold('s');
    if (dy < -0.3) input.hold('w');
  }
  if (punchNear && d < 60) input.tap('f');
}

/**
 * Set `world` to the named scene and return the screen to draw over it and
 * the best-run summary to show on the title.
 */
export function stageShot(name, world) {
  const input = new ScriptInput();
  world.reset();
  const s = world.state;
  const city = world.city;

  if (name === 'chase') {
    // Dana in the coral Comet GT, three stars, VBPD interceptors closing in.
    // A straight eastbound run down the 960 avenue: no corners to cut, the
    // chase stays on the road and the cops stay in the mirror.
    const car = s.cars.find((c) => c.model.sport && c.color === '#ff6b5e');
    car.x = 560;
    car.y = 960;
    s.player.x = car.x + 40;
    s.player.y = car.y;
    world.enterCar(car);
    car.angle = 0;
    car.speed = 400;
    s.wanted = 70;
    driveScript.target = { x: 960, y: 960 };
    for (let i = 0; i < CHASE_SECONDS / STEP; i += 1) {
      driveScript(world, input);
      world.step(STEP, input);
      if (s.gameOver) break;
    }
    return { screen: SCREEN_PLAY, best: { missionsDone: 1, cash: 400 } };
  }

  if (name === 'mission') {
    // Mission 4, on foot at Burger Barn, Harbor Boys closing in.
    world.startMission(3);
    const diner = city.landmarks.diner;
    const street = city.roadNear(diner.x, diner.y);
    s.player.x = street.x;
    s.player.y = street.y;
    s.player.onFoot = true;
    for (let i = 0; i < MISSION_SECONDS / STEP; i += 1) {
      const foe = s.enemies.find((e) => !e.dead);
      if (foe) walkScript(world, input, foe.x, foe.y, true);
      world.step(STEP, input);
      if (s.gameOver) break;
    }
    return { screen: SCREEN_PLAY, best: { missionsDone: 3, cash: 1250 } };
  }

  if (name === 'heist') {
    // Mission 6: holding the bank floor at five stars.
    world.startMission(5);
    s.mission.stage = 1;
    s.mission.holdTimer = 12;
    const bank = city.landmarks.bank;
    const street = city.roadNear(bank.x, bank.y);
    s.player.x = street.x;
    s.player.y = street.y;
    s.player.onFoot = true;
    s.wanted = 100;
    for (let i = 0; i < HEIST_SECONDS / STEP; i += 1) {
      world.step(STEP, input);
      if (s.gameOver) break;
    }
    return { screen: SCREEN_PLAY, best: { missionsDone: 5, cash: 2350 } };
  }

  // Default: the title over a living city.
  for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, input);
  return { screen: SCREEN_TITLE, best: { missionsDone: 0, cash: 0 } };
}
