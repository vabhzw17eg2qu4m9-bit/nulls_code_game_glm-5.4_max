// Enemies (contract §3.11): cable skitters, prism drones, shutter sentinels and their bolts.
import { DT, PLAYER, PULSE } from '../config.js';
import { bodyRect, dynamicSolids, groundBelow, lineOfSight, overlaps, staticHits } from './collision.js';
import { emit } from './events.js';

// Tunables of this module. A state timer counts whole steps, so a duration is always an exact step count.
const WAKE_RANGE = 24;
const SKITTER = Object.freeze({ speed: 1.4, sight: 5, alert: 0.5, lunge: 2, lungeTime: 0.35, recover: 0.8, stun: 2 });
// A drone sees as far as one pulse reaches: it never begins an aim from a spot ILO's pulse cannot reach.
const DRONE = Object.freeze({ speed: 1.2, sight: PULSE.radius, aim: 0.8, fire: 0.2, cooldown: 2.5, stun: 2.5, boltSpeed: 5, boltLife: 4 });
const SENTINEL = Object.freeze({ warning: 0.9, firing: 0.9, venting: 2 });
const BOLT = Object.freeze({ w: 0.3, h: 0.3 });
const FOOT = 0.1;                                  // floor-ahead probe in front of a skitter's leading foot
const EPSILON = 1e-9;
const FIRST = Object.freeze({ skitter: 'dormant', drone: 'patrol', sentinel: 'closed' });
const HARMFUL = Object.freeze({
  skitter: ['patrol', 'alert', 'lunge', 'recover'],
  drone: ['patrol', 'aim', 'fire', 'cooldown'],
  sentinel: [],
});
const UPDATE = { skitter: updateSkitter, drone: updateDrone, sentinel: updateSentinel };

const steps = (seconds) => Math.round(seconds / DT);
const list = (value) => value ?? [];

/** Advance a state timer by one step; true once the state has lasted `seconds`. */
function elapsed(e, seconds) {
  e.t += 1;
  return e.t >= steps(seconds);
}

/** Put an enemy into `state` from its first step: timers, harm, beam and the `enemyState` event follow. */
function setState(world, e, state) {
  e.state = state;
  e.t = 0;
  e.harmful = HARMFUL[e.kind].includes(state);
  if (e.kind === 'sentinel') e.beam = state === 'firing' ? beamLane(world, e) : null;
  emit(world, 'enemyState', { kind: e.kind, id: e.id, state, x: e.x, y: e.y });
}

/** Enter an attack state: the state event, then `enemyAttack` for the sound and the effects. */
function attack(world, e, state) {
  setState(world, e, state);
  emit(world, 'enemyAttack', { kind: e.kind, id: e.id, x: e.x, y: e.y });
}

/** Disabled for good: only a stunned or a venting machine gets here. */
function disable(world, e) {
  setState(world, e, 'disabled');
}

/** ILO's center within `range` of the enemy's center, with a clear line of sight. */
function sees(world, e, p, range) {
  const y = p.y + PLAYER.h / 2;
  const own = e.y + e.h / 2;
  return Math.hypot(p.x - e.x, y - own) <= range && lineOfSight(world, e.x, own, p.x, y);
}

/** True when ground lies under a skitter's leading foot. */
function floorAhead(world, e) {
  const front = e.facing > 0 ? e.x + e.w / 2 : e.x - e.w / 2 - FOOT;
  return groundBelow(world, { x: front, y: e.y, w: FOOT, h: e.h }, FOOT) !== null;
}

/** True when a skitter center position `x` leaves its patrol range. */
function outOfRange(e, x) {
  return e.facing > 0 ? x > e.range.x1 : x < e.range.x0;
}

function updateSkitter(world, e, p) {
  switch (e.state) {
    case 'dormant':
      setState(world, e, 'patrol');
      break;
    case 'patrol': {
      if (sees(world, e, p, SKITTER.sight)) {
        setState(world, e, 'alert');
        break;
      }
      const next = e.x + e.facing * SKITTER.speed * DT;
      if (outOfRange(e, next) || !floorAhead(world, e)) e.facing = -e.facing;
      else e.x = next;
      break;
    }
    case 'alert':
      e.facing = Math.sign(p.x - e.x) || e.facing;
      if (elapsed(e, SKITTER.alert)) attack(world, e, 'lunge');
      break;
    case 'lunge': {
      const next = e.x + (e.facing * SKITTER.lunge) / steps(SKITTER.lungeTime);
      if (outOfRange(e, next) || !floorAhead(world, e)) {
        setState(world, e, 'recover');
        break;
      }
      e.x = next;
      if (elapsed(e, SKITTER.lungeTime)) setState(world, e, 'recover');
      break;
    }
    case 'recover':
      if (elapsed(e, SKITTER.recover)) setState(world, e, 'patrol');
      break;
    case 'stunned':
      if (elapsed(e, SKITTER.stun)) setState(world, e, 'patrol');
      break;
    default:
      break;                                        // disabled
  }
}

/** One step along the drone's route, back and forth between its ends. */
function patrolRoute(e, speed) {
  const { fx, fy, tx, ty } = e.route;
  const len = Math.hypot(tx - fx, ty - fy);
  if (len > 0) {
    const next = e.u + (e.dir * speed * DT) / len;
    if (next < 0 || next > 1) e.dir = -e.dir;
    else e.u = next;
  }
  e.x = fx + (tx - fx) * e.u;
  e.y = fy + (ty - fy) * e.u;
  e.facing = Math.sign((tx - fx) * e.dir) || e.facing;
}

/** The aim follows ILO; it stops being updated once the bolt is fired. */
function aimAt(e, p) {
  const dx = p.x - e.x;
  const dy = p.y + PLAYER.h / 2 - (e.y + e.h / 2);
  const dist = Math.hypot(dx, dy);
  if (dist > 0) {
    e.aimDir = { x: dx / dist, y: dy / dist };
    e.facing = Math.sign(dx) || e.facing;
  }
}

function fireBolt(world, e) {
  attack(world, e, 'fire');
  world.bolts.push({
    id: `${e.id}:${world.step}`, x: e.x, y: e.y + e.h / 2,
    vx: e.aimDir.x * DRONE.boltSpeed, vy: e.aimDir.y * DRONE.boltSpeed, life: DRONE.boltLife, ...BOLT,
  });
}

function updateDrone(world, e, p) {
  switch (e.state) {
    case 'patrol':
      if (sees(world, e, p, DRONE.sight)) setState(world, e, 'aim');
      else patrolRoute(e, DRONE.speed);
      break;
    case 'aim':
      aimAt(e, p);
      if (elapsed(e, DRONE.aim)) fireBolt(world, e);
      break;
    case 'fire':
      if (elapsed(e, DRONE.fire)) setState(world, e, 'cooldown');
      break;
    case 'cooldown':
      if (elapsed(e, DRONE.cooldown)) setState(world, e, 'patrol');
      break;
    case 'stunned':
      if (elapsed(e, DRONE.stun)) setState(world, e, 'patrol');
      break;
    default:
      break;                                        // disabled
  }
}

/** What stops a bolt or a beam: the static solids and the dynamic solids (unbroken seams, enabled movers, loose cells) meeting `r`. */
function covers(world, r) {
  return [...staticHits(world, r), ...dynamicSolids(world).filter((s) => overlaps(r, s))];
}

/** The sentinel's lane from its front face to the first cover that spans the lane's height. */
function beamLane(world, e) {
  const lane = e.lane;
  const start = e.dir > 0 ? lane.x : lane.x + lane.w;
  let end = e.dir > 0 ? lane.x + lane.w : lane.x;
  for (const c of covers(world, lane)) {
    if (c.y > lane.y || c.y + c.h < lane.y + lane.h) continue;
    const face = e.dir > 0 ? c.x : c.x + c.w;
    if (e.dir > 0 ? face >= start && face < end : face <= start && face > end) end = face;
  }
  return { x: Math.min(start, end), y: lane.y, w: Math.abs(end - start), h: lane.h };
}

function updateSentinel(world, e, p) {
  if (e.state === 'closed' && overlaps(bodyRect(p.x, p.y), e.lane)) setState(world, e, 'warning');
  else if (e.state === 'warning' && elapsed(e, SENTINEL.warning)) attack(world, e, 'firing');
  else if (e.state === 'firing' && elapsed(e, SENTINEL.firing)) setState(world, e, 'venting');
  else if (e.state === 'venting' && elapsed(e, SENTINEL.venting)) setState(world, e, 'closed');
  if (e.state === 'firing' && e.beam.w > 0) {
    world.hazards.push({ kind: 'beam', ...e.beam, sx: e.x + (e.dir * e.w) / 2, sy: e.y + e.h / 2 });
  }
}

/** Move every bolt; one ends on ILO (a hazard this step), on cover (`boltHit`) or when its life is over. */
function updateBolts(world) {
  const body = bodyRect(world.player.x, world.player.y);
  for (let i = world.bolts.length - 1; i >= 0; i--) {
    const b = world.bolts[i];
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.life -= DT;
    const rect = bodyRect(b.x, b.y, b.w, b.h);
    if (overlaps(body, rect)) {
      world.hazards.push({ kind: 'bolt', ...rect, sx: b.x, sy: b.y });
      world.bolts.splice(i, 1);
    } else if (b.life <= EPSILON || covers(world, rect).length > 0) {
      if (b.life > EPSILON) emit(world, 'boltHit', { x: b.x, y: b.y });
      world.bolts.splice(i, 1);
    }
  }
}

/** A runtime enemy at its level position in its first state. */
function build(def) {
  const state = FIRST[def.kind];
  return {
    ...def,
    home: def.home ?? { x: def.x, y: def.y },
    state, facing: def.kind === 'sentinel' ? def.dir : 1, awake: false, harmful: HARMFUL[def.kind].includes(state),
    t: 0, u: 0, dir: def.dir ?? 1, aimDir: { x: 1, y: 0 }, beam: null,
  };
}

export function createEnemies(world) {
  world.enemies.push(...list(world.level.enemies).map(build));
}

/** Step 4 of §3.12, in mode `play` only. An enemy that is not awake keeps its state and timers. */
export function updateEnemies(world) {
  if (world.mode !== 'play') return;
  const p = world.player;
  for (const e of world.enemies) {
    e.awake = Math.abs(p.x - e.x) <= WAKE_RANGE && Math.abs(p.y - e.y) <= WAKE_RANGE;
    if (e.awake) UPDATE[e.kind](world, e, p);
    if (e.harmful) world.hazards.push({ kind: 'enemy', ...bodyRect(e.x, e.y, e.w, e.h), sx: e.x, sy: e.y + e.h / 2 });
  }
  updateBolts(world);
}

/** The ids of the disabled machines. */
export function snapshotEnemies(world) {
  return world.enemies.filter((e) => e.state === 'disabled').map((e) => e.id);
}

/** Every enemy back to its level position and first state; the snapshot ids stay disabled. No events. */
export function restoreEnemies(world, snap) {
  world.enemies.forEach((e, i) => {
    const fresh = build(list(world.level.enemies)[i]);
    if (list(snap).includes(e.id)) Object.assign(fresh, { state: 'disabled', harmful: false });
    Object.assign(e, fresh);
  });
}

/** A pulse that reached the enemy: stuns a skitter or a drone, disables a venting sentinel, else deflected. */
export function enemyOnPulse(world, e) {
  if (e.state === 'disabled') return;
  if (e.kind === 'sentinel') {
    if (e.state === 'venting') disable(world, e);
    else emit(world, 'pulseBlock', { x: e.x, y: e.y + e.h / 2 });
    return;
  }
  setState(world, e, 'stunned');
}

/** ILO's dash meets the enemy: a stunned machine is disabled once; a harmful one is left to its contact hazard. */
export function enemyOnDash(world, e) {
  if (e.state === 'stunned') disable(world, e);
}
