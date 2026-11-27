import { DT, PLAYER, RUN } from '../config.js';
import { bodyRect, buildGrid, dynamicSolids, moveX, moveY, overlaps, staticHits } from './collision.js';
import { emit } from './events.js';
import {
  createEnemies, enemyOnDash, enemyOnPulse, restoreEnemies, snapshotEnemies, updateEnemies,
} from './enemies.js';
import {
  createObjects, liftStep, relayStep, restoreObjects, snapshotObjects, updateInteractions, updateObjects,
} from './objects.js';
import { createPlayer, hitPlayer, placePlayer, updatePlayer } from './player.js';
import { expandPulse, pressPulse } from './pulse.js';

/** Per-kind fill-ins for the speed and endpoint pauses a level author left out. */
const MOVER_DEFAULTS = Object.freeze({
  platform: { speed: 2, pauseA: 1.0, pauseB: 1.0 },
  shutter: { speed: 6, pauseA: 0, pauseB: 0 },
  lift: { speed: 2.5, pauseA: 0, pauseB: 0 },
  press: { speed: 8, pauseA: 0, pauseB: 0.3 },
});
const MOVER_LISTS = [['platforms', 'platform'], ['shutters', 'shutter'], ['lifts', 'lift'], ['presses', 'press']];
const RESTING = 0.05;
const EPSILON = 1e-9;
const NEUTRAL = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const SCRIPTED = new Set(['title', 'complete', 'reboot', 'liftSequence']);
const KEYS = {
  seams: ['id', 'broken', 'revealedUntil'],
  movers: ['id', 'kind', 'x', 'y', 't', 'dir', 'powered', 'enabled', 'moving', 'blocked'],
  cells: ['id', 'x', 'y', 'state', 'socket'],
  sockets: ['id', 'cell', 'powered'],
  switches: ['id', 'on'],
  relays: ['id', 'active'],
  stations: ['id', 'active', 'inRange'],
  archives: ['id', 'collected'],
  caches: ['id', 'collected'],
  vents: ['id', 't', 'stage'],
  enemies: ['id', 'kind', 'x', 'y', 'state', 'awake', 'harmful'],
  bolts: ['id', 'x', 'y'],
  hazards: ['kind', 'x', 'y', 'w', 'h'],
};

const list = (value) => value ?? [];
const inside = (r, k) => r.x >= k.x && r.x + r.w <= k.x + k.w && r.y >= k.y && r.y + r.h <= k.y + k.h;
const copy = (value) => (value === null ? null : { ...value });

function createMover(def, kind) {
  const fill = MOVER_DEFAULTS[kind];
  const pauseA = def.pauseA ?? (kind === 'press' ? def.warn ?? fill.pauseA : fill.pauseA);
  return {
    ...def,
    kind,
    enabled: def.enabled ?? true,
    speed: def.speed ?? fill.speed,
    pauseA,
    pauseB: def.pauseB ?? fill.pauseB,
    t: 0,
    dir: 1,
    wait: pauseA,
    powered: list(def.poweredBy).length === 0,
    moving: false,
    blocked: false,
    dx: 0,
    dy: 0,
  };
}

/**
 * Build the World of §3.3 in mode `title`. The checkpoint is committed at the station of the lowest `order`, the
 * first on the route; a level without stations commits it at the spawn.
 */
export function createWorld(level) {
  const movers = [];
  for (const [name, kind] of MOVER_LISTS) {
    for (const def of list(level[name])) movers.push(createMover(def, kind));
  }
  const world = {
    level,
    step: 0,
    time: 0,
    clock: 0,
    mode: 'title',
    modeTime: 0,
    paused: false,
    cause: null,
    regionId: '',
    player: createPlayer(level.spawn.x, level.spawn.y),
    prompt: null,
    interactTarget: null,
    camera: { lookAt: null, lookT: 0 },
    events: [],
    solids: list(level.solids),
    grid: null,
    seams: list(level.seams).map((seam) => ({ ...seam, broken: false, revealedUntil: 0 })),
    movers,
    hazards: [],
    pulseTargets: [],
    cells: [],
    sockets: [],
    switches: [],
    relays: [],
    stations: [],
    archives: [],
    caches: [],
    vents: [],
    reveals: [],
    lifts: movers.filter((m) => m.kind === 'lift'),
    presses: movers.filter((m) => m.kind === 'press'),
    enemies: [],
    bolts: [],
    pulse: null,
    checkpoint: { stationId: null, snap: null },
    recoveries: 0,
    result: null,
  };
  world.grid = buildGrid(world.solids);
  createObjects(world);
  createEnemies(world);
  placePlayer(world, level.spawn.x, level.spawn.y);
  world.regionId = regionOf(world, world.player.x);
  const start = world.stations.reduce((best, s) => (best === null || s.order < best.order ? s : best), null);
  commitCheckpoint(world, start === null ? null : start.id);
  return world;
}

/** Exactly one fixed step of §3.12. `input` holds the §3.1 fields; missing fields read as no input. */
export function stepWorld(world, input = NEUTRAL) {
  world.step += 1;
  world.time += DT;
  world.hazards = [];
  updateMode(world, input);
  if (!SCRIPTED.has(world.mode)) {
    const act = world.mode === 'play' ? input : NEUTRAL;
    updateMovers(world);
    updatePlayer(world, act);
    pressPulse(world, act);
    if (world.mode === 'play') liveSteps(world, input);
  }
  world.regionId = regionOf(world, world.player.x);
}

/** Steps 4 to 8; run only while the mode stays `play` (a relay activation inside step 5 skips the rest). */
function liveSteps(world, input) {
  dashContacts(world);
  updateEnemies(world);
  updateObjects(world);
  if (world.mode !== 'play') return;
  resolveHazards(world);
  expandPulse(world, (enemy) => enemyOnPulse(world, enemy));
  updateInteractions(world, input);
  world.clock += DT;
}

/** Region whose x range holds `x`; clamped to the first and last region. */
function regionOf(world, x) {
  const regions = list(world.level.regions);
  return (regions.find((r) => x <= r.x1) ?? regions.at(-1))?.id ?? world.regionId;
}

// --- Modes (§3.13) ---

export function setMode(world, mode) {
  world.mode = mode;
  world.modeTime = 0;
}

/** Start a recovery from `play` (hp 0, kill bound, crush, retry). Counted once; ignored in every other mode. */
export function recover(world, cause) {
  if (world.mode !== 'play') return false;
  world.recoveries += 1;
  world.cause = cause;
  setMode(world, 'shutdown');
  emit(world, 'shutdown', { cause });
  return true;
}

function updateMode(world, input) {
  world.modeTime += DT;
  switch (world.mode) {
    case 'play':
      if (input.retryPressed) recover(world, 'retry');
      break;
    case 'relayActivation':
      // relayActivation: the pulse wave in flight still finishes; objects.js holds the route hint until the look is over.
      expandPulse(world, (enemy) => enemyOnPulse(world, enemy));
      relayStep(world);
      break;
    case 'shutdown':
      if (world.modeTime >= (world.cause === 'retry' ? RUN.retryTime : RUN.shutdownTime)) {
        restoreCheckpoint(world);
        setMode(world, 'reboot');
      }
      break;
    case 'reboot':
      if (world.modeTime >= RUN.rebootTime) {
        setMode(world, 'play');
        world.player.immunity = RUN.rebootImmunity;
      }
      break;
    case 'liftSequence':
      // liftSequence: objects.js drives board, barrier, rise, surface and terrace through to `complete`.
      liftStep(world);
      break;
    default:
      break;
  }
}

// --- Movers (§3.9) ---

/** AABB of ILO or of another bottom-center entity such as a loose cell. */
function footprint(world, entity) {
  return entity === world.player ? bodyRect(entity.x, entity.y) : bodyRect(entity.x, entity.y, entity.w, entity.h);
}

function placeAt(world, entity, rect) {
  entity.x = rect.x + (entity === world.player ? PLAYER.w : entity.w) / 2;
  entity.y = rect.y;
}

const shifted = (rect, dx, dy) => ({ x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h });

/** ILO and loose cells resting on the mover top. */
function ridersOn(world, m) {
  const top = m.y + m.h;
  const onTop = (x0, x1, y) => Math.abs(y - top) < RESTING && x1 > m.x && x0 < m.x + m.w;
  const riders = [];
  const p = world.player;
  if (p.onMover === m.id && onTop(p.x - PLAYER.w / 2, p.x + PLAYER.w / 2, p.y)) riders.push(p);
  for (const cell of world.cells) {
    if (cell.state === 'loose' && onTop(cell.x - cell.w / 2, cell.x + cell.w / 2, cell.y)) riders.push(cell);
  }
  return riders;
}

/** Dynamic solids outside `ignore`; an ignored cell also covers its rect view. */
function others(world, ignore) {
  return dynamicSolids(world).filter((s) => !ignore.includes(s) && !ignore.includes(s.cell));
}

/** True when nothing meets `rect`: no static solid and no dynamic solid outside `ignore`. */
function clear(world, rect, ignore) {
  if (staticHits(world, rect).length > 0) return false;
  return others(world, ignore).every((s) => !overlaps(rect, s));
}

/** Move `rect` along one axis up to `goal` and land exactly on it; false when a blocker stops it short. */
function reach(rect, axis, goal, world, blockers) {
  if (axis === 'x') moveX(rect, goal - rect.x, world, blockers);
  else moveY(rect, goal - rect.y, world, blockers);
  if (Math.abs(rect[axis] - goal) >= EPSILON) return false;
  rect[axis] = goal;
  return true;
}

/** True when point `a` lies from `b` in travel direction `sign`: the mover moves toward it, not away. */
const ahead = (a, b, sign) => (a - b) * sign > 0;

/**
 * Push ILO and loose cells that the mover's next rect meets ahead of its driving face, along its travel axes.
 * False when a pushed entity is stopped and the mover yields (it has to wait).
 */
function pushAside(world, m, nx, ny, ignore) {
  const next = { x: nx, y: ny, w: m.w, h: m.h };
  const pushables = [world.player, ...world.cells.filter((c) => c.state === 'loose')]
    .filter((entity) => !ignore.includes(entity));
  for (const entity of pushables) {
    const rect = footprint(world, entity);
    if (!overlaps(next, rect)) continue;
    const blockers = others(world, [...ignore, entity]);
    const sx = nx > m.x ? 1 : -1;
    const sy = ny > m.y ? 1 : -1;
    let stopped = false;
    if (nx !== m.x && ahead(rect.x + rect.w / 2, nx + m.w / 2, sx)) {
      stopped = !reach(rect, 'x', nx + (sx > 0 ? m.w : -rect.w), world, blockers);
    }
    if (ny !== m.y && ahead(rect.y + rect.h / 2, ny + m.h / 2, sy)) {
      stopped = !reach(rect, 'y', ny + (sy > 0 ? m.h : -rect.h), world, blockers) || stopped;
    }
    if (stopped && m.yields) return false;
    placeAt(world, entity, rect);
  }
  return true;
}

/** One step of travel; true when the mover moved. Riders follow, pushed entities make way or hold a yielding mover. */
function stepMover(world, m) {
  if (m.mode === 'loop') {
    if (!m.powered) return false;
    if (m.wait > 0) {
      m.wait = Math.max(0, m.wait - DT);
      return false;
    }
  }
  const dir = m.mode === 'toggle' ? Math.sign((m.powered ? 1 : 0) - m.t) : m.dir || 1;
  m.dir = dir;
  if (dir === 0) return false;
  const len = Math.hypot(m.tx - m.fx, m.ty - m.fy);
  if (len === 0) return false;
  let t = m.t + (dir * m.speed * DT) / len;
  let end = null;
  if (t >= 1) {
    t = 1;
    end = 'B';
  } else if (t <= 0) {
    t = 0;
    end = 'A';
  }
  const nx = m.fx + (m.tx - m.fx) * t;
  const ny = m.fy + (m.ty - m.fy) * t;
  const riders = ridersOn(world, m);
  const ignore = [m, ...riders];
  const dx = nx - m.x;
  const dy = ny - m.y;
  const blocked = riders.some((r) => !clear(world, shifted(footprint(world, r), dx, dy), ignore))
    || !pushAside(world, m, nx, ny, ignore);
  if (blocked) {
    m.blocked = true;
    return false;
  }
  for (const r of riders) {
    // A rider rests exactly on the new top, so float drift never opens a gap to the mover.
    const rect = shifted(footprint(world, r), dx, 0);
    rect.y = ny + m.h;
    placeAt(world, r, rect);
  }
  m.x = nx;
  m.y = ny;
  m.dx = dx;
  m.dy = dy;
  m.t = t;
  if (m.mode === 'toggle') {
    if (end !== null) m.dir = 0;
  } else if (end === 'A') {
    m.dir = 1;
    m.wait = m.pauseA;
  } else if (end === 'B') {
    m.dir = -1;
    m.wait = m.pauseB;
  }
  return true;
}

/**
 * Sustained squeeze by a crushing mover: ILO overlaps it, does not rest on its top, and cannot be pushed out ahead
 * of its travel. `held` is the squeeze time carried over from the previous step; it returns to 0 when the squeeze ends.
 */
function checkCrush(world, m, held) {
  const p = world.player;
  const rect = bodyRect(p.x, p.y);
  if (!overlaps(m, rect) || p.onMover === m.id) return;
  const alongX = m.tx !== m.fx;
  const sign = alongX ? Math.sign(m.tx - m.fx) : Math.sign(m.ty - m.fy);
  const goal = alongX ? m.x + (sign > 0 ? m.w : -rect.w) : m.y + (sign > 0 ? m.h : -rect.h);
  if (reach({ ...rect }, alongX ? 'x' : 'y', goal, world, others(world, [m]))) return;
  p.squeezeT = held + DT;
  if (p.squeezeT >= RUN.crushTime) {
    emit(world, 'crush', { x: p.x, y: p.y });
    recover(world, 'crush');
    // The crusher returns toward `from` at once, with no rest: a head resting on ILO hides the shutdown pose.
    m.dir = -1;
    m.wait = 0;
  }
}

/** `shutterStop` / `liftStop` when a shutter or a lift comes to rest: it has no direction now and had one before. */
function announce(world, m, was) {
  if ((m.moving && m.dir !== 0) || was === 0) return;
  if (m.kind === 'shutter') emit(world, 'shutterStop', { id: m.id, open: m.t >= 1 });
  else if (m.kind === 'lift') emit(world, 'liftStop', { id: m.id });
}

/** Step 2: mover kinematics of §3.9. Owners set `powered` and `enabled` before this runs. */
function updateMovers(world) {
  const p = world.player;
  const held = p.squeezeT;
  p.squeezeT = 0;
  for (const m of world.movers) {
    const was = m.moving ? m.dir : 0;
    m.moving = false;
    m.blocked = false;
    m.dx = 0;
    m.dy = 0;
    if (m.enabled && stepMover(world, m)) m.moving = true;
    announce(world, m, was);
    if (m.crushes && m.enabled && world.mode === 'play') checkCrush(world, m, held);
  }
}

// --- Checkpoint ---

/**
 * Snapshot the world for the station `stationId`: later recoveries restore exactly this state.
 * A station below the checkpoint station in `order` re-commits the snapshot without moving the reboot point.
 */
export function commitCheckpoint(world, stationId) {
  const order = (id) => world.stations.find((s) => s.id === id)?.order ?? 0;
  const current = world.checkpoint.stationId;
  world.checkpoint = {
    stationId: current !== null && order(current) > order(stationId) ? current : stationId,
    snap: {
      objects: snapshotObjects(world),
      enemies: snapshotEnemies(world),
      seams: world.seams.map((s) => s.broken),
    },
  };
}

/** Put every mover back to its initial (loop) or power-state (toggle) position. */
function resetMovers(world) {
  for (const m of world.movers) {
    m.t = m.mode === 'toggle' ? (m.powered ? 1 : 0) : 0;
    m.dir = m.mode === 'toggle' ? 0 : 1;
    m.wait = m.pauseA;
    m.x = m.fx + (m.tx - m.fx) * m.t;
    m.y = m.fy + (m.ty - m.fy) * m.t;
    m.moving = false;
    m.blocked = false;
    m.dx = 0;
    m.dy = 0;
  }
}

/** Restore the committed snapshot (§3.13): ILO at the station, objects and enemies through their hooks, movers reset. */
export function restoreCheckpoint(world) {
  const { stationId, snap } = world.checkpoint;
  restoreObjects(world, snap.objects);
  restoreEnemies(world, snap.enemies);
  world.seams.forEach((s, i) => {
    s.broken = snap.seams[i];
    s.revealedUntil = 0;
  });
  resetMovers(world);
  for (const vent of world.vents) {
    vent.t = 0;
    vent.stage = 'dormant';
  }
  for (const reveal of world.reveals) reveal.revealedUntil = 0;
  world.hazards = [];
  world.bolts = [];
  world.pulse = null;
  world.prompt = null;
  world.interactTarget = null;
  world.camera.lookAt = null;
  world.camera.lookT = 0;
  const station = world.stations.find((s) => s.id === stationId) ?? world.level.spawn;
  placePlayer(world, station.x, station.y);
  emit(world, 'reboot', { stationId: station.id ?? null, x: station.x, y: station.y });
}

// --- Contacts and threats ---

/** A dash that meets an enemy reports it to the enemies module (§3.11). */
function dashContacts(world) {
  const p = world.player;
  if (p.dashT <= 0) return;
  const rect = bodyRect(p.x, p.y);
  for (const enemy of world.enemies) {
    if (overlaps(rect, bodyRect(enemy.x, enemy.y, enemy.w, enemy.h))) enemyOnDash(world, enemy);
  }
}

/** Step 6: one damage outcome per hazard overlap, then the kill bounds (§3.6, §3.8). */
function resolveHazards(world) {
  const p = world.player;
  const rect = bodyRect(p.x, p.y);
  for (const hazard of world.hazards) {
    if (overlaps(rect, hazard) && hitPlayer(world, hazard) === 'damage' && p.hp <= 0) {
      recover(world, 'integrity');
      return;
    }
  }
  if (list(world.level.kill).some((k) => inside(rect, k)) || p.y < world.level.bounds.y0 - 3) recover(world, 'fall');
}

/** Plain-data snapshot for checks and `window.DEEPWAKE`. */
export function inspect(world) {
  const p = world.player;
  const pulse = world.pulse;
  return {
    step: world.step,
    time: world.time,
    clock: world.clock,
    mode: world.mode,
    modeTime: world.modeTime,
    paused: world.paused,
    cause: world.cause,
    regionId: world.regionId,
    recoveries: world.recoveries,
    checkpoint: world.checkpoint.stationId,
    player: { ...p },
    pulse: pulse === null ? null : { x: pulse.x, y: pulse.y, r: pulse.r, age: pulse.age },
    prompt: copy(world.prompt),
    interactTarget: copy(world.interactTarget),
    camera: { lookAt: copy(world.camera.lookAt), lookT: world.camera.lookT },
    result: world.result === null ? null : { ...world.result, relays: [...world.result.relays] },
    ...Object.fromEntries(Object.entries(KEYS).map(([name, keys]) => [
      name,
      world[name].map((item) => Object.fromEntries(keys.map((k) => [k, item[k]]))),
    ])),
  };
}
