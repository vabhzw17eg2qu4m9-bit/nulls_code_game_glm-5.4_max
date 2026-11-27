import { PLAYER } from '../config.js';

/** Grow `r` by `pad` on every side (negative shrinks) and return true when it overlaps `o` (edges touching do not count). */
export function overlaps(r, o, pad = 0) {
  return r.x - pad < o.x + o.w && r.x + r.w + pad > o.x && r.y - pad < o.y + o.h && r.y + r.h + pad > o.y;
}

/** Distance between the closest points of two rects: 0 when they meet. */
export function gap(r, o) {
  const dx = Math.max(0, o.x - (r.x + r.w), r.x - (o.x + o.w));
  const dy = Math.max(0, o.y - (r.y + r.h), r.y - (o.y + o.h));
  return Math.hypot(dx, dy);
}

/**
 * AABB `{ x, y, w, h }` (bottom-left form) of an entity whose position `(x, y)` is its bottom center.
 * Defaults to ILO's body; pass `w, h` for enemies and other bottom-center entities.
 */
export function bodyRect(x, y, w = PLAYER.w, h = PLAYER.h) {
  return { x: x - w / 2, y, w, h };
}

const CELL_SIZE = 8;
const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;

function cellCoord(v) {
  return Math.floor(v / CELL_SIZE);
}

/**
 * Static acceleration structure over `world.solids`: `Map<cellKey, Solid[]>`.
 * Call after the solid list changes (creation, checkpoint restore).
 */
export function buildGrid(solids) {
  const grid = new Map();
  for (const s of solids) {
    for (let cx = cellCoord(s.x); cx <= cellCoord(s.x + s.w); cx++) {
      for (let cy = cellCoord(s.y); cy <= cellCoord(s.y + s.h); cy++) {
        const k = key(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }
  return grid;
}

/** Static solids whose cells meet `r`. */
function queryGrid(grid, r) {
  const out = [];
  const seen = new Set();
  for (let cx = cellCoord(r.x); cx <= cellCoord(r.x + r.w); cx++) {
    for (let cy = cellCoord(r.y); cy <= cellCoord(r.y + r.h); cy++) {
      for (const s of grid.get(key(cx, cy)) ?? []) {
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
    }
  }
  return out;
}

/** Every static solid that overlaps `r` (edges touching do not count). */
export function staticHits(world, r) {
  return queryGrid(world.grid, r).filter((s) => overlaps(r, s));
}

/**
 * Dynamic solids as bottom-left rects: unbroken seams, enabled movers and loose cells. A cell's `x` is its
 * bottom center, so each loose cell gets a rect view that also carries its `state` and the `cell` itself.
 */
export function dynamicSolids(world) {
  const out = [];
  for (const s of world.seams) if (!s.broken) out.push(s);
  for (const m of world.movers) if (m.enabled) out.push(m);
  for (const c of world.cells) {
    if (c.state === 'loose') out.push({ x: c.x - c.w / 2, y: c.y, w: c.w, h: c.h, state: c.state, cell: c });
  }
  return out;
}

const SKIN = 0.01;
const MAX_SLICE = 0.4;
const extent = (r, axis) => (axis === 'x' ? r.w : r.h);
const ANY = () => true;

/**
 * Move rect `r` (in place) by `dx` along x and stop with exact contact at the first blocker; returns it or null.
 * Substeps of at most 0.4 units keep a 0.5-unit wall solid during a dash. A zero move resolves nothing.
 */
export function moveX(r, dx, world, dyn) {
  return dx === 0 ? null : sweep(r, 'x', dx, world, dyn ?? dynamicSolids(world));
}

/** Move rect `r` (in place) by `dy` along y and stop with exact contact at the first blocker; returns it or null. */
export function moveY(r, dy, world, dyn) {
  return dy === 0 ? null : sweep(r, 'y', dy, world, dyn ?? dynamicSolids(world));
}

/**
 * Axis sweep. Static solids always block. A dynamic solid blocks only when the leading edge started at or
 * outside its near face (within `SKIN`): float noise never lets a rect pass through a solid it touches, and a
 * rect already inside a closing mover stays free to move.
 */
function sweep(r, axis, delta, world, dyn) {
  const dir = delta > 0 ? 1 : -1;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_SLICE));
  const slice = delta / steps;
  const lead = r[axis] + (dir > 0 ? extent(r, axis) : 0);
  const blocks = (s) => {
    const face = s[axis] + (dir > 0 ? 0 : extent(s, axis));
    return dir > 0 ? lead <= face + SKIN : lead >= face - SKIN;
  };
  for (let i = 0; i < steps; i++) {
    r[axis] += slice;
    const hit = firstOverlap(r, world, dyn, blocks);
    if (hit) {
      r[axis] = hit[axis] + (dir > 0 ? -extent(r, axis) : extent(hit, axis));
      return hit;
    }
  }
  return null;
}

function firstOverlap(r, world, dyn, blocks) {
  const solid = staticHits(world, r)[0];
  if (solid) return solid;
  for (const s of dyn) if (blocks(s) && overlaps(r, s)) return s;
  return null;
}

/** `surface` of a contact for the `land` and `step` events: rock, metal, platform or cell. */
function surfaceOf(hit) {
  if (hit.kind !== undefined) return 'platform';
  if (hit.state === 'loose') return 'cell';
  return hit.mat ?? 'rock';
}

/** Ground contact under rect `r`: the solid within `depth` below it with its `surface`, or null. */
export function groundBelow(world, r, depth = 0.05, dyn) {
  const probe = { x: r.x, y: r.y - depth, w: r.w, h: depth };
  const hit = firstOverlap(probe, world, dyn ?? dynamicSolids(world), ANY);
  return hit ? { hit, surface: surfaceOf(hit) } : null;
}

/** Wall contact beside rect `r` on `side` (+1 right, −1 left): the solid within `depth` with its `surface`, or null. */
export function wallBeside(world, r, side, depth = 0.05, dyn) {
  const probe = side > 0 ? { x: r.x + r.w, y: r.y, w: depth, h: r.h } : { x: r.x - depth, y: r.y, w: depth, h: r.h };
  const hit = firstOverlap(probe, world, dyn ?? dynamicSolids(world), ANY);
  return hit ? { hit, surface: surfaceOf(hit) } : null;
}

function segmentHitsRect(x0, y0, x1, y1, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.w - x0], [-dy, y0 - r.y], [dy, r.y + r.h - y0]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * Pulse line of sight: true when the segment `(x0, y0)` → `(x1, y1)` crosses no static solid
 * and no shutter that is not fully open. Seams and other movers transmit.
 */
export function lineOfSight(world, x0, y0, x1, y1) {
  const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  for (const s of queryGrid(world.grid, box)) if (segmentHitsRect(x0, y0, x1, y1, s)) return false;
  for (const m of world.movers) {
    if (m.kind !== 'shutter' || !m.enabled || shutterIsOpen(m)) continue;
    if (segmentHitsRect(x0, y0, x1, y1, m)) return false;
  }
  return true;
}

/** True when a shutter rests fully open (`t` reached 1). A closing or closed shutter blocks pulse sight. */
function shutterIsOpen(m) {
  return m.t >= 1;
}
