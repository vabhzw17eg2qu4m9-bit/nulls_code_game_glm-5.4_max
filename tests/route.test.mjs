// The complete course played by script through real inputs only (contract §3.1), and the route rules of GOAL §10
// as assertions on the level data and on that run. The script teleports nowhere, writes no field after the start
// and sets no debug flag: the one thing set outside `stepWorld` is what the glue sets to begin a run,
// `world.mode = 'play'` (src/main.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DT, PLAYER, PULSE } from '../src/config.js';
import { LEVEL } from '../src/level/level.js';
import { createWorld, inspect } from '../src/sim/world.js';
import { createCameraRig, freeRect, viewRect } from '../src/render/camera.js';
import { Driver } from './route-driver.js';
import { MAIN, ROUTE, byId, climbSlot, cut, from, until } from './route-steps.js';

const solid = (id) => byId(LEVEL.solids, id);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const top = (s) => s.y + s.h;
/** True when `inner` lies wholly inside `outer` (both rectangles with x, y, w, h). */
const holds = (outer, inner) => inner.x >= outer.x - 1e-9 && inner.x + inner.w <= outer.x + outer.w + 1e-9
  && inner.y >= outer.y - 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;

/** A new world started the way the glue starts it, driven through the steps of the script: ids, or step functions (`cut`). */
function play(ids, watch = null) {
  const world = createWorld(LEVEL);
  world.mode = 'play';
  const d = new Driver(world);
  if (watch !== null) d.watchers.push(watch);
  for (const step of ids) d.section(typeof step === 'string' ? step : 'cut', typeof step === 'string' ? ROUTE[step] : step);
  return { world, d };
}

const VIEW = [960, 540];                            // canvas pixels of a wide screen: the rig shows 14 units of height
const PHONE = [844, 390];                           // canvas pixels of a phone on its side ...
const PHONE_BANDS = { top: 66, bottom: 126, left: 190, right: 210 }; // ... and its interface bands over the canvas
const PAN_TIME = 0.25;                              // seconds in which the view moves at most PAN_LIMIT units (GOAL §14)
const PAN_LIMIT = 6;
const PAN_STEPS = Math.round(PAN_TIME / DT) + 1;    // the updates that span PAN_TIME

/** What a run measures as it goes: the clock, the rest of each platform at its boarding end, every stretch with a
 *  carried cell, where each drone is when it begins to aim, what the real camera rig shows at the end of each stand,
 *  and how the view moves on a wide screen and on a phone on its side. The measures end up on `watch.m`. */
function measures() {
  const m = {
    lastClock: 0, rollback: false, rests: {}, carries: [], aims: [], seen: 0, carry: null, stands: 0, view: null,
    pans: [0, 0], panAt: [null, null], offBands: null,
  };
  const rig = createCameraRig(LEVEL);
  const phone = createCameraRig(LEVEL);
  phone.setBands(PHONE_BANDS);
  const trails = [[], []];                          // the last view centers on each screen, over PAN_TIME
  const watch = (d) => {
    const { world } = d;
    const p = world.player;
    m.rollback ||= world.clock < m.lastClock - 1e-9;
    m.lastClock = world.clock;
    for (const platform of world.movers) {
      if (platform.kind !== 'platform') continue;
      const rest = m.rests[platform.id] ??= { run: 0, longest: 0, resting: false };
      if (platform.moving) {                        // a departure ends the rest; an arrival at the boarding end starts one
        if (rest.resting) rest.longest = Math.max(rest.longest, rest.run * DT);
        rest.run = 0;
        rest.resting = platform.t === 0;
      } else if (rest.resting) {
        rest.run += 1;
      }
    }
    if (p.carrying !== null) {
      const carry = m.carry ??= { id: p.carrying, minX: p.x, maxX: p.x, y0: p.y, grounds: [] };
      carry.minX = Math.min(carry.minX, p.x);
      carry.maxX = Math.max(carry.maxX, p.x);
      if (p.grounded && !carry.grounds.includes(p.y)) carry.grounds.push(p.y);
    } else if (m.carry !== null) {
      m.carries.push(m.carry);
      m.carry = null;
    }
    for (const event of d.events.slice(m.seen)) {
      if (event.type !== 'enemyState' || event.state !== 'aim') continue;
      m.aims.push({ id: event.id, distance: Math.hypot(p.x - event.x, p.y + PLAYER.h / 2 - (event.y + 0.45)) });
    }
    m.seen = d.events.length;
    const view = rig.update(world, DT, ...VIEW);
    const shown = viewRect(view, ...VIEW);
    m.view = { x: shown.x0, y: shown.y0, w: shown.x1 - shown.x0, h: shown.y1 - shown.y0 };
    if (d.stands.length > m.stands) {                // a stand has just ended: keep what the camera shows there
      m.stands = d.stands.length;
      d.stands.at(-1).view = m.view;
    }

    // The camera rules (GOAL §14): the view never moves more than 6 units in 0.25 s, on a wide screen and on a phone
    // on its side with its interface bands; on the phone ILO stays between the bands. A reboot cuts to the station.
    const onPhone = phone.update(world, DT, ...PHONE);
    if (world.mode === 'reboot') for (const trail of trails) trail.length = 0;
    [view, onPhone].forEach((center, i) => {
      const trail = trails[i];
      trail.push(center);
      if (trail.length > PAN_STEPS) trail.shift();
      if (trail.length < PAN_STEPS) return;
      const move = Math.hypot(center.x - trail[0].x, center.y - trail[0].y);
      if (move > m.pans[i]) {
        m.pans[i] = move;
        m.panAt[i] = `${world.clock.toFixed(2)} s, ILO at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
      }
    });
    const free = freeRect({ ...onPhone, x: onPhone.x + onPhone.shakeX, y: onPhone.y + onPhone.shakeY }, ...PHONE, PHONE_BANDS);
    if (m.offBands === null && (p.y + PLAYER.h + 0.5 > free.y1 + 1e-9 || p.y - 1 < free.y0 - 1e-9)) {
      m.offBands = `${world.clock.toFixed(2)} s, ILO at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
    }
  };
  watch.m = m;
  return watch;
}

/** The camera rules of a run (GOAL §14): on a wide screen and on a phone on its side with its interface bands the
 *  view never moves more than 6 units in 0.25 s; on the phone ILO's head stays 0.5 units under the HUD and its feet
 *  1 unit above the touch controls. */
function calm({ d }) {
  const m = d.watchers[0].m;
  for (const [i, screen] of ['a wide screen', 'a phone on its side'].entries()) {
    assert.ok(m.pans[i] <= PAN_LIMIT + 1e-9, `the view moves ${m.pans[i].toFixed(2)} units in ${PAN_TIME} s on ${screen}: ${m.panAt[i]}`);
  }
  assert.equal(m.offBands, null, `ILO meets an interface band of the phone: ${m.offBands}`);
}

// One safe observation spot before every vent, the sentinel and each drone of the route (GOAL §10).
const SPOTS = [
  { id: 'wsSkitter', x: 34.5, y: 6, enemy: 'wsSkitter' },
  { id: 'resDrone', x: 106.5, y: 13, enemy: 'resDrone' },
  { id: 'fndSentinel', x: 144.5, y: 22, enemy: 'fndSentinel' },
  { id: 'fndVent1', x: 162.5, y: 22, vent: 'fndVent1' },
  { id: 'fndVent2', x: 165.5, y: 22, vent: 'fndVent2' },
  { id: 'fndVent3', x: 168.5, y: 22, vent: 'fndVent3' },
  { id: 'ascVent1', x: 209, y: 54, vent: 'ascVent1', enemy: 'ascDrone' },
];

/** The camera zone the rig uses for a point: the smallest one that holds it, the first on a tie (render/camera.js). */
function zoneAt(x, y) {
  const area = (z) => (z.x1 - z.x0) * (z.y1 - z.y0);
  let zone = null;
  for (const z of LEVEL.camera) {
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1 && (zone === null || area(z) < area(zone))) zone = z;
  }
  return zone;
}

/** The ground a vent's jet or an enemy covers: the jet column, a skitter's or a drone's patrol sweep, a sentinel
 *  with its beam. */
function threatRect(id, kind) {
  if (kind === 'vent') {
    const v = byId(LEVEL.vents, id);
    return { x: v.x - v.w / 2, y: v.y, w: v.w, h: v.h };
  }
  const e = byId(LEVEL.enemies, id);
  if (kind === 'skitter') {
    return { x: e.range.x0 - e.w / 2, y: e.y, w: e.range.x1 - e.range.x0 + e.w, h: e.h };
  }
  const body = { x: e.x - e.w / 2, y: e.y, w: e.w, h: e.h };
  if (kind === 'drone') {
    return { x: Math.min(e.route.fx, e.route.tx) - e.w / 2, y: e.y, w: Math.abs(e.route.tx - e.route.fx) + e.w, h: e.h };
  }
  const x0 = Math.min(body.x, e.lane.x);
  const x1 = Math.max(body.x + body.w, e.lane.x + e.lane.w);
  return { x: x0, y: Math.min(body.y, e.lane.y), w: x1 - x0, h: Math.max(body.y + body.h, e.lane.y + e.lane.h) - Math.min(body.y, e.lane.y) };
}

/** The rects watched from a spot: the jet of its vent, the reach of its enemy. */
const threatsOf = (spot) => [
  ...(spot.vent === undefined ? [] : [threatRect(spot.vent, 'vent')]),
  ...(spot.enemy === undefined ? [] : [threatRect(spot.enemy, byId(LEVEL.enemies, spot.enemy).kind)]),
];

/** What every finished run looks like when nothing went wrong, whoever was collected on the way. */
function finished({ world, d }, { archives = 0, caches = 0, recoveries = 0 } = {}) {
  assert.equal(world.mode, 'complete');
  assert.equal(d.seen('complete').length, 1, 'exactly one complete event');
  assert.equal(d.seen('shield').length, 0, 'no shield spent');
  assert.equal(d.seen('damage').length, 0, 'no damage');
  assert.equal(world.recoveries, recoveries, 'no recovery beyond the deliberate one');
  assert.equal(world.player.hp, 3);
  assert.deepEqual(world.relays.map((r) => [r.id, r.active]), [['A', true], ['B', true], ['C', true]]);
  assert.equal(world.archives.filter((a) => a.collected).length, archives);
  assert.equal(world.caches.filter((c) => c.collected).length, caches);
  assert.deepEqual(world.result, {
    time: world.clock, recoveries, archives, caches, disabled: 2, relays: ['A', 'B', 'C'], fullArchive: false,
  });
  assert.equal(world.player.y, LEVEL.bounds.y1, 'ILO ends on the terrace at the top of the level');
}

let mainRun = null;
const main = () => (mainRun ??= play(MAIN, measures()));

test('main route: spawn to complete by real inputs, no discovery, no damage, no recovery', () => {
  const run = main();
  const { world } = run;
  finished(run);
  console.log(`main route: complete at clock ${world.clock.toFixed(2)} s`);
  assert.equal(run.d.watchers[0].m.rollback, false, 'the clock never rolls back');
});

test('route rules on the level data', () => {
  // The first wall-jump shaft (M14: x 91 to 95, floor 3) stands on solid ground: no water, no pit under its floor.
  const [ground] = LEVEL.solids.filter((s) => s.x <= 91 && s.x + s.w >= 95 && near(top(s), 3));
  assert.ok(ground !== undefined, 'a solid floor spans the shaft');
  assert.ok(3 - ground.y >= 3, 'three units of rock under the shaft floor');
  assert.equal(LEVEL.kill.filter((k) => k.x < 95 && k.x + k.w > 91).length, 0);

  // The first moving platform rests at its boarding end for at least 1.5 s.
  assert.ok(byId(LEVEL.platforms, 'resBridge').pauseA >= 1.5);

  // Every kill rect is at least 3 units tall and reaches below any floor inside it.
  assert.equal(LEVEL.kill.length, 2);
  for (const k of LEVEL.kill) {
    assert.ok(k.h >= 3, `${k.id} is ${k.h} units tall`);
    for (const s of LEVEL.solids) {
      const floorInside = s.x < k.x + k.w && s.x + s.w > k.x && top(s) < k.y + k.h;
      if (floorInside) assert.ok(top(s) <= k.y + 1e-9, `${k.id} ends above the top of ${s.id}`);
    }
  }

  // Safe observation: the camera zone of each spot shows the whole threat watched from there.
  for (const spot of SPOTS) {
    const zone = zoneAt(spot.x, spot.y);
    assert.ok(zone !== null, `${spot.id}: the spot lies in a camera zone`);
    const threats = threatsOf(spot);
    assert.ok(threats.length > 0);
    for (const rect of threats) {
      assert.ok(holds({ x: zone.x0, y: zone.y0, w: zone.x1 - zone.x0, h: zone.y1 - zone.y0 }, rect),
        `${spot.id}: ${JSON.stringify(rect)} lies inside camera zone ${zone.id} `
        + `[${zone.x0}, ${zone.y0}, ${zone.x1}, ${zone.y1}]`);
    }
  }
});

/** The cells a body of ILO's height flies to from the spawn when the seams in `shut` are walls: an open cell with the
 *  cell above open (ILO is 1.5 units tall), joined on four sides, inside the bounds. Flying is a generous notion of
 *  reach, so a cell outside it is out of ILO's reach on foot too. */
function reach(shut) {
  const wall = new Set();
  const block = ({ x, y, w, h }) => {
    for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) wall.add(`${i},${j}`);
  };
  LEVEL.solids.forEach(block);
  shut.forEach(block);
  const { x0, y0, x1, y1 } = LEVEL.bounds;
  const open = (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1 && !wall.has(`${x},${y}`) && !wall.has(`${x},${y + 1}`);
  const seen = new Set();
  const queue = [[Math.floor(LEVEL.spawn.x), Math.floor(LEVEL.spawn.y)]];
  for (const [x, y] of queue) {
    if (!open(x, y) || seen.has(`${x},${y}`)) continue;
    seen.add(`${x},${y}`);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

test('route rules on the level data: every hidden seam guards a discovery; the Reservoir has a pulse-revealed side passage', () => {
  const hidden = LEVEL.seams.filter((seam) => seam.hidden);
  const finds = [...LEVEL.archives, ...LEVEL.caches];
  const intact = reach(hidden);                   // the course as a run that breaks no hidden seam finds it
  const cellOf = (object) => `${Math.floor(object.x)},${Math.floor(object.y)}`;
  const guards = hidden.map((seam) => {
    const behind = [...reach(hidden.filter((other) => other !== seam))].filter((cell) => !intact.has(cell));
    const find = finds.find((object) => behind.includes(cellOf(object)));
    assert.ok(find !== undefined, `${seam.id}: no archive or cache stands behind it`);
    return [seam, find];
  });
  const passages = guards.filter(([seam]) => seam.region === 'reservoir');
  assert.equal(passages.length, 1, 'the Reservoir has one hidden seam');
  const [seam] = passages[0];
  assert.ok(LEVEL.reveals.some((marker) => marker.kind === 'seam' && marker.ref === seam.id),
    `no reveal marker of kind seam points at ${seam.id}`);
  console.log(`hidden seams: ${guards.map(([s, f]) => `${s.id} guards ${f.id}`).join('; ')}`);
});

test('route rules on the scripted main run', () => {
  const { world, d } = main();
  const m = d.watchers[0].m;

  // The first wall-jump shaft: the climb starts with a jump from the ground beneath the shaft.
  const [ground] = LEVEL.solids.filter((s) => s.x <= 91 && s.x + s.w >= 95 && near(top(s), 3));
  assert.ok(d.jumps.some((j) => j.from === ground.id && j.x0 > 91 && j.x0 < 95), 'the climb leaves the shaft floor');

  // Each platform was watched resting at its boarding end for at least 1.5 s.
  for (const id of ['resBridge', 'ascPlatform']) {
    assert.ok(m.rests[id] !== undefined && m.rests[id].longest >= 1.5 - DT, `${id} rests at least 1.5 s at its boarding end`);
  }

  // Safe observation: ILO stood 3 s at each spot, met no hazard there, and the camera showed the threat.
  for (const spot of SPOTS) {
    const stand = d.stands.find((s) => Math.abs(s.x - spot.x) <= 0.2 && Math.abs(s.y - spot.y) <= 0.05 && s.time >= 3);
    assert.ok(stand !== undefined, `${spot.id}: a stand of 3 s at (${spot.x}, ${spot.y}); stands: ${JSON.stringify(d.stands)}`);
    assert.deepEqual(stand.hazards, [], `${spot.id}: no hazard met ILO at (${stand.x}, ${stand.y})`);
    for (const rect of threatsOf(spot)) {
      assert.ok(holds(stand.view, rect), `${spot.id}: the view at the spot shows ${JSON.stringify(rect)}; view ${JSON.stringify(stand.view)}`);
    }
  }

  // The camera rules (GOAL §14): no pan above the limit on either screen, and ILO clear of the phone's bands.
  calm({ d });

  // Every gap jump of the route lands at least 1 unit inside the ledge: M03, the three water jumps of M13, M24.
  const gapJumps = d.jumps.filter((j) => {
    const a = solid(j.from);
    const b = solid(j.to);
    if (a === undefined || b === undefined || a === b || Math.abs(j.y1 - j.y0) > 0.5) return false;
    return (j.x1 > j.x0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w)) > 0;
  });
  assert.equal(gapJumps.length, 5);
  for (const j of gapJumps) {
    const ledge = solid(j.to);
    const inside = j.x1 > j.x0 ? j.x1 - PLAYER.w / 2 - ledge.x : ledge.x + ledge.w - (j.x1 + PLAYER.w / 2);
    assert.ok(inside >= 1 - 1e-6, `the jump from x ${j.x0.toFixed(2)} lands ${inside.toFixed(2)} units inside ${ledge.id}`);
  }

  // The carried-cell stretches (M09, M26, M30) are flat: one unbroken floor and no gap. The only change of height
  // is the 0.6-unit deck of the lift cabin, mounted with a tap jump (a jump is allowed while carrying).
  assert.equal(m.carries.length, 3);
  assert.deepEqual(m.carries.map((c) => c.id), ['wsCell', 'fndCell', 'fndCell']);
  for (const c of m.carries) {
    for (const y of c.grounds) {
      assert.ok(y >= c.y0 - 0.01 && y <= c.y0 + 0.61, `${c.id} stands only on its floor (y ${c.y0}) and the cabin deck; stood at y ${y}`);
    }
    for (let x = c.minX - PLAYER.w / 2; x <= c.maxX + PLAYER.w / 2 + 1e-9; x += 0.25) {
      const floor = LEVEL.solids.find((s) => near(top(s), c.y0) && s.x <= x && x <= s.x + s.w);
      assert.ok(floor !== undefined, `${c.id}: the floor at y ${c.y0} is unbroken at x ${x.toFixed(2)}`);
    }
  }

  // A drone that begins to aim is inside a pulse from where ILO stands, and each one is stunned before it fires.
  assert.deepEqual(m.aims.map((a) => a.id), ['resDrone', 'ascDrone']);
  for (const aim of m.aims) assert.ok(aim.distance <= PULSE.radius, `${aim.id} begins to aim ${aim.distance.toFixed(2)} units from ILO`);
  const states = d.seen('enemyState').filter((e) => e.id === 'resDrone' || e.id === 'ascDrone').map((e) => e.state);
  assert.deepEqual(states, ['aim', 'stunned', 'disabled', 'aim', 'stunned', 'disabled']);
  assert.equal(d.seen('enemyAttack').filter((e) => e.id === 'resDrone' || e.id === 'ascDrone').length, 0, 'no drone fires');

  // The mandatory path depends on no secret (GOAL §10): the main run breaks no hidden seam and leaves each one intact.
  assert.deepEqual(d.seen('seamBreak').map((e) => e.id), ['wsTrain'], 'the training seam is the only seam the main run breaks');
  assert.deepEqual(world.seams.filter((seam) => seam.hidden && seam.broken), [], 'no hidden seam is broken at the end');
});

/** A detour test in three parts: the detour, a deliberate recovery at the station that commits it, the rest of the
 *  route from that station. Returns the world and driver after the recovery. */
function detour(ids, archive, station) {
  const run = play(ids, measures());
  const { world, d } = run;
  assert.equal(byId(world.archives, archive).collected, true);
  assert.equal(world.checkpoint.stationId, station);
  assert.ok(world.checkpoint.snap.objects.archives.includes(archive), `station ${station} commits the archive`);
  const clock = world.clock;
  d.section('retry', (d) => d.retry());
  assert.equal(byId(world.archives, archive).collected, true, 'the recovery keeps the archive');
  assert.equal(world.recoveries, 1);
  assert.ok(world.clock >= clock && world.clock < clock + 0.1, 'the retry adds no roll-back of the clock');
  return run;
}

test('archive A (D2): collected, committed at the next station, kept through a deliberate recovery', () => {
  const run = detour([...until('M07'), 'D2', ...from('M08').slice(0, 4)], 'A', 'st2');
  assert.equal(byId(run.world.seams, 'wsAlcove').broken, true);
  for (const id of from('M12')) run.d.section(id, ROUTE[id]);
  finished(run, { archives: 1, recoveries: 1 });
  calm(run);
});

test('archive B (D3): collected, committed at the next station, kept through a deliberate recovery', () => {
  const run = detour([...until('M22'), 'D3', ...from('M23').slice(0, 9)], 'B', 'st4');
  for (const id of from('M32')) run.d.section(id, ROUTE[id]);
  finished(run, { archives: 1, recoveries: 1 });
  calm(run);
});

test('archive C (D4): collected, committed at the next station, kept through a deliberate recovery', () => {
  const run = detour([...until('M23'), 'D4', ...from('M24').slice(0, 8)], 'C', 'st4');
  assert.equal(byId(run.world.seams, 'fndServiceSeam').broken, true);
  for (const id of from('M32')) run.d.section(id, ROUTE[id]);
  finished(run, { archives: 1, recoveries: 1 });
  calm(run);
});

test('cache1 (D1) collected below 75 energy gains 25; the route goes on to complete', () => {
  const run = play(['M01', 'M02a', 'D1', 'M02b', ...from('M03')], measures());
  const [event] = run.d.seen('cache');
  assert.deepEqual([event.id, event.gained], ['cache1', 25]);
  assert.equal(byId(run.world.caches, 'cache1').collected, true);
  finished(run, { caches: 1 });
  calm(run);
});

test('cache3 (D5) collected at full energy gains 0 and is collected; the route goes on to complete', () => {
  const run = play([...until('M28'), 'D5', ...from('M29')], measures());
  const [event] = run.d.seen('cache');
  assert.deepEqual([event.id, event.gained], ['cache3', 0]);
  assert.equal(byId(run.world.caches, 'cache3').collected, true);
  assert.equal(run.d.seen('crush').length, 0, 'the press never caught ILO');
  finished(run, { caches: 1 });
  calm(run);
});

test('cache2 (D6) lies behind the pulse-revealed side passage of the Reservoir: a pulse shows the seam, a dash opens it; the route goes on to complete', () => {
  const run = play([...until('M19'), 'D6', ...from('M20')], measures());
  const { world, d } = run;
  // A wave lights only a seam that is intact when it arrives: the seam is in the reveal event, so the pulse showed it
  // before the dash broke it.
  assert.ok(d.seen('reveal').some((e) => e.ids.includes('resPassage')), 'a pulse shows the hidden seam');
  assert.deepEqual(d.seen('seamBreak').map((e) => e.id), ['wsTrain', 'resPassage'], 'the dash opens the seam');
  const [event] = d.seen('cache');
  assert.deepEqual([event.id, event.gained], ['cache2', 25]);   // 49 energy after the pulse of the detour
  assert.equal(byId(world.caches, 'cache2').collected, true);
  finished(run, { caches: 1 });
  calm(run);
});

test('the side passage of the Reservoir asks for a pulse: in the basin the prompt is Q — Echo Pulse', () => {
  const { world, d } = play([...until('M19'), cut('D6', 'walkTo', 2)]);
  assert.ok(near(d.p.x, 110.3, 0.06) && near(d.p.y, 11, 1e-6) && d.p.grounded, `ILO stands in the basin at (${d.p.x.toFixed(2)}, ${d.p.y})`);
  assert.deepEqual(world.prompt, { key: 'Q', text: 'Echo Pulse' });
});

/** After the Relay A commit: change everything the snapshot holds, then recover. */
function sabotage(d) {
  const skitter = byId(d.world.enemies, 'wsSkitter');
  climbSlot(d);
  d.pulse();
  d.dash(1);                                        // through the alcove seam, onto the gallery
  d.walkTo(46.5);
  d.walkTo(50.5);
  d.interact('remove');                             // the cell out of its socket
  d.walkTo(48.1);                                   // west of the socket's reach (1.3): E puts the cell down, not back in
  d.interact('place');
  climbSlot(d);
  d.walkTo(42.4);                                   // west over crate B, onto the west edge of crate A
  d.idle((d) => skitter.x >= 37.3, { timeout: 8, what: 'the skitter in reach of a pulse' });
  d.pulse();
  d.idle((d) => skitter.state === 'stunned', { timeout: 1, what: 'the skitter stunned' });
  d.walkTo(41.6);
  d.walkTo(Math.min(41, skitter.x + 2.2));         // off crate A: the dash meets the skitter on its floor
  d.dash(-1);
  d.idle((d) => skitter.state === 'disabled' && d.p.grounded, { timeout: 2, what: 'the skitter disabled' });
}

test('checkpoint after Relay A: a recovery brings the committed state back', () => {
  const { world, d } = play(until('M11'));
  assert.equal(world.checkpoint.stationId, 'st2');
  const shutter = byId(world.movers, 'wsShutter');
  const seam = byId(world.seams, 'wsAlcove');
  const socket = byId(world.sockets, 'wsSocket');
  const cell = byId(world.cells, 'wsCell');
  const skitter = byId(world.enemies, 'wsSkitter');
  d.section('sabotage', sabotage);

  // Everything the snapshot holds is now different from what the station committed.
  assert.equal(seam.broken, true);
  assert.equal(socket.cell, null);
  assert.equal(cell.state, 'loose');
  assert.ok(Math.abs(cell.x - socket.x) >= 1, 'the cell lies away from its socket');
  assert.deepEqual([shutter.powered, shutter.t, shutter.y], [false, 0, 6]);
  assert.equal(skitter.state, 'disabled');

  const clock = world.clock;
  d.section('retry', (d) => d.retry());

  // The committed state is back.
  assert.equal(world.recoveries, 1);
  assert.equal(byId(world.relays, 'A').active, true);
  assert.deepEqual([shutter.powered, shutter.t, shutter.y], [true, 1, 9]);
  assert.deepEqual([socket.cell, socket.powered], ['wsCell', true]);
  assert.deepEqual([cell.state, cell.socket, cell.x, cell.y], ['socketed', 'wsSocket', socket.x, socket.y]);
  assert.equal(seam.broken, false);
  assert.equal(skitter.state, 'patrol');
  assert.equal(byId(world.seams, 'wsTrain').broken, true, 'a seam broken before the commit stays broken');
  assert.deepEqual([world.player.x, world.player.y, world.player.hp, world.player.energy, world.player.carrying], [59.5, 6, 3, 100, null]);
  assert.equal(world.checkpoint.stationId, 'st2');
  assert.ok(world.clock >= clock && world.clock < clock + 0.1, 'the retry adds no roll-back of the clock');
});

test('the ECHO PULSE sign is a safe observation spot: 10 s idle there, the skitter awake, no hit; a pulse reaches it', () => {
  const sign = LEVEL.decor.find((item) => item.kind === 'sign' && item.text.includes('ECHO PULSE'));
  const { world, d } = play(until('M04'));
  d.section('at the sign', (d) => { d.walkTo(sign.x); d.stand(10, { timeout: 14, what: 'idle at the ECHO PULSE sign' }); });
  const skitter = byId(world.enemies, 'wsSkitter');
  assert.equal(skitter.awake, true);
  assert.deepEqual(d.stands.at(-1).hazards, [], 'no hazard touched ILO at the sign');
  assert.deepEqual([d.seen('shield').length, d.seen('damage').length, world.player.hp], [0, 0, 3]);
  d.section('pulse at the sign', (d) => {
    d.pulse();
    d.idle((d) => skitter.state === 'stunned', { timeout: 0.5, what: 'the skitter stunned by a pulse from the sign' });
  });
});

test('clock: a retry adds no roll-back', () => {
  const watch = measures();
  const { world, d } = play(until('M11'), watch);
  const before = world.clock;
  d.section('retry', (d) => d.retry());
  assert.deepEqual([world.recoveries, world.cause, world.mode], [1, 'retry', 'play']);
  assert.ok(world.clock >= before, 'the clock after the retry is not below the clock before it');
  assert.ok(world.clock - before < 0.1, 'the clock stood still while ILO was down');
  assert.equal(watch.m.rollback, false, 'the clock never rolled back during the run');
});

test('restart: two worlds start identical and the main route passes twice', () => {
  assert.deepEqual(inspect(createWorld(LEVEL)), inspect(createWorld(LEVEL)));
  const first = play(MAIN, measures());
  const second = play(MAIN, measures());
  finished(first);
  finished(second);
  assert.equal(second.d.watchers[0].m.rollback, false);
  assert.equal(first.world.clock, second.world.clock);
  assert.deepEqual(inspect(first.world), inspect(second.world));
});

/** What a recovery must bring back: the cells, the sockets, the switches, the seams, the relays, the discoveries,
 *  the disabled machines and the power of every mover. */
const puzzle = (world) => ({
  cells: world.cells.map((c) => [c.id, c.state, c.socket, c.x, c.y]),
  sockets: world.sockets.map((s) => [s.id, s.cell]),
  switches: world.switches.map((s) => [s.id, s.on]),
  seams: world.seams.map((s) => [s.id, s.broken]),
  relays: world.relays.map((r) => [r.id, r.active]),
  finds: [...world.archives, ...world.caches].map((o) => [o.id, o.collected]),
  power: world.movers.map((m) => [m.id, m.powered]),
  disabled: world.enemies.filter((e) => e.state === 'disabled').map((e) => e.id),
});

/** The world as each checkpoint committed it: st1 at creation, the others at the end of the step that reaches the station. */
const committed = {
  st1: () => { const world = createWorld(LEVEL); world.mode = 'play'; return world; },
  st2: () => play(until('M11')).world,
  st3: () => play(until('M21')).world,
  st4: () => play(until('M31')).world,
};

/** The worst moments after each checkpoint, and the step the route goes on from that station: the route reaches the
 *  moment, R restores the checkpoint the way Retry from Checkpoint does, and the rest must still complete (GOAL §11
 *  and §20: no softlocks, route access after power changes). `stands` tells the moment from the world. */
const SOFTLOCKS = [
  { station: 'st1', go: 'M02', moment: 'the workshop cell carried', reach: [until('M08'), cut('M09', 'interact', 1)],
    stands: (w) => assert.equal(w.player.carrying, 'wsCell') },
  { station: 'st1', go: 'M02', moment: 'the cell in the workshop socket before the pulse', reach: until('M10'),
    stands: (w) => assert.deepEqual([byId(w.sockets, 'wsSocket').cell, byId(w.movers, 'wsShutter').powered], ['wsCell', true]) },
  { station: 'st2', go: 'M12', moment: 'the bridge switch thrown', reach: until('M17'),
    stands: (w) => assert.equal(byId(w.switches, 'resSwitch').on, true) },
  { station: 'st2', go: 'M12', moment: 'riding the bridge over the water', reach: [until('M19'), cut('M20', 'leap', 1)],
    stands: (w) => assert.equal(w.player.onMover, 'resBridge') },
  { station: 'st2', go: 'M12', moment: 'east of the bridge channel, before Relay B', reach: until('M20'),
    stands: (w) => assert.ok(near(w.player.x, 132.5, 0.06) && near(w.player.y, 13, 1e-6), `ILO at (${w.player.x.toFixed(2)}, ${w.player.y})`) },
  { station: 'st3', go: 'M22', moment: 'the foundry cell carried', reach: [until('M25'), cut('M26', 'interact', 1)],
    stands: (w) => assert.equal(w.player.carrying, 'fndCell') },
  { station: 'st3', go: 'M22', moment: 'the cell in the lift socket, the cabin up', reach: until('M27'),
    stands: (w) => assert.deepEqual([byId(w.sockets, 'fndLiftSocket').cell, byId(w.movers, 'fndLift').t], ['fndCell', 1]) },
  { station: 'st3', go: 'M22', moment: 'the latch switch thrown, the shutter still closed', reach: until('M28'),
    stands: (w) => assert.deepEqual([byId(w.switches, 'fndUpperSwitch').on, byId(w.movers, 'fndUpper').t], [true, 0]) },
  { station: 'st3', go: 'M22', moment: 'the upper shutter open, back on the walkway', reach: until('M29'),
    stands: (w) => assert.deepEqual([byId(w.movers, 'fndUpper').powered, byId(w.movers, 'fndUpper').t, w.player.y], [true, 1, 22]) },
  { station: 'st3', go: 'M22', moment: 'the cell taken out of the lift socket', reach: [until('M29'), cut('M30', 'interact', 1)],
    stands: (w) => assert.equal(w.player.carrying, 'fndCell') },
  { station: 'st3', go: 'M22', moment: 'the cell in the relay socket before the pulse', reach: until('M30'),
    stands: (w) => assert.equal(byId(w.sockets, 'fndRelaySocket').cell, 'fndCell') },
  { station: 'st4', go: 'M32', moment: 'riding the ascent platform', reach: [until('M32'), cut('M33', 'idle', 2)],
    stands: (w) => assert.equal(w.player.onMover, 'ascPlatform') },
  { station: 'st4', go: 'M32', moment: 'on the block before the ascent drone', reach: until('M34'),
    stands: (w) => assert.ok(near(w.player.y, 56, 0.06), `ILO at y ${w.player.y}`) },
  { station: 'st4', go: 'M32', moment: 'on the top platform, before the lift', reach: until('M36'),
    stands: (w) => assert.equal(w.player.y, 66) },
];

for (const { station, go, moment, reach, stands } of SOFTLOCKS) {
  test(`softlock check, checkpoint ${station}: ${moment}: Retry from Checkpoint, then the route completes`, () => {
    const run = play(reach.flat());
    const { world, d } = run;
    stands(world);
    assert.equal(world.checkpoint.stationId, station);
    d.section('retry', (d) => d.retry());
    assert.deepEqual(puzzle(world), puzzle(committed[station]()), `the snapshot of ${station} is back`);
    for (const m of world.movers) {                // no shutter stuck, the lift cabin where the snapshot has it
      const t = m.mode === 'toggle' && m.powered ? 1 : 0;
      assert.deepEqual([m.t, m.x, m.y], [t, m.fx + (m.tx - m.fx) * t, m.fy + (m.ty - m.fy) * t], `${m.id} rests where the snapshot has it`);
    }
    for (const id of from(go)) d.section(id, ROUTE[id]);
    finished(run, { recoveries: 1 });
    // No cell lost and no shutter stuck at the end: both cells sit in their sockets and every shutter is open.
    assert.deepEqual(world.cells.map((c) => [c.id, c.socket]), [['wsCell', 'wsSocket'], ['fndCell', 'fndRelaySocket']]);
    for (const id of ['wsShutter', 'fndUpper', 'ascEntrance']) assert.deepEqual([byId(world.movers, id).powered, byId(world.movers, id).t], [true, 1]);
  });
}
