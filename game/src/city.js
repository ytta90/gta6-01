// The city of Viceroy Bay: a seeded grid of avenues and streets, blocks of
// pastel art-deco buildings, a beach on the east edge, a park on the west, and
// the landmarks the story uses. Everything here is original fiction.
import { makeRng } from './rng.js';

export const WORLD = 3200;
export const ROAD_W = 72;
export const GRID = [160, 560, 960, 1360, 1760, 2160, 2560, 2960];

// Pastel art-deco palette for the buildings, roofs and trims.
const PALETTE = [
  { wall: '#f2a65a', roof: '#d97e36', trim: '#fff3e0' },
  { wall: '#7fc8bc', roof: '#4d9c8f', trim: '#eafaf5' },
  { wall: '#f7d774', roof: '#d9a441', trim: '#fff8dc' },
  { wall: '#e88ca0', roof: '#c25f78', trim: '#ffe9ef' },
  { wall: '#9db8e8', roof: '#6b8fc4', trim: '#e8f0ff' },
  { wall: '#c9b8e8', roof: '#9a7fc4', trim: '#f2eaff' },
  { wall: '#f5e6c8', roof: '#c9a86a', trim: '#ffffff' },
  { wall: '#8fd0a0', roof: '#5da271', trim: '#eafaf0' },
];

const CAR_COLORS = ['#d94f3d', '#3d7bd9', '#e8c33d', '#e8e8e8', '#2e2e38', '#7ec850', '#c06ad9', '#e8912d', '#4fc3d9'];

export function buildCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const trees = [];
  const parks = [];
  const landmarks = {};

  // Landmark plots, by block (col,row) in the grid: each is one whole block.
  const plots = {
    bank: { col: 3, row: 3, name: 'Viceroy Trust Bank' },
    garage: { col: 0, row: 6, name: "Dana's Garage" },
    hospital: { col: 5, row: 1, name: 'St. Marina Hospital' },
    police: { col: 4, row: 4, name: 'VBPD Central' },
    gunshop: { col: 2, row: 5, name: 'Ironworks Arms' },
    spray: { col: 1, row: 2, name: 'Turbo Spray' },
    diner: { col: 6, row: 5, name: 'Burger Barn' },
    pier: { col: 7, row: 2, name: 'Sunset Pier' },
    park: { col: 0, row: 0, name: 'Palm Court Park' },
    mall: { col: 5, row: 5, name: 'Bayfront Mall' },
  };

  function blockRect(col, row) {
    const x0 = GRID[col] + ROAD_W / 2;
    const y0 = GRID[row] + ROAD_W / 2;
    const x1 = (col + 1 < GRID.length ? GRID[col + 1] : WORLD) - ROAD_W / 2;
    const y1 = (row + 1 < GRID.length ? GRID[row + 1] : WORLD) - ROAD_W / 2;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Beach strip on the east edge, water beyond it.
  const beach = { x: 3032, y: 0, w: WORLD - 3032, h: WORLD };

  for (let col = 0; col < 7; col += 1) {
    for (let row = 0; row < 7; row += 1) {
      const rect = blockRect(col, row);
      const plot = Object.entries(plots).find(([, p]) => p.col === col && p.row === row);
      if (plot) {
        const [key, p] = plot;
        if (key === 'park') {
          parks.push({ ...rect, name: p.name });
          for (let i = 0; i < 26; i += 1) {
            trees.push({ x: rect.x + rng.range(20, rect.w - 20), y: rect.y + rng.range(20, rect.h - 20), r: rng.range(9, 15) });
          }
          landmarks[key] = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, name: p.name, rect };
          continue;
        }
        if (key === 'pier') {
          landmarks[key] = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, name: p.name, rect };
          continue;
        }
        const pal = PALETTE[(col * 7 + row) % PALETTE.length];
        const bw = rect.w * 0.62;
        const bh = rect.h * 0.55;
        const b = {
          x: rect.x + (rect.w - bw) / 2,
          y: rect.y + (rect.h - bh) / 2,
          w: bw,
          h: bh,
          height: key === 'bank' ? 110 : key === 'mall' ? 64 : rng.range(34, 78),
          ...pal,
          landmark: key,
          name: p.name,
        };
        buildings.push(b);
        landmarks[key] = { x: b.x + b.w / 2, y: b.y + b.h / 2, name: p.name, rect: b };
        continue;
      }
      // Ordinary block: 1-4 buildings with alleys between them.
      const count = rng.int(1, 3);
      const cols = count === 1 ? 1 : 2;
      const rows = count <= 2 ? 1 : 2;
      for (let i = 0; i < cols; i += 1) {
        for (let j = 0; j < rows; j += 1) {
          if (i * rows + j >= count) break;
          const cellW = rect.w / cols;
          const cellH = rect.h / rows;
          const bw = cellW * rng.range(0.55, 0.78);
          const bh = cellH * rng.range(0.55, 0.78);
          const pal = rng.pick(PALETTE);
          buildings.push({
            x: rect.x + i * cellW + (cellW - bw) / 2,
            y: rect.y + j * cellH + (cellH - bh) / 2,
            w: bw,
            h: bh,
            height: rng.range(18, 96),
            ...pal,
            landmark: null,
            name: null,
          });
        }
      }
      // A couple of street trees per block corner.
      for (let i = 0; i < 2; i += 1) {
        trees.push({
          x: rect.x + rng.range(8, 26),
          y: rect.y + rng.range(8, rect.h - 8),
          r: rng.range(8, 13),
        });
      }
    }
  }

  // Road graph: intersections and the streets between them, for traffic.
  const nodes = [];
  for (const gx of GRID) {
    for (const gy of GRID) nodes.push({ x: gx, y: gy });
  }
  function nearestNode(x, y) {
    let best = nodes[0];
    let bd = Infinity;
    for (const n of nodes) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // Parking spots along the roads, for parked (stealable) cars.
  const parkSpots = [];
  for (const gx of GRID) {
    for (let k = 0; k < 5; k += 1) {
      const y = 240 + k * 560 + rng.range(-60, 60);
      parkSpots.push({ x: gx + ROAD_W / 2 + 12, y, angle: Math.PI / 2 });
      parkSpots.push({ x: gx - ROAD_W / 2 - 12, y: y + 180, angle: -Math.PI / 2 });
    }
  }

  return {
    seed,
    buildings,
    trees,
    parks,
    landmarks,
    beach,
    nodes,
    nearestNode,
    parkSpots,
    carColors: CAR_COLORS,
    // A point on a road near a landmark, for mission waypoints.
    roadNear(x, y) {
      const n = nearestNode(x, y);
      return { x: n.x + 40, y: n.y + 40 };
    },
  };
}

// Is the point on a road (within the road width of a grid line)?
export function onRoad(x, y) {
  for (const g of GRID) {
    if (Math.abs(x - g) < ROAD_W / 2 + 6) return true;
    if (Math.abs(y - g) < ROAD_W / 2 + 6) return true;
  }
  return false;
}

// Nearest point on the road network (for spawning traffic on roads).
export function snapToRoad(x, y) {
  let best = { x, y };
  let bd = Infinity;
  for (const gx of GRID) {
    const d = Math.abs(x - gx);
    if (d < bd) { bd = d; best = { x: gx, y }; }
  }
  for (const gy of GRID) {
    const d = Math.abs(y - gy);
    if (d < bd) { bd = d; best = { x, y: gy }; }
  }
  return best;
}
