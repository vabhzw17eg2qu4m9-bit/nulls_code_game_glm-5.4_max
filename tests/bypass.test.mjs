// Bypass run (GOAL §12: "Defeating every enemy is optional. A careful player can bypass encounters through movement
// and cover"; §16: "one optional enemy bypass"): the course from the spawn to the end by real inputs, with no machine
// disabled and no hit. A pulse that stuns a machine is allowed; a dash into a stunned machine is not.
// The steps of the main route (tests/route-steps.js) serve wherever the main route already passes a machine: the
// skitter (M06), the sentinel behind its cover (M23). B19 and B35 replace the two steps that disable a drone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyRect, overlaps } from '../src/sim/collision.js';
import { LEVEL } from '../src/level/level.js';
import { createWorld } from '../src/sim/world.js';
import { Driver } from './route-driver.js';
import { ROUTE, byId, mountBlock, stunAscentDrone } from './route-steps.js';

const MAIN = Array.from({ length: 37 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
const between = (first, last) => MAIN.slice(MAIN.indexOf(first), MAIN.indexOf(last) + 1);

/** The reservoir drone passed, not disabled: stunned as the block is mounted, stunned again from the basin, then
 *  2 up onto the ledge and on east, out of its sight, before the second stun is over. */
const B19 = (d) => {
  d.stand(3);                                     // the observation spot: hidden behind the cover block
  mountBlock(d);
  d.walkTo(110.3);                                // east off the block, down into the basin
  d.pulse();
  d.leap(112.2, { hold: 'full', floor: 13 });     // 2 up east onto the ledge
  d.walkTo(118.6);
};

/** The ascent drone passed, not disabled: stunned from the block, then east under it into the second shaft; the climb
 *  starts at once, and the wall between the shafts hides ILO before the stun is over. */
const B35 = (d) => {
  stunAscentDrone(d);
  d.walkTo(223.5);
};

const STEPS = {
  ...ROUTE,
  B19,
  B35,
};
export const BYPASS = [
  ...MAIN.slice(0, MAIN.indexOf('M19')), 'B19', ...between('M20', 'M34'), 'B35', ...MAIN.slice(MAIN.indexOf('M36')),
];

test('bypass: spawn to complete with no machine disabled and no hit; both drones passed under a stun', () => {
  const world = createWorld(LEVEL);
  world.mode = 'play';
  const d = new Driver(world);
  const met = new Set();                           // every hazard that met ILO's body, of any kind
  d.watchers.push((d) => {
    const body = bodyRect(d.p.x, d.p.y);
    for (const hazard of d.world.hazards) if (overlaps(body, hazard)) met.add(hazard.kind);
  });
  for (const id of BYPASS) d.section(id, STEPS[id]);

  // No hit: no shield, no damage, no recovery, and no hazard of any kind ever met ILO (no enemy body, bolt, beam or jet).
  assert.equal(d.seen('shield').length, 0, 'no shield spent');
  assert.equal(d.seen('damage').length, 0, 'no damage');
  assert.deepEqual([...met], [], 'no hazard met ILO');
  assert.equal(world.recoveries, 0);
  assert.equal(world.player.hp, 3);

  // Every machine was met awake and none was disabled: each drone aimed at ILO and was stunned (the reservoir drone
  // twice: at the block, then from the basin), the skitter patrolled and was stunned, the sentinel fired at the recess.
  const states = (id) => d.seen('enemyState').filter((e) => e.id === id).map((e) => e.state);
  const changes = (all) => all.filter((state, i) => state !== all[i - 1]);
  assert.deepEqual(changes(states('resDrone')), ['aim', 'stunned', 'patrol']);
  assert.equal(states('resDrone').filter((state) => state === 'stunned').length, 2, 'the reservoir drone was stunned twice');
  assert.deepEqual(changes(states('ascDrone')), ['aim', 'stunned', 'patrol']);
  assert.deepEqual(changes(states('fndSentinel')), ['warning', 'firing', 'venting', 'closed']);
  assert.deepEqual(changes(states('wsSkitter')).slice(-2), ['stunned', 'patrol']);
  assert.deepEqual(world.enemies.filter((e) => e.state === 'disabled'), [], 'no machine disabled');

  // The run ends like the main run, with nothing disabled and nothing found.
  assert.equal(world.mode, 'complete');
  assert.equal(d.seen('complete').length, 1, 'exactly one complete event');
  assert.deepEqual(world.relays.map((r) => [r.id, r.active]), [['A', true], ['B', true], ['C', true]]);
  assert.deepEqual([world.archives.filter((a) => a.collected).length, world.caches.filter((c) => c.collected).length], [0, 0]);
  assert.deepEqual(world.result, {
    time: world.clock, recoveries: 0, archives: 0, caches: 0, disabled: 0, relays: ['A', 'B', 'C'], fullArchive: false,
  });
  assert.equal(world.player.y, LEVEL.bounds.y1, 'ILO ends on the terrace at the top of the level');
  console.log(`bypass run: complete at clock ${world.clock.toFixed(2)} s`);
});
