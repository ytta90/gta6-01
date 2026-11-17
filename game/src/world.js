// The rules and state of Viceroy Bay, with no drawing and no browser in it:
// the player on foot and in cars, traffic, pedestrians, police, the wanted
// system, combat, pickups, shops and the mission engine. step() advances one
// fixed step and returns what happened as bit flags.
import { buildCity, onRoad, snapToRoad, WORLD } from './city.js';
import { angleDiff, angleTo, circleHitsRect, clamp, dist, makeRng } from './rng.js';
import { MISSIONS, PICKUP_CASH } from './missions.js';

export const EVENT_CRIME = 1;
export const EVENT_PICKUP = 2;
export const EVENT_MISSION_DONE = 4;
export const EVENT_MISSION_FAIL = 8;
export const EVENT_BUSTED = 16;
export const EVENT_WASTED = 32;
export const EVENT_SHOT = 64;
export const EVENT_CRASH = 128;
export const EVENT_HIT_PED = 256;

export const SAVE_KEY = 'viceroy-bay.save.v1';
export const STEP = 1 / 60;

const CAR_W = 26;
const CAR_L = 52;
const PLAYER_R = 13;
const PED_R = 11;

const CAR_MODELS = [
  { name: 'Comet GT', top: 560, accel: 330, color: '#ff6b5e', sport: true },
  { name: 'Sunrunner', top: 470, accel: 260, color: '#3d7bd9', sport: false },
  { name: 'Bay Taxi', top: 440, accel: 240, color: '#e8c33d', sport: false, taxi: true },
  { name: 'Mule Van', top: 400, accel: 210, color: '#e8e8e8', sport: false },
  { name: 'Lowrider', top: 480, accel: 250, color: '#7ec850', sport: false },
  { name: 'Interceptor', top: 620, accel: 380, color: '#22242e', sport: true, police: true },
];

function makeCar(rng, x, y, angle, model, traffic) {
  return {
    x, y, angle, speed: 0, model, traffic: !!traffic,
    color: model.color,
    // Traffic cars follow the road graph.
    targetNode: null, wait: 0, stuck: 0,
    // Parked cars the player can steal.
    parked: false, stolen: false, health: 100, dead: false,
  };
}

export function createWorld(seed) {
  const rng = makeRng(seed);
  const city = buildCity(seed);
  const state = {
    seed,
    time: 0,
    clock: 17.5, // golden hour: 17:30
    player: { x: 0, y: 0, angle: 0, speed: 0, health: 100, armor: 0, onFoot: true, car: null, punchTimer: 0, invuln: 0, aimAngle: 0 },
    cars: [],
    peds: [],
    cops: [],
    bullets: [],
    pickups: [],
    enemies: [],
    cash: 150,
    debtPaid: 0,
    wanted: 0, // 0..100 heat
    wantedStars: 0,
    quietTimer: 0,
    missionIndex: 0,
    mission: null, // { def, stage, timer, holdTimer, checkpoint, kills }
    missionMessage: '',
    messageTimer: 0,
    hasPistol: false,
    ammo: 0,
    kills: 0,
    carsStolen: 0,
    bustedCount: 0,
    wastedCount: 0,
    gameOver: null, // 'busted' | 'wasted'
    stats: { missionsDone: 0, distance: 0 },
    // Shop / service state
    nearShop: null,
    effects: [], // {x,y,kind,t}
  };

  function spawnCarAt(x, y, angle, modelIdx, traffic) {
    const car = makeCar(rng, x, y, angle, CAR_MODELS[modelIdx], traffic);
    state.cars.push(car);
    return car;
  }

  function spawnTraffic(count) {
    for (let i = 0; i < count; i += 1) {
      const node = city.nodes[Math.floor(rng.next() * city.nodes.length)];
      const horizontal = rng.chance(0.5);
      const angle = horizontal ? (rng.chance(0.5) ? 0 : Math.PI) : (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
      const car = spawnCarAt(node.x + rng.range(-20, 20), node.y + rng.range(-20, 20), angle, rng.int(1, 4), true);
      car.speed = rng.range(120, 220);
      car.targetNode = pickNextNode(node, angle);
    }
  }

  function pickNextNode(node, angle) {
    // Continue roughly straight: pick a neighbour node in the current direction.
    const dx = Math.round(Math.cos(angle));
    const dy = Math.round(Math.sin(angle));
    const nx = node.x + dx * 400;
    const ny = node.y + dy * 400;
    if (nx < 160 || nx > 2960 || ny < 160 || ny > 2960) {
      // Turn around at the edge: pick a random neighbour instead.
      const options = city.nodes.filter((n) => Math.abs(n.x - node.x) + Math.abs(n.y - node.y) === 400);
      return options[Math.floor(rng.next() * options.length)] || node;
    }
    return { x: nx, y: ny };
  }

  function spawnPeds(count) {
    for (let i = 0; i < count; i += 1) {
      const node = city.nodes[Math.floor(rng.next() * city.nodes.length)];
      state.peds.push({
        x: node.x + rng.range(-160, 160), y: node.y + rng.range(-160, 160),
        angle: rng.range(0, Math.PI * 2), speed: rng.range(28, 52),
        color: ['#e8912d', '#4fc3d9', '#c06ad9', '#7ec850', '#e88ca0', '#5a6b8a'][Math.floor(rng.next() * 6)],
        panic: 0, dead: false, walkTimer: rng.range(1, 4),
      });
    }
  }

  function spawnParked(count) {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < 300) {
      guard += 1;
      const spot = city.parkSpots[Math.floor(rng.next() * city.parkSpots.length)];
      if (state.cars.some((c) => dist(c.x, c.y, spot.x, spot.y) < 70)) continue;
      const modelIdx = rng.chance(0.12) ? 0 : rng.int(1, 4);
      const car = spawnCarAt(spot.x, spot.y, spot.angle, modelIdx, false);
      car.parked = true;
      placed += 1;
    }
  }

  function spawnPickups() {
    // Cash briefcases scattered around the city.
    for (let i = 0; i < 10; i += 1) {
      const node = city.nodes[Math.floor(rng.next() * city.nodes.length)];
      state.pickups.push({ x: node.x + rng.range(-140, 140), y: node.y + rng.range(-140, 140), kind: 'cash', taken: false });
    }
    state.pickups.push({ x: city.landmarks.gunshop.x + 60, y: city.landmarks.gunshop.y + 60, kind: 'health', taken: false });
    state.pickups.push({ x: city.landmarks.hospital.x, y: city.landmarks.hospital.y + 90, kind: 'health', taken: false });
  }

  function reset() {
    state.time = 0;
    state.clock = 17.5;
    state.cars = [];
    state.peds = [];
    state.cops = [];
    state.bullets = [];
    state.pickups = [];
    state.enemies = [];
    state.effects = [];
    state.cash = 150;
    state.debtPaid = 0;
    state.wanted = 0;
    state.wantedStars = 0;
    state.quietTimer = 0;
    state.missionIndex = 0;
    state.mission = null;
    state.missionMessage = '';
    state.messageTimer = 0;
    state.hasPistol = false;
    state.ammo = 0;
    state.kills = 0;
    state.carsStolen = 0;
    state.bustedCount = 0;
    state.wastedCount = 0;
    state.gameOver = null;
    state.stats = { missionsDone: 0, distance: 0 };
    state.nearShop = null;
    const garage = city.landmarks.garage;
    state.player.x = garage.x + 40;
    state.player.y = garage.y + 60;
    state.player.angle = -Math.PI / 2;
    state.player.health = 100;
    state.player.armor = 0;
    state.player.onFoot = true;
    state.player.car = null;
    state.player.punchTimer = 0;
    state.player.invuln = 0;
    spawnTraffic(14);
    spawnPeds(26);
    spawnParked(14);
    spawnPickups();
    // Dana's own starter car parked by the garage.
    const starter = spawnCarAt(garage.x + 90, garage.y + 40, Math.PI / 2, 1, false);
    starter.parked = true;
    starter.owned = true;
  }

  function addWanted(amount) {
    state.wanted = clamp(state.wanted + amount, 0, 100);
    state.quietTimer = 0;
  }

  function updateWanted(dt) {
    const stars = state.wanted <= 0 ? 0 : Math.min(5, Math.ceil(state.wanted / 20));
    state.wantedStars = stars;
    // Heat cools off when the player stays clean and out of sight.
    const copNear = state.cops.some((c) => dist(c.x, c.y, state.player.x, state.player.y) < 500);
    if (!copNear) {
      state.quietTimer += dt;
      if (state.quietTimer > 8) state.wanted = Math.max(0, state.wanted - dt * 2.2);
    } else {
      state.quietTimer = 0;
    }
    // Police presence follows the wanted level.
    const wantCops = stars === 0 ? 0 : stars <= 2 ? stars + 1 : stars + 2;
    while (state.cops.length < wantCops) spawnCop();
    while (state.cops.length > wantCops) state.cops.pop();
  }

  function spawnCop() {
    const px = state.player.x;
    const py = state.player.y;
    const angle = rng.range(0, Math.PI * 2);
    const x = clamp(px + Math.cos(angle) * 700, 80, WORLD - 80);
    const y = clamp(py + Math.sin(angle) * 700, 80, WORLD - 80);
    if (state.wantedStars >= 3 && rng.chance(0.6)) {
      const car = spawnCarAt(x, y, angleTo(x, y, px, py), 5, false);
      car.police = true;
      state.cops.push({ x, y, angle: 0, car, foot: false, speed: 0 });
    } else {
      state.cops.push({ x, y, angle: 0, car: null, foot: true, speed: 0 });
    }
  }

  function startMission(index) {
    const def = MISSIONS[index];
    if (!def) return false;
    state.mission = { def, stage: 0, timer: 0, holdTimer: 0, checkpoint: 0, kills: 0, failed: false };
    state.missionMessage = def.intro;
    state.messageTimer = 6;
    return true;
  }

  function currentStage() {
    if (!state.mission) return null;
    return state.mission.def.stages[state.mission.stage] || null;
  }

  function advanceStage() {
    const m = state.mission;
    m.stage += 1;
    m.timer = 0;
    m.holdTimer = 0;
    m.checkpoint = 0;
    if (m.stage >= m.def.stages.length) {
      state.cash += m.def.reward;
      state.debtPaid += m.def.reward;
      state.stats.missionsDone += 1;
      state.mission = null;
      state.missionMessage = `Mission complete: ${m.def.name} — $${m.def.reward}. Debt left: $${Math.max(0, 4000 - state.debtPaid)}.`;
      state.messageTimer = 6;
      state.missionIndex = Math.min(MISSIONS.length, state.missionIndex + 1);
      return EVENT_MISSION_DONE;
    }
    return 0;
  }

  function failMission(reason) {
    if (!state.mission) return 0;
    const name = state.mission.def.name;
    state.mission = null;
    state.missionMessage = `Mission failed: ${name} — ${reason}. Talk to Rico at the garage to retry.`;
    state.messageTimer = 6;
    return EVENT_MISSION_FAIL;
  }

  function tryStartMission() {
    if (state.mission) return;
    if (state.missionIndex >= MISSIONS.length) {
      state.missionMessage = 'All missions done — Viceroy Bay is yours, Dana. Free roam!';
      state.messageTimer = 5;
      return;
    }
    startMission(state.missionIndex);
  }

  function save() {
    try {
      const p = state.player;
      const data = {
        cash: state.cash, debtPaid: state.debtPaid, missionIndex: state.missionIndex,
        health: p.health, armor: p.armor, hasPistol: state.hasPistol, ammo: state.ammo,
        x: p.x, y: p.y, kills: state.kills, carsStolen: state.carsStolen,
        stats: state.stats, savedAt: Date.now(),
      };
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      reset();
      state.cash = data.cash ?? 150;
      state.debtPaid = data.debtPaid ?? 0;
      state.missionIndex = data.missionIndex ?? 0;
      state.player.health = data.health ?? 100;
      state.player.armor = data.armor ?? 0;
      state.hasPistol = !!data.hasPistol;
      state.ammo = data.ammo ?? 0;
      state.player.x = data.x ?? state.player.x;
      state.player.y = data.y ?? state.player.y;
      state.kills = data.kills ?? 0;
      state.carsStolen = data.carsStolen ?? 0;
      state.stats = data.stats ?? state.stats;
      state.missionMessage = 'Welcome back, Dana. Save loaded.';
      state.messageTimer = 4;
      return true;
    } catch {
      return false;
    }
  }

  function hasSave() {
    try { return !!window.localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  // After being busted the player pays the fine, walks out of the station and
  // keeps playing: clear the stop flag without resetting the world.
  function resumeAfterBusted() {
    state.gameOver = null;
    state.player.health = Math.max(50, state.player.health);
  }

  // ---- movement helpers ----
  function moveCircleOutOfBuildings(x, y, r) {
    for (const b of city.buildings) {
      if (circleHitsRect(x, y, r, b)) {
        const nx = clamp(x, b.x, b.x + b.w);
        const ny = clamp(y, b.y, b.y + b.h);
        const dx = x - nx;
        const dy = y - ny;
        const d = Math.hypot(dx, dy) || 1;
        const push = r - d + 0.5;
        if (d < 0.01) {
          // Centre inside the building: push out along the smallest axis.
          const left = x - b.x;
          const right = b.x + b.w - x;
          const top = y - b.y;
          const bottom = b.y + b.h - y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) return { x: b.x - r, y };
          if (m === right) return { x: b.x + b.w + r, y };
          if (m === top) return { x, y: b.y - r };
          return { x, y: b.y + b.h + r };
        }
        return { x: x + (dx / d) * push, y: y + (dy / d) * push };
      }
    }
    return { x, y };
  }

  function nearestCar(x, y, maxDist) {
    let best = null;
    let bd = maxDist;
    for (const car of state.cars) {
      if (car.dead) continue;
      const d = dist(x, y, car.x, car.y);
      if (d < bd) { bd = d; best = car; }
    }
    return best;
  }

  function enterCar(car) {
    const p = state.player;
    p.onFoot = false;
    p.car = car;
    car.parked = false;
    car.traffic = false;
    car.targetNode = null;
    if (!car.owned && !car.stolen) {
      car.stolen = true;
      state.carsStolen += 1;
      addWanted(25);
      state.missionMessage = `You stole the ${car.model.name}! The cops noticed.`;
      state.messageTimer = 4;
    }
    return EVENT_CRIME;
  }

  function exitCar() {
    const p = state.player;
    const car = p.car;
    if (!car) return;
    const side = { x: car.x + Math.cos(car.angle + Math.PI / 2) * 34, y: car.y + Math.sin(car.angle + Math.PI / 2) * 34 };
    p.x = side.x;
    p.y = side.y;
    p.angle = car.angle;
    p.onFoot = true;
    p.car = null;
    car.speed = 0;
  }

  function shoot(fromX, fromY, angle) {
    state.bullets.push({ x: fromX, y: fromY, angle, speed: 900, life: 0.9, friendly: true });
    return EVENT_SHOT;
  }

  function damagePlayer(amount) {
    const p = state.player;
    if (p.invuln > 0) return 0;
    let rest = amount;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, rest);
      p.armor -= absorbed;
      rest -= absorbed;
    }
    p.health -= rest;
    p.invuln = 0.4;
    if (p.health <= 0) {
      p.health = 0;
      state.gameOver = 'wasted';
      state.wastedCount += 1;
      return EVENT_WASTED;
    }
    return 0;
  }

  // ---- mission stage logic ----
  function missionTargetPos(stage) {
    if (!stage || !stage.target) return null;
    const lm = city.landmarks[stage.target];
    return lm ? { x: lm.x, y: lm.y, name: lm.name } : null;
  }

  function updateMission(dt, events) {
    const m = state.mission;
    if (!m) return events;
    const stage = currentStage();
    if (!stage) return events;
    const p = state.player;
    m.timer += dt;
    if (stage.time && m.timer > stage.time) return events | failMission('Out of time.');
    if (stage.type === 'enterCar') {
      if (!p.onFoot) return events | advanceStage();
    } else if (stage.type === 'goto') {
      const t = missionTargetPos(stage);
      if (t && dist(p.x, p.y, t.x, t.y) < (stage.radius || 100)) return events | advanceStage();
      if (stage.wanted) addWanted(stage.wanted * dt * 0.4);
    } else if (stage.type === 'stealCar') {
      const t = missionTargetPos(stage);
      const car = state.cars.find((c) => c.model.sport && c.color === '#ff6b5e' && !c.dead);
      if (car && p.car === car) return events | advanceStage();
      if (t && !m.targetCar) {
        // Park the target Comet GT near the mall if it is not there yet.
        const parked = state.cars.find((c) => c.model.sport && c.color === '#ff6b5e' && c.parked);
        if (!parked) {
          const c = spawnCarAt(t.x + 70, t.y - 40, Math.PI / 2, 0, false);
          c.parked = true;
          m.targetCar = c;
        } else m.targetCar = parked;
      }
    } else if (stage.type === 'deliverCar') {
      const t = missionTargetPos(stage);
      if (t && p.car && p.car.model.sport && p.car.color === '#ff6b5e' && dist(p.x, p.y, t.x, t.y) < (stage.radius || 110)) {
        return events | advanceStage();
      }
    } else if (stage.type === 'combat') {
      if (m.enemiesSpawned !== true) {
        m.enemiesSpawned = true;
        const t = missionTargetPos(stage);
        // Spawn on the street by the target, never inside its building.
        const street = city.roadNear(t.x, t.y);
        for (let i = 0; i < stage.count; i += 1) {
          state.enemies.push({
            x: street.x + rng.range(-140, 140), y: street.y + rng.range(-140, 140),
            health: 60, speed: rng.range(70, 95), punchTimer: 0, color: '#8a2f2f', dead: false,
          });
        }
      }
      if (m.kills >= stage.count) {
        state.enemies = state.enemies.filter((e) => !e.dead);
        return events | advanceStage();
      }
    } else if (stage.type === 'race') {
      const names = stage.checkpoints;
      const targetName = names[m.checkpoint];
      const t = city.landmarks[targetName];
      if (t && dist(p.x, p.y, t.x, t.y) < 110) {
        m.checkpoint += 1;
        state.missionMessage = `Checkpoint ${m.checkpoint}/${names.length}!`;
        state.messageTimer = 2;
        if (m.checkpoint >= names.length) return events | advanceStage();
      }
    } else if (stage.type === 'hold') {
      const t = missionTargetPos(stage);
      if (t && dist(p.x, p.y, t.x, t.y) < (stage.radius || 150)) {
        m.holdTimer += dt;
        addWanted(6 * dt);
        if (m.holdTimer >= stage.hold) return events | advanceStage();
      } else {
        m.holdTimer = Math.max(0, m.holdTimer - dt * 2);
      }
    }
    return events;
  }

  // ---- per-frame updates ----
  function updatePlayer(dt, input) {
    const p = state.player;
    if (p.punchTimer > 0) p.punchTimer -= dt;
    if (p.invuln > 0) p.invuln -= dt;

    if (p.onFoot) {
      const run = input.down('shift');
      const speed = run ? 265 : 170;
      const mx = input.axis('a', 'd') + input.axis('arrowleft', 'arrowright');
      const my = input.axis('w', 's') + input.axis('arrowup', 'arrowdown');
      const len = Math.hypot(mx, my) || 1;
      const nx = p.x + (mx / len) * speed * dt * (mx || my ? 1 : 0);
      const ny = p.y + (my / len) * speed * dt * (mx || my ? 1 : 0);
      const fixed = moveCircleOutOfBuildings(nx, ny, PLAYER_R);
      const moved = dist(p.x, p.y, fixed.x, fixed.y);
      p.x = clamp(fixed.x, 20, WORLD - 20);
      p.y = clamp(fixed.y, 20, WORLD - 20);
      p.speed = moved / Math.max(dt, 0.001);
      if (mx || my) p.angle = Math.atan2(my, mx);
      state.stats.distance += moved;
      // Aim at the mouse for shooting.
      if (input.canvas) {
        const rect = input.canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        p.aimAngle = Math.atan2(input.mouseY - cy, input.mouseX - cx);
      }
      if (input.wasPressed('e')) {
        const car = nearestCar(p.x, p.y, 64);
        if (car) return enterCar(car);
      }
      if (input.wasPressed('f') && p.punchTimer <= 0) {
        p.punchTimer = 0.35;
        return punch();
      }
      if ((input.mouseClicked || input.mouseDown) && state.hasPistol && state.ammo > 0) {
        state.ammo -= 1;
        addWanted(8);
        return shoot(p.x + Math.cos(p.aimAngle) * 20, p.y + Math.sin(p.aimAngle) * 20, p.aimAngle);
      }
    } else {
      const car = p.car;
      const forward = input.axis('s', 'w') + input.axis('arrowdown', 'arrowup');
      const steer = input.axis('a', 'd') + input.axis('arrowleft', 'arrowright');
      const handbrake = input.down(' ');
      const accel = car.model.accel * (handbrake ? 0.4 : 1);
      car.speed += forward * accel * dt;
      if (forward === 0) car.speed *= Math.max(0, 1 - 1.4 * dt);
      if (handbrake) car.speed *= Math.max(0, 1 - 3.2 * dt);
      car.speed = clamp(car.speed, -180, car.model.top);
      const turnRate = 2.3 * clamp(Math.abs(car.speed) / 140, 0.6, 1) * (car.speed < 0 ? -1 : 1);
      car.angle += steer * turnRate * dt;
      const nx = car.x + Math.cos(car.angle) * car.speed * dt;
      const ny = car.y + Math.sin(car.angle) * car.speed * dt;
      const hit = moveCircleOutOfBuildings(nx, ny, 24);
      if (dist(nx, ny, hit.x, hit.y) > 0.5) {
        // A hard hit damages the car (once per half second at most); a slow
        // scrape just slows it down.
        if (Math.abs(car.speed) > 240 && (!car.crashAt || state.time - car.crashAt > 0.5)) {
          car.crashAt = state.time;
          return crashCar(car);
        }
        car.speed *= 0.3;
      }
      car.x = clamp(hit.x, 20, WORLD - 20);
      car.y = clamp(hit.y, 20, WORLD - 20);
      p.x = car.x;
      p.y = car.y;
      p.angle = car.angle;
      p.speed = Math.abs(car.speed);
      state.stats.distance += Math.abs(car.speed) * dt;
      if (input.wasPressed('e')) exitCar();
      if (input.wasPressed('f')) {
        // Drive-by punch is useless; honk instead.
      }
      if (input.down(' ') && Math.abs(car.speed) < 5 && input.wasPressed('w')) {
        // nothing
      }
      if (input.wasPressed('h')) {
        // Honk: no gameplay effect, just sound (handled by caller via event? keep simple)
      }
      // Running over pedestrians is a crime.
      for (const ped of state.peds) {
        if (!ped.dead && dist(ped.x, ped.y, car.x, car.y) < 30 && Math.abs(car.speed) > 60) {
          ped.dead = true;
          addWanted(15);
          return EVENT_HIT_PED | EVENT_CRIME;
        }
      }
      // Ramming other cars.
      for (const other of state.cars) {
        if (other === car || other.dead) continue;
        if (dist(other.x, other.y, car.x, car.y) < 44 && Math.abs(car.speed) > 120) {
          other.speed = car.speed * 0.5;
          other.x += Math.cos(car.angle) * 30;
          other.y += Math.sin(car.angle) * 30;
          if (other.police) addWanted(12);
          return EVENT_CRASH;
        }
      }
    }
    return 0;
  }

  function punch() {
    const p = state.player;
    const px = p.x + Math.cos(p.angle) * 30;
    const py = p.y + Math.sin(p.angle) * 30;
    let hitSomething = false;
    // A punch lands on the nearest thing in reach, not everything nearby.
    let nearestPed = null;
    let nearestPedD = 34;
    for (const ped of state.peds) {
      if (ped.dead) continue;
      const d = dist(ped.x, ped.y, px, py);
      if (d < nearestPedD) { nearestPedD = d; nearestPed = ped; }
    }
    if (nearestPed) {
      nearestPed.dead = true;
      hitSomething = true;
      addWanted(10);
    }
    let nearestEnemy = null;
    let nearestEnemyD = 40;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, px, py);
      if (d < nearestEnemyD) { nearestEnemyD = d; nearestEnemy = e; }
    }
    if (nearestEnemy) {
      nearestEnemy.health -= 34;
      hitSomething = true;
      if (nearestEnemy.health <= 0) {
        nearestEnemy.dead = true;
        state.mission.kills += 1;
        state.kills += 1;
      }
    }
    for (const cop of state.cops) {
      if (cop.foot && !cop.down && dist(cop.x, cop.y, px, py) < 36) {
        cop.foot = false;
        cop.down = true;
        hitSomething = true;
        addWanted(20);
        break;
      }
    }
    return hitSomething ? EVENT_CRIME : 0;
  }

  function crashCar(car) {
    car.health -= 18;
    if (car.health <= 0) {
      car.dead = true;
      if (state.player.car === car) exitCar();
    }
    return EVENT_CRASH;
  }

  function updateTraffic(dt) {
    for (const car of state.cars) {
      if (!car.traffic || car.dead) continue;
      if (!car.targetNode) car.targetNode = pickNextNode({ x: car.x, y: car.y }, car.angle);
      const target = car.targetNode;
      const d = dist(car.x, car.y, target.x, target.y);
      if (d < 30) {
        car.targetNode = pickNextNode(target, car.angle);
        continue;
      }
      const want = angleTo(car.x, car.y, target.x, target.y);
      car.angle += clamp(angleDiff(car.angle, want), -2.2 * dt, 2.2 * dt);
      const slow = car.wait > 0;
      car.speed = slow ? 0 : clamp(car.speed + 120 * dt, 0, 190);
      const nx = car.x + Math.cos(car.angle) * car.speed * dt;
      const ny = car.y + Math.sin(car.angle) * car.speed * dt;
      const fixed = moveCircleOutOfBuildings(nx, ny, 24);
      if (dist(nx, ny, fixed.x, fixed.y) > 0.5) car.speed *= 0.5;
      car.x = clamp(fixed.x, 20, WORLD - 20);
      car.y = clamp(fixed.y, 20, WORLD - 20);
      // Gentle separation from other cars.
      for (const other of state.cars) {
        if (other === car || other.dead) continue;
        if (dist(other.x, other.y, car.x, car.y) < 46) {
          car.x -= Math.cos(car.angle) * 20 * dt;
          car.y -= Math.sin(car.angle) * 20 * dt;
        }
      }
    }
  }

  function updatePeds(dt) {
    for (const ped of state.peds) {
      if (ped.dead) continue;
      ped.walkTimer -= dt;
      const playerNear = dist(ped.x, ped.y, state.player.x, state.player.y) < 90;
      const danger = state.wantedStars > 0 || playerNear;
      if (ped.panic > 0) ped.panic -= dt;
      if (danger && ped.panic <= 0 && rng.chance(0.02)) ped.panic = rng.range(1, 2.5);
      const speed = ped.panic > 0 ? ped.speed * 2.6 : ped.speed;
      if (ped.walkTimer <= 0) {
        ped.walkTimer = rng.range(2, 5);
        ped.angle = rng.range(0, Math.PI * 2);
      }
      let nx = ped.x;
      let ny = ped.y;
      if (ped.panic > 0) {
        const away = angleTo(state.player.x, state.player.y, ped.x, ped.y);
        nx = ped.x + Math.cos(away) * speed * dt;
        ny = ped.y + Math.sin(away) * speed * dt;
      } else {
        nx = ped.x + Math.cos(ped.angle) * speed * dt;
        ny = ped.y + Math.sin(ped.angle) * speed * dt;
      }
      const fixed = moveCircleOutOfBuildings(nx, ny, PED_R);
      ped.x = clamp(fixed.x, 20, WORLD - 20);
      ped.y = clamp(fixed.y, 20, WORLD - 20);
    }
  }

  function updateCops(dt) {
    const p = state.player;
    for (const cop of state.cops) {
      if (cop.down) continue;
      if (cop.car) {
        const car = cop.car;
        if (car.dead) { cop.car = null; cop.foot = true; cop.x = car.x; cop.y = car.y; continue; }
        const want = angleTo(car.x, car.y, p.x, p.y);
        car.angle += clamp(angleDiff(car.angle, want), -2.2 * dt, 2.2 * dt);
        const targetSpeed = state.wantedStars >= 4 ? 580 : 500;
        car.speed = clamp(car.speed + 300 * dt, 0, targetSpeed);
        const nx = car.x + Math.cos(car.angle) * car.speed * dt;
        const ny = car.y + Math.sin(car.angle) * car.speed * dt;
        const hit = moveCircleOutOfBuildings(nx, ny, 24);
        if (dist(nx, ny, hit.x, hit.y) > 0.5) car.speed *= 0.4;
        car.x = clamp(hit.x, 20, WORLD - 20);
        car.y = clamp(hit.y, 20, WORLD - 20);
        cop.x = car.x;
        cop.y = car.y;
        // Ram the player's car (at most once every 0.8 s per cop car).
        if (!p.onFoot && p.car && dist(car.x, car.y, p.x, p.y) < 48) {
          if (!cop.ramAt || state.time - cop.ramAt > 0.8) {
            cop.ramAt = state.time;
            p.car.speed *= 0.7;
            p.car.health -= 4;
            if (p.car.health <= 0) {
              return bustPlayer();
            }
          }
        }
        // Bust on foot: cop car stops next to a slow player.
        if (p.onFoot && dist(car.x, car.y, p.x, p.y) < 46 && p.speed < 60) return bustPlayer();
      } else if (cop.foot) {
        const want = angleTo(cop.x, cop.y, p.x, p.y);
        cop.angle = want;
        const speed = 235;
        const nx = cop.x + Math.cos(want) * speed * dt;
        const ny = cop.y + Math.sin(want) * speed * dt;
        const fixed = moveCircleOutOfBuildings(nx, ny, PED_R);
        cop.x = clamp(fixed.x, 20, WORLD - 20);
        cop.y = clamp(fixed.y, 20, WORLD - 20);
        if (p.onFoot && dist(cop.x, cop.y, p.x, p.y) < 26 && p.speed < 120) return bustPlayer();
        if (!p.onFoot && dist(cop.x, cop.y, p.x, p.y) < 30 && Math.abs(p.car.speed) < 40) return bustPlayer();
      }
    }
    return 0;
  }

  function bustPlayer() {
    if (state.wantedStars === 0) return 0;
    const fine = Math.min(state.cash, 100 + state.wantedStars * 50);
    state.cash -= fine;
    state.wanted = 0;
    state.wantedStars = 0;
    state.cops = [];
    if (state.player.car) exitCar();
    const station = city.landmarks.police;
    state.player.x = station.x + 120;
    state.player.y = station.y + 120;
    state.player.health = Math.max(50, state.player.health);
    state.bustedCount += 1;
    state.gameOver = 'busted';
    if (state.mission) failMission('Busted by the VBPD.');
    return EVENT_BUSTED;
  }

  function updateEnemies(dt) {
    const p = state.player;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, p.x, p.y);
      const want = angleTo(e.x, e.y, p.x, p.y);
      e.angle = want;
      if (d > 34) {
        const nx = e.x + Math.cos(want) * e.speed * dt;
        const ny = e.y + Math.sin(want) * e.speed * dt;
        const fixed = moveCircleOutOfBuildings(nx, ny, PED_R);
        e.x = clamp(fixed.x, 20, WORLD - 20);
        e.y = clamp(fixed.y, 20, WORLD - 20);
      } else if (e.punchTimer <= 0) {
        e.punchTimer = 0.8;
        return damagePlayer(9);
      }
      if (e.punchTimer > 0) e.punchTimer -= dt;
    }
    return 0;
  }

  function updateBullets(dt) {
    let events = 0;
    for (const b of state.bullets) {
      b.x += Math.cos(b.angle) * b.speed * dt;
      b.y += Math.sin(b.angle) * b.speed * dt;
      b.life -= dt;
      if (b.life <= 0) continue;
      // Walls stop bullets.
      let hitWall = false;
      for (const bd of city.buildings) {
        if (b.x > bd.x && b.x < bd.x + bd.w && b.y > bd.y && b.y < bd.y + bd.h) { hitWall = true; break; }
      }
      if (hitWall) { b.life = 0; continue; }
      if (b.friendly) {
        for (const e of state.enemies) {
          if (!e.dead && dist(e.x, e.y, b.x, b.y) < 18) {
            e.health -= 34;
            b.life = 0;
            if (e.health <= 0) {
              e.dead = true;
              state.mission.kills += 1;
              state.kills += 1;
            }
            break;
          }
        }
        for (const cop of state.cops) {
          if (cop.foot && !cop.down && dist(cop.x, cop.y, b.x, b.y) < 18) {
            cop.down = true;
            b.life = 0;
            addWanted(20);
            events |= EVENT_CRIME;
            break;
          }
        }
      }
    }
    state.bullets = state.bullets.filter((b) => b.life > 0);
    return events;
  }

  function updatePickups() {
    const p = state.player;
    let events = 0;
    for (const pk of state.pickups) {
      if (pk.taken) continue;
      if (dist(p.x, p.y, pk.x, pk.y) < 36) {
        pk.taken = true;
        if (pk.kind === 'cash') {
          state.cash += PICKUP_CASH;
          state.missionMessage = `Found a cash briefcase: +$${PICKUP_CASH}.`;
          state.messageTimer = 3;
        } else if (pk.kind === 'health') {
          state.player.health = 100;
          state.missionMessage = 'Health restored.';
          state.messageTimer = 3;
        }
        events |= EVENT_PICKUP;
      }
    }
    return events;
  }

  function updateShops() {
    const p = state.player;
    state.nearShop = null;
    const shops = [
      { key: 'spray', action: 'spray', label: 'Turbo Spray — press Q: $200, repairs car + clears wanted' },
      { key: 'gunshop', action: 'gun', label: state.hasPistol ? 'Ironworks Arms — press Q: ammo $50 / 24 rounds' : 'Ironworks Arms — press Q: buy pistol $300' },
      { key: 'diner', action: 'food', label: 'Burger Barn — press Q: meal $25, full health' },
    ];
    for (const s of shops) {
      const lm = city.landmarks[s.key];
      if (lm && dist(p.x, p.y, lm.x, lm.y) < 130) {
        state.nearShop = s;
        return;
      }
    }
  }

  function useShop(input) {
    if (!state.nearShop || !input.wasPressed('q')) return 0;
    const s = state.nearShop;
    const p = state.player;
    if (s.action === 'spray') {
      if (state.cash < 200) return 0;
      if (!p.car) return 0;
      state.cash -= 200;
      p.car.health = 100;
      state.wanted = 0;
      state.missionMessage = 'Fresh paint, clean slate. Wanted cleared.';
      state.messageTimer = 3;
      return EVENT_PICKUP;
    }
    if (s.action === 'gun') {
      if (!state.hasPistol) {
        if (state.cash < 300) return 0;
        state.cash -= 300;
        state.hasPistol = true;
        state.ammo = 48;
        state.missionMessage = 'Pistol bought. Click to shoot, F to punch.';
        state.messageTimer = 4;
      } else {
        if (state.cash < 50) return 0;
        state.cash -= 50;
        state.ammo += 24;
        state.missionMessage = 'Ammo +24.';
        state.messageTimer = 2;
      }
      return EVENT_PICKUP;
    }
    if (s.action === 'food') {
      if (state.cash < 25) return 0;
      state.cash -= 25;
      p.health = 100;
      state.missionMessage = 'Burger Barn: health restored.';
      state.messageTimer = 2;
      return EVENT_PICKUP;
    }
    return 0;
  }

  // One fixed step. `input` is the live Input object (or a stub with the same
  // methods for scripted scenes). Returns event flags.
  function step(dt, input, autopilot) {
    let events = 0;
    if (state.gameOver) return 0;
    state.time += dt;
    state.clock = (17.5 + state.time / 3600) % 24;
    if (state.messageTimer > 0) state.messageTimer -= dt;

    if (autopilot) {
      events |= autopilot(state, dt);
    } else if (input) {
      events |= updatePlayer(dt, input);
      events |= useShop(input);
      if (input.wasPressed('r') && !state.mission) tryStartMission();
      if (input.wasPressed('m')) {
        // Mute is handled by the caller (audio lives outside the world).
      }
    }

    events |= updateMission(dt, events);
    updateTraffic(dt);
    updatePeds(dt);
    events |= updateCops(dt);
    events |= updateEnemies(dt);
    events |= updateBullets(dt);
    events |= updatePickups();
    updateShops();
    updateWanted(dt);

    // Effects age out.
    state.effects = state.effects.filter((e) => (e.t += dt) < 1);

    // Slowly respawn traffic and pedestrians so the city never empties.
    if (state.cars.filter((c) => c.traffic).length < 10) spawnTraffic(2);
    if (state.peds.filter((p) => !p.dead).length < 18) spawnPeds(4);
    // Clean up dead police cars so new ones can spawn.
    state.cars = state.cars.filter((c) => !c.dead || c === state.player.car);

    if (state.gameOver === 'wasted') events |= EVENT_WASTED;
    if (state.gameOver === 'busted') events |= EVENT_BUSTED;
    return events;
  }

  reset();
  return {
    state, city, reset, step, startMission, tryStartMission, currentStage,
    missionTargetPos, save, load, hasSave, addWanted, CAR_MODELS, enterCar, exitCar, failMission,
    resumeAfterBusted,
  };
}
