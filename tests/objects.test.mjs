import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE, CELL, DAMAGE, DT, LIFT, PLAYER, PULSE, RUN, SHIELD } from '../src/config.js';
import { bodyRect, dynamicSolids, groundBelow, overlaps, staticHits } from '../src/sim/collision.js';
import { placePlayer } from '../src/sim/player.js';
import { commitCheckpoint, createWorld, stepWorld } from '../src/sim/world.js';
import { LEVELS, SPOTS } from './fixtures/objects.js';

const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const EVERY = Object.freeze(Object.fromEntries(Object.keys(IDLE).map((key) => [key, true])));
const EPSILON = 1e-9;
const press = (held = {}) => ({ ...IDLE, ...held });
const byId = (items, id) => items.find((item) => item.id === id);
const types = (events) => events.map((event) => event.type);
const of = (events, type) => events.filter((event) => event.type === type);
/** Cell and socket events only: a vent or a press in earshot adds cues of its own. */
const handling = (events) => types(events).filter((type) => type.startsWith('cell') || type === 'socketPower');
/** Everything but the footfall cues of walking. */
const quiet = (events) => events.filter((event) => event.type !== 'step');

function near(actual, expected, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

/** A `play` world of fixture `name` with ILO at `spot`. Every step's events collect in `seen` until `clear`. */
function open(name, spot = 'start') {
  const world = createWorld(LEVELS[name]);
  world.mode = 'play';
  placePlayer(world, ...SPOTS[name][spot]);
  world.events.length = 0;
  const t = {
    world,
    seen: [],
    /** One step; `input` may be a function of the world. */
    step(input = IDLE) {
      stepWorld(world, typeof input === 'function' ? input(world) : input);
      t.seen.push(...world.events);
      world.events.length = 0;
    },
    /** `count` steps; `each` runs after every step. */
    run(count, input = IDLE, each) {
      for (let i = 0; i < count; i += 1) {
        t.step(input);
        each?.(world);
      }
    },
    /** Steps until `done(world)` holds and returns how many it took; fails after 20 seconds. */
    until(done, input = IDLE, each) {
      let count = 0;
      while (!done(world)) {
        assert.ok(count < 2400, `not reached after ${count} steps: mode ${world.mode}, ILO at ${world.player.x}, ${world.player.y}`);
        t.step(input);
        each?.(world);
        count += 1;
      }
      return count;
    },
    /** Walk with real input until ILO stands within `tolerance` of `x`: accelerate while the braking distance still fits. */
    walkTo(x, tolerance = 0.12) {
      const p = world.player;
      for (let count = 0; Math.abs(x - p.x) > tolerance || Math.abs(p.vx) > 0.3; count += 1) {
        assert.ok(count < 2400, `walkTo(${x}) stuck at ${p.x}, ${p.y}`);
        const dir = Math.sign(x - (p.x + (p.vx * Math.abs(p.vx)) / (2 * PLAYER.groundBrake)));
        t.step(press({ right: dir > 0, left: dir < 0 }));
      }
    },
    /** A full tap of E: one step down, one step up. */
    e() {
      t.step(press({ interactPressed: true }));
      t.step();
    },
    /** One step of Q: the wave that follows needs more steps to reach anything. */
    pulse: () => t.step(press({ pulsePressed: true })),
    /** Steps until the wave of a pulse has lit a relay and the look at the route starts. */
    reached: () => t.until((w) => w.mode === 'relayActivation'),
    /** Move ILO's feet to `(x, y)` and keep everything else, as `window.DEEPWAKE.warp` does. */
    warp: (x, y = world.player.y) => Object.assign(world.player, { x, y, vx: 0, vy: 0 }),
    /** Turn ILO with real input and let it come to a stop. */
    face(dir) {
      t.step(press(dir > 0 ? { right: true } : { left: true }));
      t.run(4);
    },
    clear: () => { t.seen.length = 0; },
  };
  return t;
}

/** Every cell is in exactly one place: loose, carried by ILO, or in the one socket that names it. */
function assertCells(world) {
  const carried = world.cells.filter((cell) => cell.state === 'carried');
  assert.equal(carried.length <= 1, true);
  assert.equal(carried[0]?.id ?? null, world.player.carrying);
  assert.equal(world.cells.length, world.level.cells.length);
  for (const socket of world.sockets) {
    const cell = byId(world.cells, socket.cell);
    assert.equal(socket.powered, socket.cell !== null);
    if (cell !== undefined) assert.deepEqual([cell.state, cell.socket], ['socketed', socket.id]);
  }
  for (const cell of world.cells) {
    if (cell.state === 'socketed') assert.equal(byId(world.sockets, cell.socket)?.cell, cell.id);
    else assert.equal(cell.socket, null);
  }
}

/** True when no enabled mover and no unbroken seam meets the corridor `rect`: the road along it is open. */
function roadOpen(world, rect) {
  const meets = (o) => o.x < rect.x + rect.w && o.x + o.w > rect.x && o.y < rect.y + rect.h && o.y + o.h > rect.y;
  return !world.movers.some((m) => m.enabled && meets(m)) && !world.seams.some((s) => !s.broken && meets(s));
}

/** Switch relays on by hand: the setup of a test that is not about the pulse. */
function lightRelays(world, ...ids) {
  for (const id of ids) byId(world.relays, id).active = true;
}

/** The workshop circuit up to Relay A: archive A, carry the cell, insert it, walk through the open shutter, pulse. */
function circuit(t) {
  t.walkTo(5.6);
  t.e();
  t.walkTo(9.4);
  t.e();
  t.walkTo(13.6);
  t.e();
  t.walkTo(20.5);
  t.until((w) => byId(w.movers, 'shA').t === 1);
  t.pulse();
  t.reached();
}

/** Real inputs from the shaft floor: jump up to the left wall, wall-jump up the shaft, land on the switch ledge. */
function climbShaft(t) {
  let toward = -1;                                  // the wall ILO flies to
  t.until((w) => w.player.grounded && w.player.y === 7, (w) => {
    const p = w.player;
    const onWall = p.wall !== 0 && !p.grounded;
    if (onWall) toward = -p.wall;                   // jump away from the wall ILO touches
    return press({ left: toward < 0, right: toward > 0, jump: true, jumpPressed: onWall || p.grounded });
  });
}

// --- Cells ---

test('Cells: E picks up the nearest loose cell in reach and does nothing out of reach', () => {
  // The reach of E (GOAL §11, about 1.3 units), measured between the closest point of ILO's body and that of the cell.
  const beside = (distance) => {                     // ILO on the floor, its east face `distance` from the west face of c1 (x 3)
    const t = open('cells', 'near');
    t.warp(3 - PLAYER.w / 2 - distance, 0);
    t.run(1);
    return t;
  };
  const inside = beside(1.25);
  assert.deepEqual([inside.world.interactTarget, inside.world.prompt], [{ kind: 'pickup', id: 'c1', x: 3.5, y: 0 }, { key: 'E', text: 'Pick Up Cell' }]);
  inside.e();
  assert.deepEqual([inside.seen, inside.world.player.carrying], [[{ type: 'cellPickup', id: 'c1' }], 'c1']);

  const outside = beside(1.35);
  assert.deepEqual([outside.world.interactTarget, outside.world.prompt, outside.world.player.carrying], [null, null, null]);
  outside.e();
  assert.deepEqual([outside.seen, outside.world.player.carrying], [[], null]);

  const corner = open('cells', 'near');             // 1 west and 1 above the cell's corner: 1.41 between the closest points
  corner.warp(3 - 1 - PLAYER.w / 2, CELL.h + 1 + PLAYER.gravity * DT * DT);   // ILO falls one step before E looks
  corner.run(1);
  assert.deepEqual([corner.world.interactTarget, corner.world.prompt], [null, null]);

  const t = open('cells', 'near');
  t.run(1);
  assert.deepEqual(t.world.interactTarget, { kind: 'pickup', id: 'c1', x: 3.5, y: 0 });
  assert.deepEqual(t.world.prompt, { key: 'E', text: 'Pick Up Cell' });
  const c1 = byId(t.world.cells, 'c1');
  t.e();
  assert.deepEqual(t.seen, [{ type: 'cellPickup', id: 'c1' }]);
  assert.deepEqual([t.world.player.carrying, c1.state, c1.socket, c1.x, c1.y], ['c1', 'carried', null, 3.5, 0]);
  assert.deepEqual(t.world.interactTarget, { kind: 'place', id: 'c1', x: 4.6 - 1, y: 0 });   // c4 blocks the front
  assert.deepEqual(t.world.prompt, { key: 'E', text: 'Place Cell' });
  assertCells(t.world);

  const both = open('cells', 'between');            // c1 at 3.5 and c4 at 6 are both within reach
  both.run(1);
  assert.deepEqual(both.world.interactTarget, { kind: 'pickup', id: 'c4', x: 6, y: 0 });
});

test('Cells: a carried cell caps the speed at 4.5, keeps the jump and rules out dash, pulse, wall slide and wall jump', () => {
  const t = open('cells', 'near');
  const p = t.world.player;
  t.e();                                            // carry c1
  t.clear();
  t.run(30, press({ left: true }));
  near(p.vx, -PLAYER.carrySpeed);
  t.clear();
  t.step(press({ left: true, dashPressed: true, pulsePressed: true }));
  assert.deepEqual(quiet(t.seen), []);
  assert.deepEqual([p.dashT, p.pulseCd, p.energy], [0, 0, PULSE.max]);
  t.clear();
  const from = [p.x, p.y];
  t.step(press({ left: true, jump: true, jumpPressed: true }));
  assert.deepEqual(quiet(t.seen), [{ type: 'jump', x: from[0], y: from[1], wall: 0 }]);
  near(p.vy, PLAYER.jumpSpeed - PLAYER.gravity * DT);
  t.until((w) => w.player.grounded);
  assert.equal(p.carrying, 'c1');

  t.warp(11, 0);                                    // the wall at x 12 is 0.625 units east
  t.until((w) => w.player.wall === 1, press({ right: true }));
  t.run(4, press({ right: true }));
  assert.equal(p.x, 11.625);
  t.clear();
  const feet = [p.x, p.y];
  t.step(press({ right: true, jump: true, jumpPressed: true }));
  assert.deepEqual(quiet(t.seen), [{ type: 'jump', x: feet[0], y: feet[1], wall: 0 }]);
  t.run(12, press({ right: true }));
  assert.deepEqual([p.grounded, p.wall, p.sliding], [false, 1, false]);   // at the wall, not sliding
  t.clear();
  t.step(press({ right: true, jump: true, jumpPressed: true }));         // no wall jump while carrying
  assert.deepEqual(of(t.seen, 'jump'), []);
  let fastest = 0;
  t.until((w) => w.player.grounded, press({ right: true }), (w) => { fastest = Math.min(fastest, w.player.vy); });
  assert.deepEqual(of(t.seen, 'jump'), []);                              // nor when the jump buffer runs out
  assert.ok(fastest < -PLAYER.wallSlideSpeed, `ILO fell at up to ${-fastest}: faster than a wall slide`);
  assert.equal(p.carrying, 'c1');
});

test('Cells: a carried cell is put down 1 unit in front, behind when the front is taken', () => {
  const c1 = (t) => byId(t.world.cells, 'c1');
  const carry = (spot) => {
    const t = open('cells', 'near');
    t.e();
    t.warp(...SPOTS.cells[spot]);
    t.run(1);
    return t;
  };
  const front = carry('free');
  const x = 15.5;
  assert.deepEqual(front.world.interactTarget, { kind: 'place', id: 'c1', x: x + 1, y: 0 });
  assert.deepEqual(front.world.prompt, { key: 'E', text: 'Place Cell' });
  front.clear();
  front.e();
  assert.deepEqual(of(front.seen, 'cellDrop'), [{ type: 'cellDrop', id: 'c1', x: x + 1, y: 0 }]);
  assert.deepEqual([c1(front).state, c1(front).x, c1(front).y, front.world.player.carrying], ['loose', x + 1, 0, null]);
  assert.deepEqual(front.world.interactTarget, { kind: 'pickup', id: 'c1', x: x + 1, y: 0 });   // within reach again
  assertCells(front.world);

  for (const [spot, what] of [['wallFront', 'a wall'], ['pitFront', 'a pit']]) {
    const t = carry(spot);
    t.face(-1);                                    // the obstacle is in front, free ground behind
    const { x: px } = t.world.player;
    assert.deepEqual(t.world.interactTarget, { kind: 'place', id: 'c1', x: px + 1, y: 0 }, what);
    t.clear();
    t.e();
    assert.deepEqual(of(t.seen, 'cellDrop'), [{ type: 'cellDrop', id: 'c1', x: px + 1, y: 0 }], what);
    assert.deepEqual([c1(t).state, c1(t).x, c1(t).y], ['loose', px + 1, 0]);
    assertCells(t.world);
  }

  for (const [spot, x] of [['wallPit', 12], ['overPit', 21.2]]) {       // a wall in front and a pit behind, and the reverse
    const t = carry(spot);
    assert.deepEqual(t.world.interactTarget, { kind: 'place', id: 'c1', x, y: 0 });   // offered...
    t.clear();
    t.e();
    t.e();
    assert.deepEqual(handling(t.seen), ['cellReject', 'cellReject']);               // ...and refused twice
    assert.deepEqual([t.world.player.carrying, c1(t).state, c1(t).x, c1(t).y], ['c1', 'carried', 3.5, 0]);
    assertCells(t.world);
  }

  const jet = carry('jet');                         // a vent jet in front, a wall behind
  const v1 = byId(jet.world.vents, 'v1');
  jet.until(() => v1.stage === 'dormant' && v1.t >= 3.5);
  assert.deepEqual(jet.world.interactTarget, { kind: 'place', id: 'c1', x: 27.6, y: 0 });
  jet.clear();
  jet.e();                                          // a dormant jet is no obstacle
  assert.deepEqual(of(jet.seen, 'cellDrop'), [{ type: 'cellDrop', id: 'c1', x: 27.6, y: 0 }]);
  jet.e();                                          // and ILO takes the cell back
  assert.equal(jet.world.player.carrying, 'c1');
  jet.clear();
  jet.until(() => v1.stage === 'active');
  assert.deepEqual(jet.world.hazards, [{ kind: 'vent', x: 27, y: 0, w: 1, h: 3, sx: 27.5, sy: 3 }]);
  jet.e();
  assert.deepEqual(handling(jet.seen), ['cellReject']);
  assert.deepEqual([jet.world.player.carrying, c1(jet).state, jet.world.player.hp], ['c1', 'carried', 3]);
  assertCells(jet.world);
});

test('Cells: a carried cell fills an empty socket in reach; E again takes it out and the socket powers down', () => {
  const t = open('cells', 'near');
  t.e();                                            // carry c1
  t.warp(30.5, 0);                                  // beside the empty s1, out of reach of c2 at 33
  t.run(1);
  assert.deepEqual(t.world.interactTarget, { kind: 'insert', id: 's1', x: 31.6, y: 0 });
  assert.deepEqual(t.world.prompt, { key: 'E', text: 'Insert Cell' });
  const c1 = byId(t.world.cells, 'c1');
  const s1 = byId(t.world.sockets, 's1');
  assert.equal(s1.powered, false);
  t.clear();
  t.e();
  assert.deepEqual(handling(t.seen), ['cellInsert', 'socketPower']);   // the socket answers on the next step
  assert.deepEqual(of(t.seen, 'cellInsert'), [{ type: 'cellInsert', id: 'c1', socketId: 's1' }]);
  assert.deepEqual(of(t.seen, 'socketPower'), [{ type: 'socketPower', id: 's1', on: true }]);
  assert.deepEqual([c1.state, c1.socket, c1.x, c1.y, t.world.player.carrying], ['socketed', 's1', 31.6, 0, null]);
  assert.deepEqual([s1.cell, s1.powered], ['c1', true]);
  assert.deepEqual(t.world.interactTarget, { kind: 'remove', id: 'c1', x: 31.6, y: 0 });
  assert.deepEqual(t.world.prompt, { key: 'E', text: 'Remove Cell' });
  assertCells(t.world);
  t.clear();
  t.e();
  assert.deepEqual(handling(t.seen), ['cellRemove', 'socketPower']);
  assert.deepEqual(of(t.seen, 'cellRemove'), [{ type: 'cellRemove', id: 'c1', socketId: 's1' }]);
  assert.deepEqual(of(t.seen, 'socketPower'), [{ type: 'socketPower', id: 's1', on: false }]);
  assert.deepEqual([c1.state, c1.socket, s1.cell, s1.powered, t.world.player.carrying], ['carried', null, null, false, 'c1']);
  assertCells(t.world);
});

test('Cells: a loose cell in reach comes before a socketed one; a full socket takes no second cell', () => {
  const t = open('cells', 'atS2');
  const s2 = byId(t.world.sockets, 's2');
  const c2 = byId(t.world.cells, 'c2');
  const c3 = byId(t.world.cells, 'c3');
  t.run(1);
  assert.deepEqual(t.world.interactTarget, { kind: 'pickup', id: 'c2', x: 33, y: 0 });   // c2 loose, s2 empty: the cell first
  t.e();                                            // pick up c2
  assert.deepEqual(t.world.interactTarget, { kind: 'insert', id: 's2', x: 35.6, y: 0 });
  t.e();                                            // and fill s2 with it
  assert.deepEqual([s2.cell, c2.state, s2.powered], ['c2', 'socketed', true]);
  assert.deepEqual(t.world.interactTarget, { kind: 'remove', id: 'c2', x: 35.6, y: 0 });
  t.warp(36.1, 0);                                  // c3 lies loose within reach, s2 is close too
  t.run(1);
  assert.deepEqual(t.world.interactTarget, { kind: 'pickup', id: 'c3', x: 37, y: 0 });   // the loose cell first
  t.e();
  assert.equal(t.world.player.carrying, 'c3');
  assert.deepEqual(t.world.interactTarget, { kind: 'place', id: 'c3', x: 37.1, y: 0 });   // s2 is full: no insert
  t.e();
  assert.deepEqual([s2.cell, c3.state, c3.x], ['c2', 'loose', 37.1]);
  assertCells(t.world);
});

test('Cells: one E press is one action: a held E never inserts and removes', () => {
  const t = open('cells', 'near');
  t.e();                                            // carry c1
  t.warp(30.9, 0);
  t.run(1);
  t.clear();
  t.run(240, press({ interactPressed: true }));     // E goes down and stays down for two seconds
  assert.deepEqual(handling(t.seen), ['cellInsert', 'socketPower']);
  assert.deepEqual([byId(t.world.sockets, 's1').cell, t.world.player.carrying], ['c1', null]);
  assertCells(t.world);

  const held = open('cells', 'near');
  held.run(240, press({ interactPressed: true }));  // held from the first step on: one pickup, nothing more
  assert.deepEqual(handling(held.seen), ['cellPickup']);
  assert.deepEqual([held.world.player.carrying, byId(held.world.cells, 'c1').x], ['c1', 3.5]);
});

test('Cells: repeated presses and recoveries never duplicate or lose a cell', () => {
  const t = open('cells', 'near');
  const c1 = byId(t.world.cells, 'c1');
  const s1 = byId(t.world.sockets, 's1');
  t.e();                                            // carry c1
  t.warp(30.5, 0);
  for (let i = 0; i < 4; i += 1) {                  // insert, remove, insert, remove
    t.e();
    assertCells(t.world);
  }
  assert.deepEqual([t.world.player.carrying, s1.cell], ['c1', null]);
  t.e();                                            // inserted for the commit
  assert.equal(s1.cell, 'c1');
  commitCheckpoint(t.world, null);                  // no station in this level: commit by hand
  assert.deepEqual(t.world.checkpoint.snap.objects.cells, [['socketed', 31.6, 0], ['loose', 6, 0], ['loose', 33, 0], ['loose', 37, 0]]);
  t.e();                                            // taken out again after the commit
  assert.equal(t.world.player.carrying, 'c1');
  t.step(press({ retryPressed: true }));
  t.until((w) => w.mode === 'play');
  assert.deepEqual(of(t.seen, 'reboot'), [{ type: 'reboot', stationId: null, x: 1.5, y: 0 }]);
  assert.deepEqual([c1.state, c1.socket, s1.cell, t.world.player.carrying], ['socketed', 's1', 'c1', null]);
  assertCells(t.world);
  t.warp(30.5, 0);                                  // beside the socket, out of c2's reach
  t.e();                                            // out of the socket once more
  t.warp(28.6, 0);
  t.run(1);
  assert.deepEqual(t.world.interactTarget, { kind: 'place', id: 'c1', x: 29.6, y: 0 });
  t.e();                                            // and left on the ground elsewhere
  assert.equal(c1.state, 'loose');
  t.step(press({ retryPressed: true }));
  t.until((w) => w.mode === 'play');
  assert.deepEqual([c1.state, c1.x, s1.cell], ['socketed', 31.6, 'c1']);
  assertCells(t.world);
});

// --- Puzzles ---

test('Workshop circuit: carry the cell, insert it, the shutter opens, the pulse reaches Relay A and the checkpoint moves', () => {
  const t = open('workshop');
  const { world } = t;
  const shutter = byId(world.movers, 'shA');
  const relay = byId(world.relays, 'A');
  const road = { x: 15.6, y: 0, w: 7.4, h: 1.5 };   // from the socket to the node of Relay A
  assert.deepEqual([world.checkpoint.stationId, shutter.powered, shutter.t], ['st0', false, 0]);
  t.walkTo(5.6);
  assert.deepEqual(world.interactTarget, { kind: 'archive', id: 'A', x: 6.5, y: 0 });
  assert.deepEqual(world.prompt, { key: 'E', text: 'Read Archive' });
  t.clear();
  t.e();
  assert.deepEqual(of(t.seen, 'archive'), [{ type: 'archive', id: 'A', title: 'A title', text: 'A text' }]);
  t.walkTo(9.4);
  assert.deepEqual(world.interactTarget, { kind: 'pickup', id: 'c1', x: 10.5, y: 0 });
  t.e();
  assert.equal(world.player.carrying, 'c1');
  t.walkTo(13.6);
  assert.deepEqual(world.interactTarget, { kind: 'insert', id: 'sA', x: 14.5, y: 0 });
  assert.deepEqual(world.prompt, { key: 'E', text: 'Insert Cell' });
  t.clear();
  t.e();
  assert.deepEqual(handling(t.seen), ['cellInsert', 'socketPower']);
  assert.equal(shutter.powered, true);
  assert.equal(roadOpen(world, road), false);       // the shutter is still closed
  t.until(() => shutter.t === 1);
  assert.deepEqual(of(t.seen, 'shutterStop'), [{ type: 'shutterStop', id: 'shA', open: true }]);
  near(shutter.y, 3);
  assert.equal(roadOpen(world, road), true);        // the route to the relay is open
  t.walkTo(20.5);
  assert.equal(roadOpen(world, road), true);
  const { x } = world.player;
  t.clear();
  t.pulse();
  t.reached();
  assert.deepEqual(of(t.seen, 'pulse'), [{ type: 'pulse', x, y: 0.75 }]);
  assert.deepEqual([relay.active, world.checkpoint.stationId], [true, 'stA']);
  assert.deepEqual(of(t.seen, 'relay'), [{ type: 'relay', id: 'A', x: 23.5, y: 1.2, lookAt: { x: 18.25, y: 1.5 } }]);
  assert.deepEqual(world.camera.lookAt, { x: 18.25, y: 1.5 });
  assert.deepEqual([byId(world.stations, 'st0').active, byId(world.stations, 'stA').active], [true, true]);
  assert.deepEqual(world.checkpoint.snap.objects, {
    relays: ['A'], stations: ['st0', 'stA'], sockets: ['c1'], switches: [], cells: [['socketed', 14.5, 0], ['loose', 33.5, 0]],
    archives: ['A'], caches: [], idle: true,
  });
  t.run(60);
  near(world.camera.lookT, world.modeTime);
  assert.deepEqual([world.prompt, world.interactTarget], [null, null]);
  near(world.player.x, x);
  t.until((w) => w.mode === 'play');
  assert.deepEqual([world.camera.lookAt, world.camera.lookT], [null, 0]);   // the look is over
  assert.equal(roadOpen(world, road), true);        // and still open after the relay
  assert.deepEqual([shutter.powered, shutter.t, world.prompt, world.recoveries], [true, 1, null, 0]);
  assertCells(world);
});

test('Workshop: recovery after Relay A restores the relay, the open shutter and the filled socket together', () => {
  const t = open('workshop');
  const { world } = t;
  const shutter = byId(world.movers, 'shA');
  circuit(t);
  t.until((w) => w.mode === 'play');
  t.clear();
  t.step(press({ retryPressed: true }));
  t.until((w) => w.mode === 'play');
  const sA = byId(world.sockets, 'sA');
  assert.deepEqual([byId(world.relays, 'A').active, sA.cell, sA.powered], [true, 'c1', true]);
  assert.deepEqual([shutter.powered, shutter.t, shutter.y], [true, 1, 3]);
  assert.equal(roadOpen(world, { x: 15.6, y: 0, w: 7.4, h: 1.5 }), true);
  assert.equal(byId(world.archives, 'A').collected, true);
  assert.deepEqual([world.checkpoint.stationId, world.recoveries], ['stA', 1]);
  assert.deepEqual(of(t.seen, 'reboot'), [{ type: 'reboot', stationId: 'stA', x: 27.5, y: 0 }]);
  near(world.player.x, 27.5);
  t.run(120);
  assert.deepEqual(of(t.seen, 'station'), []);     // rebooting at a station is no new visit
  assert.deepEqual([shutter.t, byId(world.relays, 'A').active], [1, true]);
  assertCells(world);
});

test('Workshop: what changed after the relay commit rolls back; the archive from before it stays', () => {
  const t = open('workshop');
  const { world } = t;
  const p = world.player;
  circuit(t);
  t.until((w) => w.mode === 'play');
  const seam = byId(world.seams, 'seamA');
  const c2 = byId(world.cells, 'c2');
  t.walkTo(29.8);                                   // through the station, up to the seam
  assert.equal(byId(world.stations, 'stA').active, true);
  t.face(1);                                       // toward the seam
  t.clear();
  t.step(press({ dashPressed: true }));
  t.run(30);
  assert.deepEqual(of(t.seen, 'seamBreak'), [{ type: 'seamBreak', id: 'seamA', x: 31.25, y: 1.5 }]);
  assert.equal(seam.broken, true);
  assert.ok(p.x > 31.5);
  t.walkTo(32.6);                                   // stopped by c2 at 33.5
  t.e();                                            // carry it
  t.walkTo(31);
  t.face(-1);
  t.e();                                            // and leave it 3.5 units west of its home
  assert.equal(c2.state, 'loose');
  near(c2.x, 30, 0.12);
  t.walkTo(35.6);
  t.e();                                            // archive B
  t.walkTo(37.9);
  t.e();                                            // cache k1
  assert.deepEqual([byId(world.archives, 'B').collected, byId(world.caches, 'k1').collected], [true, true]);
  t.step(press({ retryPressed: true }));
  t.until((w) => w.mode === 'play');
  assert.deepEqual([seam.broken, c2.state, c2.x, c2.y], [false, 'loose', 33.5, 0]);
  assert.deepEqual([byId(world.archives, 'A').collected, byId(world.archives, 'B').collected], [true, false]);
  assert.deepEqual([byId(world.caches, 'k1').collected, byId(world.relays, 'A').active], [false, true]);
  assert.deepEqual([byId(world.sockets, 'sA').cell, p.carrying, p.x], ['c1', null, 27.5]);
  assertCells(world);
});

test('Workshop: the shutter never closes through ILO or a loose cell; it closes once the lane is clear', () => {
  const t = open('workshop');
  const { world } = t;
  const shutter = byId(world.movers, 'shA');
  circuit(t);
  t.until((w) => w.mode === 'play');
  t.walkTo(13.6);
  t.until(() => shutter.t === 1);
  t.e();                                            // the cell leaves the socket
  assert.equal(shutter.powered, false);
  t.warp(18.25, 0);                                 // into the doorway before the shutter moves
  t.clear();
  t.until(() => shutter.blocked);
  near(shutter.y, 1.5);                             // it rests on ILO's head
  t.run(60);
  assert.deepEqual([shutter.blocked, shutter.moving, world.player.hp, world.recoveries], [true, false, 3, 0]);
  near(shutter.y, 1.5);
  t.clear();
  t.warp(15, 0);                                    // out of the lane
  t.until(() => shutter.t === 0);
  assert.deepEqual(of(t.seen, 'shutterStop'), [{ type: 'shutterStop', id: 'shA', open: false }]);
  assert.deepEqual([shutter.blocked, shutter.y], [false, 0]);

  const l = open('workshop');                       // the same with a loose cell in the lane
  const head = byId(l.world.movers, 'shA');
  const c1 = byId(l.world.cells, 'c1');
  const c2 = byId(l.world.cells, 'c2');
  circuit(l);
  l.until((w) => w.mode === 'play');
  l.warp(32.6, 0);
  l.run(1);
  assert.deepEqual(l.world.interactTarget, { kind: 'pickup', id: 'c2', x: 33.5, y: 0 });
  l.e();
  l.face(1);
  l.warp(17.25, 0);
  l.run(1);
  assert.deepEqual(l.world.interactTarget, { kind: 'place', id: 'c2', x: 18.25, y: 0 });   // the open shutter is above
  l.e();
  l.warp(13.6, 0);
  l.e();                                            // the socket empties: the shutter comes down on the loose cell
  l.until(() => head.blocked);
  near(head.y, 1.1);                                // on the cell's top: the cell is not pushed down
  assert.deepEqual([c2.state, c2.x, l.world.player.hp], ['loose', 18.25, 3]);
  near(c2.y, 0);
  l.run(60);
  assert.deepEqual([head.blocked, head.moving], [true, false]);
  near(head.y, 1.1);
  near(c2.y, 0);
  l.warp(25, 0);                                    // c1 out of ILO's hands, away from the empty socket
  l.run(1);
  l.e();
  assert.deepEqual([c1.state, c1.x], ['loose', 26]);
  l.warp(17.3, 0);
  l.run(1);
  assert.deepEqual([l.world.interactTarget.kind, l.world.interactTarget.id, l.world.interactTarget.x], ['pickup', 'c2', 18.25]);   // y: 4e-15 into the floor, the core's nudge under the shutter
  near(l.world.interactTarget.y, 0);
  l.e();                                            // a carried cell is not solid: the lane is clear
  l.until(() => head.t === 0);
  assert.deepEqual([head.y, head.blocked, l.world.player.hp, l.world.recoveries], [0, false, 3, 0]);
  assertCells(l.world);
});

test('Reservoir bridge: the switch latches the platform, it runs, and the crossing over the water works', () => {
  const t = open('reservoir', 'inShaft');
  const { world } = t;
  const p = world.player;
  const platform = byId(world.movers, 'pB');
  const latch = byId(world.switches, 'swB');
  const road = { x: 0, y: 0, w: 31.2, h: 1.5 };     // the ground route up to the water
  assert.deepEqual([platform.powered, platform.t, platform.x, roadOpen(world, road)], [false, 0, 32, true]);
  t.run(240);
  assert.deepEqual([platform.powered, platform.moving, platform.t], [false, false, 0]);   // no power: it waits
  climbShaft(t);
  assert.deepEqual([p.grounded, p.y], [true, 7]);
  t.walkTo(21.5);
  t.run(1);
  assert.deepEqual(world.interactTarget, { kind: 'switch', id: 'swB', x: 21.5, y: 7 });
  assert.deepEqual(world.prompt, { key: 'E', text: 'Activate Switch' });
  t.clear();
  t.e();
  assert.deepEqual(of(t.seen, 'switch'), [{ type: 'switch', id: 'swB', x: 21.5, y: 7 }]);
  assert.equal(latch.on, true);
  t.run(1);
  assert.equal(platform.powered, true);
  t.until(() => platform.t > 0.1);
  assert.equal(platform.moving, true);
  t.until((w) => w.player.grounded && w.player.y === 0, press({ right: true }));   // down from the ledge
  t.walkTo(31.2);
  assert.equal(roadOpen(world, road), true);
  t.until(() => platform.t === 0 && platform.wait > 0.6);                          // resting at the near end
  t.until(() => p.x > 33.2, press({ right: true }));                               // step aboard
  t.until(() => Math.abs(p.vx) < 0.01);
  assert.equal(p.onMover, 'pB');
  t.until(() => platform.moving);                                                  // it departs with ILO aboard
  const [ix, mx] = [p.x, platform.x];
  t.until(() => platform.t === 1);
  near(p.x - ix, platform.x - mx);
  assert.deepEqual([p.onMover, p.y, platform.x], ['pB', 0, 41]);
  t.until(() => p.x > 44.9, press({ right: true }));                               // off onto the far bank
  t.until(() => p.onMover === null && p.grounded);
  t.walkTo(46);
  assert.deepEqual([p.y, world.recoveries, latch.on], [0, 0, true]);
  t.clear();
  t.pulse();
  t.reached();
  assert.equal(byId(world.relays, 'B').active, true);
  assert.equal(world.checkpoint.stationId, 'stB');
  assert.deepEqual(of(t.seen, 'relay'), [{ type: 'relay', id: 'B', x: 49.5, y: 1.2, lookAt: { x: 36.5, y: 1 } }]);
  t.until((w) => w.mode === 'play');
  assert.deepEqual([platform.powered, latch.on], [true, true]);                    // the way back still runs
});

test('Foundry counterweight: the cell lifts the cabin, the upper switch latches the route, the cell goes on to Relay C', () => {
  const t = open('foundry');
  const { world } = t;
  const p = world.player;
  const [cab, shU] = [byId(world.movers, 'cab'), byId(world.movers, 'shU')];
  const upper = { x: 24, y: 4.6, w: 0.5, h: 3 };    // the shutter's lane on the walkway
  const lower = { x: 11.6, y: 0, w: 18.6, h: 3 };    // the road under the walkway
  assert.deepEqual([cab.powered, cab.t, cab.y, shU.powered, shU.t], [false, 0, 0, false, 0]);
  t.walkTo(2.4);
  t.e();                                            // carry the cell
  t.walkTo(10.5);                                   // onto the cabin
  assert.deepEqual([p.onMover, p.y], ['cab', 0.6]);
  t.run(1);
  assert.deepEqual(world.interactTarget, { kind: 'insert', id: 'sLift', x: 11.6, y: 0 });
  t.e();                                            // the counterweight: the cabin rises with ILO on it
  t.run(96);
  near(cab.y, 2, 0.01);
  near(p.y, 2.6, 0.01);
  assert.equal(p.onMover, 'cab');
  t.until(() => cab.t === 1);
  assert.deepEqual([cab.y, cab.powered, p.y, p.onMover], [4, true, 4.6, 'cab']);
  near(p.x, 10.5, 0.12);
  t.walkTo(16);                                     // onto the walkway, up to the switch
  assert.deepEqual([p.onMover, roadOpen(world, upper)], [null, false]);   // the upper shutter still bars the way
  near(p.y, 4.6);
  t.run(1);
  assert.deepEqual(world.interactTarget, { kind: 'switch', id: 'swU', x: 16, y: 4.6 });
  t.e();                                            // latched for good
  assert.equal(byId(world.switches, 'swU').on, true);
  assert.equal(shU.powered, true);
  t.until(() => shU.t === 1);
  near(shU.y, 7.6);
  assert.equal(roadOpen(world, upper), true);

  t.walkTo(10.5);                                   // back over the cabin
  t.until((w) => w.player.grounded && w.player.y === 0.6, press({ left: true }));   // and down to the dock
  t.walkTo(10.5);                                   // under the raised cabin, on the ground
  near(p.y, 0);
  assert.equal(roadOpen(world, lower), true);
  t.run(1);
  assert.deepEqual(world.interactTarget, { kind: 'remove', id: 'c1', x: 11.6, y: 0 });
  t.e();                                            // the counterweight leaves: the cabin sinks
  t.until(() => p.x > 11.6, press({ right: true }));                              // ILO steps clear in time
  t.until(() => cab.t === 0);
  assert.deepEqual([cab.y, cab.powered, p.hp, p.carrying], [0, false, 3, 'c1']);
  assert.deepEqual([shU.t, shU.powered, byId(world.switches, 'swU').on], [1, true, true]);   // the route stays open
  assert.deepEqual([roadOpen(world, upper), roadOpen(world, lower)], [true, true]);

  t.walkTo(37.4);                                   // along the ground under the walkway to the relay socket
  t.run(1);
  assert.deepEqual(world.interactTarget, { kind: 'insert', id: 'sRelay', x: 38.6, y: 0 });
  t.clear();
  t.e();
  assert.deepEqual(handling(t.seen), ['cellInsert', 'socketPower']);
  assert.equal(roadOpen(world, lower), true);
  t.walkTo(40.5);
  t.clear();
  t.pulse();
  t.reached();
  assert.deepEqual([byId(world.relays, 'C').active, world.checkpoint.stationId], [true, 'stC']);
  assert.deepEqual(of(t.seen, 'relay'), [{ type: 'relay', id: 'C', x: 42.5, y: 1.2, lookAt: { x: 24.25, y: 6 } }]);
  t.until((w) => w.mode === 'play');
  assert.deepEqual([world.camera.lookAt, byId(world.stations, 'stC').active], [null, true]);
  assert.deepEqual([cab.t, shU.t, byId(world.switches, 'swU').on, byId(world.sockets, 'sRelay').cell], [0, 1, true, 'c1']);
  assert.deepEqual([roadOpen(world, upper), roadOpen(world, lower)], [true, true]);
  assert.equal(world.recoveries, 0);
  assertCells(world);

  t.step(press({ retryPressed: true }));           // the relay commit holds all of it
  t.until((w) => w.mode === 'play');
  assert.deepEqual([byId(world.relays, 'C').active, shU.t, shU.powered, cab.t], [true, 1, true, 0]);
  assert.deepEqual([byId(world.switches, 'swU').on, byId(world.sockets, 'sRelay').cell, world.player.x], [true, 'c1', 46.5]);
});

test('Foundry: a pulse on Relay C before its socket is powered reports relayUnpowered and activates nothing', () => {
  const t = open('foundry', 'relay');
  const { world } = t;
  const relay = byId(world.relays, 'C');
  t.pulse();
  t.run(60);
  assert.deepEqual(of(t.seen, 'relayUnpowered'), [{ type: 'relayUnpowered', id: 'C' }]);
  assert.deepEqual([relay.active, world.mode, world.checkpoint.stationId, world.camera.lookAt], [false, 'play', 'st0', null]);
  assert.deepEqual([of(t.seen, 'relay'), byId(world.stations, 'stC').active], [[], false]);
  near(world.player.energy, PULSE.max - PULSE.cost);   // the pulse itself was spent
});

// --- Stations, relays and checkpoints ---

test('Stations: entering the range repairs, refills, emits station and moves the checkpoint; 2.5 units away re-arms it', () => {
  const t = open('stations', 'west');
  const { world } = t;
  const p = world.player;
  const st1 = byId(world.stations, 'st1');
  assert.deepEqual([world.checkpoint.stationId, st1.active, st1.armed], ['st0', false, true]);
  Object.assign(p, { hp: 1, energy: 10, regenDelay: 5 });
  t.walkTo(18.6);
  assert.deepEqual([st1.inRange, p.hp, p.energy, of(t.seen, 'station')], [false, 1, 10, []]);
  t.walkTo(20.3);
  assert.deepEqual([st1.active, st1.inRange, st1.armed, p.hp, p.energy], [true, true, false, 3, 100]);
  assert.deepEqual(of(t.seen, 'station'), [{ type: 'station', id: 'st1', x: 20.5, y: 0 }]);
  assert.equal(world.checkpoint.stationId, 'st1');
  t.run(60);
  Object.assign(p, { hp: 2, energy: 40, regenDelay: 5 });
  t.walkTo(22.3);
  assert.equal(st1.inRange, false);
  t.walkTo(20.5);                                   // back inside: no new visit
  assert.equal(of(t.seen, 'station').length, 1);
  assert.deepEqual([p.hp, p.energy, world.checkpoint.stationId], [2, 40, 'st1']);
  t.walkTo(23.4);
  t.walkTo(20.5);                                   // 2.5 units away armed it again
  assert.equal(of(t.seen, 'station').length, 2);
  assert.deepEqual([p.hp, p.energy], [3, 100]);

  t.walkTo(44.3);                                   // a higher-order station takes the checkpoint
  assert.deepEqual([of(t.seen, 'station').length, world.checkpoint.stationId], [3, 'st2']);
  const snap = world.checkpoint.snap;
  t.walkTo(20.5);                                   // a lower-order one docks, but never moves it back
  assert.deepEqual([of(t.seen, 'station').length, world.checkpoint.stationId, world.checkpoint.snap !== snap], [4, 'st2', true]);
  t.step(press({ retryPressed: true }));
  t.until((w) => w.mode === 'play');
  near(p.x, 44.5);
});

test('Stations: an entry made under hit immunity docks once the immunity is over; a reboot drops the pending visit', () => {
  const t = open('stations', 'west');
  const p = t.world.player;
  const st1 = byId(t.world.stations, 'st1');
  Object.assign(p, { hp: 1, energy: 10, regenDelay: 5, immunity: 2.5 });
  t.walkTo(20.3);
  assert.deepEqual([st1.pending, st1.armed, p.hp, of(t.seen, 'station')], [true, false, 1, []]);
  t.walkTo(24);                                     // ILO is 3.5 units away...
  assert.deepEqual([st1.inRange, st1.pending, p.hp], [false, true, 1]);
  t.until((w) => w.player.immunity === 0);         // ...when the visit is still honoured
  assert.deepEqual(of(t.seen, 'station'), [{ type: 'station', id: 'st1', x: 20.5, y: 0 }]);
  assert.deepEqual([st1.pending, p.hp, p.energy, t.world.checkpoint.stationId], [false, 3, 100, 'st1']);
  t.run(60);
  assert.equal(of(t.seen, 'station').length, 1);

  const r = open('stations', 'west');
  Object.assign(r.world.player, { hp: 1, immunity: 1.2 });
  r.walkTo(20.3);
  assert.equal(byId(r.world.stations, 'st1').pending, true);
  r.step(press({ retryPressed: true }));
  r.until((w) => w.mode === 'play');
  assert.deepEqual([byId(r.world.stations, 'st1').pending, r.world.checkpoint.stationId, r.world.player.hp], [false, 'st0', 3]);
  r.clear();
  r.run(240);
  assert.deepEqual(of(r.seen, 'station'), []);     // ILO reboots at its station: no new visit
  r.walkTo(9.4);
  r.e();                                            // the cell on the road comes along
  r.walkTo(20.3);
  assert.deepEqual(of(r.seen, 'station'), [{ type: 'station', id: 'st1', x: 20.5, y: 0 }]);
});

test('Stations: a cell carried at the commit rests 1.2 units beside the checkpoint station after a recovery', () => {
  const t = open('stations');
  const c1 = byId(t.world.cells, 'c1');
  t.walkTo(9.4);
  t.e();                                            // carry c1
  t.walkTo(20.3);                                   // the station docks ILO with the cell in its hands
  assert.deepEqual([t.world.player.carrying, t.world.checkpoint.stationId, c1.state], ['c1', 'st1', 'carried']);
  assert.deepEqual(t.world.checkpoint.snap.objects.cells, [['carried', 10.5, 0], ['loose', 72.5, 0]]);
  t.step(press({ retryPressed: true }));
  t.until((w) => w.mode === 'play');
  assert.deepEqual([c1.state, c1.y, t.world.player.carrying], ['loose', 0, null]);
  near(c1.x, 21.7);
  near(t.world.player.x, 20.5);
  assertCells(t.world);

  const l = open('stations', 'east');               // the right side of st3 is a wall: the cell rests on the left
  const c2 = byId(l.world.cells, 'c2');
  l.walkTo(71.4);
  l.e();
  l.walkTo(76.3);
  assert.equal(l.world.checkpoint.stationId, 'st3');
  l.step(press({ retryPressed: true }));
  l.until((w) => w.mode === 'play');
  assert.deepEqual([c2.state, c2.x, l.world.player.carrying], ['loose', 75.3, null]);
  assertCells(l.world);

  const s = open('cells', 'near');                  // no station in this level: the commit is made by hand
  s.e();
  commitCheckpoint(s.world, null);
  s.step(press({ retryPressed: true }));
  s.until((w) => w.mode === 'play');
  near(byId(s.world.cells, 'c1').x, 2.7);           // beside the spawn
  near(s.world.player.x, 1.5);
  assertCells(s.world);
});

test('Checkpoints: a cell that lay where ILO reboots rests beside the station after a recovery', () => {
  // The real course. wsCell cannot reach st2 in hand: the shutter west of the station is closed. It is carried from here.
  const t = open('course');
  const { world } = t;
  const p = world.player;
  const station = byId(world.stations, 'st2');
  const cell = byId(world.cells, 'wsCell');
  const other = byId(world.cells, 'fndCell');
  t.warp(station.x - 1.1, station.y);
  t.face(1);
  Object.assign(cell, { state: 'carried', socket: null });
  p.carrying = cell.id;
  t.run(1);
  t.e();                                            // put down 1 unit ahead of ILO: inside the station's range
  near(cell.x, station.x - 0.1, 0.02);
  assert.deepEqual([cell.state, p.carrying], ['loose', null]);
  t.step(press({ right: true, jump: true, jumpPressed: true }));   // hop over the cell, east
  t.run(30, press({ right: true, jump: true }));
  t.walkTo(station.x + 2.7);                        // more than 2.5 units away: the station arms again
  assert.deepEqual([station.inRange, station.armed], [false, true]);
  t.until((w) => station.inRange, press({ left: true }));   // the return visit commits the cell where it lies
  assert.deepEqual(world.checkpoint.snap.objects.cells, [['loose', cell.x, cell.y], ['loose', other.x, other.y]]);
  t.run(1);
  t.step(press({ retryPressed: true }));
  t.until((w) => w.mode === 'play');
  assert.deepEqual(of(t.seen, 'reboot'), [{ type: 'reboot', stationId: 'st2', x: station.x, y: station.y }]);
  near(p.x, station.x);
  const body = bodyRect(cell.x, cell.y, cell.w, cell.h);
  assert.equal(overlaps(bodyRect(p.x, p.y), body), false, 'ILO reboots outside the cell');
  assert.deepEqual([cell.state, cell.socket, cell.y], ['loose', null, station.y]);
  near(cell.x, station.x + 1.2);                    // where a cell carried at a commit rests too
  assert.equal(staticHits(world, body).length, 0);  // free ground: no rock, mover, seam or other cell meets it
  assert.deepEqual(dynamicSolids(world).filter((s) => s.cell !== cell && overlaps(body, s)), []);
  assert.notEqual(groundBelow(world, body), null);
  assertCells(world);
});

test('Checkpoints: a death costs one recovery, retry adds one, the clock never rewinds, movers and vents reset', () => {
  const t = open('stations', 'pitEdge');
  const { world } = t;
  const [platform, vent] = [byId(world.movers, 'p1'), byId(world.vents, 'v1')];
  t.until(() => platform.t > 0.2);
  assert.ok(vent.t > 0);
  t.until((w) => w.mode === 'shutdown', press({ right: true }));
  const died = world.clock;
  assert.deepEqual(of(t.seen, 'shutdown'), [{ type: 'shutdown', cause: 'fall' }]);
  t.run(60);                                        // 0.5 s into a 1.2 s shutdown
  assert.deepEqual([world.mode, world.clock, world.recoveries], ['shutdown', died, 1]);
  t.until((w) => w.mode === 'reboot');
  assert.deepEqual([world.clock, world.cause, of(t.seen, 'shutdown').length, of(t.seen, 'reboot').length], [died, 'fall', 1, 1]);
  t.run(60);                                        // 0.5 s into a 0.9 s reboot
  assert.deepEqual([world.mode, world.clock], ['reboot', died]);
  t.until((w) => w.mode === 'play');
  near(world.clock, died + DT);                     // the step that returns to play is a play step
  assert.deepEqual([world.recoveries, world.player.hp, world.checkpoint.stationId], [1, 3, 'st0']);
  near(world.player.x, 2.5);
  near(world.player.energy, PULSE.max);
  assert.deepEqual([platform.t, platform.x, platform.y, platform.moving], [0, 50, 0.2, false]);
  near(platform.wait, platform.pauseA - DT);       // back at its start, one boarding step into its rest
  assert.equal(vent.stage, 'dormant');
  near(vent.t, DT);                                // the cycle restarted from zero with this step
  t.run(30);
  assert.ok(world.clock > died + DT);

  t.clear();
  const before = world.clock;
  t.step(press({ retryPressed: true }));
  assert.deepEqual([world.mode, world.cause, world.recoveries, world.clock], ['shutdown', 'retry', 2, before]);
  assert.deepEqual(of(t.seen, 'shutdown'), [{ type: 'shutdown', cause: 'retry' }]);
  t.until((w) => w.mode === 'play');
  near(world.clock, before + DT);                   // rewound by nothing
  assert.deepEqual([world.recoveries, platform.t], [2, 0]);
  near(vent.t, DT);
  t.run(30);
  assert.ok(world.clock > before + DT);
});

test('Relay: a pulse on a relay whose socket is empty reports relayUnpowered; the filled socket lets it activate', () => {
  const t = open('stations', 'west');
  const { world } = t;
  const relay = byId(world.relays, 'B');
  t.warp(38.3, 0);
  t.run(1);
  assert.deepEqual([world.interactTarget, world.prompt], [null, null]);   // the node itself is not an E target
  t.clear();
  t.pulse();
  t.run(60);
  assert.deepEqual(of(t.seen, 'relayUnpowered'), [{ type: 'relayUnpowered', id: 'B' }]);
  assert.deepEqual([relay.active, world.mode, world.checkpoint.stationId, world.camera.lookAt], [false, 'play', 'st0', null]);
  assert.deepEqual([of(t.seen, 'relay'), byId(world.stations, 'st2').active], [[], false]);

  const f = open('stations');
  f.walkTo(9.4);
  f.e();                                            // carry the cell to the relay socket
  f.walkTo(36.8);
  f.run(1);
  assert.deepEqual(f.world.interactTarget, { kind: 'insert', id: 'sB', x: 37.6, y: 0 });
  f.e();
  f.walkTo(38.3);
  f.clear();
  f.pulse();
  f.reached();
  assert.equal(byId(f.world.relays, 'B').active, true);
  assert.equal(f.world.checkpoint.stationId, 'st2');
  assert.deepEqual(of(f.seen, 'relay'), [{ type: 'relay', id: 'B', x: 40.5, y: 1.2, lookAt: { x: 37.6, y: 1 } }]);
  f.until((w) => w.mode === 'play');
  assert.deepEqual([f.world.camera.lookAt, byId(f.world.stations, 'st2').active], [null, true]);
});

// --- Exploration, vents and the press ---

test('Exploration: an archive event carries its title and text; a cache gives 25 energy up to 100 and still counts when full', () => {
  const t = open('workshop');
  t.walkTo(5.6);
  t.e();
  assert.deepEqual(of(t.seen, 'archive'), [{ type: 'archive', id: 'A', title: 'A title', text: 'A text' }]);
  assert.equal(byId(t.world.archives, 'A').collected, true);
  assert.deepEqual([t.world.interactTarget, t.world.prompt], [null, null]);   // read once
  t.run(240);
  assert.equal(of(t.seen, 'archive').length, 1);

  const salvage = (energy) => {
    const r = open('workshop');
    Object.assign(r.world.player, { x: 37.9, y: 0, energy, regenDelay: 5 });
    r.run(1);
    assert.deepEqual(r.world.interactTarget, { kind: 'cache', id: 'k1', x: 38.5, y: 0 });   // before archive B in reach
    assert.deepEqual(r.world.prompt, { key: 'E', text: 'Salvage Cache' });
    r.clear();
    r.e();
    return r;
  };
  const part = salvage(40);
  assert.deepEqual(of(part.seen, 'cache'), [{ type: 'cache', id: 'k1', gained: CACHE.energy }]);
  near(part.world.player.energy, 65);
  const cap = salvage(90);
  assert.deepEqual(of(cap.seen, 'cache'), [{ type: 'cache', id: 'k1', gained: 10 }]);
  near(cap.world.player.energy, PULSE.max);
  const full = salvage(100);
  assert.deepEqual(of(full.seen, 'cache'), [{ type: 'cache', id: 'k1', gained: 0 }]);
  assert.deepEqual([full.world.player.energy, byId(full.world.caches, 'k1').collected], [PULSE.max, true]);
  const next = { kind: 'archive', id: 'B', x: 36.5, y: 0 };   // the cache is gone: archive B is next in reach
  assert.deepEqual([part.world.interactTarget, full.world.interactTarget], [next, next]);   // salvaged once
});

test('Interact: of a cache and an archive both in reach, E acts on the nearer one, whatever the kind', () => {
  // The shelf above Relay B of the course: cache2 at x 132.5 and archive B at x 134.5 stand 2 units apart. The
  // course itself keeps cache2 in the side room of the Reservoir: this check's own copy of the world puts it here.
  const shelf = (x) => {
    const t = open('course');
    Object.assign(byId(t.world.caches, 'cache2'), { x: 132.5, y: 24 });
    t.warp(x, 24);
    t.run(1);
    return t;
  };
  const cache = { kind: 'cache', id: 'cache2', x: 132.5, y: 24 };
  const reader = shelf(134.5);                      // archive B underfoot, cache2 1.125 units away: both in reach
  assert.deepEqual([reader.world.interactTarget, reader.world.prompt], [{ kind: 'archive', id: 'B', x: 134.5, y: 24 }, { key: 'E', text: 'Read Archive' }]);
  reader.e();
  assert.deepEqual([byId(reader.world.archives, 'B').collected, byId(reader.world.caches, 'cache2').collected], [true, false]);
  assert.deepEqual(reader.world.interactTarget, cache);   // the cache is what is left in reach
  assert.deepEqual(shelf(133.1).world.interactTarget, cache);   // the cache underfoot: nearer than the archive, 0.5 away
  assert.deepEqual(shelf(133.5).world.interactTarget, cache);   // a tie, 0.125 each: the cache comes first
});

test('Vents: dormant first, a warning of 0.6 s, then a jet hazard equal to the jet rect', () => {
  const t = open('vents', 'besideV1');
  const vent = byId(t.world.vents, 'v1');
  const cues = () => of(t.seen, 'vent').filter((event) => event.id === 'v1');
  const jets = (w) => w.hazards.filter((hazard) => hazard.sx === vent.x);   // v2 is in earshot too
  const jet = { kind: 'vent', x: 13.5, y: 0, w: 1, h: 4, sx: 14, sy: 4 };
  assert.deepEqual([vent.t, vent.stage, t.world.hazards], [0, 'dormant', []]);
  t.run(456);                                       // 3.8 s: still dormant
  assert.deepEqual([vent.stage, jets(t.world), cues()], ['dormant', [], []]);
  t.until(() => vent.stage === 'warning');
  const warned = t.world.time;
  assert.deepEqual(cues(), [{ type: 'vent', id: 'v1', stage: 'warning', x: 14, y: 0 }]);
  assert.deepEqual(jets(t.world), []);              // the warning is harmless
  t.until(() => vent.stage === 'active');
  near(t.world.time - warned, 0.6, DT);             // the shortest warning the contract allows
  t.run(60, IDLE, (w) => assert.deepEqual(jets(w), [jet]));
  assert.equal(t.world.player.hp, 3);               // ILO stands beside the jet
  t.until(() => vent.stage === 'dormant');
  assert.deepEqual(cues().map((event) => event.stage), ['warning', 'active', 'dormant']);
  t.run(30);
  assert.deepEqual(jets(t.world), []);
});

test('Vents: a jet hit follows the shield rules: energy pays first, integrity when the meter is low', () => {
  const t = open('vents', 'inV2');
  const p = t.world.player;
  t.until((w) => of(t.seen, 'shield').length === 1);
  assert.deepEqual(of(t.seen, 'shield'), [{ type: 'shield', x: 24, y: 0 }]);
  assert.deepEqual([p.energy, p.hp, p.immunity, p.regenDelay, p.vx, p.vy], [50, 3, SHIELD.immunity, PULSE.regenDelay, 0, 0]);
  t.run(24);                                        // still inside the jet under immunity: nothing more
  assert.deepEqual([of(t.seen, 'shield').length, p.energy], [1, 50]);
  t.until((w) => of(t.seen, 'damage').length === 1);
  assert.equal(of(t.seen, 'shield').length, 2);     // the meter refilled enough for one more shield
  assert.deepEqual(of(t.seen, 'damage'), [{ type: 'damage', x: 24, y: 0, cause: 'vent' }]);
  assert.deepEqual([p.hp, p.immunity, p.regenDelay, p.vx, p.vy, p.stunT, t.world.recoveries],
    [2, DAMAGE.immunity, PULSE.regenDelay, -5, DAMAGE.knockY, DAMAGE.stun, 0]);
});

test('Press: warn, drop, then a crush recovery', () => {
  const t = open('vents', 'underPress');
  const pr = byId(t.world.movers, 'pr1');
  const cues = () => of(t.seen, 'press').map((event) => event.stage);
  near(pr.pauseA, 3.3875);                          // the rest of its period, never shorter than the warning
  near(pr.pauseB, 0.3);
  near(pr.speed, 8);
  t.run(1);
  assert.deepEqual([t.seen, pr.stage], [[], 'warn']);   // the head starts inside its warning: that is no change
  t.until((w) => of(t.seen, 'press').length === 1);     // the first drop, a second in
  assert.deepEqual(cues(), ['drop']);
  assert.equal(pr.moving, true);
  t.until((w) => w.mode === 'shutdown');
  assert.deepEqual(of(t.seen, 'crush'), [{ type: 'crush', x: 31.5, y: 0 }]);
  assert.deepEqual(of(t.seen, 'shutdown'), [{ type: 'shutdown', cause: 'crush' }]);
  assert.deepEqual([t.world.player.hp, t.world.player.energy], [RUN.integrity, PULSE.max]);   // a crush is no hit
  t.until((w) => w.mode === 'play');
  assert.deepEqual([t.world.recoveries, pr.t], [1, 0]);
  near(pr.wait, pr.pauseA - DT);
  assert.deepEqual(of(t.seen, 'reboot'), [{ type: 'reboot', stationId: 'st0', x: 2.5, y: 0 }]);
  assert.deepEqual([t.world.player.hp, t.world.player.x], [RUN.integrity, 2.5]);
  near(t.world.player.immunity, RUN.rebootImmunity - DT);   // set on entering play, one step older now

  t.warp(31.5, 0);                                  // back under the head for its next cycle
  t.clear();
  t.until((w) => of(t.seen, 'press').length === 1);
  assert.deepEqual(of(t.seen, 'press'), [{ type: 'press', id: 'pr1', stage: 'warn', x: 31.5, y: 4.25 }]);
  assert.deepEqual([pr.moving, pr.t, pr.y, pr.wait > 0.9], [false, 0, 3.5, true]);   // it warns while it rests up top
  t.run(60);                                        // half of its second of warning
  assert.deepEqual(cues(), ['warn']);
  t.until((w) => of(t.seen, 'press').length === 2);
  assert.deepEqual(cues(), ['warn', 'drop']);
  t.until((w) => w.mode === 'shutdown');
  assert.deepEqual([of(t.seen, 'crush').length, t.world.recoveries], [1, 2]);
  assert.deepEqual(cues(), ['warn', 'drop']);       // the rise comes after the squeeze
});

test('Press: the head that crushes ILO returns at once, without its rest, and runs its normal cycle again', () => {
  const t = open('course');
  const { world } = t;
  const head = byId(world.movers, 'fndPress1');
  placePlayer(world, 189.5, 30);                   // idle on the floor its head ends level with
  t.until((w) => w.mode === 'shutdown');           // the head drops after its first second and closes on idle ILO for 0.30 s
  const crushAt = world.step;
  const iloTop = world.player.y + PLAYER.h;
  assert.deepEqual([of(t.seen, 'crush'), of(t.seen, 'shutdown')], [[{ type: 'crush', x: 189.5, y: 30 }], [{ type: 'shutdown', cause: 'crush' }]]);
  // At once: from the step after the crush the head rises without a rest, until it is clear of ILO's top.
  let clearAt = null;
  let lastY = head.y;
  t.until((w) => head.t === 0, IDLE, (w) => {
    clearAt ??= head.y >= iloTop ? w.step : null;
    if (head.t > 0) assert.deepEqual([head.moving, head.wait, head.y > lastY], [true, 0, true], `step ${w.step}`);   // not the arrival step
    lastY = head.y;
  });
  const after = (clearAt - crushAt) * DT;
  assert.ok(after <= 0.2, `the head cleared ILO's top ${after.toFixed(3)} s after the crush`);   // 1.5 units at 8: 0.192 s
  assert.deepEqual([head.dir, head.wait, head.y >= iloTop], [1, head.pauseA, true]);   // up top it rests as after any rise
  // It stays clear through the rest of the shutdown; the recovery then resets it like every mover.
  t.until((w) => w.mode === 'reboot', IDLE, (w) => assert.deepEqual([head.moving, head.t, head.y >= iloTop], [false, 0, true]));
  assert.deepEqual([head.t, head.dir, head.wait, head.y], [0, 1, head.pauseA, head.fy]);
  // The cycle after the recovery is the normal one: rest pauseA, drop, rest pauseB, rise.
  t.until((w) => w.mode === 'play');
  const travel = Math.abs(head.ty - head.fy) / head.speed;
  const [rest, drop, down, rise] = [t.until((w) => head.moving), t.until((w) => head.t === 1), t.until((w) => head.y > head.ty), t.until((w) => head.t === 0)];
  near(rest * DT, head.pauseA, 2 * DT);
  near(drop * DT, travel, 2 * DT);
  near(down * DT, head.pauseB, 2 * DT);
  near(rise * DT, travel, 2 * DT);
  assert.deepEqual([head.dir, head.wait, of(t.seen, 'crush').length], [1, head.pauseA, 1]);
});

test('Press: a retry under the resting head leaves the head to its cycle', () => {
  const t = open('course');
  const ref = open('course');                      // the same world where R is not pressed
  const head = byId(t.world.movers, 'fndPress1');
  const refHead = byId(ref.world.movers, 'fndPress1');
  placePlayer(t.world, 189.5, 30);
  placePlayer(ref.world, 189.5, 30);
  t.run(30);
  ref.run(30);                                     // the head rests up top, 0.75 s before its first drop
  const pose = (m) => [m.t, m.dir, m.wait, m.x, m.y, m.moving];
  // Through the retry shutdown the head is step for step the head that saw no retry: no crush, no return stroke.
  t.step(press({ retryPressed: true }));
  ref.step();
  assert.deepEqual(pose(head), pose(refHead));
  t.until((w) => w.mode === 'reboot', IDLE, (w) => {
    ref.step();
    if (w.mode === 'shutdown') assert.deepEqual(pose(head), pose(refHead));
  });
  assert.deepEqual([of(t.seen, 'crush'), t.world.recoveries, t.world.cause], [[], 1, 'retry']);
  assert.deepEqual([head.t, head.dir, head.wait], [0, 1, head.pauseA]);   // the reset of any recovery
});

test('Press: a cycle announces warn, drop and rise once each, and rise on the first step the head moves up', () => {
  const t = open('course');
  const head = byId(t.world.movers, 'fndPress1');
  const cues = () => of(t.seen, 'press').map((event) => event.stage);
  placePlayer(t.world, 185, 30);                  // beside fndPress1, in earshot, never under its head
  // The head starts inside its first warning, which is no change of stage: the two cycles count from its first rise.
  t.until((w) => cues().includes('rise') && head.t === 0 && !head.moving);
  t.clear();
  let rising = false;                             // this rise has already had a step with a positive dy
  let seen = 0;
  t.until((w) => of(t.seen, 'press').length === 6, IDLE, (w) => {
    const cue = t.seen.slice(seen).find((event) => event.type === 'press');
    seen = t.seen.length;
    if (head.t === 1) rising = false;             // landed or resting at the bottom: the next rise is a new one
    if (cue?.stage === 'rise') assert.deepEqual([rising, head.dy > EPSILON], [false, true], `step ${w.step}`);
    if (head.dy > EPSILON) rising = true;
  });
  assert.deepEqual(cues(), ['warn', 'drop', 'rise', 'warn', 'drop', 'rise']);
});

// --- Pulse reveals and mover power ---

test('Pulse: a wave that reaches seams and reveal markers highlights them for 5 s and emits one reveal event', () => {
  const t = open('stations');
  const seam = byId(t.world.seams, 'seamS');
  const marker = byId(t.world.reveals, 'rev1');
  assert.deepEqual([seam.revealedUntil, marker.revealedUntil], [0, 0]);
  t.pulse();
  t.until((w) => w.pulse === null);
  assert.deepEqual(of(t.seen, 'reveal'), []);       // the cue comes with the step after the wave
  t.run(1);
  assert.deepEqual(of(t.seen, 'reveal'), [{ type: 'reveal', ids: ['seamS', 'rev1'] }]);
  for (const marked of [seam, marker]) {
    assert.ok(marked.revealedUntil <= t.world.time + PULSE.revealTime);
    assert.ok(marked.revealedUntil > t.world.time + PULSE.revealTime - 0.5);
  }
  t.until((w) => w.time >= seam.revealedUntil);
  assert.ok(seam.revealedUntil < t.world.time);     // the highlight is over

  t.run(90);                                        // past the pulse cooldown
  t.pulse();
  t.until((w) => w.pulse === null);
  t.run(1);
  assert.equal(of(t.seen, 'reveal').length, 2);     // one per wave

  t.warp(60, 0);
  t.run(240);                                       // the meter refills past the pulse cost
  t.clear();
  t.pulse();
  t.until((w) => w.pulse === null);
  t.run(1);
  assert.deepEqual([of(t.seen, 'reveal'), of(t.seen, 'relayUnpowered')], [[], []]);   // nothing in reach of this wave
});

test('Pulse: a reveal marker that shows a seam is spent once the seam breaks: no prompt, no highlight, no reveal event', () => {
  // D6 of the course: the basin of the Reservoir, beside the hidden seam resPassage (x 108, y 10 to 13) and the
  // marker resPassageHint that shows it.
  const t = open('course');
  const seam = byId(t.world.seams, 'resPassage');
  const marker = byId(t.world.reveals, 'resPassageHint');
  const beside = () => {                            // ILO on the basin floor, east of the seam
    t.warp(110.3, 11);
    t.run(1);
  };
  const wave = () => {                              // Q, the wave, and the step that flushes its one `reveal` cue
    t.pulse();
    t.until((w) => w.pulse === null);
    t.run(1);
  };
  beside();
  assert.deepEqual(t.world.prompt, PULSE_PROMPT);    // the seam is whole: the prompt asks for the pulse ...
  wave();
  assert.deepEqual(of(t.seen, 'reveal').flatMap((event) => event.ids).sort(), ['resPassage', 'resPassageHint']);   // ... which lights the seam and its marker
  assert.ok(seam.revealedUntil > t.world.time && marker.revealedUntil > t.world.time);

  t.step(press({ dashPressed: true, left: true })); // the dash west breaks the seam while the two are lit
  t.until((w) => seam.broken);
  t.until((w) => w.time >= Math.max(seam.revealedUntil, marker.revealedUntil));   // the light goes out
  beside();
  assert.deepEqual(t.world.prompt, null);           // a spent marker asks for no pulse
  t.clear();
  wave();
  assert.deepEqual(of(t.seen, 'reveal'), []);       // and the wave that reaches it lights nothing
  assert.ok(seam.revealedUntil < t.world.time && marker.revealedUntil < t.world.time);
});

test('Mover power: a mover without poweredBy always runs; a poweredBy mover waits for the socket, switch or relay', () => {
  const t = open('ascent');
  const pA = byId(t.world.movers, 'pA');
  assert.deepEqual(pA.poweredBy, ['A']);
  t.run(240);
  assert.deepEqual([pA.powered, pA.moving, pA.t, pA.x, pA.y], [false, false, 0, 10, 3]);   // an unpowered platform waits
  byId(t.world.relays, 'A').active = true;
  t.run(1);
  assert.deepEqual([pA.powered, pA.t], [true, 0]);  // powered now: it first waits out its boarding pause
  t.run(180);
  assert.deepEqual([pA.moving, pA.t > 0.3, pA.y > 3], [true, true, true]);
});

// --- The prompt for a pulse (GOAL §17) ---

const PULSE_PROMPT = Object.freeze({ key: 'Q', text: 'Echo Pulse' });

test('Pulse prompt: an offline relay in sight of a wave asks for a pulse once a wave would wake it', () => {
  // Relay A of the course has no socket: from x 53 in the corridor outside its chamber a wave reaches it through the
  // open shutter. (At x 52 the inserted cell, 1.125 away, is still in reach of E, and a target of E always wins.)
  const a = open('course');
  a.warp(53, 6);
  a.run(1);
  assert.deepEqual(a.world.prompt, null);            // the shutter is closed: no clear line
  a.warp(48.5, 6);
  a.run(1);
  a.e();                                             // M09: take wsCell ...
  a.warp(50.5, 6);
  a.run(1);
  a.e();                                             // ... and insert it: the shutter opens
  a.until((w) => byId(w.movers, 'wsShutter').t === 1);
  a.warp(53, 6);
  a.run(1);
  assert.deepEqual(a.world.prompt, PULSE_PROMPT);
  a.pulse();                                         // M11
  a.reached();
  a.until((w) => w.mode === 'play');
  a.run(1);
  assert.deepEqual(a.world.prompt, null);            // Relay A is on: a pulse here has nothing left to wake

  // Relay C waits for its socket: nothing asks before the cell is in it.
  const c = open('course');
  c.warp(189, 22);
  c.run(1);
  assert.deepEqual(c.world.prompt, null);
  c.warp(173.5, 22);
  c.run(1);
  c.e();                                             // M26: take fndCell
  c.warp(186.5, 22);
  c.run(1);
  c.e();                                             // M30: into fndRelaySocket
  c.warp(189, 22);
  c.run(1);
  assert.deepEqual(c.world.prompt, PULSE_PROMPT);
});

test('Pulse prompt: a hidden seam or a reveal marker in sight within 4 units asks for a pulse; rock in between or the light still on does not', () => {
  const at = (x, y) => {                            // the course, ILO warped to a real spot, one step taken
    const t = open('course');
    t.warp(x, y);
    t.run(1);
    return t;
  };
  assert.deepEqual(at(34.5, 6).world.prompt, PULSE_PROMPT);   // M05: the sign ECHO PULSE, under the conduit marker
  assert.deepEqual(at(45, 10).world.prompt, PULSE_PROMPT);    // D2: on crate B, 2.6 units from the hidden seam wsAlcove
  const pit = at(159.5, 18);                       // D4: in the pit beside the service seam and its marker
  assert.deepEqual(pit.world.prompt, PULSE_PROMPT);
  pit.warp(161.5, 22);                             // on the foundry floor 3.3 units above the seam: the rock floor blocks the line
  pit.run(1);
  assert.deepEqual(pit.world.prompt, null);
  pit.warp(159.5, 18);
  pit.clear();
  pit.pulse();                                     // the wave lights the seam and the marker: nothing asks while they are lit
  pit.run(90);                                     // the cooldown is over long before the light is
  assert.deepEqual([pit.world.prompt, of(pit.seen, 'reveal').length], [null, 1]);
  pit.until((w) => w.time >= Math.max(...w.reveals.map((m) => m.revealedUntil), ...w.seams.map((s) => s.revealedUntil)));
  pit.run(1);
  assert.deepEqual(pit.world.prompt, PULSE_PROMPT);
});

test('Pulse prompt: nothing asks while ILO cannot pulse: a cell in hand, energy below the cost, the cooldown running', () => {
  const carried = open('course');                  // crate B, the hidden seam in sight
  carried.warp(45, 10);
  carried.run(1);
  assert.deepEqual(carried.world.prompt, PULSE_PROMPT);
  carried.warp(47.5, 6);
  carried.run(1);
  carried.e();                                     // take wsCell
  carried.warp(45, 10);
  carried.run(1);
  assert.deepEqual([carried.world.interactTarget.kind, carried.world.prompt], ['place', { key: 'E', text: 'Place Cell' }]);
  carried.clear();
  carried.step(press({ pulsePressed: true }));
  assert.deepEqual(of(carried.seen, 'pulse'), []);

  const low = open('course');                      // the sign again
  low.warp(34.5, 6);
  Object.assign(low.world.player, { energy: PULSE.cost - 1, regenDelay: 5 });
  low.run(1);
  assert.deepEqual(low.world.prompt, null);
  Object.assign(low.world.player, { energy: PULSE.cost });
  low.run(1);
  assert.deepEqual(low.world.prompt, PULSE_PROMPT); // the cost itself is enough

  const spent = open('course');                    // a pulse from the spawn reaches nothing
  spent.pulse();
  spent.warp(34.5, 6);
  spent.run(1);
  assert.deepEqual(spent.world.prompt, null);      // its cooldown is running
  spent.until((w) => w.player.pulseCd === 0);
  spent.run(1);
  assert.deepEqual(spent.world.prompt, PULSE_PROMPT);
});

test('Pulse prompt: an enemy alone never asks for a pulse, and a target of E in reach always wins', () => {
  const enemy = open('course');                    // M05: once the marker is lit, only the skitter is near
  const skitter = byId(enemy.world.enemies, 'wsSkitter');
  enemy.warp(34.5, 6);
  enemy.run(1);
  assert.deepEqual(enemy.world.prompt, PULSE_PROMPT);
  enemy.pulse();
  enemy.until((w) => w.player.pulseCd === 0);
  const p = enemy.world.player;
  assert.equal(skitter.state, 'stunned');
  assert.ok(Math.hypot(skitter.x - p.x, skitter.y + skitter.h / 2 - (p.y + PLAYER.h / 2)) <= PULSE.radius, 'the skitter is inside one pulse');
  assert.deepEqual(enemy.world.prompt, null);

  const reader = open('course');                   // D2: on the gallery beside archive A, the alcove marker in sight
  reader.warp(51.2, 10);
  reader.run(1);
  assert.deepEqual([reader.world.interactTarget.kind, reader.world.prompt], ['archive', { key: 'E', text: 'Read Archive' }]);
  reader.e();                                      // read once: no target is left, and the pulse is what comes next
  assert.deepEqual([reader.world.interactTarget, reader.world.prompt], [null, PULSE_PROMPT]);
});

// --- The ascent ---

test('Ascent: the console stays dead with two relays and answers only inside boarding, in play, hands free', () => {
  const t = open('ascent', 'console');
  lightRelays(t.world, 'A', 'B');
  t.run(1);
  assert.deepEqual(t.world.interactTarget, null);
  assert.deepEqual(t.world.prompt, { key: null, text: 'Lift offline · 2/3 relays' });
  t.e();
  assert.deepEqual([t.world.mode, t.world.ascent.idle, t.world.result, of(t.seen, 'liftSequence')], ['play', true, null, []]);

  const beside = open('ascent', 'beside');          // three relays, but west of the boarding area
  lightRelays(beside.world, 'A', 'B', 'C');
  beside.run(1);
  assert.deepEqual([beside.world.interactTarget, beside.world.prompt], [null, null]);
  beside.e();
  assert.equal(beside.world.mode, 'play');

  const carry = open('ascent', 'cell');             // on the terrace, a cell within reach
  lightRelays(carry.world, 'A', 'B', 'C');
  carry.run(1);
  carry.e();
  carry.warp(30.6, 0);
  carry.run(1);
  assert.deepEqual([carry.world.interactTarget.kind, carry.world.prompt], ['place', { key: 'E', text: 'Place Cell' }]);
  carry.e();                                        // hands free again...
  const cell = byId(carry.world.cells, 'c1');
  assert.deepEqual([cell.state, cell.x], ['loose', 31.6]);
  carry.warp(28.9, 0);                              // ...and out of the cell's reach, still inside boarding
  carry.run(1);
  assert.deepEqual(carry.world.interactTarget, { kind: 'lift', id: 'ascent', x: 30, y: 0 });
  assert.deepEqual(carry.world.prompt, { key: 'E', text: 'Activate Lift' });

  const r = open('ascent', 'atC');                  // the third relay lights: the look at the route starts
  lightRelays(r.world, 'A', 'B');
  r.pulse();
  r.reached();
  r.warp(30, 0);
  r.run(1);
  assert.deepEqual([r.world.interactTarget, r.world.prompt], [null, null]);
  r.e();
  assert.equal(r.world.mode, 'relayActivation');
  r.until((w) => w.mode === 'play');
  r.run(1);
  assert.deepEqual(r.world.interactTarget, { kind: 'lift', id: 'ascent', x: 30, y: 0 });
  r.e();
  assert.equal(r.world.mode, 'liftSequence');
});

test('Ascent: the lift runs its five stages with input off and the clock stopped, builds the result once, ends in complete', () => {
  const t = open('ascent', 'console');
  const { world } = t;
  const p = world.player;
  lightRelays(world, 'A', 'B', 'C');
  t.warp(5.1, 0);
  t.e();                                            // archive A
  t.warp(20, 0);
  t.e();                                            // cache k1
  t.warp(30, 0);
  t.run(1);
  assert.deepEqual(world.interactTarget, { kind: 'lift', id: 'ascent', x: 30, y: 0 });
  t.clear();
  t.e();
  assert.equal(world.mode, 'liftSequence');
  assert.deepEqual([world.ascent.idle, world.prompt, world.interactTarget], [false, null, null]);
  const result = world.result;
  assert.deepEqual(result, { time: world.clock, recoveries: 0, archives: 1, caches: 1, disabled: 0, relays: ['A', 'B', 'C'], fullArchive: false });
  const clock = world.clock;
  const starts = {};
  const track = (w) => {
    if (w.ascent.stage !== null && !(w.ascent.stage in starts)) starts[w.ascent.stage] = w.modeTime;
    assert.equal(w.clock, clock);                   // the expedition clock is stopped
    assert.equal(w.result, result);                 // built once
  };
  t.until((w) => w.ascent.stage === 'barrier', EVERY, track);
  assert.deepEqual(of(t.seen, 'liftSequence').map((event) => event.stage), ['board', 'barrier']);
  near(p.x, 30, 1e-3);                             // board: the cabin center, input off
  assert.deepEqual([p.y, p.vx, p.vy, p.grounded], [0, 0, 0, true]);
  t.until((w) => w.ascent.stage === 'rise', EVERY, track);
  near(starts.barrier, LIFT.board, 2 * DT);
  near(starts.rise, LIFT.board + LIFT.barrier, 2 * DT);
  t.run(24, EVERY, track);                          // 0.2 s into the rise
  assert.ok(p.y < 0.1, `the rise eases in: ILO is at ${p.y}, a linear rise would be at 0.4`);
  t.run(276, IDLE, track);                          // halfway: 2.5 s of 5
  near(p.y, 5, 0.03);
  near(world.ascent.cabinY, 5, 0.03);
  t.until((w) => w.ascent.stage === 'terrace', IDLE, track);
  near(starts.surface, 6.6, 2 * DT);
  near(p.x, 30, 1e-3);
  assert.deepEqual([p.y, world.ascent.cabinY], [10, 10]);   // surface: the cabin floor at the terrace top
  t.run(180, IDLE, track);                          // halfway through the walk
  near(p.x, 31.5, 0.03);
  t.until((w) => w.mode === 'complete', IDLE, track);
  near(starts.terrace, 9.1, 2 * DT);
  assert.deepEqual(of(t.seen, 'liftSequence').map((event) => event.stage), ['board', 'barrier', 'rise', 'surface', 'terrace']);
  assert.deepEqual(of(t.seen, 'complete'), [{ type: 'complete', result }]);
  assert.deepEqual([world.ascent.idle, world.ascent.stage, world.ascent.cabinY, world.modeTime], [false, 'terrace', 10, 0]);
  assert.deepEqual([p.x, p.y, p.vx, p.vy, p.grounded], [33, 10, 0, 0, true]);   // 3 units onto the terrace
  t.clear();
  t.run(120, EVERY);                                // a finished run steps to nothing more
  assert.deepEqual([t.seen, world.mode, world.clock, world.result], [[], 'complete', clock, result]);
  near(result.time, world.clock);                   // the record is the clock as it stops: the console step counted
});

test('Ascent: the result counts what the expedition gathered; all three archives make fullArchive', () => {
  const t = open('ascent');
  lightRelays(t.world, 'A', 'B', 'C');
  t.walkTo(5.1);
  t.e();
  t.e();                                            // archives A and B from one spot
  t.walkTo(6.6);
  t.e();                                            // archive C
  t.warp(30, 0);
  t.run(1);
  t.e();
  assert.deepEqual(t.world.result, { time: t.world.clock, recoveries: 0, archives: 3, caches: 0, disabled: 0, relays: ['A', 'B', 'C'], fullArchive: true });
});

// --- Clock ---

test('Clock: expedition time advances in play only, not in relayActivation, shutdown, reboot or liftSequence', () => {
  const t = open('ascent', 'atC');
  const { world } = t;
  lightRelays(world, 'A', 'B');
  t.run(30);
  const before = world.clock;
  t.pulse();
  t.reached();
  const looked = world.clock;
  assert.ok(looked > before);                       // the steps before the wave hit were play
  t.run(120);
  assert.deepEqual([world.mode, world.clock], ['relayActivation', looked]);
  t.until((w) => w.mode === 'play');
  near(world.clock, looked + DT);
  t.run(30);
  const played = world.clock;
  assert.ok(played > looked);
  t.step(press({ retryPressed: true }));
  assert.equal(world.mode, 'shutdown');
  t.run(48);                                       // 0.4 s of the 0.5 s retry shutdown
  assert.deepEqual([world.mode, world.clock], ['shutdown', played]);
  t.until((w) => w.mode === 'reboot');
  t.run(60);
  assert.deepEqual([world.mode, world.clock], ['reboot', played]);
  t.until((w) => w.mode === 'play');
  near(world.clock, played + DT);
  t.run(30);
  const resumed = world.clock;
  assert.ok(resumed > played);
  lightRelays(world, 'C');
  t.warp(30, 0);
  t.run(1);
  t.e();
  assert.equal(world.mode, 'liftSequence');
  const left = world.clock;
  assert.ok(left > resumed);
  t.run(600);                                       // 5 s of the 12.1 s sequence
  assert.deepEqual([world.mode, world.clock], ['liftSequence', left]);
  t.until((w) => w.mode === 'complete');
  t.run(60);
  assert.deepEqual([world.mode, world.clock], ['complete', left]);
});
