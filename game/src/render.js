// Drawing only: the city, the people and cars in it, the HUD with its
// minimap, and the title / pause / busted / wasted panels. Top-down with
// extruded buildings, so the city reads as a place, not a map.
import { GRID, ROAD_W, WORLD, onRoad } from './city.js';
import { clamp, dist } from './rng.js';
import { MISSIONS } from './missions.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BUSTED = 'busted';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const SUN = { x: 0.55, y: 0.85 }; // golden-hour light direction, unit-ish

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 1280, h: 800, scale: 1, camX: 0, camY: 0, zoom: 1 };
  const fonts = new Map();

  function font(size, bold) {
    const key = `${size}|${bold ? 1 : 0}`;
    if (!fonts.has(key)) fonts.set(key, `${bold ? '700 ' : ''}${size}px ${FONT}`);
    return fonts.get(key);
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * ratio);
    canvas.height = Math.round(view.h * ratio);
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function text(str, x, y, size, color, align = 'left', bold = false) {
    ctx.font = font(size, bold);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- the city ----
  function drawGround(city, cam) {
    // Grass base.
    ctx.fillStyle = '#7fae62';
    ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
    // Beach + water on the east edge.
    const bx = 3032;
    ctx.fillStyle = '#e8d9a0';
    ctx.fillRect(bx, cam.y, WORLD - bx, cam.h);
    ctx.fillStyle = '#3f9ec4';
    ctx.fillRect(3140, cam.y, WORLD - 3140, cam.h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let y = Math.floor(cam.y / 90) * 90; y < cam.y + cam.h; y += 90) {
      ctx.fillRect(3140, y, 60, 4);
    }
    // Parks.
    for (const park of city.parks) {
      ctx.fillStyle = '#69a84f';
      ctx.fillRect(park.x, park.y, park.w, park.h);
      ctx.fillStyle = '#8bc07a';
      ctx.fillRect(park.x + 14, park.y + 14, park.w - 28, park.h - 28);
    }
    // Sidewalk blocks (the pale ground each block sits on).
    ctx.fillStyle = '#c9c2b2';
    for (let col = 0; col < 7; col += 1) {
      for (let row = 0; row < 7; row += 1) {
        const x0 = GRID[col] + ROAD_W / 2;
        const y0 = GRID[row] + ROAD_W / 2;
        const x1 = (col + 1 < GRID.length ? GRID[col + 1] : WORLD) - ROAD_W / 2;
        const y1 = (row + 1 < GRID.length ? GRID[row + 1] : WORLD) - ROAD_W / 2;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    // Roads.
    ctx.fillStyle = '#3a3f4a';
    for (const g of GRID) {
      ctx.fillRect(g - ROAD_W / 2, 0, ROAD_W, WORLD);
      ctx.fillRect(0, g - ROAD_W / 2, WORLD, ROAD_W);
    }
    // Lane dashes.
    ctx.fillStyle = '#e8d44d';
    for (const g of GRID) {
      for (let d = 0; d < WORLD; d += 64) {
        ctx.fillRect(g - 2, d, 4, 30);
        ctx.fillRect(d, g - 2, 30, 4);
      }
    }
    // Crosswalks at intersections.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const gx of GRID) {
      for (const gy of GRID) {
        for (let i = -2; i <= 2; i += 1) {
          ctx.fillRect(gx - ROAD_W / 2 + 4 + (i + 2) * 13, gy - ROAD_W / 2 - 10, 8, 20);
          ctx.fillRect(gx - ROAD_W / 2 - 10, gy - ROAD_W / 2 + 4 + (i + 2) * 13, 20, 8);
        }
      }
    }
  }

  function drawTrees(city, cam) {
    for (const t of city.trees) {
      if (t.x < cam.x - 40 || t.x > cam.x + cam.w + 40 || t.y < cam.y - 40 || t.y > cam.y + cam.h + 40) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(t.x + 5, t.y + 6, t.r, t.r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f7d3a';
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4da34d';
      ctx.beginPath();
      ctx.arc(t.x - 3, t.y - 3, t.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBuildings(city, cam) {
    // Sort far-to-near so nearer roofs overlap farther walls.
    const visible = city.buildings.filter(
      (b) => b.x + b.w > cam.x - 120 && b.x < cam.x + cam.w + 120 && b.y + b.h > cam.y - 120 && b.y < cam.y + cam.h + 120,
    );
    visible.sort((a, b) => a.y - b.y);
    for (const b of visible) {
      const h = b.height;
      const sx = SUN.x * h * 0.35;
      const sy = SUN.y * h * 0.35;
      // Ground shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(b.x + sx * 0.4, b.y + sy * 0.4, b.w, b.h);
      // South + east faces (the extruded sides).
      ctx.fillStyle = shade(b.wall, -28);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.h);
      ctx.lineTo(b.x + sx, b.y + b.h + sy);
      ctx.lineTo(b.x + b.w + sx, b.y + b.h + sy);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(b.wall, -48);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w, b.y);
      ctx.lineTo(b.x + b.w + sx, b.y + sy);
      ctx.lineTo(b.x + b.w + sx, b.y + b.h + sy);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.closePath();
      ctx.fill();
      // Roof.
      ctx.fillStyle = b.roof;
      ctx.beginPath();
      ctx.moveTo(b.x + sx, b.y + sy);
      ctx.lineTo(b.x + b.w + sx, b.y + sy);
      ctx.lineTo(b.x + b.w + sx, b.y + b.h + sy);
      ctx.lineTo(b.x + sx, b.y + b.h + sy);
      ctx.closePath();
      ctx.fill();
      // Roof detail: parapet + a vent or two.
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + sx + 6, b.y + sy + 6);
      ctx.lineTo(b.x + b.w + sx - 6, b.y + sy + 6);
      ctx.lineTo(b.x + b.w + sx - 6, b.y + b.h + sy - 6);
      ctx.lineTo(b.x + sx + 6, b.y + b.h + sy - 6);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(b.x + sx + b.w * 0.25, b.y + sy + b.h * 0.3, 14, 10);
      ctx.fillRect(b.x + sx + b.w * 0.6, b.y + sy + b.h * 0.55, 10, 10);
      // Landmark sign.
      if (b.landmark) {
        ctx.fillStyle = '#20242e';
        const label = b.name;
        ctx.font = font(15, true);
        const w = ctx.measureText(label).width + 18;
        const lx = b.x + b.w / 2 - w / 2;
        const ly = b.y + b.h / 2 - 12;
        roundRect(lx, ly, w, 24, 5);
        ctx.fill();
        ctx.fillStyle = '#ffd94d';
        ctx.textAlign = 'center';
        ctx.fillText(label, b.x + b.w / 2, ly + 17);
      }
    }
  }

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amount, 0, 255);
    const g = clamp(((n >> 8) & 0xff) + amount, 0, 255);
    const b = clamp((n & 0xff) + amount, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // ---- entities ----
  function drawCarShape(x, y, angle, color, police, taxi) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(-27, -12, 54, 28, 8);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(-26, -13, 52, 26, 8);
    ctx.fill();
    // Windshield + rear window.
    ctx.fillStyle = '#1c2733';
    roundRect(2, -11, 12, 22, 3);
    ctx.fill();
    ctx.fillRect(-22, -11, 7, 22);
    // Headlights.
    ctx.fillStyle = '#fff8c0';
    ctx.fillRect(24, -11, 3, 5);
    ctx.fillRect(24, 6, 3, 5);
    if (police) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-8, -13, 16, 4);
      ctx.fillStyle = '#d94f3d';
      ctx.fillRect(-8, -13, 8, 4);
      ctx.fillStyle = '#3d7bd9';
      ctx.fillRect(0, -13, 8, 4);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(8, true);
      ctx.textAlign = 'center';
      ctx.fillText('VBPD', 0, 2);
    }
    if (taxi) {
      ctx.fillStyle = '#20242e';
      ctx.font = font(8, true);
      ctx.textAlign = 'center';
      ctx.fillText('TAXI', 0, 2);
    }
    ctx.restore();
  }

  function drawPerson(x, y, angle, color, isPlayer, aiming) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 4, 12, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2c89b';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    // Facing tick.
    ctx.fillStyle = color;
    ctx.fillRect(8, -3, 7, 6);
    ctx.restore();
    if (isPlayer) {
      ctx.strokeStyle = '#ffd94d';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.stroke();
      if (aiming) {
        ctx.strokeStyle = 'rgba(255,217,77,0.7)';
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(aiming) * 18, y + Math.sin(aiming) * 18);
        ctx.lineTo(x + Math.cos(aiming) * 34, y + Math.sin(aiming) * 34);
        ctx.stroke();
      }
    }
  }

  function drawWorld(state, city) {
    const p = state.player;
    const zoom = p.onFoot ? 1.0 : 0.82;
    view.zoom = zoom;
    const vw = view.w / zoom;
    const vh = view.h / zoom;
    const camX = clamp(p.x - vw / 2, -80, WORLD - vw + 80);
    const camY = clamp(p.y - vh / 2, -80, WORLD - vh + 80);
    view.camX = camX;
    view.camY = camY;
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    const cam = { x: camX, y: camY, w: vw, h: vh };
    drawGround(city, cam);
    // Pickups (cash briefcases).
    for (const pk of state.pickups) {
      if (pk.taken) continue;
      const bob = Math.sin(state.time * 3 + pk.x) * 3;
      ctx.fillStyle = pk.kind === 'cash' ? '#ffd94d' : '#ff5a5a';
      roundRect(pk.x - 12, pk.y - 9 + bob, 24, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#20242e';
      ctx.font = font(12, true);
      ctx.textAlign = 'center';
      ctx.fillText(pk.kind === 'cash' ? '$' : '+', pk.x, pk.y + 4 + bob);
    }
    drawTrees(city, cam);
    // Mission marker: a bouncing beacon over the current objective.
    const marker = missionMarker(state, city);
    if (marker) {
      const bob = Math.sin(state.time * 4) * 8;
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath();
      ctx.moveTo(marker.x, marker.y - 52 + bob);
      ctx.lineTo(marker.x - 10, marker.y - 72 + bob);
      ctx.lineTo(marker.x + 10, marker.y - 72 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,217,77,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 34 + Math.sin(state.time * 4) * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawBuildings(city, cam);
    // Cars.
    for (const car of state.cars) {
      if (car.dead) continue;
      if (car.x < camX - 80 || car.x > camX + vw + 80 || car.y < camY - 80 || car.y > camY + vh + 80) continue;
      drawCarShape(car.x, car.y, car.angle, car.color, !!car.police, !!car.model.taxi);
    }
    // Pedestrians.
    for (const ped of state.peds) {
      if (ped.dead) continue;
      if (ped.x < camX - 40 || ped.x > camX + vw + 40 || ped.y < camY - 40 || ped.y > camY + vh + 40) continue;
      drawPerson(ped.x, ped.y, ped.angle, ped.color, false);
    }
    // Mission enemies.
    for (const e of state.enemies) {
      if (e.dead) continue;
      drawPerson(e.x, e.y, e.angle, e.color, false);
      ctx.fillStyle = '#20242e';
      ctx.fillRect(e.x - 14, e.y - 24, 28, 5);
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(e.x - 14, e.y - 24, 28 * clamp(e.health / 60, 0, 1), 5);
    }
    // Police on foot.
    for (const cop of state.cops) {
      if (cop.car || cop.down) continue;
      drawPerson(cop.x, cop.y, cop.angle, '#2b4a8a', false);
      ctx.fillStyle = '#2b4a8a';
      ctx.beginPath();
      ctx.arc(cop.x, cop.y - 2, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bullets.
    ctx.fillStyle = '#ffe9a8';
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player (on foot only; in a car the car is the player).
    if (p.onFoot) {
      const blink = p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0;
      if (!blink) drawPerson(p.x, p.y, p.angle, '#e84c6d', true, state.hasPistol ? p.aimAngle : null);
    }
    ctx.restore();
    return { camX, camY, vw, vh, zoom };
  }

  function missionMarker(state, city) {
    const m = state.mission;
    if (!m) return null;
    const stage = m.def.stages[m.stage];
    if (!stage) return null;
    if (stage.type === 'race') {
      const name = stage.checkpoints[m.checkpoint];
      const lm = city.landmarks[name];
      return lm ? { x: lm.x, y: lm.y } : null;
    }
    if (stage.target) {
      const lm = city.landmarks[stage.target];
      return lm ? { x: lm.x, y: lm.y } : null;
    }
    return null;
  }

  // ---- HUD + minimap ----
  function drawMinimap(state, city, viewInfo) {
    const size = 190;
    const x0 = 16;
    const y0 = view.h - size - 16;
    const scale = size / WORLD;
    ctx.save();
    ctx.fillStyle = 'rgba(16,20,28,0.82)';
    roundRect(x0 - 6, y0 - 6, size + 12, size + 12, 10);
    ctx.fill();
    ctx.beginPath();
    roundRect(x0, y0, size, size, 6);
    ctx.clip();
    ctx.fillStyle = '#5d8a4a';
    ctx.fillRect(x0, y0, size, size);
    // Water + beach.
    ctx.fillStyle = '#3f9ec4';
    ctx.fillRect(x0 + 3140 * scale, y0, size - 3140 * scale, size);
    ctx.fillStyle = '#e8d9a0';
    ctx.fillRect(x0 + 3032 * scale, y0, 108 * scale, size);
    // Roads.
    ctx.fillStyle = '#3a3f4a';
    for (const g of GRID) {
      ctx.fillRect(x0 + (g - ROAD_W / 2) * scale, y0, ROAD_W * scale, size);
      ctx.fillRect(x0, y0 + (g - ROAD_W / 2) * scale, size, ROAD_W * scale);
    }
    // Buildings.
    ctx.fillStyle = '#c9c2b2';
    for (const b of city.buildings) {
      ctx.fillRect(x0 + b.x * scale, y0 + b.y * scale, Math.max(2, b.w * scale), Math.max(2, b.h * scale));
    }
    // Mission marker.
    const marker = missionMarker(state, city);
    if (marker) {
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath();
      ctx.arc(x0 + marker.x * scale, y0 + marker.y * scale, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#20242e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Police.
    ctx.fillStyle = '#5a8cff';
    for (const cop of state.cops) {
      if (cop.down) continue;
      ctx.beginPath();
      ctx.arc(x0 + cop.x * scale, y0 + cop.y * scale, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Enemies.
    ctx.fillStyle = '#ff5a5a';
    for (const e of state.enemies) {
      if (e.dead) continue;
      ctx.beginPath();
      ctx.arc(x0 + e.x * scale, y0 + e.y * scale, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    const p = state.player;
    ctx.save();
    ctx.translate(x0 + p.x * scale, y0 + p.y * scale);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // Viewport rectangle.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + viewInfo.camX * scale, y0 + viewInfo.camY * scale, viewInfo.vw * scale, viewInfo.vh * scale);
  }

  function drawHud(state, city, viewInfo) {
    const p = state.player;
    // Top-left: cash + debt.
    ctx.fillStyle = 'rgba(16,20,28,0.72)';
    roundRect(16, 14, 250, 64, 10);
    ctx.fill();
    text(`$${state.cash.toLocaleString('en-US')}`, 30, 42, 26, '#7ee787', 'left', true);
    const debtLeft = Math.max(0, 4000 - state.debtPaid);
    text(`Debt left: $${debtLeft.toLocaleString('en-US')}`, 30, 66, 15, '#e8e4d8');
    // Top-right: wanted stars.
    const stars = state.wantedStars;
    ctx.fillStyle = 'rgba(16,20,28,0.72)';
    roundRect(view.w - 236, 14, 220, 52, 10);
    ctx.fill();
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i < stars ? '#ffd94d' : 'rgba(255,255,255,0.25)';
      const sx = view.w - 216 + i * 40;
      const sy = 40;
      ctx.beginPath();
      for (let k = 0; k < 5; k += 1) {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        const a2 = a + Math.PI / 5;
        const px = sx + Math.cos(a) * 13;
        const py = sy + Math.sin(a) * 13;
        const qx = sx + Math.cos(a2) * 5.5;
        const qy = sy + Math.sin(a2) * 5.5;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        ctx.lineTo(qx, qy);
      }
      ctx.closePath();
      ctx.fill();
    }
    // Health + armor bar, under the stars.
    const barW = 220;
    const bx = view.w - 236;
    const by = 76;
    ctx.fillStyle = 'rgba(16,20,28,0.72)';
    roundRect(bx, by, barW, 40, 10);
    ctx.fill();
    ctx.fillStyle = '#3a3f4a';
    roundRect(bx + 10, by + 10, barW - 20, 10, 5);
    ctx.fill();
    ctx.fillStyle = p.health > 30 ? '#7ee787' : '#ff5a5a';
    roundRect(bx + 10, by + 10, (barW - 20) * clamp(p.health / 100, 0, 1), 10, 5);
    ctx.fill();
    text(`HP ${Math.ceil(p.health)}`, bx + 12, by + 34, 12, '#e8e4d8', 'left', true);
    if (p.armor > 0) text(`Armor ${Math.ceil(p.armor)}`, bx + 90, by + 34, 12, '#5a8cff', 'left', true);
    if (state.hasPistol) text(`Ammo ${state.ammo}`, bx + 160, by + 34, 12, '#ffd94d', 'left', true);
    // Mission objective, top centre.
    const m = state.mission;
    if (m) {
      const stage = m.def.stages[m.stage];
      const label = stage ? stage.text : m.def.name;
      ctx.font = font(17, true);
      const w = Math.min(view.w - 40, ctx.measureText(label).width + 120);
      ctx.fillStyle = 'rgba(16,20,28,0.78)';
      roundRect((view.w - w) / 2, 14, w, 44, 10);
      ctx.fill();
      ctx.fillStyle = '#ffd94d';
      ctx.textAlign = 'center';
      ctx.fillText(`★ ${m.def.name}`, view.w / 2, 32);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(15, false);
      ctx.fillText(label, view.w / 2, 50);
      // Hold / timer progress.
      if (stage && stage.type === 'hold') {
        const frac = clamp(m.holdTimer / stage.hold, 0, 1);
        ctx.fillStyle = '#3a3f4a';
        ctx.fillRect((view.w - 200) / 2, 62, 200, 8);
        ctx.fillStyle = '#ffd94d';
        ctx.fillRect((view.w - 200) / 2, 62, 200 * frac, 8);
      } else if (stage && stage.time) {
        const left = Math.max(0, stage.time - m.timer);
        text(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, view.w / 2, 76, 16, '#ffb0b0', 'center', true);
      }
    } else if (state.missionIndex < MISSIONS.length) {
      ctx.fillStyle = 'rgba(16,20,28,0.6)';
      ctx.font = font(14, false);
      const label = `Next mission: ${MISSIONS[state.missionIndex].name} — press R at the garage`;
      const w = ctx.measureText(label).width + 36;
      roundRect((view.w - w) / 2, 14, w, 34, 10);
      ctx.fill();
      ctx.fillStyle = '#e8e4d8';
      ctx.textAlign = 'center';
      ctx.fillText(label, view.w / 2, 36);
    }
    // Toast message, below the objective bar so it never covers the HUD.
    if (state.messageTimer > 0 && state.missionMessage) {
      const msg = state.missionMessage.length > 120 ? state.missionMessage.slice(0, 117) + '…' : state.missionMessage;
      ctx.font = font(15, false);
      const w = Math.min(980, ctx.measureText(msg).width + 40);
      ctx.fillStyle = 'rgba(16,20,28,0.8)';
      roundRect((view.w - w) / 2, 108, w, 34, 10);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(msg, view.w / 2, 130);
    }
    // Shop prompt.
    if (state.nearShop) {
      ctx.font = font(15, true);
      const w = ctx.measureText(state.nearShop.label).width + 36;
      ctx.fillStyle = 'rgba(32,36,46,0.85)';
      roundRect((view.w - w) / 2, view.h - 116, w, 34, 10);
      ctx.fill();
      ctx.fillStyle = '#ffd94d';
      ctx.textAlign = 'center';
      ctx.fillText(state.nearShop.label, view.w / 2, view.h - 93);
    }
    // Speed + car name, bottom right.
    if (!p.onFoot && p.car) {
      const kmh = Math.round(Math.abs(p.car.speed) * 0.36);
      text(`${kmh}`, view.w - 30, view.h - 56, 44, '#ffffff', 'right', true);
      text('km/h', view.w - 30, view.h - 30, 14, '#c9c2b2', 'right');
      text(p.car.model.name, view.w - 30, view.h - 84, 15, '#ffd94d', 'right', true);
      if (p.car.health < 100) {
        ctx.fillStyle = '#3a3f4a';
        ctx.fillRect(view.w - 190, view.h - 104, 160, 8);
        ctx.fillStyle = p.car.health > 30 ? '#7ee787' : '#ff5a5a';
        ctx.fillRect(view.w - 190, view.h - 104, 160 * clamp(p.car.health / 100, 0, 1), 8);
      }
    }
    // Controls hint, bottom centre (fades after a while).
    if (state.time < 25) {
      text('WASD drive / walk · E enter car · F punch · Click shoot · Space handbrake · R mission · P pause · M mute', view.w / 2, view.h - 18, 13, 'rgba(255,255,255,0.75)', 'center');
    }
    drawMinimap(state, city, viewInfo);
  }

  // ---- panels ----
  function drawPanel(title, lines, prompt, accent) {
    ctx.fillStyle = 'rgba(10,12,18,0.55)';
    ctx.fillRect(0, 0, view.w, view.h);
    const w = Math.min(680, view.w - 60);
    const h = 150 + lines.length * 30 + 70;
    const x = (view.w - w) / 2;
    const y = (view.h - h) / 2;
    ctx.fillStyle = 'rgba(20,24,34,0.96)';
    roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    text(title, view.w / 2, y + 62, 44, accent, 'center', true);
    lines.forEach((line, i) => {
      text(line, view.w / 2, y + 112 + i * 30, 18, '#e8e4d8', 'center');
    });
    text(prompt, view.w / 2, y + h - 30, 18, '#ffd94d', 'center', true);
  }

  function drawTitle(state, city, best) {
    const viewInfo = drawWorld(state, city);
    // Title over the live city.
    ctx.fillStyle = 'rgba(10,12,18,0.45)';
    ctx.fillRect(0, 0, view.w, view.h);
    const cx = view.w / 2;
    text('VICEROY BAY', cx, 190, 84, '#ffd94d', 'center', true);
    ctx.fillStyle = '#ff6b5e';
    ctx.fillRect(cx - 190, 208, 380, 4);
    text('An open-world crime story in the sun', cx, 252, 24, '#ffffff', 'center');
    const lines = [
      'Dana Reyes owes the crew $4,000. Six jobs stand between her and freedom.',
      'Steal cars, outrun the VBPD, run missions across a living city —',
      'on foot and behind the wheel, with a minimap, a wanted level and a save.',
      '',
      'WASD move / drive · E enter car · F punch · Click shoot · Space handbrake',
      'R start mission · Q use shop · P pause · M mute music',
    ];
    lines.forEach((line, i) => text(line, cx, 310 + i * 30, 18, i < 3 ? '#e8e4d8' : '#c9c2b2', 'center'));
    if (best && best.missionsDone > 0) {
      text(`Best run: ${best.missionsDone} mission${best.missionsDone === 1 ? '' : 's'} done · $${best.cash} earned`, cx, 310 + lines.length * 30 + 6, 16, '#7ee787', 'center', true);
    }
    const prompt = state.hasSave ? 'Enter — New game · C — Continue saved game' : 'Press Enter or click to start';
    text(prompt, cx, view.h - 90, 22, '#ffd94d', 'center', true);
    text('A wholly original game. No part of it comes from any commercial game.', cx, view.h - 52, 13, 'rgba(255,255,255,0.6)', 'center');
    return viewInfo;
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen. */
  function draw(state, city, screen, extra) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, view.w, view.h);
    if (screen === SCREEN_TITLE) {
      drawTitle(state, city, extra);
      return;
    }
    const viewInfo = drawWorld(state, city);
    drawHud(state, city, viewInfo);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The city waits for you.', `Cash $${state.cash} · Missions done ${state.stats.missionsDone}/6`], 'P — resume · S — save game', '#7ec8e8');
    } else if (screen === SCREEN_BUSTED) {
      drawPanel('BUSTED', ['The VBPD caught up with you.', `Fine paid. Cash left: $${state.cash}.`, 'The crew is not impressed.'], 'Enter — walk out of the station', '#5a8cff');
    } else if (screen === SCREEN_OVER) {
      const lines = [
        `Missions done: ${state.stats.missionsDone} of 6 · Cash earned $${state.cash}`,
        `Cars stolen: ${state.carsStolen} · KOs: ${state.kills}`,
        state.stats.missionsDone >= 6 ? 'Viceroy Bay is yours, Dana.' : 'Rico is already lining up the next job.',
      ];
      drawPanel('WASTED', lines, 'Enter — try again · C — continue from save', '#ff5a5a');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, view };
}
