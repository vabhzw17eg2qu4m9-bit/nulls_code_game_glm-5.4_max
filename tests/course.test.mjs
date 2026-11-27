// The real course (`src/level/level.js`) in the simulation. One test per `kill` rect of the course, so that the
// output names each of them: the deep water of the reservoirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, PULSE, RUN } from '../src/config.js';
import { LEVEL } from '../src/level/level.js';
import { placePlayer } from '../src/sim/player.js';
import { createWorld, stepWorld } from '../src/sim/world.js';

const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const byId = (items, id) => items.find((item) => item.id === id);

/** A `play` world of the real course. Every step's events collect in `seen` until `clear`. */
function open() {
  const world = createWorld(LEVEL);
  world.mode = 'play';
  world.events.length = 0;
  const t = {
    world,
    seen: [],
    step() {
      stepWorld(world, IDLE);
      t.seen.push(...world.events);
      world.events.length = 0;
    },
    /** `count` idle steps; `each` runs after every step. */
    run(count, each) {
      for (let i = 0; i < count; i += 1) {
        t.step();
        each?.(world);
      }
    },
    /** Steps until `done(world)` holds and returns how many it took; fails after 20 seconds. `each` runs after every step. */
    until(done, each) {
      let count = 0;
      while (!done(world)) {
        assert.ok(count < 2400, `not reached after ${count} steps: mode ${world.mode}, ILO at ${world.player.x}, ${world.player.y}`);
        t.step();
        each?.(world);
        count += 1;
      }
      return count;
    },
    clear: () => { t.seen.length = 0; },
  };
  return t;
}

// GOAL §11, "Water and falls": a fall into a deep channel is one recovery. ILO comes back at the last checkpoint,
// the expedition never rolls back.
for (const k of LEVEL.kill) {
  test(`Course: a fall into ${k.id} (${k.kind}, x ${k.x} to ${k.x + k.w}) is one recovery by a fall, back at the checkpoint, whole, with the clock kept`, () => {
    const t = open();
    const { world } = t;
    placePlayer(world, 59.5, 6);                        // station st2: the checkpoint the route commits before the waters
    t.run(2);
    assert.deepEqual([world.checkpoint.stationId, byId(world.stations, 'st2').active], ['st2', true]);
    Object.assign(world.player, { hp: 1, energy: 20 }); // spent before the fall
    t.run(60);
    const before = world.clock;
    t.clear();

    Object.assign(world.player, { x: k.x + k.w / 2, y: k.y + k.h + 1, vx: 0, vy: 0 });   // above the middle of the rect: it falls in
    let fell = null;                                    // the clock when the water took ILO
    let back = null;                                    // the clock when play resumed
    const held = new Set();                             // what the clock read while ILO was down
    t.until((w) => w.recoveries > 0 && w.mode === 'play', (w) => {
      if (w.recoveries === 0) return;                  // still falling
      fell ??= w.clock;
      if (w.mode === 'play') back = w.clock;
      else held.add(w.clock);
    });
    assert.deepEqual(t.seen.filter((event) => event.type === 'shutdown'), [{ type: 'shutdown', cause: 'fall' }]);   // once, by the fall
    assert.deepEqual(t.seen.filter((event) => event.type === 'reboot'), [{ type: 'reboot', stationId: 'st2', x: 59.5, y: 6 }]);
    assert.deepEqual([world.recoveries, world.cause], [1, 'fall']);
    assert.deepEqual([world.checkpoint.stationId, world.player.x, world.player.y], ['st2', 59.5, 6]);   // at the checkpoint ...
    assert.deepEqual([world.player.hp, world.player.energy], [RUN.integrity, PULSE.max]);               // ... whole
    assert.deepEqual([fell >= before, back >= fell, ...held], [true, true, fell]);                     // the clock never went back, and stood still while ILO was down
    t.run(120);
    near(world.clock, back + 1);                        // and runs on: a second for 120 steps
    assert.deepEqual([world.recoveries, world.player.y], [1, 6]);   // still standing at the checkpoint
  });
}
