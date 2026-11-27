// Gameplay objects of contract §3.10: cells, sockets, switches, mover power, vents, presses, relays, stations, archives,
// caches, reveals and the ascent lift, with the E interactions and the relay look and lift sequence of §3.13.

import { CACHE, CELL, DT, LIFT, PLAYER, PULSE, RUN } from '../config.js';
import { bodyRect, dynamicSolids, gap, groundBelow, overlaps, staticHits } from './collision.js';
import { emit } from './events.js';
import { pulseOrigin, pulseReady, waveReaches } from './pulse.js';
import { commitCheckpoint, setMode } from './world.js';

const PLACE_REACH = 1;         // a carried cell is put down this far in front of ILO, then the same distance behind
const PROBE = 0.05;            // depth below a put-down cell that must hold supporting ground
const STATION_RANGE = 1.5;     // horizontal reach of a station
const STATION_RISE = 0.5;      // vertical reach of a station
const STATION_ARM = 2.5;       // distance from a station that re-arms it
const REST_OFFSET = 1.2;       // where a cell carried at a commit rests beside its station
const REBOOT_CLEAR = 0.05;     // a loose cell this close to where ILO reboots rests beside the station instead
const WALK = 3;                // units ILO walks onto the terrace, the last lift stage
// Presses and vents announce their stages only this close to ILO: a machine far away must not fire cues, and the
// core tests list the exact events of a range whose press stands 60 units from ILO.
const EARSHOT = 24;
const HINT_RANGE = 4;           // a hidden seam or a reveal marker this close is worth asking for a pulse
const LETTERS = ['A', 'B', 'C'];
const STAGE_START = {
  board: 0, barrier: LIFT.board, rise: LIFT.board + LIFT.barrier,
  surface: LIFT.board + LIFT.barrier + LIFT.rise, terrace: LIFT.board + LIFT.barrier + LIFT.rise + LIFT.surface,
};
const LIFT_STAGES = Object.keys(STAGE_START);
const LIFT_END = LIFT_STAGES.reduce((sum, name) => sum + LIFT[name], 0);
const PROMPTS = Object.freeze({
  insert: Object.freeze({ key: 'E', text: 'Insert Cell' }),
  place: Object.freeze({ key: 'E', text: 'Place Cell' }),
  pickup: Object.freeze({ key: 'E', text: 'Pick Up Cell' }),
  remove: Object.freeze({ key: 'E', text: 'Remove Cell' }),
  switch: Object.freeze({ key: 'E', text: 'Activate Switch' }),
  cache: Object.freeze({ key: 'E', text: 'Salvage Cache' }),
  archive: Object.freeze({ key: 'E', text: 'Read Archive' }),
  lift: Object.freeze({ key: 'E', text: 'Activate Lift' }),
});
const OFFLINE = Object.freeze([0, 1, 2].map((n) => Object.freeze({ key: null, text: `Lift offline · ${n}/3 relays` })));
// GOAL §17 names it a contextual prompt: it shows only where a pulse does something ILO has not seen.
const PULSE_PROMPT = Object.freeze({ key: 'Q', text: 'Echo Pulse' });
// Per world: the pulse wave whose reached seams and markers still wait for their one `reveal` event.
const REVEALED = new WeakMap();
// Per world: the last step E was down. E down on consecutive steps is one key still held, not a second press.
const E_DOWN = new WeakMap();

const list = (value) => value ?? [];
const byId = (items, id) => items.find((item) => item.id === id);
/** Rect of a bottom-center object with a size, such as a socket or a cell. */
const centered = (object) => bodyRect(object.x, object.y, object.w, object.h);
/** Rect of an interactable without a size (switch, cache, archive): one unit wide, as tall as ILO, standing on its anchor. */
const standing = (object) => bodyRect(object.x, object.y, 1, PLAYER.h);
const playerRect = (world) => bodyRect(world.player.x, world.player.y);
/** The point of a seam a pulse reaches: the middle of its rect. */
const middle = (seam) => ({ x: seam.x + seam.w / 2, y: seam.y + seam.h / 2 });
/** Distance from ILO's body to the closest point of `rect`: the measure of the reach of E, and of which target in reach is the nearer. */
const reachTo = (world, rect) => gap(playerRect(world), rect);
const inRange = (world, rect) => reachTo(world, rect) <= PLAYER.interactReach;
const inside = (rect, box) => rect.x >= box.x && rect.x + rect.w <= box.x + box.w
  && rect.y >= box.y && rect.y + rect.h <= box.y + box.h;
const atStation = (player, station) => Math.abs(player.x - station.x) <= STATION_RANGE
  && Math.abs(player.y - station.y) <= STATION_RISE;
/** True when ILO is within `EARSHOT` of the span from `x0` to `x1`. */
const heard = (world, x0, x1) => Math.max(x0 - world.player.x, world.player.x - x1, 0) <= EARSHOT;
const activeRelays = (world) => LETTERS.filter((id) => byId(world.relays, id)?.active === true);
const target = (kind, object) => ({ kind, id: object.id, x: object.x, y: object.y });
/** `PLACE_REACH` in front of ILO for `sign` 1, behind for -1. */
const spotAt = (player, sign) => ({ x: player.x + sign * player.facing * PLACE_REACH, y: player.y });
/** Smooth step: eases in and out over `u` from 0 to 1. */
const smooth = (u) => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

/** Build the runtime lists of §3.10 from the level and register the pulse targets. The core built the movers. */
export function createObjects(world) {
  const level = world.level;
  world.cells = list(level.cells).map((def) => ({ ...def, w: def.w ?? CELL.w, h: def.h ?? CELL.h, state: 'loose', socket: null }));
  world.sockets = list(level.sockets).map((def) => ({ ...def, cell: null, powered: false }));
  world.switches = list(level.switches).map((def) => ({ ...def, on: false }));
  world.relays = list(level.relays).map((def) => ({ ...def, active: false, socket: def.socket ?? null }));
  // A station ILO already stands at is spent: it arms again once ILO leaves.
  world.stations = list(level.stations).map((def) => {
    const near = atStation(world.player, def);
    return { ...def, active: false, inRange: near, armed: !near, pending: false };
  });
  const start = world.stations.reduce((best, s) => (best === null || s.order < best.order ? s : best), null);
  if (start !== null) start.active = true;
  world.archives = list(level.archives).map((def) => ({ ...def, collected: false }));
  world.caches = list(level.caches).map((def) => ({ ...def, collected: false }));
  world.vents = list(level.vents).map((def) => ({ ...def, w: def.w ?? 1, t: 0, stage: 'dormant' }));
  world.reveals = list(level.reveals).map((def) => ({ ...def, revealedUntil: 0 }));
  const ascent = level.ascent ?? null;
  world.ascent = ascent === null ? null : { ...ascent, idle: true, stage: null, cabinY: ascent.y };
  // The rest of a press is its period, but never shorter than its warning. A head that starts within its warning
  // is already warning: that first stage is no change, so it raises no cue.
  for (const press of world.presses) {
    press.pauseA = Math.max(press.warn ?? 0, (press.period ?? 0) - Math.abs(press.ty - press.fy) / press.speed - press.pauseB);
    press.stage = pressStage(press);
  }
  for (const relay of world.relays) {
    world.pulseTargets.push({ id: `relay:${relay.id}`, ref: relay, onPulse: (w) => activateRelay(w, relay) });
  }
  for (const seam of world.seams) {
    world.pulseTargets.push({ id: `seam:${seam.id}`, ref: middle(seam), onPulse: (w) => reveal(w, seam) });
  }
  for (const marker of world.reveals) {
    world.pulseTargets.push({ id: `reveal:${marker.id}`, ref: marker, onPulse: (w) => reveal(w, marker) });
  }
  REVEALED.set(world, { wave: null, ids: [] });
}

/** Step 5: sockets, mover power, presses, vents and stations, then the reveal cue of a pulse wave that is over. */
export function updateObjects(world) {
  for (const socket of world.sockets) {
    const on = socket.cell !== null;
    if (on !== socket.powered) {
      socket.powered = on;
      emit(world, 'socketPower', { id: socket.id, on });
    }
  }
  for (const m of world.movers) m.powered = isPowered(world, list(m.poweredBy));
  updatePresses(world);
  updateVents(world);
  updateStations(world);
  flushReveal(world);
}

/**
 * Step 8: what E acts on now, the prompt of this step, and the one action of a fresh E press. Only in `play`.
 * A press acts once: E still down on the next step never acts again (§3.10).
 */
export function updateInteractions(world, input) {
  if (world.mode !== 'play') return;
  show(world);
  const fresh = input.interactPressed && E_DOWN.get(world) !== world.step - 1;
  if (input.interactPressed) E_DOWN.set(world, world.step);
  const found = world.interactTarget;
  if (!fresh || found === null) return;
  act(world, found);
  if (world.mode === 'play') show(world);           // the prompt never shows what the press just used up
}

/** The target of this step and its prompt; with no target, why the lift console stays dead, or the pulse worth a press here. */
function show(world) {
  world.interactTarget = findTarget(world);
  world.prompt = world.interactTarget === null ? offlinePrompt(world) ?? pulseHint(world) : PROMPTS[world.interactTarget.kind];
}

/** Plain data of what a recovery restores (§3.13). The lists line up with the world's lists. */
export function snapshotObjects(world) {
  return {
    relays: activeRelays(world),
    stations: world.stations.filter((s) => s.active).map((s) => s.id),
    sockets: world.sockets.map((s) => s.cell),
    switches: world.switches.map((s) => s.on),
    cells: world.cells.map((c) => [c.state, c.x, c.y]),
    archives: world.archives.filter((a) => a.collected).map((a) => a.id),
    caches: world.caches.filter((c) => c.collected).map((c) => c.id),
    idle: world.ascent === null || world.ascent.idle,
  };
}

/** Put the objects back to the snapshot: a cell carried at the commit rests beside the station; movers get their power. */
export function restoreObjects(world, snap) {
  world.relays.forEach((relay) => { relay.active = snap.relays.includes(relay.id); });
  world.stations.forEach((station) => {
    station.active = snap.stations.includes(station.id);
    station.inRange = false;
    station.armed = true;
    station.pending = false;
  });
  // ILO reboots standing at the checkpoint station: that is no new visit.
  const here = byId(world.stations, world.checkpoint.stationId) ?? null;
  if (here !== null) {
    here.inRange = true;
    here.armed = false;
  }
  world.sockets.forEach((socket, i) => {
    socket.cell = snap.sockets[i];
    socket.powered = socket.cell !== null;
  });
  world.switches.forEach((latch, i) => { latch.on = snap.switches[i]; });
  world.archives.forEach((archive) => { archive.collected = snap.archives.includes(archive.id); });
  world.caches.forEach((cache) => { cache.collected = snap.caches.includes(cache.id); });
  if (world.ascent !== null) {
    world.ascent.idle = snap.idle;
    world.ascent.stage = null;
    world.ascent.cabinY = world.ascent.y;
  }
  // Power comes first: the core places the toggle movers right after this call, and a resting cell keeps clear of them.
  for (const m of world.movers) {
    m.powered = isPowered(world, list(m.poweredBy));
    if (m.kind === 'press') m.stage = null;
  }
  const anchor = here ?? world.level.spawn;
  world.cells.forEach((cell, i) => restoreCell(world, cell, snap.cells[i], anchor));
  // A cell that lay where ILO reboots would close around ILO: like one that was carried, it rests beside the anchor.
  // Every cell is back where it lay by now, so one that already occupies the rest spot sends this one to the other side.
  const feet = bodyRect(anchor.x, anchor.y);
  for (const cell of world.cells) {
    if (cell.state === 'loose' && overlaps(centered(cell), feet, REBOOT_CLEAR)) Object.assign(cell, restSpot(world, cell, anchor));
  }
  world.player.carrying = null;
  REVEALED.get(world).wave = null;
}

/** Per step of `relayActivation`: the reveal cue of the finished wave, the route hint, then control back to ILO. */
export function relayStep(world) {
  flushReveal(world);
  world.camera.lookT = world.modeTime;
  if (world.modeTime < RUN.relayTime) return;
  world.camera.lookAt = null;
  world.camera.lookT = 0;
  setMode(world, 'play');
}

/** Per step of `liftSequence`: the five stages of §3.13, each announced at its start, then `complete`. */
export function liftStep(world) {
  const ascent = world.ascent;
  const player = world.player;
  const time = Math.min(world.modeTime, LIFT_END);
  const stage = LIFT_STAGES.findLast((name) => time >= STAGE_START[name]);
  if (ascent.stage !== stage) {
    ascent.stage = stage;
    emit(world, 'liftSequence', { stage });
  }
  // ILO stands on the cabin floor without input: in its center, 3 units to the right once the terrace walk is over.
  const part = (name) => smooth((time - STAGE_START[name]) / LIFT[name]);
  player.vx = 0;
  player.vy = 0;
  player.x = ascent.x + WALK * part('terrace');
  ascent.cabinY = ascent.y + (world.level.bounds.y1 - ascent.y) * part('rise');
  player.y = ascent.cabinY;
  if (stage === 'board') Object.assign(player, { grounded: true, onMover: null, wall: 0, sliding: false, dashT: 0, facing: 1 });
  if (world.modeTime >= LIFT_END) {
    emit(world, 'complete', { result: world.result });
    setMode(world, 'complete');
  }
}

/** A mover without `poweredBy` always runs; else any socket that holds a cell, switch that is on or active relay powers it. */
function isPowered(world, ids) {
  return ids.length === 0 || ids.some((id) => world.sockets.some((s) => s.id === id && s.cell !== null)
    || world.switches.some((s) => s.id === id && s.on) || world.relays.some((r) => r.id === id && r.active));
}

/**
 * A press warns while it rests up top with at most `warn` seconds left; below the top it is in a stroke. The stage
 * is `drop` from the first step down through the rest at the bottom, and `rise` from the first step back up.
 * It never reads `dy`: at an arrival that is float noise, not a direction.
 */
function pressStage(press) {
  if (press.t === 1) return 'drop';
  if (press.t === 0) return press.moving ? 'rise' : press.wait <= press.warn ? 'warn' : null;
  return press.dir === 1 ? 'drop' : 'rise';
}

/** The `press` cue of every stage change within earshot. */
function updatePresses(world) {
  for (const press of world.presses) {
    const stage = pressStage(press);
    if (stage === press.stage) continue;
    press.stage = stage;
    if (stage !== null && heard(world, press.x, press.x + press.w)) {
      emit(world, 'press', { id: press.id, stage, x: press.x + press.w / 2, y: press.y + press.h / 2 });
    }
  }
}

/** The vent cycle of §3.10 counted from `t = 0`. */
function ventStage(vent) {
  if (vent.t < vent.delay) return 'dormant';
  const phase = (vent.t - vent.delay) % vent.period;
  if (phase < vent.period - vent.warn - vent.active) return 'dormant';
  return phase < vent.period - vent.active ? 'warning' : 'active';
}

function updateVents(world) {
  for (const vent of world.vents) {
    vent.t += DT;
    const stage = ventStage(vent);
    if (stage !== vent.stage) {
      vent.stage = stage;
      if (heard(world, vent.x - vent.w / 2, vent.x + vent.w / 2)) emit(world, 'vent', { id: vent.id, stage, x: vent.x, y: vent.y });
    }
    if (stage === 'active') {
      world.hazards.push({ kind: 'vent', x: vent.x - vent.w / 2, y: vent.y, w: vent.w, h: vent.h, sx: vent.x, sy: vent.y + vent.h });
    }
  }
}

/**
 * A station docks ILO that enters its range while the station is armed: it repairs, refills and commits, then
 * arms again once ILO is `STATION_ARM` away. An entry made under hit immunity stays pending until the immunity is
 * over, even when ILO has walked on: no visit is lost.
 */
function updateStations(world) {
  const player = world.player;
  for (const station of world.stations) {
    const near = atStation(player, station);
    if (Math.abs(player.x - station.x) > STATION_ARM) station.armed = true;
    const entering = near && !station.inRange && station.armed;
    if (entering) {
      station.armed = false;
      station.pending = player.immunity > 0;
      if (!station.pending) dock(world, station);
    } else if (station.pending && player.immunity <= 0) {
      dock(world, station);
    }
    station.inRange = near;
  }
}

/** The activation of a station: repair, refill, the `station` event and the checkpoint commit. */
function dock(world, station) {
  station.pending = false;
  station.active = true;
  world.player.hp = RUN.integrity;
  world.player.energy = PULSE.max;
  emit(world, 'station', { id: station.id, x: station.x, y: station.y });
  commitCheckpoint(world, station.id);
}

/**
 * True when no wave shows `marked` again: a broken seam, or a reveal marker of a seam that broke. Such a marker is
 * spent: a wave that reaches it lights nothing and lists nothing, and nothing asks for a pulse on its account.
 */
function spent(world, marked) {
  return marked.broken === true || (marked.kind === 'seam' && byId(world.seams, marked.ref)?.broken === true);
}

/** A seam or reveal marker reached by the wave: highlighted for `revealTime`, and listed in the wave's one `reveal` event. */
function reveal(world, marker) {
  if (spent(world, marker)) return;
  marker.revealedUntil = world.time + PULSE.revealTime;
  const batch = REVEALED.get(world);
  if (batch.wave !== world.pulse) {
    batch.wave = world.pulse;
    batch.ids = [];
  }
  batch.ids.push(marker.id);
}

function flushReveal(world) {
  const batch = REVEALED.get(world);
  if (batch.wave === null || world.pulse !== null) return;
  emit(world, 'reveal', { ids: batch.ids });
  batch.wave = null;
}

/** True when a pulse that reaches the node switches the relay on: it has no socket, or its socket holds a cell. */
function relayReady(world, relay) {
  const socket = byId(world.sockets, relay.socket);
  return relay.socket === null || (socket !== undefined && socket.cell !== null);
}

/** A pulse that reaches the node: `relayUnpowered` while its socket is empty; else the relay locks on and the look starts. */
function activateRelay(world, relay) {
  if (relay.active) return;
  if (!relayReady(world, relay)) {
    emit(world, 'relayUnpowered', { id: relay.id });
    return;
  }
  relay.active = true;
  const station = byId(world.stations, relay.station);
  if (station !== undefined) station.active = true;
  commitCheckpoint(world, relay.station);
  world.camera.lookAt = relay.lookAt;
  world.prompt = null;
  world.interactTarget = null;
  setMode(world, 'relayActivation');
  emit(world, 'relay', { id: relay.id, x: relay.x, y: relay.y, lookAt: { ...relay.lookAt } });
}

/** The one thing E acts on, in the order of §3.10 "Interact priority"; null when nothing is in range. */
function findTarget(world) {
  const player = world.player;
  const carried = player.carrying === null ? null : byId(world.cells, player.carrying) ?? null;
  if (carried !== null) {
    const socket = world.sockets.find((s) => s.cell === null && inRange(world, centered(s)));
    if (socket !== undefined) return target('insert', socket);
    const spot = putDown(world, carried) ?? spotAt(player, 1);
    return { kind: 'place', id: carried.id, x: spot.x, y: spot.y };
  }
  let nearest = null;
  for (const cell of world.cells) {
    if (cell.state !== 'loose' || !inRange(world, centered(cell))) continue;
    if (nearest === null || Math.hypot(cell.x - player.x, cell.y - player.y) < Math.hypot(nearest.x - player.x, nearest.y - player.y)) {
      nearest = cell;
    }
  }
  if (nearest !== null) return target('pickup', nearest);
  const socketed = world.cells.find((cell) => cell.state === 'socketed' && inRange(world, centered(cell)));
  if (socketed !== undefined) return target('remove', socketed);
  const latch = world.switches.find((s) => !s.on && inRange(world, standing(s)));
  if (latch !== undefined) return target('switch', latch);
  // A cache and an archive share one rank: of those in reach, E acts on the nearest, whatever the kind.
  const find = nearestFind(world);
  if (find !== null) return find;
  if (liftReady(world)) return { kind: 'lift', id: world.ascent.id, x: world.ascent.console.x, y: world.ascent.console.y };
  return null;
}

/**
 * The uncollected cache or archive in reach that is nearest to ILO's body, measured like the reach itself.
 * Null when neither is in reach; a tie keeps the cache, which is looked at first.
 */
function nearestFind(world) {
  let found = null;
  let distance = Infinity;
  for (const [kind, items] of [['cache', world.caches], ['archive', world.archives]]) {
    for (const item of items) {
      if (item.collected) continue;
      const to = reachTo(world, standing(item));
      if (to <= PLAYER.interactReach && to < distance) {
        found = target(kind, item);
        distance = to;
      }
    }
  }
  return found;
}

/** Where the carried cell can be put down: in front, then behind; null when neither spot is free. */
function putDown(world, cell) {
  for (const sign of [1, -1]) {
    const spot = spotAt(world.player, sign);
    if (restsFree(world, cell, spot)) return spot;
  }
  return null;
}

/** True when the cell rests on ground at `spot` and meets nothing solid, hazardous, lethal or a socket housing. */
function restsFree(world, cell, spot) {
  const rect = bodyRect(spot.x, spot.y, cell.w, cell.h);
  const solids = dynamicSolids(world);
  return staticHits(world, rect).length === 0
    && solids.every((s) => !overlaps(rect, s))
    && groundBelow(world, rect, PROBE, solids) !== null
    && !world.hazards.some((hazard) => overlaps(rect, hazard))
    && !list(world.level.kill).some((k) => overlaps(rect, k))
    && !world.sockets.some((socket) => overlaps(rect, centered(socket)));
}

/** The spot beside `anchor` where a cell carried at a commit rests: `REST_OFFSET` right when free, else left. */
function restSpot(world, cell, anchor) {
  const right = { x: anchor.x + REST_OFFSET, y: anchor.y };
  return spotFree(world, cell, right) ? right : { x: anchor.x - REST_OFFSET, y: anchor.y };
}

/** True when nothing solid meets a cell at `spot`: rock, a mover back at its start, or a cell already restored. */
function spotFree(world, cell, spot) {
  const rect = bodyRect(spot.x, spot.y, cell.w, cell.h);
  const parked = world.movers.filter((m) => m.enabled)
    .map((m) => (m.mode === 'toggle' && m.powered ? { x: m.tx, y: m.ty, w: m.w, h: m.h } : { x: m.fx, y: m.fy, w: m.w, h: m.h }));
  return staticHits(world, rect).length === 0
    && parked.every((m) => !overlaps(rect, m))
    && !world.cells.some((other) => other !== cell && other.state === 'loose' && overlaps(rect, centered(other)));
}

/** One cell back from the snapshot: into its socket, where it lay, or beside `anchor` when it was carried. */
function restoreCell(world, cell, [state, x, y], anchor) {
  const socket = world.sockets.find((s) => s.cell === cell.id);
  if (socket !== undefined) {
    Object.assign(cell, { state: 'socketed', socket: socket.id, x: socket.x, y: socket.y });
    return;
  }
  Object.assign(cell, { state: 'loose', socket: null, x, y });
  if (state === 'carried') Object.assign(cell, restSpot(world, cell, anchor));
}

/** The console answers only with every relay active and ILO inside the boarding area of an idle lift, hands free. */
function liftReady(world) {
  const ascent = world.ascent;
  return ascent !== null && ascent.idle && world.player.carrying === null && activeRelays(world).length === LETTERS.length
    && inside(playerRect(world), ascent.boarding);
}

/** Inside the boarding area of a lift that lacks relays: why its console stays dead. */
function offlinePrompt(world) {
  const ascent = world.ascent;
  if (ascent === null || !inside(playerRect(world), ascent.boarding)) return null;
  const count = activeRelays(world).length;
  return count === LETTERS.length ? null : OFFLINE[count];
}

/**
 * The prompt for a pulse (GOAL §17): only where Q emits a wave now and the wave does something ILO has not seen.
 * It wakes an offline relay whose socket is fed, or highlights a hidden seam or a reveal marker that is not lit and
 * not spent, each only where the wave itself would reach it (§3.7); a seam or a marker must lie within `HINT_RANGE`.
 * An enemy alone never asks: the prompt is for what the wave opens and shows, not for what it may interrupt.
 */
function pulseHint(world) {
  if (!pulseReady(world.player)) return null;
  const from = pulseOrigin(world.player);
  const inSight = (point, range) => waveReaches(world, from.x, from.y, range, point.x, point.y);
  const toLight = (marked) => marked.revealedUntil <= world.time && !spent(world, marked);
  const wake = world.relays.some((node) => !node.active && relayReady(world, node) && inSight(node, PULSE.radius));
  const light = world.seams.some((seam) => seam.hidden && toLight(seam) && inSight(middle(seam), HINT_RANGE))
    || world.reveals.some((marker) => toLight(marker) && inSight(marker, HINT_RANGE));
  return wake || light ? PULSE_PROMPT : null;
}

/** The run record of §3.13, committed once when the lift leaves. */
function buildResult(world) {
  const archives = world.archives.filter((a) => a.collected).length;
  return {
    // The console step adds its own tick to the clock after this runs: the record holds the clock as it stops.
    time: world.clock + DT,
    recoveries: world.recoveries,
    archives,
    caches: world.caches.filter((c) => c.collected).length,
    disabled: world.enemies.filter((e) => e.state === 'disabled').length,
    relays: activeRelays(world),
    fullArchive: archives === LETTERS.length,
  };
}

function insert(world, cell, socket) {
  Object.assign(cell, { state: 'socketed', socket: socket.id, x: socket.x, y: socket.y });
  socket.cell = cell.id;
  world.player.carrying = null;
  emit(world, 'cellInsert', { id: cell.id, socketId: socket.id });
}

function drop(world, cell, spot) {
  if (!restsFree(world, cell, spot)) {
    emit(world, 'cellReject');
    return;
  }
  Object.assign(cell, spot, { state: 'loose', socket: null });
  world.player.carrying = null;
  emit(world, 'cellDrop', { id: cell.id, x: cell.x, y: cell.y });
}

/** The action of one E press on `found`, the target this step found. */
function act(world, found) {
  const player = world.player;
  switch (found.kind) {
    case 'insert':
      insert(world, byId(world.cells, player.carrying), byId(world.sockets, found.id));
      break;
    case 'place':
      drop(world, byId(world.cells, player.carrying), found);
      break;
    case 'pickup': {
      const cell = byId(world.cells, found.id);
      cell.state = 'carried';
      player.carrying = cell.id;
      emit(world, 'cellPickup', { id: cell.id });
      break;
    }
    case 'remove': {
      const cell = byId(world.cells, found.id);
      const socket = byId(world.sockets, cell.socket);
      socket.cell = null;
      cell.socket = null;
      cell.state = 'carried';
      player.carrying = cell.id;
      emit(world, 'cellRemove', { id: cell.id, socketId: socket.id });
      break;
    }
    case 'switch': {
      const latch = byId(world.switches, found.id);
      latch.on = true;
      emit(world, 'switch', { id: latch.id, x: latch.x, y: latch.y });
      break;
    }
    case 'cache': {
      const cache = byId(world.caches, found.id);
      const gained = Math.min(CACHE.energy, PULSE.max - player.energy);
      cache.collected = true;
      player.energy += gained;
      emit(world, 'cache', { id: cache.id, gained });
      break;
    }
    case 'archive': {
      const archive = byId(world.archives, found.id);
      archive.collected = true;
      emit(world, 'archive', { id: archive.id, title: archive.title, text: archive.text });
      break;
    }
    default:
      // The lift leaves: the result is committed once and the sequence of §3.13 takes over.
      world.result = buildResult(world);
      world.ascent.idle = false;
      world.prompt = null;
      world.interactTarget = null;
      setMode(world, 'liftSequence');
  }
}
