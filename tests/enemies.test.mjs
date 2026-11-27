import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, PLAYER, PULSE } from '../src/config.js';
import { bodyRect, overlaps } from '../src/sim/collision.js';
import { placePlayer } from '../src/sim/player.js';
import { commitCheckpoint, createWorld, inspect, stepWorld } from '../src/sim/world.js';
import { snapshotEnemies } from '../src/sim/enemies.js';
import { SPOTS } from './fixtures/enemies.js';

const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const EPSILON = 1e-9;
const press = (held = {}) => ({ ...IDLE, ...held });
const enemy = (world, id) => world.enemies.find((e) => e.id === id);
const box = (e) => bodyRect(e.x, e.y, e.w, e.h);
const hits = (seen) => seen.filter((e) => e.type === 'shield' || e.type === 'damage');
/** `state@step` for every state change of enemy `id`. */
const states = (seen, id) => seen.filter((e) => e.type === 'enemyState' && e.id === id).map((e) => `${e.state}@${e.step}`);

function near(actual, expected, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

/** A `play` world with ILO at a fixture spot. With the stub objects module the fixture's station is registered by hand. */
function open(spot) {
  const [level, x, y] = SPOTS[spot];
  const world = createWorld(level);
  world.mode = 'play';
  if (world.stations.length === 0) {
    world.stations.push(...level.stations.map((station) => ({ ...station })));
    commitCheckpoint(world, 'st0');
  }
  placePlayer(world, x, y);
  world.events.length = 0;
  return world;
}

/** Move ILO to a fixture spot between steps: setup only, never a gameplay input. */
function warp(world, spot) {
  const [, x, y] = SPOTS[spot];
  placePlayer(world, x, y);
}

/** One step; its events go to `seen` with the step that emitted them. */
function step(world, input = IDLE, seen = []) {
  stepWorld(world, input);
  seen.push(...world.events.map((event) => ({ ...event, step: world.step })));
  world.events.length = 0;
}

/** `count` steps with a constant input or one built per step; `each` runs after every step. */
function run(world, count, input = IDLE, { seen = [], each } = {}) {
  for (let i = 0; i < count; i++) {
    step(world, typeof input === 'function' ? input(i, world) : input, seen);
    each?.(world, i);
  }
  return seen;
}

/** Steps with `input` until `done(world)` holds, at most `max` steps. */
function until(world, input, done, seen = [], max = 1200) {
  for (let i = 0; !done(world) && i < max; i++) step(world, typeof input === 'function' ? input(i, world) : input, seen);
  return seen;
}

/** Horizontal gap between ILO and an enemy that stand side by side. */
const gap = (world, e) => Math.abs(world.player.x - e.x) - PLAYER.w / 2 - e.w / 2;

/** Walk toward `e` until the gap is at most 1 unit, then dash into it. */
function dashInto(world, e, seen = [], each) {
  const key = world.player.x < e.x ? 'right' : 'left';
  step(world, press({ [key]: true }), seen);
  until(world, press({ [key]: true }), () => gap(world, e) <= 1, seen, 240);
  until(world, IDLE, () => world.player.dashCd === 0, seen, 60);
  run(world, 40, (i) => press({ dashPressed: i === 0 }), { seen, each });
  return seen;
}

/** Pulse an enemy in reach, wait for its stun, then dash into it: the disabling route, through real inputs. */
function stunAndDash(world, id, seen = []) {
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => enemy(world, id).state === 'stunned', seen, 60);
  return dashInto(world, enemy(world, id), seen);
}

// --- Cable Skitter ---

test('Skitter: patrols at 1.4 units per second inside its range and turns at both bounds', () => {
  const world = open('watch');
  const skitter = enemy(world, 'sk1');
  let minX = Infinity;
  let maxX = -Infinity;
  const track = () => {
    minX = Math.min(minX, skitter.x);
    maxX = Math.max(maxX, skitter.x);
  };
  run(world, 121, IDLE, { each: track });
  near(skitter.x, 15.4);
  assert.equal(skitter.y, 0);
  assert.equal(skitter.awake, true);
  run(world, 900, IDLE, { each: track });
  assert.ok(maxX <= 15.5 && maxX > 15.48, `rightmost center ${maxX}`);
  assert.ok(minX >= 12 && minX < 12.02, `leftmost center ${minX}`);
  assert.equal(skitter.state, 'patrol');
  assert.equal(skitter.harmful, true);
});

test('Skitter: turns at a ledge on both ends and never leaves its floor height', () => {
  const world = open('watchLedge');
  const skitter = enemy(world, 'sk2');
  let minX = Infinity;
  let maxX = -Infinity;
  const facings = new Set();
  const heights = new Set();
  run(world, 900, IDLE, {
    each: () => {
      minX = Math.min(minX, skitter.x);
      maxX = Math.max(maxX, skitter.x);
      facings.add(skitter.facing);
      heights.add(skitter.y);
    },
  });
  assert.deepEqual([...heights], [2]);
  assert.deepEqual([...facings].sort(), [-1, 1]);
  assert.ok(maxX <= 45.4 + 1.4 * DT && maxX > 45.38, `rightmost center ${maxX}: the front foot stays on the ledge`);
  assert.ok(minX >= 40.6 - 1.4 * DT && minX < 40.62, `leftmost center ${minX}`);
  assert.equal(skitter.state, 'patrol');
});

test('Skitter: detects ILO within 5 units, not at 5.1 and not through a wall', () => {
  const close = open('inSight');
  run(close, 3, IDLE);
  assert.equal(enemy(close, 'sk1').state, 'alert');

  const justFar = open('outOfSight');
  run(justFar, 3, IDLE);
  assert.equal(enemy(justFar, 'sk1').state, 'patrol');

  const walled = open('wallSide');
  const skitter = enemy(walled, 'sk1');
  const seen = [];
  let closest = Infinity;
  run(walled, 600, IDLE, { seen, each: () => { closest = Math.min(closest, Math.hypot(skitter.x - 20, 0.4)); } });
  assert.ok(closest < 4.6, `closest approach ${closest}`);
  assert.deepEqual(states(seen, 'sk1'), ['patrol@1']);
  assert.equal(skitter.state, 'patrol');
});

test('Skitter: 0.5 s telegraph before the lunge, no retarget mid-lunge, then a recovery pause', () => {
  const world = open('open');
  const skitter = enemy(world, 'sk1');
  const seen = [];
  until(world, IDLE, () => skitter.state === 'lunge', seen, 100);
  assert.deepEqual(states(seen, 'sk1'), ['patrol@1', 'alert@2', 'lunge@62']);
  near(skitter.x, 14);                                            // it stands still while alert
  assert.equal(seen.find((e) => e.type === 'enemyAttack').step, 62);

  placePlayer(world, 17, 0);                                      // ILO is behind it now
  let lastX = skitter.x;
  let towardLeft = true;
  let lungeSteps = 0;
  const facings = new Set();
  const recoverX = [];
  run(world, 170, IDLE, {
    seen,
    each: () => {
      if (skitter.state === 'lunge') {
        lungeSteps += 1;
        towardLeft &&= skitter.x <= lastX + 1e-12;
        lastX = skitter.x;
        facings.add(skitter.facing);
      }
      if (skitter.state === 'recover') recoverX.push(skitter.x);
    },
  });
  assert.ok(lungeSteps >= 40 && [...facings].every((f) => f === -1), `lunge facings ${[...facings]}`);
  assert.ok(towardLeft, 'the lunge keeps its locked direction');
  near(recoverX[0], 12);                                         // about 2 units, stopped by the range bound
  assert.ok(recoverX.length >= 96 && recoverX.every((x) => x === recoverX[0]), 'it rests while recovering');
  assert.deepEqual(states(seen, 'sk1').slice(2, 5), ['lunge@62', 'recover@104', 'patrol@200']);
});

test('Skitter: a pulse stuns it for 2 s', () => {
  const world = open('open');
  const skitter = enemy(world, 'sk1');
  const seen = [];
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => skitter.state === 'stunned', seen, 60);
  const stunnedAt = world.step;
  assert.deepEqual(states(seen, 'sk1'), ['patrol@1', 'alert@2', `stunned@${stunnedAt}`]);
  assert.equal(skitter.harmful, false);
  run(world, 239, IDLE, { seen });
  assert.equal(skitter.state, 'stunned');
  near(skitter.x, 14);                                            // a stunned machine does not move
  step(world, IDLE, seen);
  assert.equal(skitter.state, 'patrol');
  assert.equal(states(seen, 'sk1').at(-1), `patrol@${stunnedAt + 240}`);
});

test('Skitter: a stunned skitter is not harmful: overlap gives no shield and no damage', () => {
  const world = open('open');
  const skitter = enemy(world, 'sk1');
  const seen = [];
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => skitter.state === 'stunned', seen, 60);
  let overlapping = 0;
  let contactHazards = 0;
  const watch = (w) => {
    overlapping += overlaps(bodyRect(w.player.x, w.player.y), box(skitter)) ? 1 : 0;
    contactHazards += w.hazards.filter((h) => h.kind === 'enemy').length;
  };
  until(world, press({ right: true }), () => gap(world, skitter) < 0, seen, 120);
  run(world, 40, IDLE, { seen, each: watch });
  assert.ok(overlapping >= 20, `steps overlapping ${overlapping}`);
  assert.equal(contactHazards, 0);
  assert.deepEqual(hits(seen), []);
  assert.equal(world.player.hp, 3);
  assert.equal(world.player.energy, 65);
});

test('Skitter: a dash into a stunned skitter disables it once and it stays disabled', () => {
  const world = open('open');
  const skitter = enemy(world, 'sk1');
  const seen = [];
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => skitter.state === 'stunned', seen, 60);
  let dashContacts = 0;
  dashInto(world, skitter, seen, (w) => {
    if (w.player.dashT > 0 && overlaps(bodyRect(w.player.x, w.player.y), box(skitter))) dashContacts += 1;
  });
  assert.ok(dashContacts >= 2, `dash steps in contact ${dashContacts}`);
  assert.equal(skitter.state, 'disabled');
  assert.equal(skitter.harmful, false);

  dashInto(world, skitter, seen);                                 // a second dash adds nothing
  run(world, 400, IDLE, { seen, each: (w) => assert.equal(w.hazards.some((h) => h.kind === 'enemy'), false) });
  assert.equal(skitter.state, 'disabled');
  assert.deepEqual(hits(seen), []);
  assert.equal(world.player.hp, 3);
});

test('Skitter: a dash into an active skitter gives shield or damage and never disables it', () => {
  const world = open('open');
  const skitter = enemy(world, 'sk1');
  const seen = [];
  run(world, 3, IDLE, { seen });
  assert.equal(skitter.state, 'alert');
  dashInto(world, skitter, seen);
  assert.deepEqual(hits(seen).map((e) => e.type), ['shield']);
  assert.equal(world.player.energy, 50);
  assert.notEqual(skitter.state, 'disabled');
});

// --- Prism Drone ---

test('Drone: patrols its route at 1.2 units per second, back and forth', () => {
  const world = open('droneFar');
  const drone = enemy(world, 'd1');
  let minX = Infinity;
  let maxX = -Infinity;
  const seenStates = new Set();
  const track = () => {
    minX = Math.min(minX, drone.x);
    maxX = Math.max(maxX, drone.x);
    seenStates.add(drone.state);
  };
  run(world, 120, IDLE, { each: track });
  near(drone.x, 21.2);
  near(drone.y, 1);
  assert.equal(drone.awake, true);
  run(world, 900, IDLE, { each: track });
  assert.ok(minX >= 20 - EPSILON && minX < 20.01, `leftmost ${minX}`);
  assert.ok(maxX <= 24 + EPSILON && maxX > 23.99, `rightmost ${maxX}`);
  assert.deepEqual([...seenStates], ['patrol']);
});

test('Drone: aims for 0.8 s in state aim, then fires one bolt from its center at ILO', () => {
  const world = open('droneNear');
  const drone = enemy(world, 'd1');
  const seen = [];
  const boltIds = new Set();
  run(world, 96, IDLE, { seen });
  assert.equal(drone.state, 'aim');
  assert.equal(drone.harmful, true);
  assert.deepEqual(world.bolts, []);
  step(world, IDLE, seen);
  assert.equal(drone.state, 'fire');
  assert.deepEqual(states(seen, 'd1'), ['aim@1', 'fire@97']);
  assert.equal(seen.find((e) => e.type === 'enemyAttack').step, 97);
  const [bolt] = world.bolts;
  assert.equal(bolt.id, 'd1:97');
  assert.equal(bolt.w, 0.3);
  assert.equal(bolt.h, 0.3);
  near(bolt.life + DT, 4);
  near(bolt.x - bolt.vx * DT, 20);                                // it left the drone center
  near(bolt.y - bolt.vy * DT, 1.45);
  near(Math.hypot(bolt.vx, bolt.vy), 5);
  const sight = Math.hypot(23 - 20, 0.75 - 1.45);
  near(bolt.vx, (5 * 3) / sight);
  near(bolt.vy, (5 * -0.7) / sight);
  run(world, 325, IDLE, { seen, each: (w) => w.bolts.forEach((b) => boltIds.add(b.id)) });
  assert.deepEqual([...boltIds], ['d1:97']);
  assert.deepEqual(states(seen, 'd1'), ['aim@1', 'fire@97', 'cooldown@121', 'patrol@421', 'aim@422']);
});

test('Drone: an aim begins only with ILO within one pulse radius of the drone', () => {
  // The step of the first aim from each spot. At `atPlatform` ILO is 6.04 from d1 at home, out of sight; d1
  // patrols 5 steps to 6.001, still out of sight, and aims on the next step at 5.99.
  const firstAim = { droneNear: 1, columnTop: 247, atPlatform: 6, atCell: 1 };
  for (const [spot, firstStep] of Object.entries(firstAim)) {
    const world = open(spot);
    const drone = enemy(world, 'd1');
    const aims = [];
    let previous = drone.state;
    run(world, 720, IDLE, {
      each: (w) => {
        const p = w.player;
        if (drone.state === 'aim' && previous !== 'aim') {
          aims.push({ step: w.step, d: Math.hypot(drone.x - p.x, drone.y + drone.h / 2 - (p.y + PLAYER.h / 2)) });
        }
        previous = drone.state;
      },
    });
    assert.equal(aims[0].step, firstStep, `${spot}: the step of the first aim`);
    assert.ok(aims.length >= 2, `${spot}: the drone aims again after its cooldown`);
    for (const { step, d } of aims) {
      assert.ok(d <= PULSE.radius, `${spot}: the aim at step ${step} began ${d} from ILO, one pulse reaches ${PULSE.radius}`);
    }
  }
});

function firedBolt(spot) {
  const world = open(spot);
  const seen = until(world, IDLE, () => world.bolts.length > 0, [], 400);   // the drone may patrol into sight first
  return { world, seen, bolt: world.bolts[0], fired: world.step };
}

test('Drone: the aim direction locks before the bolt; ILO moving after the lock is missed', () => {
  const { world, seen, bolt } = firedBolt('columnTop');
  const drone = enemy(world, 'd1');
  const locked = { ...drone.aimDir };
  const velocity = [bolt.vx, bolt.vy];
  const start = [world.player.x, world.player.y];
  assert.ok(locked.y > 0, 'ILO is above the drone');
  assert.equal(drone.state, 'fire');
  run(world, 40, press({ right: true }), { seen });              // ILO leaves the column top
  run(world, 440, IDLE, {
    seen,
    each: (w) => {
      assert.deepEqual(w.enemies[0].aimDir, locked);
      if (w.bolts[0] !== undefined) {
        near(w.bolts[0].vx, velocity[0]);
        near(w.bolts[0].vy, velocity[1]);
      }
    },
  });
  assert.ok(world.player.x > start[0] + 2 && world.player.y === 0, 'ILO moved off the column');
  assert.deepEqual(hits(seen), []);
  assert.equal(world.bolts.length, 0);
});

test('Drone: a bolt flies at 5 units per second and lives 4 s', () => {
  const { world, seen, bolt, fired } = firedBolt('columnTop');
  near(Math.hypot(bolt.vx, bolt.vy), 5);
  run(world, 40, press({ right: true }), { seen });               // ILO steps out of the lane
  const [x, y] = [bolt.x, bolt.y];
  step(world, IDLE, seen);
  near(bolt.x - x, bolt.vx * DT);
  near(bolt.y - y, bolt.vy * DT);
  run(world, fired + 478 - world.step, IDLE, { seen });
  assert.equal(world.bolts.length, 1);
  near(world.bolts[0].life, DT);
  step(world, IDLE, seen);
  assert.equal(world.bolts.length, 0);                            // 4 s = 480 steps after the shot
  assert.equal(seen.filter((e) => e.type === 'boltHit').length, 0);
  assert.deepEqual(hits(seen), []);
});

test('Drone: a bolt ends on ILO as a bolt hazard', () => {
  const world = open('droneNear');
  world.player.energy = 0;
  const seen = [];
  let boltsAtHit = null;
  run(world, 200, IDLE, {
    seen,
    each: (w) => {
      if (boltsAtHit === null && hits(seen).length > 0) boltsAtHit = w.bolts.length;
    },
  });
  assert.deepEqual(hits(seen).map((e) => [e.type, e.cause]), [['damage', 'bolt']]);
  assert.equal(world.player.hp, 2);
  assert.equal(boltsAtHit, 0);
});

test('Drone: a bolt ends on terrain with boltHit', () => {
  const world = open('droneNear');
  const seen = [];
  let hold = 0;
  run(world, 400, () => {
    if (hold === 0 && world.bolts.length > 0) hold = 50;
    if (hold === 0) return IDLE;
    hold -= 1;
    return press({ jump: true, jumpPressed: hold === 49 });       // ILO jumps out of the way
  }, { seen });
  const boltHits = seen.filter((e) => e.type === 'boltHit');
  assert.equal(boltHits.length, 1);
  const [hit] = boltHits;
  assert.ok(hit.y <= 0 && hit.y > -0.05, `boltHit at y ${hit.y}: the floor top`);
  assert.ok(hit.x > 24 && hit.x < 27, `boltHit at x ${hit.x}`);
  assert.deepEqual(hits(seen), []);
  assert.equal(world.bolts.length, 0);
});

test('Drone: a bolt ends on a platform', () => {
  const { world, seen, bolt } = firedBolt('atPlatform');
  assert.deepEqual(world.movers.map((m) => m.kind), ['platform']);
  assert.ok(bolt.vx > 0 && bolt.vy < 0, 'the bolt flies down and right');
  until(world, IDLE, () => world.bolts.length === 0, seen, 200);
  const boltHits = seen.filter((e) => e.type === 'boltHit');
  assert.equal(boltHits.length, 1);
  assert.ok(boltHits[0].x > 23.85 && boltHits[0].x < 24, `boltHit at x ${boltHits[0].x}: the platform's left face`);
  assert.ok(boltHits[0].y > 0.95 && boltHits[0].y < 1.45, `boltHit at y ${boltHits[0].y}: inside the platform`);
  assert.deepEqual(hits(seen), []);
  assert.equal(world.player.hp, 3);
});

test('Drone: a bolt ends on a loose cell', () => {
  const { world, seen, bolt } = firedBolt('atCell');
  assert.equal(world.cells[0].state, 'loose');
  assert.ok(bolt.vx < 0 && bolt.vy < 0, 'the bolt flies down and left');
  until(world, IDLE, () => world.bolts.length === 0, seen, 200);
  const boltHits = seen.filter((e) => e.type === 'boltHit');
  assert.equal(boltHits.length, 1);
  assert.ok(boltHits[0].x > 16.5 && boltHits[0].x < 16.65, `boltHit at x ${boltHits[0].x}: the cell's right face`);
  assert.ok(boltHits[0].y > 0.75 && boltHits[0].y < 1.1, `boltHit at y ${boltHits[0].y}: inside the cell`);
  assert.deepEqual(hits(seen), []);
  assert.deepEqual([world.cells[0].x, world.cells[0].y, world.cells[0].state], [16, 0, 'loose']);
});

test('Drone: a pulse interrupts an aim and stuns for 2.5 s', () => {
  const world = open('droneNear');
  const drone = enemy(world, 'd1');
  const seen = [];
  run(world, 30, IDLE, { seen });
  assert.equal(drone.state, 'aim');
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => drone.state === 'stunned', seen, 60);
  const stunnedAt = world.step;
  assert.deepEqual(states(seen, 'd1'), ['aim@1', `stunned@${stunnedAt}`]);
  assert.equal(drone.harmful, false);
  run(world, 299, IDLE, { seen });
  assert.equal(drone.state, 'stunned');
  assert.deepEqual(world.bolts, []);
  step(world, IDLE, seen);
  assert.equal(drone.state, 'patrol');
  assert.equal(states(seen, 'd1').at(-1), `patrol@${stunnedAt + 300}`);
});

test('Drone: a dash on a stunned drone disables it', () => {
  const world = open('droneNear');
  const drone = enemy(world, 'd1');
  const seen = stunAndDash(world, 'd1');
  assert.equal(drone.state, 'disabled');
  assert.equal(drone.harmful, false);
  run(world, 400, IDLE, { seen });
  assert.equal(drone.state, 'disabled');
  assert.deepEqual(world.bolts, []);
  assert.deepEqual(hits(seen), []);
  assert.equal(world.player.hp, 3);
});

// --- Shutter Sentinel ---

test('Sentinel: 0.9 s warning before a beam of 0.9 s, the hazard is the lane, venting lasts 2.0 s', () => {
  const world = open('inLane');
  world.player.immunity = 99;
  const sentinel = enemy(world, 'sg1');
  const seen = [];
  let hazard = null;
  const beamSteps = [];
  run(world, 457, IDLE, {
    seen,
    each: (w) => {
      const beams = w.hazards.filter((h) => h.kind === 'beam');
      if (beams.length > 0) {
        hazard ??= beams[0];
        beamSteps.push(w.step);
      }
      assert.equal(w.hazards.filter((h) => h.kind === 'enemy').length, 0);
      assert.equal(sentinel.harmful, false);
      assert.equal(sentinel.beam !== null, w.step >= 109 && w.step < 217);
    },
  });
  assert.deepEqual(states(seen, 'sg1'), ['warning@1', 'firing@109', 'venting@217', 'closed@457']);
  assert.deepEqual(seen.find((e) => e.type === 'enemyAttack'), {
    type: 'enemyAttack', kind: 'sentinel', id: 'sg1', x: 6, y: 0, step: 109,
  });
  assert.deepEqual(hazard, { kind: 'beam', x: 6.75, y: 0.75, w: 8, h: 0.5, sx: 6.75, sy: 1 });
  assert.equal(beamSteps[0], 109);
  assert.equal(beamSteps.at(-1), 216);
  near(beamSteps.length * DT, 0.9, DT / 2);       // GOAL §12: a burst of about 0.9 s
});

test('Sentinel: the beam stops at a platform cover; ILO behind the cover takes nothing', () => {
  const front = open('coverFront');
  front.player.immunity = 99;
  assert.deepEqual(front.movers.map((m) => m.kind), ['platform']);
  const seenFront = [];
  let hazard = null;
  const coverY = new Set();
  run(front, 210, IDLE, {
    seenFront: seenFront,
    each: (w) => {
      hazard ??= w.hazards.find((h) => h.kind === 'beam');
      coverY.add(w.movers[0].y);
    },
  });
  assert.deepEqual(hazard, { kind: 'beam', x: 46, y: 0.75, w: 3.25, h: 0.5, sx: 49.25, sy: 1 });
  assert.ok(hazard.w < enemy(front, 'sg2').lane.w);
  assert.ok(coverY.size > 1, 'the cover is a moving platform');

  const behind = open('coverBehind');
  const seen = [];
  let fired = false;
  run(behind, 457, IDLE, {
    seen,
    each: (w) => {
      for (const h of w.hazards) {
        assert.equal(h.kind, 'beam');
        assert.equal(h.x, 46, 'the beam stops at the cover');
        assert.equal(overlaps(bodyRect(w.player.x, w.player.y), h), false);
      }
      fired ||= enemy(behind, 'sg2').state === 'firing';
    },
  });
  assert.ok(fired, 'the sentinel fired while ILO was behind the cover');
  assert.deepEqual(states(seen, 'sg2'), ['warning@1', 'firing@109', 'venting@217', 'closed@457']);
  assert.deepEqual(hits(seen), []);
  assert.equal(behind.player.hp, 3);
  assert.equal(behind.player.energy, 100);
});

test('Sentinel: a pulse during venting disables it', () => {
  const world = open('inLane');
  world.player.immunity = 99;
  const sentinel = enemy(world, 'sg1');
  const seen = [];
  until(world, IDLE, () => sentinel.state === 'venting', seen, 300);
  assert.equal(sentinel.beam, null);
  world.player.immunity = 0;
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => sentinel.state === 'disabled', seen, 60);
  assert.equal(sentinel.beam, null);
  run(world, 500, IDLE, { seen, each: (w) => assert.deepEqual(w.hazards, []) });
  assert.equal(sentinel.state, 'disabled');
  assert.deepEqual(hits(seen), []);
  assert.equal(world.player.hp, 3);
});

test('Sentinel: a pulse on closed armor gives pulseBlock and no change; warning is left alone too', () => {
  const world = open('beside');
  const sentinel = enemy(world, 'sg1');
  const seen = [];
  run(world, 2, IDLE, { seen });
  assert.equal(sentinel.state, 'closed');
  step(world, press({ pulsePressed: true }), seen);
  const blocked = () => seen.filter((e) => e.type === 'pulseBlock').length;
  until(world, IDLE, () => blocked() === 1, seen, 60);
  assert.deepEqual(seen.find((e) => e.type === 'pulseBlock'), { type: 'pulseBlock', x: 6, y: 1, step: world.step });
  assert.equal(sentinel.state, 'closed');
  assert.deepEqual(states(seen, 'sg1'), []);

  until(world, press({ right: true }), () => sentinel.state === 'warning', seen, 120);
  const warned = world.step;
  run(world, 30, IDLE, { seen });
  until(world, IDLE, () => world.player.pulseCd === 0, seen, 120);
  assert.equal(sentinel.state, 'warning');
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => blocked() === 2, seen, 60);
  assert.equal(sentinel.state, 'warning', 'the pulse did not reset or skip the warning');
  until(world, IDLE, () => sentinel.state === 'firing', seen, 200);
  assert.deepEqual(states(seen, 'sg1'), [`warning@${warned}`, `firing@${warned + 108}`]);
});

test('Sentinel: touching it never harms', () => {
  const world = open('inside');
  const sentinel = enemy(world, 'sg1');
  const seen = [];
  let contactHazards = 0;
  run(world, 120, IDLE, { seen, each: (w) => { contactHazards += w.hazards.filter((h) => h.kind === 'enemy').length; } });
  assert.ok(overlaps(bodyRect(world.player.x, world.player.y), box(sentinel)), 'ILO stands inside its body');
  near(world.player.x, 6);                                        // a wall fixture is not solid
  assert.deepEqual(states(seen, 'sg1'), []);
  assert.equal(sentinel.state, 'closed');
  assert.equal(sentinel.harmful, false);
  assert.equal(contactHazards, 0);
  assert.deepEqual(hits(seen), []);
});

// --- General ---

test('General: a far enemy keeps its state and its timers', () => {
  const world = open('far');
  const skitter = enemy(world, 'sk1');
  const seen = run(world, 240, IDLE, { seen: [] });
  assert.deepEqual(inspect(world).enemies, [
    { id: 'sk1', kind: 'skitter', x: 14, y: 0, state: 'dormant', awake: false, harmful: false },
    { id: 'sk2', kind: 'skitter', x: 43, y: 2, state: 'dormant', awake: false, harmful: false },
  ]);
  assert.deepEqual(seen, []);

  placePlayer(world, 10.5, 0);
  step(world, press({ pulsePressed: true }), seen);
  until(world, IDLE, () => skitter.state === 'stunned', seen, 60);
  const stunnedAt = world.step;
  run(world, 60, IDLE, { seen });                                 // 0.5 s of the 2 s stun pass
  placePlayer(world, 72, 0);
  run(world, 400, IDLE, { seen });
  assert.equal(skitter.state, 'stunned');
  assert.equal(skitter.awake, false);
  assert.equal(seen.filter((e) => e.type === 'enemyState').at(-1).step, stunnedAt);

  placePlayer(world, 10.5, 0);
  run(world, 179, IDLE, { seen });
  assert.equal(skitter.state, 'stunned', 'the timer stood still while ILO was away');
  step(world, IDLE, seen);
  assert.equal(skitter.state, 'patrol');
});

test('General: nothing changes during relayActivation, shutdown and reboot', () => {
  const world = open('droneNear');
  const drone = enemy(world, 'd1');
  const seen = [];
  until(world, IDLE, () => world.bolts.length > 0, seen, 200);
  const bolt = world.bolts[0];
  const frozen = { x: bolt.x, y: bolt.y, life: bolt.life, state: drone.state, t: drone.t };
  assert.equal(drone.state, 'fire');
  const paused = world.step;
  for (const mode of ['relayActivation', 'shutdown', 'reboot']) {
    world.mode = mode;
    world.modeTime = 0;
    run(world, 100, IDLE, { seen });
    assert.deepEqual({ x: bolt.x, y: bolt.y, life: bolt.life, state: drone.state, t: drone.t }, frozen, mode);
    assert.equal(world.mode, mode);
  }
  assert.deepEqual(seen.filter((e) => e.step > paused && (e.type.startsWith('enemy') || e.type === 'boltHit')), []);
});

test('General: a recovery clears bolts and puts the enemies back', () => {
  const world = open('droneNear');
  const drone = enemy(world, 'd1');
  const seen = [];
  until(world, IDLE, () => world.bolts.length > 0, seen, 200);
  assert.equal(drone.state, 'fire');
  step(world, press({ retryPressed: true }), seen);
  assert.equal(world.mode, 'shutdown');
  run(world, 150, IDLE, { seen });
  assert.equal(world.mode, 'reboot');
  assert.equal(world.recoveries, 1);
  assert.deepEqual(world.bolts, []);
  assert.deepEqual(world.hazards, []);
  assert.deepEqual([drone.state, drone.x, drone.y, drone.harmful, drone.awake], ['patrol', 20, 1, true, false]);
  run(world, 100, IDLE, { seen });
  assert.equal(world.mode, 'play');
});

test('General: restore keeps an enemy disabled before the commit and re-enables one disabled after it', () => {
  const world = open('open');
  const seen = stunAndDash(world, 'sk1');
  assert.deepEqual(snapshotEnemies(world), ['sk1']);
  commitCheckpoint(world, 'st0');
  warp(world, 'ledgeEnd');
  stunAndDash(world, 'sk2', seen);
  assert.deepEqual(snapshotEnemies(world), ['sk1', 'sk2']);

  step(world, press({ retryPressed: true }), seen);
  run(world, 150, IDLE, { seen });
  assert.equal(world.mode, 'reboot');
  assert.deepEqual(world.enemies.map((e) => [e.id, e.state, e.x, e.y, e.harmful, e.awake]), [
    ['sk1', 'disabled', 14, 0, false, false],
    ['sk2', 'dormant', 43, 2, false, false],
  ]);
  assert.deepEqual(snapshotEnemies(world), ['sk1']);
  run(world, 400, IDLE, { seen });
  assert.equal(world.mode, 'play');
  assert.equal(enemy(world, 'sk1').state, 'disabled');
  assert.deepEqual(hits(seen), []);
});

test('General: inspect lists every enemy with its state and every bolt', () => {
  const world = open('open');
  run(world, 2, IDLE);
  assert.deepEqual(inspect(world).enemies, [
    { id: 'sk1', kind: 'skitter', x: 14, y: 0, state: 'alert', awake: true, harmful: true },
    { id: 'sk2', kind: 'skitter', x: 43, y: 2, state: 'dormant', awake: false, harmful: false },
  ]);
  assert.deepEqual(inspect(world).bolts, []);

  const flying = firedBolt('droneNear');                              // d1 aims from its home: position and step are exact
  assert.deepEqual(inspect(flying.world).enemies, [
    { id: 'd1', kind: 'drone', x: 20, y: 1, state: 'fire', awake: true, harmful: true },
  ]);
  const [shown] = inspect(flying.world).bolts;
  assert.equal(shown.id, 'd1:97');
  near(shown.x, flying.bolt.x);
  near(shown.y, flying.bolt.y);
});
