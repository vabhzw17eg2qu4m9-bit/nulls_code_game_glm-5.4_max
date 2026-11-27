// The camera rig (contract §5.1): pure code, no DOM and no WebGL. It computes where the view looks; `placeCamera` puts a Three.js camera there.

import { PLAYER } from '../config.js';

const YAW = (22 * Math.PI) / 180; // the camera sits to the right of the lane
const PITCH = (14 * Math.PI) / 180; // and above it
const DISTANCE = 34; // from the view center along the view axis
const VIEW_H = 14; // visible height in units on wide screens: a 16:9 view keeps it
const MIN_VIEW_W = 16; // the visible width in units never drops below this ...
const MAX_VIEW_W = 28.5; // ... and never exceeds this, so the view stays near the size of a camera zone
const LOOK_AHEAD = 2.5; // units ahead of ILO at full speed
const LEAD_RATE = 4; // per second: how fast the look-ahead turns with ILO, so the zigzag of a wall jump does not shake the view
const REST_Y = -3; // at rest ILO's feet hang this far below the center of the view's free height
const DEAD_TOP = 2; // vertical dead zone above the rest line: a jump barely moves the view
const DEAD_BOTTOM = 1.3; // and below it
const FOLLOW = 14; // per second: how fast the view approaches its target
const MAX_SPEED = 90; // units per second: the view never jumps, whatever the frame rate
const ZONE_TIME = 0.6; // seconds to ease from one camera zone's range to the next
const ZONE_SWITCH = 1; // units: another zone must lie this much nearer than the one in use before the view changes zone
const LOOK_RATE = 4; // per second: ease toward a relay look hint, and back
const LOOK_MARGIN = 5; // units of view half size a look hint leaves around ILO
const SHAKE_TIME = 0.2;
const SHAKE_SIZE = 0.12;
const KEEP_TOP = 0.5; // units between the bottom of the top band and ILO's head ...
const KEEP_BOTTOM = 1; // ... and between ILO's feet and the top of the bottom band
const NO_BANDS = Object.freeze({ top: 0, bottom: 0, left: 0, right: 0 });
const SURFACE_Y = 2; // units from the cabin floor up to the view center once the lift has surfaced (GOAL §16) ...
const SURFACED = new Set(['surface', 'terrace']); // ... in these stages, so that the opening and the sky fill the view
const LIFT_OPEN = 4.4; // units over the cabin floor: the top of the opening the lift rises to, kept under the top band ...
const LIFT_RISING = new Set(['rise', 'surface', 'terrace']); // ... from the rise on, where the cabin moves

// Camera basis. `TO_VIEWER` points at the viewer; `RIGHT` is the world x axis projected onto the screen, so
// world x is horizontal on screen; `UP` completes the right-handed basis. World z runs down-left on screen.
const TO_VIEWER = [Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => v.map((n) => n / Math.hypot(...v));
const RIGHT = unit([1 - TO_VIEWER[0] ** 2, -TO_VIEWER[0] * TO_VIEWER[1], -TO_VIEWER[0] * TO_VIEWER[2]]);
const UP = unit(cross(TO_VIEWER, RIGHT));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const holds = (zone, p) => p.x >= zone.x0 && p.x <= zone.x1 && p.y >= zone.y0 && p.y <= zone.y1;
const area = (zone) => (zone.x1 - zone.x0) * (zone.y1 - zone.y0);
const smooth = (t) => t * t * (3 - 2 * t);

/** The part of the gameplay plane (z 0) that the view shows: `{ x0, y0, x1, y1 }` in world units. */
export function viewRect(view, viewW, viewH) {
  const halfW = ((viewW * view.unitsPerPixel) / 2) / RIGHT[0];
  const halfH = ((viewH * view.unitsPerPixel) / 2) / UP[1];
  return { x0: view.x - halfW, y0: view.y - halfH, x1: view.x + halfW, y1: view.y + halfH };
}

/**
 * Writes into `rect` the part of the gameplay plane that a view centered at (`x`, `y`) shows between the bands `bands`
 * (canvas pixels, as `setBands` takes them): `{ x0, y0, x1, y1 }` in world units, the box the interface leaves free.
 */
function setFreeRect(rect, x, y, unitsPerPixel, viewW, viewH, bands) {
  const halfW = ((viewW * unitsPerPixel) / 2) / RIGHT[0];
  const halfH = ((viewH * unitsPerPixel) / 2) / UP[1];
  rect.x0 = x - halfW + (bands.left * unitsPerPixel) / RIGHT[0];
  rect.x1 = x + halfW - (bands.right * unitsPerPixel) / RIGHT[0];
  rect.y0 = y - halfH + (bands.bottom * unitsPerPixel) / UP[1];
  rect.y1 = y + halfH - (bands.top * unitsPerPixel) / UP[1];
  return rect;
}

/**
 * The part of the gameplay plane the view shows between its bands, without its shake: `{ x0, y0, x1, y1 }` in world
 * units. Exported for the tests only: they call it, the game does not.
 */
export function freeRect(view, viewW, viewH, bands) {
  return setFreeRect({}, view.x, view.y, view.unitsPerPixel, viewW, viewH, bands);
}

/**
 * World offset `{ x, y, z }` that moves a point `depth` units behind the gameplay plane along the view axis
 * (negative: in front of it) without changing its screen position: something mounted on a wall lines up with the wall.
 */
export function depthOffset(depth) {
  return { x: -depth * TO_VIEWER[0], y: -depth * TO_VIEWER[1], z: -depth * TO_VIEWER[2] };
}

/** Put the orthographic `camera` where `view` (the result of the rig's `update`) looks, for a canvas of `viewW × viewH` pixels. */
export function placeCamera(camera, view, viewW, viewH) {
  const halfW = (viewW * view.unitsPerPixel) / 2;
  const halfH = (viewH * view.unitsPerPixel) / 2;
  const x = view.x + view.shakeX;
  const y = view.y + view.shakeY;
  // The frustum of an orthographic camera is in camera space: it is centered on the camera axis.
  camera.left = -halfW;
  camera.right = halfW;
  camera.bottom = -halfH;
  camera.top = halfH;
  camera.up.set(...UP);
  camera.position.set(x + TO_VIEWER[0] * DISTANCE, y + TO_VIEWER[1] * DISTANCE, TO_VIEWER[2] * DISTANCE);
  camera.lookAt(x, y, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/**
 * Where the view center may sit for a zone, for a view of half size `hw × hh`: clamped inside it; on an axis the
 * zone cannot hold, clamped inside the level bounds instead.
 */
function rangeFor(zone, hw, hh, bounds) {
  if (zone === null) return { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity };
  const fit = (low, high, half) => (high - low < 2 * half ? [(low + high) / 2, (low + high) / 2] : [low + half, high - half]);
  const [x0, x1] = zone.x1 - zone.x0 < 2 * hw ? fit(bounds.x0, bounds.x1, hw) : [zone.x0 + hw, zone.x1 - hw];
  const [y0, y1] = zone.y1 - zone.y0 < 2 * hh ? fit(bounds.y0, bounds.y1, hh) : [zone.y0 + hh, zone.y1 - hh];
  return { x0, x1, y0, y1 };
}

/**
 * The camera rig of one level. `update(world, dt, viewW, viewH)` returns `{ x, y, unitsPerPixel, shakeX, shakeY, zone, free }`:
 * the view center in world units, the world units per canvas pixel, the damage shake, the camera zone in use, and the
 * box of the gameplay plane the view shows between its interface bands (one object, rewritten by every update).
 * `dt` is visual seconds; at 0 nothing moves.
 */
export function createCameraRig(level) {
  const zones = (level.camera ?? []).map((zone) => ({ ...zone }));
  const bounds = level.bounds;
  const spawn = level.spawn;
  const state = {
    world: null, mode: null, x: spawn.x, y: spawn.y - REST_Y, hp: PLAYER.h,
    zone: undefined, from: null, zoneT: 1, range: rangeFor(null), lead: 0, hint: null, look: 0, shake: 0, reduced: false,
  };
  let bands = NO_BANDS;

  /**
   * The zone in use now, with its range: of the zones that hold ILO, the one whose range lies nearest to the point
   * the view wants to look at, so that a change of zone never pulls the view away from ILO. The zone in use keeps
   * that role until another one lies clearly nearer, so pacing where two are equally near does not rock the view.
   * A new rig or a reboot takes the nearest, as a rig that starts there would.
   */
  function chooseZone(p, target, half, snap) {
    let best = null;
    let inUse = null;
    for (const zone of zones) {
      if (!holds(zone, p)) continue;
      const range = rangeFor(zone, half.x1, half.y1, bounds);
      const entry = {
        zone, range,
        near: Math.hypot(Math.max(range.x0 - target.x, target.x - range.x1, 0), Math.max(range.y0 - target.y, target.y - range.y1, 0)),
      };
      if (zone === state.zone) inUse = entry;
      if (best === null || entry.near < best.near || (entry.near === best.near && area(zone) < area(best.zone))) best = entry;
    }
    if (best === null) return { zone: null, range: rangeFor(null), near: 0 };
    return !snap && inUse !== null && inUse.near <= best.near + ZONE_SWITCH ? inUse : best;
  }

  const free = {}; // the free box of the last update, handed out with the view
  function update(world, dt, viewW, viewH) {
    const p = world.player;
    const unitsPerPixel = 1 / clamp(viewH / VIEW_H, viewW / (MAX_VIEW_W * RIGHT[0]), viewW / (MIN_VIEW_W * RIGHT[0]));
    const size = viewRect({ x: 0, y: 0, unitsPerPixel }, viewW, viewH);
    const band = {
      top: (bands.top * unitsPerPixel) / UP[1], bottom: (bands.bottom * unitsPerPixel) / UP[1],
      left: (bands.left * unitsPerPixel) / RIGHT[0], right: (bands.right * unitsPerPixel) / RIGHT[0],
    };
    // The free height between the top and the bottom band. ILO rests below its center as on a view without bands,
    // moved up where the view is too short for the dead zone to fit between the bands.
    const freeH = 2 * size.y1 - band.top - band.bottom;
    const rest = band.bottom - size.y1 + clamp(freeH / 2 + REST_Y, KEEP_BOTTOM + DEAD_BOTTOM, freeH - KEEP_TOP - PLAYER.h - DEAD_TOP);
    const fresh = world !== state.world;
    const reboot = !fresh && world.mode === 'reboot' && state.mode !== 'reboot';
    state.world = world;
    state.mode = world.mode;

    // Where to look. Once the lift has surfaced, and with the expedition complete, ILO's feet on the terrace lie
    // `SURFACE_Y` under the view center instead of the rest line, so that the opening and the sky fill the view
    // (GOAL §16). The rise keeps the rest line: the opening stays above the cabin.
    const surfaced = world.mode === 'complete'
      || (world.mode === 'liftSequence' && world.ascent !== null && SURFACED.has(world.ascent.stage));
    let tx;
    let ty;
    if (world.mode === 'title') {
      tx = spawn.x;
      ty = spawn.y + rest;
    } else if (world.mode === 'liftSequence' && world.ascent) {
      tx = world.ascent.x;
      // Under a top band the view sits higher than the rest line, so that the opening above the cabin shows from
      // boarding on; it reaches `LIFT_OPEN` over the cabin floor.
      ty = world.ascent.cabinY + (surfaced ? SURFACE_Y : bands.top > 0 ? Math.max(rest, LIFT_OPEN - size.y1 + band.top) : rest);
    } else {
      // The view leads ILO in the direction it faces once it moves.
      const lead = p.facing * LOOK_AHEAD * Math.min(1, Math.abs(p.vx) / PLAYER.maxSpeed);
      state.lead = fresh || reboot ? lead : state.lead + (lead - state.lead) * (1 - Math.exp(-LEAD_RATE * dt));
      tx = p.x + state.lead;
      const rel = p.y - state.y;
      // The view moves only when ILO leaves a band around its rest line, so a jump barely moves it.
      ty = fresh || reboot ? p.y + rest : state.y + (rel > rest + DEAD_TOP ? rel - rest - DEAD_TOP : rel < rest - DEAD_BOTTOM ? rel - rest + DEAD_BOTTOM : 0);
      if (surfaced) ty = p.y + SURFACE_Y;
    }

    // The zone whose range lies nearest that point; its range eases in from the range in use before the change.
    // A new world, a reboot or a return from outside every zone takes its range at once.
    const chosen = chooseZone(p, { x: tx, y: ty }, size, fresh || reboot);
    if (chosen.zone !== state.zone || fresh || reboot) {
      state.from = fresh || reboot || state.zone === null ? null : state.range;
      state.zone = chosen.zone;
      state.zoneT = 0;
    }
    state.zoneT = Math.min(1, state.zoneT + dt / ZONE_TIME);
    const blend = smooth(state.zoneT);
    const from = state.from;
    state.range = from === null ? chosen.range : {
      x0: from.x0 + (chosen.range.x0 - from.x0) * blend, x1: from.x1 + (chosen.range.x1 - from.x1) * blend,
      y0: from.y0 + (chosen.range.y0 - from.y0) * blend, y1: from.y1 + (chosen.range.y1 - from.y1) * blend,
    };

    if (world.mode !== 'title' && !(world.mode === 'liftSequence' && world.ascent)) {
      // A relay look hint pulls the view toward its point while it is set and lets it back afterwards.
      const hint = world.camera?.lookAt ?? null;
      if (hint !== null) state.hint = hint;
      state.look += ((hint === null ? 0 : 1) - state.look) * (1 - Math.exp(-LOOK_RATE * dt));
      if (state.look > 0.001 && state.hint !== null) {
        tx += state.look * clamp(state.hint.x - tx, -(size.x1 - LOOK_MARGIN), size.x1 - LOOK_MARGIN);
        ty += state.look * clamp(state.hint.y + 1 - ty, -(size.y1 - LOOK_MARGIN), size.y1 - LOOK_MARGIN);
      }
    }

    if (fresh || reboot) {
      state.x = tx;
      state.y = ty;
    } else if (dt > 0) {
      const approach = 1 - Math.exp(-FOLLOW * dt);
      const dx = (tx - state.x) * approach;
      const dy = (ty - state.y) * approach;
      const scale = Math.min(1, (MAX_SPEED * dt) / Math.hypot(dx, dy));
      state.x += dx * scale;
      state.y += dy * scale;
    }

    // Damage shake decays for 0.2 s and is off with reduced motion. The clamps count the shake in, so the view stays
    // in its zone and ILO stays clear of the bands.
    if (p.hp < state.hp) state.shake = SHAKE_TIME;
    state.hp = p.hp;
    state.shake = Math.max(0, state.shake - dt);
    const amplitude = state.reduced ? 0 : SHAKE_SIZE * (state.shake / SHAKE_TIME);
    const shakeX = amplitude * Math.sin(state.shake * 95);
    const shakeY = amplitude * 0.6 * Math.sin(state.shake * 71 + 1.3);
    state.x = clamp(state.x, state.range.x0 - shakeX, state.range.x1 - shakeX);
    state.y = clamp(state.y, state.range.y0 - shakeY, state.range.y1 - shakeY);
    // From the rise on, the opening above the cabin stays under the top band. ILO's own range comes after it and
    // wins where the view is too short for both.
    if (bands.top > 0 && world.mode === 'liftSequence' && world.ascent && LIFT_RISING.has(world.ascent.stage)) {
      state.y = Math.max(state.y, world.ascent.cabinY + LIFT_OPEN - size.y1 + band.top - shakeY);
    }
    // The bands win over the zone: ILO's head and feet stay clear of the top and the bottom band, and its body
    // clear of the side bands wherever they reach its rows.
    if (bands.bottom > 0) state.y = Math.min(state.y, p.y - KEEP_BOTTOM + size.y1 - band.bottom - shakeY);
    if (bands.top > 0) state.y = Math.max(state.y, p.y + PLAYER.h + KEEP_TOP - size.y1 + band.top - shakeY);
    if (p.y < state.y + shakeY - size.y1 + band.bottom) {
      if (bands.left > 0) state.x = Math.min(state.x, p.x - PLAYER.w / 2 + size.x1 - band.left - shakeX);
      if (bands.right > 0) state.x = Math.max(state.x, p.x + PLAYER.w / 2 - size.x1 + band.right - shakeX);
    }
    setFreeRect(free, state.x + shakeX, state.y + shakeY, unitsPerPixel, viewW, viewH, bands);
    return { x: state.x, y: state.y, unitsPerPixel, shakeX, shakeY, zone: state.zone?.id ?? null, free };
  }

  return {
    update,
    /** The parts of the canvas the interface covers, in canvas pixels: `{ top, bottom, left, right }`. At 0 the rig keeps off that edge. */
    setBands(value) {
      bands = value;
    },
    /** With reduced motion the rig drops the damage shake. */
    setReducedMotion(on) {
      state.reduced = on;
    },
  };
}
