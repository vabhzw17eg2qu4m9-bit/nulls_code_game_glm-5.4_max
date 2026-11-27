import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAMAGE, DASH, DT, PLAYER, PULSE, RUN, SHIELD } from '../src/config.js';
import { LEVEL as COURSE } from '../src/level/level.js';
import { bodyRect, overlaps } from '../src/sim/collision.js';
import { placePlayer } from '../src/sim/player.js';
import { commitCheckpoint, createWorld, inspect, restoreCheckpoint, stepWorld } from '../src/sim/world.js';
import { LEVEL, SPOTS } from './fixtures/core.js';

const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const EPSILON = 1e-9;
const solid = (id) => LEVEL.solids.find((s) => s.id === id);
const mover = (world, kind) => world.movers.find((m) => m.kind === kind);
const press = (held = {}) => ({ ...IDLE, ...held });
const types = (events) => events.map((event) => event.type);

function near(actual, expected, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

/** A `play` world with ILO at a fixture spot. The stub objects module makes no stations, so the fixture's start station is registered by hand. */
function open(spot) {
  const world = createWorld(LEVEL);
  world.mode = 'play';
  if (world.stations.length === 0) {
    world.stations.push(...LEVEL.stations.map((station) => ({ ...station })));
    commitCheckpoint(world, 'st0');
  }
  placePlayer(world, ...SPOTS[spot]);
  world.events.length = 0;
  return world;
}

/** A `play` world of the real course (`src/level/level.js`) with ILO's feet at `(x, y)`. */
function openCourse(x, y) {
  const world = createWorld(COURSE);
  world.mode = 'play';
  placePlayer(world, x, y);
  world.events.length = 0;
  return world;
}

/** Step `count` times with a constant input or one built per step; events go to `seen`, `each` runs after every step. */
function run(world, count, input = IDLE, { seen = [], each } = {}) {
  for (let i = 0; i < count; i++) {
    stepWorld(world, typeof input === 'function' ? input(i, world) : input);
    each?.(world);
    seen.push(...world.events);
    world.events.length = 0;
  }
  return seen;
}

/** The fixture shutter is powered by switch `sw1`; the stub objects module does not derive power, so both are set. */
function setShutterPower(world, on) {
  for (const s of world.switches) if (s.id === 'sw1') s.on = on;
  mover(world, 'shutter').powered = on;
}

/** A beam that stays over `x`. `stepWorld` rebuilds `world.hazards`, so the source re-adds itself after every rebuild. */
function beam(world, x, sx = x + 4, w = 1) {
  const source = { kind: 'beam', x, y: 0, w, h: 2, sx, sy: 0.75 };
  let current = [];
  Object.defineProperty(world, 'hazards', {
    configurable: true,
    get: () => current,
    set: (rebuilt) => {
      current = [...rebuilt, source];
    },
  });
}

function pulseHits(world, targets) {
  const hits = Object.fromEntries(targets.map((t) => [t.id, 0]));
  world.pulseTargets.push(...targets.map((t) => ({ ...t, onPulse: () => { hits[t.id] += 1; } })));
  run(world, 60, (i) => press({ pulsePressed: i === 0 }));
  return hits;
}

/** Highest point of a jump that is held for `heldSteps` steps. */
function jumpHeight(world, heldSteps) {
  let top = 0;
  run(world, 200, (i) => press({ jump: i < heldSteps, jumpPressed: i === 0 }), { each: (w) => { top = Math.max(top, w.player.y); } });
  return top - SPOTS.floor[1];
}

// --- Movement ---

test('Movement: ground and air acceleration and braking reach the configured values', () => {
  const world = open('floor');
  run(world, 6, press({ right: true }));
  near(world.player.vx, PLAYER.groundAccel * 6 * DT);
  run(world, 60, press({ right: true }));
  near(world.player.vx, PLAYER.maxSpeed);
  run(world, 12);
  near(world.player.vx, PLAYER.maxSpeed - PLAYER.groundBrake * 12 * DT);
  run(world, 12);
  near(world.player.vx, 0);
  assert.ok(world.player.x > 7);

  const air = open('floor');
  run(air, 1, press({ jump: true, jumpPressed: true, right: true }));
  run(air, 11, press({ jump: true, right: true }));
  near(air.player.vx, PLAYER.airAccel * 12 * DT);
  run(air, 12, press({ jump: true }));
  near(air.player.vx, PLAYER.airAccel * 12 * DT - PLAYER.airBrake * 12 * DT);
});

test('Movement: a one-frame tap rises 1.2 to 1.5 and a held jump about 2.6', () => {
  const tap = jumpHeight(open('floor'), 1);
  assert.ok(tap >= 1.2 && tap <= 1.5, `tap jump rose ${tap}`);
  near(jumpHeight(open('floor'), 200), 2.6, 0.1);
});

test('Movement: a tap jump mounts a 1-unit ledge; a 2-unit ledge needs the held jump', () => {
  const climb = (spot, direction, heldSteps) => {
    const world = open(spot);
    run(world, 45, press({ [direction]: true }));
    run(world, 100, (i) => press({ [direction]: true, jump: i < heldSteps, jumpPressed: i === 0 }));
    return world.player.y;
  };
  assert.equal(climb('beforeLedge1', 'right', 1), 1);
  assert.equal(climb('beyondLedge2', 'left', 1), 0);
  assert.equal(climb('beyondLedge2', 'left', 60), 2);
});

test('Movement: coyote time works 0.10 s after a ledge and fails at 0.12 s', () => {
  const jumpsAfterLeaving = (steps) => {
    const world = open('onLedge2');
    let left = null;
    const seen = run(world, 100, (i) => {
      const pressAt = left === null ? Infinity : left + steps;
      return press({ right: i < pressAt, jump: i === pressAt, jumpPressed: i === pressAt });
    }, {
      each: (w) => { if (left === null && !w.player.grounded) left = w.step - 1; },
    });
    return types(seen).includes('jump');
  };
  assert.equal(jumpsAfterLeaving(Math.round(0.10 / DT)), true);
  assert.equal(jumpsAfterLeaving(Math.round(0.12 / DT)), false);
});

test('Movement: a jump buffered 0.13 s before landing fires on landing; 0.17 s is too early', () => {
  const dry = open('floor');
  placePlayer(dry, 5, 3);
  let landing = 0;
  run(dry, 120, IDLE, { each: (w) => { if (landing === 0 && w.player.grounded) landing = w.step; } });
  const buffered = (before) => {
    const world = open('floor');
    placePlayer(world, 5, 3);
    const seen = run(world, landing + 2, (i) => press({ jump: i === landing - before, jumpPressed: i === landing - before }));
    return types(seen).includes('jump');
  };
  assert.equal(buffered(Math.round(0.13 / DT)), true);
  assert.equal(buffered(Math.round(0.17 / DT)), false);
});

test('Movement: a ceiling stops the rise with vy 0 and no embedding', () => {
  const world = open('underCeiling');
  const ceiling = solid('ceiling');
  let touched = false;
  run(world, 60, (i) => press({ jump: true, jumpPressed: i === 0 }), { each: (w) => {
    assert.ok(w.player.y + PLAYER.h <= ceiling.y + EPSILON);
    if (w.player.y + PLAYER.h >= ceiling.y - EPSILON) {
      touched = true;
      assert.equal(w.player.vy, 0);
    }
  } });
  assert.ok(touched);
  near(world.player.y, 0);
  assert.equal(world.player.grounded, true);
});

test('Movement: no double jump', () => {
  const world = open('floor');
  const seen = run(world, 40, (i) => press({ jump: i < 30, jumpPressed: i === 0 || i === 24 }));
  assert.equal(types(seen).filter((t) => t === 'jump').length, 1);
  assert.ok(world.player.vy < 7);
});

test('Landing: a tap jump emits land with its fall speed at a phase that used to be silent', () => {
  const world = open('floor');
  let fallSpeed = 0;
  // The 0.05 ground probe turns `grounded` on while the feet are still above the floor. This jump used to end
  // the step before contact inside that probe, so `land` never came.
  const seen = run(world, 120, (i) => press({ jump: i === 0, jumpPressed: i === 0 }), {
    seen: [],
    each: (w) => { if (w.player.y > 0) fallSpeed = PLAYER.gravity * DT - w.player.vy; },
  });
  assert.deepEqual(seen.filter((event) => event.type === 'land'), [{ type: 'land', x: 5, y: 0, speed: fallSpeed, surface: 'rock' }]);
  assert.ok(fallSpeed > 9 && fallSpeed < 10.5, `fall speed ${fallSpeed}: a tap jump drops from about 1.3`);
  near(world.player.y, 0);
  assert.equal(world.player.grounded, true);
});

test('Landing: standing still or dashing on the ground emits no land', () => {
  const world = open('floor');
  const seen = run(world, 120, IDLE, { seen: [] });
  run(world, 120, (i) => press({ right: true, dashPressed: i === 0 || i === 70 }), { seen });
  assert.equal(types(seen).includes('land'), false);
  assert.deepEqual(types(seen).filter((t) => t === 'dash'), ['dash', 'dash']);
  assert.equal(world.player.grounded, true);
});

test('Movement: a long fall stops at the fall speed limit 24 and never exceeds it', () => {
  const world = open('floor');
  placePlayer(world, 5, 14);                        // 14 units of air: the limit is reached after 9, then held for 5 more
  let fastest = 0;
  let capped = 0;
  const seen = run(world, 200, IDLE, { seen: [], each: (w) => {
    fastest = Math.min(fastest, w.player.vy);
    if (w.player.vy === -24) capped += 1;
  } });
  assert.equal(-fastest, 24);                       // GOAL §7
  assert.ok(capped > 10, `ILO fell at the limit for ${capped} steps`);
  assert.deepEqual(seen.filter((event) => event.type === 'land'), [{ type: 'land', x: 5, y: 0, speed: 24, surface: 'rock' }]);
  assert.equal(world.player.grounded, true);
});

// --- Walls ---

test('Walls: holding toward a wall limits the fall to 3; grounded side contact never slides', () => {
  const world = open('shaftAir');
  let fastest = 0;
  run(world, 60, press({ right: true }), { each: (w) => { if (w.player.sliding) fastest = Math.min(fastest, w.player.vy); } });
  assert.equal(world.player.wall, 1);
  assert.equal(world.player.sliding, true);
  near(fastest, -PLAYER.wallSlideSpeed);
  const grounded = open('shaft');
  run(grounded, 60, press({ right: true }));
  assert.equal(grounded.player.grounded, true);
  assert.equal(grounded.player.wall, 1);
  assert.equal(grounded.player.sliding, false);
});

test('Walls: a wall jump launches at 7 away and 12.5 up with a 0.10 s steering lock', () => {
  const world = open('shaftAir');
  run(world, 30, press({ right: true }));
  assert.equal(world.player.sliding, true);
  const seen = run(world, 1, press({ right: true, jump: true, jumpPressed: true }));
  near(world.player.vx, -PLAYER.wallJumpX);
  assert.ok(world.player.vy > 12 && world.player.vy <= PLAYER.wallJumpY);
  near(world.player.stunT, PLAYER.wallJumpLock);
  run(world, 9, press({ right: true }));
  near(world.player.vx, -PLAYER.wallJumpX);
  run(world, 14, press({ right: true }));
  assert.ok(world.player.vx > -PLAYER.wallJumpX && world.player.vx < 0);
  assert.deepEqual(types(seen), ['jump']);
  assert.equal(seen[0].wall, 1);
});

test('Walls: a wall jump refreshes the air dash', () => {
  const world = open('shaftAir');
  run(world, 30, press({ right: true }));
  const spent = run(world, 1, press({ right: true, dashPressed: true }));
  assert.deepEqual(types(spent), ['dash', 'dashStop']);
  assert.equal(world.player.dashAir, false);
  const seen = run(world, 1, press({ right: true, jump: true, jumpPressed: true }));
  assert.deepEqual(types(seen), ['jump']);
  assert.equal(world.player.dashAir, true);
});

test('Walls: a 4-unit shaft with ground beneath is climbable to the top', () => {
  const world = open('shaft');
  const top = solid('shaftR').h;
  assert.equal(solid('shaftR').x - (solid('shaftL').x + solid('shaftL').w), 4);
  let hold = 1;
  let reached = 0;
  run(world, 600, (i, w) => {
    const jump = w.player.wall !== 0;
    if (jump && !w.player.grounded) hold = -w.player.wall;
    return press({ right: hold === 1, left: hold === -1, jump: true, jumpPressed: jump });
  }, { each: (w) => { reached = Math.max(reached, w.player.y); } });
  assert.ok(reached > top, `reached ${reached} of ${top}`);
});

test('Walls: an unbroken seam is solid but no wall: ILO neither slides on it nor wall-jumps from it', () => {
  const world = open('floor');
  const seam = world.seams[0];
  placePlayer(world, seam.x - PLAYER.w / 2 - 0.03, 1.5);
  let airborne = 0;
  const seen = run(world, 60, (i) => press({ right: true, jump: true, jumpPressed: i === 3 }), { each: (w) => {
    assert.ok(w.player.x + PLAYER.w / 2 <= seam.x + EPSILON, 'the seam still holds ILO back');
    if (!w.player.grounded) {
      airborne += 1;
      assert.deepEqual([w.player.wall, w.player.sliding], [0, false]);
    }
  } });
  assert.ok(airborne > 20, 'ILO fell beside the seam');
  assert.deepEqual(types(seen), ['land']);
  assert.equal(seam.broken, false);
  assert.equal(world.player.grounded, true);
});

// The wall-jump shafts the ROUTE block of src/level/level.js names: the air ILO climbs through, from the shaft floor
// up to the exit ledge, the wall the first jump from the floor flies to, and how far that jump rises before it
// steers (`rise`: a wall that starts above the floor).
const SHAFTS = [
  { name: 'crate slot', x0: 46, x1: 47, floor: 6, top: 10, first: 1, rise: 1.6 },
  { name: 'reservoir shaft 1', x0: 91, x1: 95, floor: 3, top: 13, first: -1 },
  { name: 'switch shaft', x0: 100, x1: 104, floor: 13, top: 21, first: -1 },
  { name: 'reservoir shaft 2', x0: 137, x1: 141, floor: 13, top: 22, first: 1 },
  { name: 'ascent shaft 1', x0: 197, x1: 201, floor: 22, top: 36, first: -1 },
  { name: 'ascent shaft 2', x0: 222, x1: 226, floor: 54, top: 66, first: -1 },
];

test('Walls: every wall-jump shaft of the real course climbs on rock and metal alone', () => {
  for (const { name, x0, x1, floor, top, first, rise = 0 } of SHAFTS) {
    const air = { x: x0, y: floor, w: x1 - x0, h: top - floor };
    assert.equal(COURSE.seams.some((seam) => overlaps(seam, air)), false, `${name}: no seam lies in the shaft`);
    const world = openCourse(x0 + Math.min(1.5, (x1 - x0) / 2), floor);
    const { player } = world;
    let toward = first;
    let base = floor;
    let steps = 0;
    // Hold toward a wall; jump from the floor, and away from a wall once ILO slides down it (the top of its arc),
    // until ILO stands on the exit ledge.
    while (!(player.grounded && player.y >= top)) {
      assert.ok(steps < 2400, `${name}: the climb did not reach y ${top}: ILO at ${player.x}, ${player.y}`);
      if (player.grounded) base = player.y;
      const onWall = player.wall !== 0 && !player.grounded;
      const jump = player.grounded || (onWall && player.vy < 0);
      if (jump && onWall) toward = -player.wall;
      const dir = player.y - base >= rise ? toward : 0;
      stepWorld(world, press({ left: dir < 0, right: dir > 0, jump: true, jumpPressed: jump }));
      world.events.length = 0;
      steps += 1;
    }
    assert.equal(world.seams.some((seam) => seam.broken), false, `${name}: the climb broke no seam`);
  }
});

// --- Dash ---

test('Dash: 0.16 s at 15 units per second with gravity off, about 2.4 of travel, exit speed 6.5', () => {
  const world = open('floor');
  const startX = world.player.x;
  let dashSteps = 0;
  let travel = null;
  run(world, 24, (i) => press({ dashPressed: i === 0 }), { each: (w) => {
    near(w.player.y, 0);
    if (w.player.dashT > 0) {
      dashSteps += 1;
      near(w.player.vy, 0);
      near(w.player.vx, DASH.speed);
    } else if (travel === null) {
      travel = w.player.x - startX;
      near(w.player.vx, DASH.exitSpeed);
    }
  } });
  near(dashSteps * DT, DASH.time, DT);
  near(travel, DASH.speed * DASH.time);
});

test('Dash: cooldown 0.45 s', () => {
  const world = open('floor');
  const seen = run(world, 70, (i) => press({ dashPressed: i === 0 || i === 53 || i === 56 }));
  assert.equal(types(seen).filter((t) => t === 'dash').length, 2);
});

test('Dash: pressed during the wall-jump lock or a hit stun, it goes toward the held direction', () => {
  for (const after of [3, 11]) {                     // 0.03 s and 0.09 s into the 0.10 s steering lock
    const wall = open('shaftAir');
    run(wall, 30, press({ right: true }));
    run(wall, 1, press({ right: true, jump: true, jumpPressed: true }));
    run(wall, after, press({ left: true, jump: true }));
    assert.ok(wall.player.stunT > 0, 'still locked');
    const seen = run(wall, 1, press({ left: true, jump: true, dashPressed: true }));
    assert.deepEqual(seen.filter((event) => event.type === 'dash').map((event) => event.dir), [-1], `${after} steps after the wall jump`);
    assert.deepEqual([wall.player.facing, wall.player.dashDir], [-1, -1]);
    const rest = run(wall, 20, press({ left: true, jump: true }));
    assert.equal(types(rest).includes('dashStop'), false, 'the dash ran its course away from the wall');
    assert.ok(wall.player.x < SPOTS.shaftAir[0] - 2, `ILO left the wall: x ${wall.player.x}`);
  }

  const hit = open('floor');
  Object.assign(hit.player, { facing: 1, energy: SHIELD.cost - 1 });
  beam(hit, 5, 9);                                 // the source is east: ILO is knocked back west
  assert.deepEqual(types(run(hit, 1)), ['damage']);
  run(hit, 3);
  const hitSeen = run(hit, 1, press({ left: true, dashPressed: true }));
  assert.deepEqual(hitSeen.filter((event) => event.type === 'dash').map((event) => event.dir), [-1]);
  assert.equal(hit.player.facing, -1);
});

test('Dash: a jump pressed any time during a ground dash fires when the dash ends', () => {
  for (let at = 0; at < DASH.time / DT; at += 1) {
    const world = open('floor');
    const seen = run(world, 22, (i) => press({ jump: true, jumpPressed: i === at, dashPressed: i === 0 }));
    const jumps = seen.filter((event) => event.type === 'jump');
    assert.deepEqual(jumps.map((event) => event.wall), [0], `pressed at step ${at}`);
    assert.ok(world.player.y > 0, `pressed at step ${at}: ILO is rising`);
  }
});

test('Dash: one air dash until a landing', () => {
  const world = open('floor');
  placePlayer(world, 5, 12);
  run(world, 1, press({ dashPressed: true }));
  assert.equal(world.player.dashAir, false);
  const seen = run(world, 130, (i) => press({ dashPressed: i === 70 || i === 115 }), { each: (w) => { if (w.step === 71) assert.equal(w.player.grounded, false); } });
  assert.deepEqual(types(seen).filter((t) => t === 'dash'), ['dash']);
  assert.equal(world.player.grounded, true);
});

test('Dash: a wall ends the dash and a 0.5-unit wall is never tunneled', () => {
  const wall = solid('thin');
  const world = open('beforeThinWall');
  const seen = run(world, 60, (i) => press({ dashPressed: i === 0 }), { each: (w) => assert.ok(w.player.x + PLAYER.w / 2 <= wall.x + EPSILON) });
  const stop = seen.find((event) => event.type === 'dashStop');
  assert.ok(stop);
  near(stop.x + PLAYER.w / 2, wall.x);
  assert.equal(world.player.dashT, 0);
  assert.ok(!types(seen).includes('seamBreak'));
});

test('Dash: a seam breaks and the dash continues', () => {
  const world = open('beforeSeam');
  const seam = world.seams[0];
  const startX = world.player.x;
  let travel = null;
  const seen = run(world, 24, (i) => press({ dashPressed: i === 0 }), { each: (w) => { if (travel === null && w.player.dashT <= 0) travel = w.player.x - startX; } });
  assert.equal(seam.broken, true);
  assert.deepEqual(types(seen).filter((t) => t !== 'step'), ['dash', 'seamBreak']);
  assert.equal(seen.find((event) => event.type === 'seamBreak').id, seam.id);
  near(travel, DASH.speed * DASH.time);
  run(world, 30, press({ right: true }));
  assert.ok(world.player.x > seam.x + seam.w);
});

test('Dash: the direction never reverses mid-dash', () => {
  const world = open('floor');
  let lastX = world.player.x;
  run(world, 20, (i) => press({ left: i > 0, dashPressed: i === 0 }), { each: (w) => {
    assert.ok(w.player.x > lastX);
    lastX = w.player.x;
    assert.equal(w.player.dashDir, 1);
    near(w.player.vx, w.player.dashT > 0 ? DASH.speed : DASH.exitSpeed);
  } });
});

test('Dash: a landing that used to be silent emits land and refreshes the air dash', () => {
  const world = open('floor');
  placePlayer(world, 4.5, 0);                                             // the dash carries ILO to about 8.2, clear of the low ceiling at x 9
  world.events.length = 0;
  const seen = [];
  // Jump held 5 steps, air dash right after. This fall used to end the step before contact inside the 0.05
  // ground probe: the landing was silent and the air dash stayed spent.
  run(world, 5, (i) => press({ jump: true, jumpPressed: i === 0 }), { seen });
  run(world, 1, press({ dashPressed: true }), { seen });                // the air dash, spent in the air
  assert.equal(world.player.dashAir, false);
  run(world, 150, IDLE, { seen });
  const lands = seen.filter((event) => event.type === 'land');
  assert.equal(lands.length, 1);
  near(lands[0].y, 0);
  assert.equal(world.player.dashAir, true, 'the landing gave the air dash back');
  run(world, 10, (i) => press({ jump: true, jumpPressed: i === 0 }), { seen });
  assert.ok(world.player.y > 0.5, 'airborne again');
  run(world, 1, press({ dashPressed: true }), { seen });
  assert.deepEqual(types(seen).filter((t) => t === 'dash'), ['dash', 'dash']);
});

test('Carrying a cell: speed 4.5, jump allowed, dash, pulse, wall slide and wall jump unavailable', () => {
  const world = open('floor');
  world.player.carrying = 'c1';
  const seen = run(world, 40, (i) => press({ right: true, dashPressed: i === 0, pulsePressed: i === 0 }));
  near(world.player.vx, PLAYER.carrySpeed);
  assert.deepEqual(types(seen).filter((t) => t !== 'step'), []);
  const seenJump = run(world, 1, press({ jump: true, jumpPressed: true }));
  assert.deepEqual(types(seenJump), ['jump']);
  assert.equal(world.player.vy > 12, true);

  const wall = open('shaftAir');
  wall.player.carrying = 'c1';
  const wallSeen = run(wall, 30, press({ right: true }));
  assert.equal(wall.player.wall, 1);
  assert.equal(wall.player.sliding, false);
  wallSeen.length = 0;
  run(wall, 1, press({ right: true, jump: true, jumpPressed: true }));
  assert.deepEqual(types(wallSeen), []);
  assert.ok(wall.player.vy < 0);
});

// --- Pulse ---

test('Pulse: costs 35 energy and cools down 0.7 s', () => {
  const world = open('floor');
  const seen = run(world, 90, (i) => press({ pulsePressed: i === 0 || i === 24 || i === 60 || i === 85 }));
  assert.deepEqual(types(seen), ['pulse', 'pulse']);
  near(world.player.energy, PULSE.max - 2 * PULSE.cost);
  near(world.player.pulseCd, PULSE.cooldown - 4 * DT);
  near(world.player.regenDelay, PULSE.regenDelay - 4 * DT);
});

test('Pulse: regeneration starts 1.5 s later at 20 per second up to 100', () => {
  const world = open('floor');
  const energyAt = {};
  run(world, 540, (i) => press({ pulsePressed: i === 0 }), { each: (w) => { if ([168, 241, 421].includes(w.step)) energyAt[w.step] = w.player.energy; } });
  near(energyAt[168], PULSE.max - PULSE.cost);
  near(energyAt[241], PULSE.max - PULSE.cost + PULSE.regen * 0.5, 0.3);
  near(energyAt[421], PULSE.max);
});

test('Pulse: radius 6 and one response per target', () => {
  const world = open('floor');
  const origin = [SPOTS.floor[0], SPOTS.floor[1] + PLAYER.h / 2];
  const around = (distance) => ({ x: origin[0] + distance, y: origin[1] });
  assert.deepEqual(pulseHits(world, [{ id: 'near', ref: around(5.5) }, { id: 'far', ref: around(6.5) }]), { near: 1, far: 0 });
  assert.equal(world.pulse, null);
});

test('Pulse: rock blocks line of sight and a seam transmits it', () => {
  assert.deepEqual(
    pulseHits(open('atThinWall'), [{ id: 'front', ref: { x: 45, y: 0.75 } }, { id: 'behind', ref: { x: 52, y: 0.75 } }]),
    { front: 1, behind: 0 },
  );
  assert.deepEqual(pulseHits(open('beforeSeamSight'), [{ id: 'past', ref: { x: 46, y: 0.75 } }]), { past: 1 });
});

test('Pulse: a closed shutter blocks line of sight, an open one does not', () => {
  const world = open('beforeShutter');
  const target = [{ id: 'past', ref: { x: 66, y: 0.75 } }];
  assert.deepEqual(pulseHits(world, target), { past: 0 });
  setShutterPower(world, true);
  run(world, 70);
  assert.equal(mover(world, 'shutter').t, 1);
  assert.deepEqual(pulseHits(world, target), { past: 1 });
});

test('Pulse: below 35 energy gives pulseEmpty with no cost and no cooldown', () => {
  const world = open('floor');
  world.player.energy = PULSE.cost - 5;
  world.player.regenDelay = 5;
  const seen = run(world, 3, press({ pulsePressed: true }));
  assert.deepEqual(types(seen), ['pulseEmpty', 'pulseEmpty', 'pulseEmpty']);
  near(world.player.energy, PULSE.cost - 5);
  assert.equal(world.player.pulseCd, 0);
  assert.equal(world.pulse, null);
});

test('Pulse: carrying a cell blocks the pulse', () => {
  const world = open('floor');
  world.player.carrying = 'c1';
  const seen = run(world, 2, press({ pulsePressed: true }));
  assert.deepEqual(types(seen), []);
  near(world.player.energy, PULSE.max);
  assert.equal(world.pulse, null);
});

test('Pulse: the wave expands over 0.35 s to radius 6: a target at 3 units answers at half the time, one at the radius at the end', () => {
  const world = open('floor');
  const origin = [SPOTS.floor[0], SPOTS.floor[1] + PLAYER.h / 2];
  const answered = {};
  const target = (id, distance) => ({
    id, ref: { x: origin[0] + distance, y: origin[1] },
    onPulse: () => { answered[id] ??= [world.step, world.pulse.r]; },   // the step of the answer, and where the front was
  });
  world.pulseTargets.push(target('half', 3), target('rim', 6), target('beyond', 6.01));
  const front = {};
  run(world, 60, (i) => press({ pulsePressed: i === 0 }), { each: (w) => { if (w.pulse !== null) front[w.step] = w.pulse.r; } });
  // The wave starts on step 1, so it is 0.175 s old at step 21 and 0.35 s old at step 42 (GOAL §8).
  assert.deepEqual([answered.half?.[0], answered.rim?.[0]], [21, 42]);
  near(answered.half[1], 3);                        // the front has reached 3 when the target at 3 answers ...
  near(answered.rim[1], 6);                         // ... and the full radius 6 when the target on the rim answers, on the wave's last step
  assert.deepEqual(Object.keys(front), Array.from({ length: 41 }, (_, i) => String(i + 1)));   // the wave is gone after its 42nd step
  for (let step = 1; step <= 41; step += 1) near(front[step], (6 * step) / 42);               // and its front grows evenly
  assert.equal(world.pulse, null);
});

// --- Damage ---

test('Damage: at 50 energy or more a hit spends 50 energy and leaves integrity', () => {
  const world = open('floor');
  beam(world, 5, 9);
  const seen = run(world, 1);
  assert.deepEqual(types(seen), ['shield']);
  assert.equal(world.player.hp, RUN.integrity);
  near(world.player.energy, PULSE.max - SHIELD.cost);
  near(world.player.immunity, SHIELD.immunity);
  near(world.player.regenDelay, PULSE.regenDelay);
  near(world.player.vx, 0);
  near(world.player.vy, 0);
});

test('Damage: below 50 energy a hit removes one integrity with knockback away from the source', () => {
  const world = open('floor');
  world.player.energy = SHIELD.cost - 1;
  world.player.regenDelay = 5;
  beam(world, 5, 9);
  const seen = run(world, 1);
  assert.deepEqual(types(seen), ['damage']);
  assert.equal(seen[0].cause, 'beam');
  assert.equal(world.player.hp, RUN.integrity - 1);
  near(world.player.energy, SHIELD.cost - 1);
  near(world.player.immunity, DAMAGE.immunity);
  near(world.player.regenDelay, PULSE.regenDelay);
  near(world.player.vx, -DAMAGE.knockX);
  near(world.player.vy, DAMAGE.knockY);
  near(world.player.stunT, DAMAGE.stun);

  const facing = open('floor');
  facing.player.facing = -1;
  facing.player.energy = SHIELD.cost - 1;
  beam(facing, 5, 5);
  run(facing, 1);
  near(facing.player.vx, DAMAGE.knockX);
});

test('Damage: one outcome per hit and one hit per immunity window', () => {
  const world = open('floor');
  beam(world, 5, 9);
  const seen = run(world, 300);
  assert.deepEqual(types(seen).filter((t) => t === 'shield' || t === 'damage'), ['shield', 'shield', 'damage']);
  assert.equal(world.player.hp, RUN.integrity - 1);
  near(world.player.energy, 0);
});

test('Damage: knockback never embeds ILO in a wall or a ceiling', () => {
  const ceiling = open('underCeiling');
  ceiling.player.energy = SHIELD.cost - 1;
  beam(ceiling, 10.5, 12);
  let rose = 0;
  run(ceiling, 60, IDLE, { each: (w) => {
    rose = Math.max(rose, w.player.y);
    assert.ok(w.player.y + PLAYER.h <= solid('ceiling').y + EPSILON && w.player.y >= -EPSILON);
  } });
  assert.ok(rose > 0.4);

  const walled = open('atWestWall');
  walled.player.energy = SHIELD.cost - 1;
  beam(walled, 0.375, 5);
  run(walled, 60, IDLE, { each: (w) => assert.ok(w.player.x - PLAYER.w / 2 >= 0 - EPSILON && w.player.y >= -EPSILON) });
});

test('Damage: hp 0 shuts down, reboots and resumes at the checkpoint with one recovery', () => {
  const world = open('eastFloor');
  world.player.energy = 0;
  beam(world, 38, 44, 6);
  const seen = run(world, 560);
  assert.deepEqual(seen.filter((event) => event.type === 'shutdown'), [{ type: 'shutdown', cause: 'integrity' }]);
  assert.deepEqual(seen.filter((event) => event.type === 'reboot'), [{ type: 'reboot', stationId: 'st0', x: 1.5, y: 0 }]);
  assert.equal(world.mode, 'play');
  assert.equal(world.recoveries, 1);
  near(world.player.x, 1.5);
  near(world.player.y, 0);
  assert.equal(world.player.hp, RUN.integrity);
  near(world.player.energy, PULSE.max);
  near(world.player.vx, 0);
  near(world.player.vy, 0);
  assert.ok(world.player.immunity > DAMAGE.immunity);
});

test('Damage: a kill bound gives exactly one recovery', () => {
  const world = open('beforePit');
  const seen = run(world, 500, press({ right: true }));
  assert.deepEqual(seen.filter((event) => event.type === 'shutdown'), [{ type: 'shutdown', cause: 'fall' }]);
  assert.equal(world.recoveries, 1);
  assert.equal(world.mode, 'play');
});

test('Damage: R gives one recovery and R during shutdown is ignored', () => {
  const world = open('floor');
  const seen = run(world, 180, (i) => press({ retryPressed: i === 0 || i === 10 || i === 40 }));
  assert.deepEqual(seen.filter((event) => event.type === 'shutdown'), [{ type: 'shutdown', cause: 'retry' }]);
  assert.equal(world.recoveries, 1);
  assert.equal(world.mode, 'play');
  near(world.player.x, 1.5);
  run(world, 1, press({ retryPressed: true }));
  assert.equal(world.recoveries, 2);
  assert.equal(world.mode, 'shutdown');
});

// --- Platforms ---

test('Platforms: a rider moves with the platform and a jump from it keeps the jump speed', () => {
  const world = open('onPlatform');
  const platform = mover(world, 'platform');
  run(world, 170, IDLE, { each: (w) => {
    assert.equal(w.player.onMover, platform.id);
    near(w.player.y, platform.y + platform.h);
    near(w.player.vy, 0);
  } });
  assert.equal(platform.moving, true);
  assert.ok(world.player.y > 3);
  const seen = run(world, 1, press({ jump: true, jumpPressed: true }));
  assert.deepEqual(types(seen), ['jump']);
  near(world.player.vy, PLAYER.jumpSpeed - PLAYER.gravity * DT);
  assert.equal(world.player.onMover, null);
});

test('Platforms: a platform whose rider would be pushed into rock is blocked', () => {
  const world = open('onPlatform');
  const platform = mover(world, 'platform');
  const rack = solid('rack');
  const startY = platform.y;
  run(world, 200, IDLE, { each: (w) => assert.ok(w.player.y + PLAYER.h <= rack.y + EPSILON) });
  assert.equal(platform.blocked, true);
  assert.equal(platform.moving, false);
  near(platform.y + platform.h + PLAYER.h, rack.y);
  assert.ok(platform.y > startY);
});

test('Platforms: a closing shutter stops short of ILO and closes once the way is clear', () => {
  const world = open('beforeShutter');
  const shutter = mover(world, 'shutter');
  setShutterPower(world, true);
  const opening = run(world, 70);
  placePlayer(world, ...SPOTS.inDoorway);
  assert.equal(shutter.t, 1);
  assert.deepEqual(opening.filter((event) => event.type.startsWith('shutter')), [
    { type: 'shutterStop', id: 'shut1', open: true },
  ]);
  setShutterPower(world, false);
  const closing = run(world, 45, IDLE, { each: (w) => assert.ok(shutter.y + EPSILON >= w.player.y + PLAYER.h) });
  assert.equal(shutter.blocked, true);
  near(shutter.y, world.player.y + PLAYER.h);
  assert.ok(shutter.t > 0);
  assert.deepEqual(closing.filter((event) => event.type.startsWith('shutter')), [
    { type: 'shutterStop', id: 'shut1', open: false },
  ]);
  placePlayer(world, ...SPOTS.beforeShutter);
  const clearing = run(world, 45);
  assert.equal(shutter.t, 0);
  assert.deepEqual(clearing.filter((event) => event.type.startsWith('shutter')).at(-1), { type: 'shutterStop', id: 'shut1', open: false });
});

test('A loose cell is solid: ILO stops at its side and stands on its top; a cell rides with a mover', () => {
  const world = open('floor');
  world.cells.push({ id: 'c1', x: 8.5, y: 0, w: 1, h: 1.1, state: 'loose', socket: null, home: { x: 8.5, y: 0 } });
  run(world, 120, press({ right: true }), { each: (w) => assert.ok(w.player.x + PLAYER.w / 2 <= 8 + EPSILON) });
  near(world.player.x + PLAYER.w / 2, 8);
  placePlayer(world, 8.5, 3);
  const seen = run(world, 60);
  assert.deepEqual(types(seen), ['land']);
  assert.equal(seen[0].surface, 'cell');
  assert.equal(world.player.grounded, true);
  near(world.player.y, 1.1);

  const riding = createWorld(LEVEL);
  riding.mode = 'play';
  riding.cells.push({ id: 'c2', x: 58, y: 1.5, w: 1, h: 1.1, state: 'loose', socket: null, home: { x: 58, y: 1.5 } });
  const platform = mover(riding, 'platform');
  run(riding, 150, IDLE, { each: (w) => near(w.cells[0].y, platform.y + platform.h) });
  near(riding.cells[0].x, 58);
  assert.ok(riding.cells[0].y > 2.5);
});

test('Platforms: a mover pushes ILO to exact contact, yields at a wall, and ILO cannot push back into it', () => {
  const world = createWorld({
    ...LEVEL,
    solids: [...LEVEL.solids, { id: 'post', x: 25, y: 0, w: 0.5, h: 3, mat: 'metal', region: 'workshop' }],
    platforms: [...LEVEL.platforms, {
      id: 'ram', x: 20, y: 0.25, w: 2, h: 0.5, fx: 20, fy: 0.25, tx: 23, ty: 0.25,
      mode: 'toggle', yields: true, crushes: false, enabled: true, poweredBy: [], speed: 2,
    }],
  });
  world.mode = 'play';
  placePlayer(world, 24.5, 0);
  const ram = world.movers.find((m) => m.id === 'ram');
  const outside = (w) => {
    assert.ok(w.player.x + PLAYER.w / 2 <= 25 + EPSILON);
    assert.ok(w.player.x - PLAYER.w / 2 >= ram.x + ram.w - EPSILON);
  };
  run(world, 200, IDLE, { each: outside });
  assert.equal(ram.blocked, true);
  near(world.player.x + PLAYER.w / 2, 25);
  near(world.player.x - PLAYER.w / 2, ram.x + ram.w);
  run(world, 120, press({ left: true }), { each: outside });
  near(world.player.x, 24.625);
});

test('Platforms: a press crush gives a recovery that bypasses shield and integrity', () => {
  const world = open('underPress');
  const seen = run(world, 480, IDLE, { each: (w) => {
    if (types(w.events).includes('crush')) {
      assert.equal(w.player.hp, RUN.integrity);
      near(w.player.energy, PULSE.max);
    }
  } });
  assert.deepEqual(types(seen).filter((t) => ['crush', 'shutdown', 'reboot'].includes(t)), ['crush', 'shutdown', 'reboot']);
  assert.equal(seen.find((event) => event.type === 'shutdown').cause, 'crush');
  assert.equal(world.recoveries, 1);
  assert.equal(world.mode, 'play');
  near(world.player.x, 1.5);
});

test('Crush: a press that stops flush with the floor crushes idle ILO 0.30 s after it closes on it, once', () => {
  const [def] = COURSE.presses;                    // fndPress1 of the real course: its head ends level with the floor
  const world = openCourse(def.x + def.w / 2, def.ty);
  const head = mover(world, 'press');
  let inside = 0;                                  // steps with ILO's box in the head, up to the crush
  let crushed = false;
  const seen = run(world, 600, IDLE, { each: (w) => {
    if (!crushed && overlaps(head, bodyRect(w.player.x, w.player.y))) inside += 1;
    if (types(w.events).includes('crush')) {
      crushed = true;
      assert.deepEqual([w.player.hp, w.player.energy], [RUN.integrity, PULSE.max], 'a crush is no hit');
    }
  } });
  assert.deepEqual(seen.filter((event) => event.type === 'crush'), [{ type: 'crush', x: def.x + def.w / 2, y: def.ty }]);
  assert.deepEqual(seen.filter((event) => event.type === 'shutdown'), [{ type: 'shutdown', cause: 'crush' }]);
  assert.equal(crushed, true);
  near(inside * DT, RUN.crushTime, DT / 2);        // neither sooner nor left inside longer
  assert.deepEqual([world.recoveries, world.mode, seen.filter((event) => event.type === 'reboot').length], [1, 'play', 1]);
});

test('Crush: a rider on the head of a press is never crushed', () => {
  const world = open('underPress');
  const head = mover(world, 'press');
  placePlayer(world, head.x + head.w / 2, head.y + head.h);
  const seen = run(world, 600, IDLE, { each: (w) => {
    assert.equal(w.player.onMover, head.id);
    near(w.player.y, head.y + head.h);
  } });
  assert.deepEqual(types(seen).filter((t) => t !== 'press'), []);
  assert.equal(world.recoveries, 0);

  // The head of the real press has 0.5 units of air over it at the top: ILO boards it where it rests on the floor.
  const [def] = COURSE.presses;
  const course = openCourse(COURSE.spawn.x, COURSE.spawn.y);
  const real = mover(course, 'press');
  let aboard = false;
  const courseSeen = run(course, 720, IDLE, { each: (w) => {
    if (!aboard && real.t === 1) {
      placePlayer(course, real.x + real.w / 2, real.y + real.h);
      aboard = true;
    } else if (aboard) {
      assert.equal(w.player.onMover, real.id);
      near(w.player.y, real.y + real.h);
    }
  } });
  assert.equal(aboard, true);
  assert.deepEqual(types(courseSeen).filter((t) => t !== 'press' && t !== 'vent'), []);
  assert.equal(course.recoveries, 0);
});

// --- World, checkpoint, determinism ---

test('World: createWorld fills mover defaults and a title world does not step', () => {
  const rect = (id, tx, ty, extra = {}) => ({ id, x: 40, y: 10, w: 2, h: 0.5, fx: 40, fy: 10, tx, ty, mode: 'loop', yields: true, crushes: false, enabled: true, poweredBy: [], ...extra });
  const world = createWorld({
    ...LEVEL,
    platforms: [rect('p', 40, 12)],
    shutters: [rect('s', 40, 13, { mode: 'toggle' })],
    lifts: [rect('l', 40, 14, { mode: 'toggle' })],
    presses: [rect('r', 40, 8, { crushes: true, yields: false, warn: 0.9 })],
  });
  assert.equal(world.mode, 'title');
  assert.deepEqual(world.movers.map((m) => [m.speed, m.pauseA, m.pauseB]), [[2, 1, 1], [6, 0, 0], [2.5, 0, 0], [8, 0.9, 0.3]]);
  assert.deepEqual(world.lifts.map((m) => m.id), ['l']);
  assert.deepEqual(world.presses.map((m) => m.id), ['r']);
  for (const m of world.movers) {
    assert.deepEqual([m.t, m.dir, m.wait, m.moving, m.blocked], [0, 1, m.pauseA, false, false]);
    near(m.x, m.fx);
    near(m.y, m.fy);
  }
  const x = world.player.x;
  stepWorld(world, press({ right: true }));
  assert.equal(world.step, 1);
  near(world.player.x, x);
  assert.equal(world.player.grounded, true);
});

test('World: without a station a recovery returns ILO to the spawn', () => {
  const world = createWorld({ ...LEVEL, stations: [] });
  world.mode = 'play';
  placePlayer(world, 41, 0);
  const seen = run(world, 180, (i) => press({ retryPressed: i === 0 }));
  assert.deepEqual(seen.filter((event) => event.type === 'reboot'), [{ type: 'reboot', stationId: null, x: LEVEL.spawn.x, y: LEVEL.spawn.y }]);
  near(world.player.x, LEVEL.spawn.x);
  assert.equal(world.recoveries, 1);
  assert.equal(world.mode, 'play');
});

test('Checkpoint: restore rolls back seams and movers and puts ILO at the station', () => {
  const world = open('beforeSeam');
  const seam = world.seams[0];
  const platform = mover(world, 'platform');
  run(world, 24, (i) => press({ dashPressed: i === 0 }));
  run(world, 120, press({ right: true }));
  assert.equal(seam.broken, true);
  assert.ok(platform.t > 0);
  Object.assign(world.player, { hp: 1, energy: 10, vx: 3, carrying: 'c1' });
  restoreCheckpoint(world);
  const reboot = [...world.events];
  assert.equal(seam.broken, false);
  assert.equal(platform.t, 0);
  assert.equal(platform.wait, platform.pauseA);
  near(platform.y, platform.fy);
  assert.deepEqual([world.player.hp, world.player.carrying], [RUN.integrity, null]);
  assert.deepEqual([world.player.x, world.player.y, world.player.vx, world.player.vy, world.player.energy], [1.5, 0, 0, 0, PULSE.max]);
  assert.deepEqual(reboot, [{ type: 'reboot', stationId: 'st0', x: 1.5, y: 0 }]);
});

test('Clock: 120 steps of play move the expedition clock by exactly 1 second (a fixed step of 1 / 120)', () => {
  const world = open('floor');
  assert.equal(world.clock, 0);
  run(world, 120);
  near(world.clock, 1);                            // exact up to the rounding of 120 additions
  run(world, 120);
  near(world.clock, 2);
});

test('Determinism: the same input sequence twice gives an identical inspect', () => {
  const script = (i) => press({
    right: i % 240 < 150,
    left: i % 240 > 200,
    jump: i % 37 < 20,
    jumpPressed: i % 37 === 0,
    dashPressed: i % 53 === 0,
    pulsePressed: i % 71 === 0,
    retryPressed: i === 500,
  });
  const first = open('floor');
  const second = open('floor');
  run(first, 600, script);
  run(second, 600, script);
  assert.deepEqual(inspect(first), inspect(second));
  assert.equal(first.recoveries, 1);
});
