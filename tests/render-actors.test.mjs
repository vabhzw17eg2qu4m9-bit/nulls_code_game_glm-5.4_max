// The actors of the renderer (contract §5.1): the machines (enemies), the props and the effects, on the real worlds
// of the simulation: the object and enemy fixtures and LEVEL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { DT, PLAYER } from '../src/config.js';
import { hitPlayer, placePlayer } from '../src/sim/player.js';
import { createWorld, setMode, stepWorld } from '../src/sim/world.js';
import { createEffects } from '../src/render/effects.js';
import { createIlo } from '../src/render/ilo.js';
import { createMachines } from '../src/render/machines.js';
import { createProps } from '../src/render/props.js';
import { createRenderer, createStage } from '../src/render/renderer.js';
import { createCanvas } from './fakes/gl.js';
import { LEVEL as CORE } from './fixtures/core.js';
import { PALETTE, VOXEL } from '../src/render/voxel.js';
import { DRONE, SENTINEL, SKITTER, SPOTS as ENEMY_SPOTS } from './fixtures/enemies.js';
import { LEVELS, SPOTS as OBJECT_SPOTS } from './fixtures/objects.js';

const REAL = await import('../src/level/level.js').then((module) => module.LEVEL, () => null); // once the real level loads
const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const FRAME = 1 / 60; // visual seconds per sync
const SETTLE = 90; // syncs until a machine has reached the pose of its state
const STATES = {
  skitter: ['dormant', 'patrol', 'alert', 'lunge', 'recover', 'stunned', 'disabled'],
  drone: ['patrol', 'aim', 'fire', 'cooldown', 'stunned', 'disabled'],
  sentinel: ['closed', 'warning', 'firing', 'venting', 'disabled'],
};
const FIXTURES = { skitter: SKITTER, drone: DRONE, sentinel: SENTINEL };
/** The longest any particle of a pool may live, in seconds. */
const LIFETIME = {
  'machines.spark': 0.5, 'machines.wisp': 1.1, 'machines.ember': 0.6, 'machines.bolt': 4, 'props.vent': 1.3,
  'effects.dash': 0.24, 'effects.ring': 0.5, 'effects.seam': 0.9, 'effects.shield': 0.36, 'effects.flash': 0.2,
  'effects.dust': 0.55, 'effects.conduit': 0.65, 'effects.air': 10, 'effects.steam': 1.2, 'effects.drift': 4.5,
};
/** Every enemy kind, a vent and a seam on the workshop range: every particle effect can run at once. */
const STRESS = { ...LEVELS.workshop, enemies: [...SKITTER.enemies, ...DRONE.enemies, ...SENTINEL.enemies], vents: [LEVELS.vents.vents[1]] };

const press = (held = {}) => ({ ...IDLE, ...held });
const enemy = (world, id) => world.enemies.find((e) => e.id === id);

function near(actual, expected, tolerance = 0.01, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}${actual} is not within ${tolerance} of ${expected}`);
}

/** A `play` world of `level` with ILO at `(x, y)`, its events cleared. */
function open(level, x = level.spawn.x, y = level.spawn.y) {
  const world = createWorld(level);
  world.mode = 'play';
  placePlayer(world, x, y);
  world.events.length = 0;
  return world;
}

/** A stage of `level` at 960 × 540. */
function stageOf(level) {
  const stage = createStage(level);
  stage.resize(960, 540);
  return stage;
}

/** Sync `stage` `count` times with `world`; `events` happen on the first sync. */
function run(stage, world, count, events = []) {
  for (let i = 0; i < count; i++) stage.sync(world, FRAME, i === 0 ? events : []);
  stage.scene.updateMatrixWorld(true); // what the renderer does before it draws
}

/** The object called `name` in the scene: a group (`kind:id`) or a named mesh. */
const mesh = (stage, name) => stage.scene.getObjectByName(name);

/** What `name` looks like now: every mesh under it that is visible, with its light and its place. */
function look(stage, name) {
  stage.scene.updateMatrixWorld(true);
  const rows = [];
  mesh(stage, name)?.traverseVisible((object) => {
    if (object.isMesh) {
      rows.push([object.name, object.material.color.getHexString(), object.material.opacity.toFixed(2), ...object.matrixWorld.elements.map((v) => v.toFixed(2))]);
    }
  });
  return rows;
}

/** The world-space bounds of a mesh. */
function bounds(object) {
  object.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(object);
}

/** Every pair of a list, in order. */
const pairs = (list) => list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b]));

/** The actors as the stage builds them, each on its own: `{ sync, pools }` can be reached here. */
function actorsOf(level) {
  const scene = new THREE.Scene();
  const ilo = createIlo(scene);
  const machines = createMachines(scene, level);
  const props = createProps(scene, level, ilo);
  const effects = createEffects(scene);
  return {
    scene, ilo, machines, props, effects,
    sync(world, events = []) {
      for (const actor of [ilo, machines, props, effects]) actor.sync(world, FRAME, events);
    },
    setReducedMotion(on) {
      for (const actor of [ilo, machines, props, effects]) actor.setReducedMotion(on);
    },
    dispose() {
      for (const actor of [ilo, machines, props, effects]) actor.dispose();
    },
  };
}

/** Every pool of the actors with its name. */
const poolsOf = (actors) => [
  ...Object.entries(actors.machines.pools).map(([name, pool]) => [`machines.${name}`, pool]),
  ...Object.entries(actors.props.pools).map(([name, pool]) => [`props.${name}`, pool]),
  ...Object.entries(actors.effects.pools).map(([name, pool]) => [`effects.${name}`, pool]),
];

test('Props and machines: LEVEL has a model for every cell, socket, relay, station, archive, cache, vent, switch, mover and enemy', { skip: REAL === null }, () => {
  const stage = stageOf(REAL);
  const world = open(REAL);
  run(stage, world, 2);
  const lists = {
    cell: REAL.cells, socket: REAL.sockets, relay: REAL.relays, station: REAL.stations, archive: REAL.archives, cache: REAL.caches,
    vent: REAL.vents, switch: REAL.switches, platform: REAL.platforms, shutter: REAL.shutters, lift: REAL.lifts, press: REAL.presses,
  };
  for (const [kind, list] of Object.entries(lists)) {
    for (const def of list ?? []) assert.ok(look(stage, `${kind}:${def.id}`).length > 0, `LEVEL has ${kind} ${def.id}; the stage shows nothing for it`);
  }
  for (const def of REAL.enemies) assert.ok(look(stage, `${def.kind}:${def.id}`).length > 0, `LEVEL has enemy ${def.id}; the stage shows nothing for it`);
  assert.ok(look(stage, `ascent:${REAL.ascent.id}`).length > 0, 'the stage shows nothing for the ascent lift');
  stage.dispose();
});

for (const [kind, states] of Object.entries(STATES)) {
  test(`Machines: the ${kind} looks different in every state`, () => {
    const stage = stageOf(FIXTURES[kind]);
    const world = open(FIXTURES[kind]);
    const looks = {};
    for (const state of states) {
      for (const e of world.enemies) Object.assign(e, { state, t: 30, beam: state === 'firing' ? { ...e.lane } : null });
      run(stage, world, SETTLE);
      for (const e of world.enemies) looks[`${e.id}/${state}`] = look(stage, `${kind}:${e.id}`);
    }
    for (const e of world.enemies) {
      for (const [a, b] of pairs(states)) assert.notDeepEqual(looks[`${e.id}/${a}`], looks[`${e.id}/${b}`], `${e.id} looks the same in ${a} and ${b}`);
    }
    stage.dispose();
  });
}

test('Machines: shape and motion tell the states apart, not color alone', () => {
  // Skitter: the sensor bar, the height of the hull and its tilt.
  let stage = stageOf(SKITTER);
  let world = open(SKITTER);
  const skitter = {};
  for (const state of STATES.skitter) {
    Object.assign(enemy(world, 'sk1'), { state, t: 30 });
    run(stage, world, SETTLE);
    const elements = mesh(stage, 'skitter:sk1').getObjectByName('bar').matrixWorld.elements;
    skitter[state] = { bar: mesh(stage, 'skitter:sk1').getObjectByName('bar').material.color.r, lift: elements[13], pitch: elements[1], roll: elements[6] };
  }
  assert.ok(skitter.patrol.bar > 0.3, `the bar of a patrolling skitter is lit (${skitter.patrol.bar})`);
  assert.ok(skitter.stunned.bar < 0.01 && skitter.disabled.bar < 0.01, 'the bar of a stunned or disabled skitter is off');
  assert.ok(skitter.alert.lift > skitter.patrol.lift && skitter.patrol.lift > skitter.dormant.lift && skitter.disabled.lift < skitter.dormant.lift, 'the hull rears in alert, sits low dormant, lies lowest disabled');
  assert.ok(skitter.alert.pitch > 0.1 && skitter.lunge.pitch < -0.1, 'the hull tilts up in alert and down in a lunge');
  assert.ok(skitter.disabled.roll < -0.5 && Math.abs(skitter.patrol.roll) < 0.01, 'a disabled skitter lies on its back');
  stage.dispose();

  // Drone: the lens from cyan to amber to bright, the targeting line only while aiming.
  stage = stageOf(DRONE);
  world = open(DRONE);
  const drone = {};
  for (const state of STATES.drone) {
    Object.assign(enemy(world, 'd1'), { state, t: 30 });
    run(stage, world, SETTLE);
    const lens = mesh(stage, 'drone:d1').getObjectByName('lens').material.color;
    drone[state] = { red: lens.r, blue: lens.b, line: mesh(stage, 'targetLine').visible, drop: -mesh(stage, 'drone:d1').children[0].position.y + 0.45 };
  }
  assert.ok(drone.patrol.blue > drone.patrol.red, 'a patrolling drone has a cyan lens');
  assert.ok(drone.aim.red > drone.aim.blue, 'an aiming drone has an amber lens');
  assert.ok(drone.fire.red > 0.99 && drone.fire.blue > drone.aim.blue, 'a firing drone has a bright lens');
  assert.deepEqual(STATES.drone.filter((state) => drone[state].line), ['aim'], 'the targeting line shows while aiming only');
  assert.ok(drone.stunned.drop > 0.15 && drone.disabled.drop > 0.2 && drone.patrol.drop < 0.05, 'a stunned or disabled drone hangs low');
  stage.dispose();

  // Sentinel: the panels slide apart, the beam only while firing, the lane line only while warning.
  stage = stageOf(SENTINEL);
  world = open(SENTINEL);
  const sentinel = {};
  for (const state of STATES.sentinel) {
    Object.assign(enemy(world, 'sg1'), { state, t: 30, beam: state === 'firing' ? { ...enemy(world, 'sg1').lane } : null });
    run(stage, world, SETTLE);
    const group = mesh(stage, 'sentinel:sg1');
    sentinel[state] = {
      gap: group.getObjectByName('upperPanel').position.y - group.getObjectByName('lowerPanel').position.y,
      beam: group.getObjectByName('beam').visible, line: group.getObjectByName('laneLine').visible, lamp: group.getObjectByName('lamp').visible,
    };
  }
  assert.ok(sentinel.closed.gap < 0.06 && sentinel.warning.gap < sentinel.firing.gap && sentinel.firing.gap < sentinel.venting.gap, 'the panels open wider from warning to firing to venting');
  assert.deepEqual(STATES.sentinel.filter((state) => sentinel[state].beam), ['firing'], 'the beam shows while firing only');
  assert.deepEqual(STATES.sentinel.filter((state) => sentinel[state].line), ['warning'], 'the lane line shows while warning only');
  assert.ok(sentinel.firing.lamp && sentinel.venting.lamp && !sentinel.closed.lamp && !sentinel.disabled.lamp, 'the warning light burns while firing and venting');
  stage.dispose();
});

test('Machines: the beam fills the sentinel\'s beam rect exactly and is gone outside firing', () => {
  for (const [id, spot] of [['sg1', 'inLane'], ['sg2', 'coverFront']]) {
    const stage = stageOf(SENTINEL);
    assert.equal(mesh(stage, `sentinel:${id}`).getObjectByName('beam').visible, false, `${id}: its beam draws nothing before the first sync`);
    const world = open(SENTINEL, ...ENEMY_SPOTS[spot].slice(1));
    const e = enemy(world, id);
    for (let i = 0; i < 400 && e.state !== 'firing'; i++) stepWorld(world, IDLE);
    assert.equal(e.state, 'firing', `${id} never fires`);
    for (let i = 0; i < 12; i++) stepWorld(world, IDLE); // the beam is at full strength
    run(stage, world, 1);
    const beam = mesh(stage, `sentinel:${id}`).getObjectByName('beam');
    assert.equal(beam.visible, true);
    assert.ok(e.beam.w > 0, `${id} has a beam`);
    const box = bounds(beam);
    near(box.min.x, e.beam.x, 0.01, `${id}: min x `);
    near(box.max.x, e.beam.x + e.beam.w, 0.01, `${id}: max x `);
    near(box.min.y, e.beam.y, 0.01, `${id}: min y `);
    near(box.max.y, e.beam.y + e.beam.h, 0.01, `${id}: max y `);
    for (let i = 0; i < 200 && e.state === 'firing'; i++) stepWorld(world, IDLE);
    assert.equal(e.beam, null, `${id}: the beam rect is null outside firing`);
    run(stage, world, 1);
    assert.equal(beam.visible, false, `${id}: the beam mesh is hidden outside firing`);
    stage.dispose();
  }
  if (REAL !== null) {
    const stage = createStage(REAL);
    for (const def of REAL.enemies.filter((enemy) => enemy.kind === 'sentinel')) {
      assert.equal(mesh(stage, `sentinel:${def.id}`).getObjectByName('beam').visible, false, `LEVEL: the beam of ${def.id} draws nothing before the first sync`);
    }
    stage.dispose();
  }
});

test('Props: an active vent jet fills its jet rect exactly', () => {
  const stage = stageOf(LEVELS.vents);
  const world = open(LEVELS.vents, ...OBJECT_SPOTS.vents.besideV1);
  const seen = new Set();
  for (let i = 0; i < 1500 && seen.size < world.vents.length; i++) {
    stepWorld(world, IDLE);
    run(stage, world, 1);
    for (const vent of world.vents) {
      const jet = mesh(stage, `vent:${vent.id}`).getObjectByName('jet');
      assert.equal(jet.visible, vent.stage !== 'dormant', `${vent.id} is ${vent.stage}`);
      if (vent.stage !== 'active' || seen.has(vent.id)) continue;
      seen.add(vent.id);
      const box = bounds(jet);
      near(box.min.x, vent.x - vent.w / 2, 0.01, `${vent.id}: min x `);
      near(box.max.x, vent.x + vent.w / 2, 0.01, `${vent.id}: max x `);
      near(box.min.y, vent.y, 0.01, `${vent.id}: min y `);
      near(box.max.y, vent.y + vent.h, 0.01, `${vent.id}: max y `);
    }
  }
  assert.equal(seen.size, world.vents.length, 'every vent of the range fired once');
  stage.dispose();
});

test('Props: a carried cell sits at ILO\'s hands', () => {
  const level = LEVELS.cells;
  const actors = actorsOf(level);
  const world = open(level, ...OBJECT_SPOTS.cells.near);
  stepWorld(world, press({ interactPressed: true }));
  const cell = world.cells.find((c) => c.id === 'c1');
  assert.equal(cell.state, 'carried');
  const place = () => actors.scene.getObjectByName('cell:c1').position;
  /** One frame of the simulation and of the actors; where ILO's hands are in that frame and where the cell went. */
  const frame = (input) => {
    stepWorld(world, input);
    actors.ilo.sync(world, FRAME, world.events);
    const anchor = actors.ilo.carryAnchor();
    actors.machines.sync(world, FRAME, world.events);
    actors.props.sync(world, FRAME, world.events);
    return { anchor, at: place() };
  };
  for (let i = 0; i < 12; i++) frame(IDLE); // the cell reaches the hands
  for (let i = 0; i < 60; i++) {
    const { anchor, at } = frame(press({ right: i % 24 < 12, left: i % 24 >= 12, jumpPressed: i === 4 }));
    assert.ok(Math.hypot(at.x - anchor.x, at.y - anchor.y, at.z - anchor.z) < 1e-9, `frame ${i}: the carried cell is at ${at.x}, ${at.y}, ${at.z}; ILO's hands at ${anchor.x}, ${anchor.y}, ${anchor.z}`);
  }
  actors.dispose();
});

test('Props: a collected archive is gone and a collected cache is an open crate with nothing left in it', () => {
  const stage = stageOf(LEVELS.workshop);
  const world = open(LEVELS.workshop);
  run(stage, world, 1);
  assert.ok(look(stage, 'archive:A').length > 0, 'archive A is on its pedestal');
  assert.deepEqual(look(stage, 'cache:k1').map((row) => row[0]), ['loot', 'glint'], 'the cache is a closed crate with scrap');
  for (const object of [...world.archives, ...world.caches]) object.collected = true;
  run(stage, world, 1);
  assert.deepEqual(look(stage, 'archive:A'), [], 'a collected archive has no visible mesh');
  assert.deepEqual(look(stage, 'cache:k1').map((row) => row[0]), ['crate'], 'a collected cache shows its open crate and nothing that was in it');
  stage.dispose();
});

test('Props: the outline sits on what E acts on now', () => {
  const stage = stageOf(LEVELS.workshop);
  const world = open(LEVELS.workshop, 6.4, 0);
  run(stage, world, 1);
  assert.equal(mesh(stage, 'interactOutline').visible, false, 'nothing to act on: no outline');
  /** `target` names an object of `rect` `[x, y, w, h]` on this stage: the outline must frame it. */
  const framed = (target, [x, y, w, h]) => {
    world.interactTarget = target;
    run(stage, world, 1);
    const outline = mesh(stage, 'interactOutline');
    assert.equal(outline.visible, true, `${target.kind}:${target.id}: no outline`);
    const center = bounds(outline).getCenter(new THREE.Vector3());
    const size = bounds(outline).getSize(new THREE.Vector3());
    near(center.x, x + w / 2, 0.02, `${target.kind}:${target.id}: center x `);
    near(center.y, y - 0.1 + (h + 0.2) / 2, 0.02, `${target.kind}:${target.id}: center y `);
    near(size.x, 1.05 * (w + 0.2), 0.02, `${target.kind}:${target.id}: width `);
    near(size.y, 1.05 * (h + 0.2), 0.02, `${target.kind}:${target.id}: height `);
  };
  framed({ kind: 'pickup', id: 'c1' }, [10, 0, 1, 1.1]);
  framed({ kind: 'remove', id: 'c1' }, [10, 0, 1, 1.1]);
  framed({ kind: 'insert', id: 'sA' }, [13.9, 0, 1.2, 1.5]);
  framed({ kind: 'cache', id: 'k1' }, [38, 0, 1, 1.5]);
  framed({ kind: 'archive', id: 'A' }, [6, 0, 1, 1.5]);
  // A carried cell is outlined where it is: in ILO's hands.
  Object.assign(world.cells[0], { state: 'carried' });
  world.player.carrying = 'c1';
  world.interactTarget = { kind: 'place', id: 'c1' };
  run(stage, world, 12);
  const carried = mesh(stage, 'cell:c1').position;
  near(bounds(mesh(stage, 'interactOutline')).getCenter(new THREE.Vector3()).x, carried.x, 0.001, 'a carried cell: center x ');
  world.interactTarget = null;
  run(stage, world, 1);
  assert.equal(mesh(stage, 'interactOutline').visible, false);
  stage.dispose();

  const other = stageOf(LEVELS.reservoir);
  const elsewhere = open(LEVELS.reservoir);
  elsewhere.interactTarget = { kind: 'switch', id: 'swB' };
  run(other, elsewhere, 1);
  near(bounds(mesh(other, 'interactOutline')).getCenter(new THREE.Vector3()).x, 21.5, 0.02, 'switch: center x ');
  other.dispose();
  const liftStage = stageOf(LEVELS.ascent);
  const liftWorld = open(LEVELS.ascent);
  liftWorld.interactTarget = { kind: 'lift', id: LEVELS.ascent.ascent.id };
  run(liftStage, liftWorld, 1);
  near(bounds(mesh(liftStage, 'interactOutline')).getCenter(new THREE.Vector3()).x, LEVELS.ascent.ascent.console.x, 0.02, 'lift console: center x ');
  liftStage.dispose();
});

test('Props: power, activation and warning change what lights up', () => {
  let stage = stageOf(LEVELS.workshop);
  let world = open(LEVELS.workshop);
  run(stage, world, 1);
  /** The red channel of the light of `name` under the group `owner`. */
  const light = (owner, name) => mesh(stage, owner).getObjectByName(name).material.color.r;
  const dark = { socket: light('socket:sA', 'slot'), relay: light('relay:A', 'node'), station: light('station:stA', 'light') };
  const parts = { relay: look(stage, 'relay:A').length, station: look(stage, 'station:stA').length };
  Object.assign(world.sockets[0], { cell: 'c1', powered: true });
  world.relays[0].active = true;
  world.stations[1].active = true;
  run(stage, world, 1);
  assert.ok(light('socket:sA', 'slot') > 3 * dark.socket, 'a powered socket lights its slot');
  assert.ok(light('relay:A', 'node') > 3 * dark.relay && look(stage, 'relay:A').length === parts.relay + 1, 'an active relay lights its node and casts light');
  assert.ok(light('station:stA', 'light') > 3 * dark.station && look(stage, 'station:stA').length === parts.station + 1, 'an active station lights up and casts light');
  stage.dispose();

  stage = stageOf(LEVELS.reservoir);
  world = open(LEVELS.reservoir);
  run(stage, world, 1);
  const platformLight = () => mesh(stage, 'platform:pB').getObjectByName('light').material.color.r;
  const dim = platformLight();
  assert.equal(mesh(stage, 'switch:swB').getObjectByName('on').visible, false);
  world.switches[0].on = true;
  world.movers.find((m) => m.id === 'pB').powered = true;
  run(stage, world, 1);
  assert.equal(mesh(stage, 'switch:swB').getObjectByName('on').visible, true);
  assert.equal(mesh(stage, 'switch:swB').getObjectByName('off').visible, false);
  assert.ok(platformLight() > 3 * dim, 'a powered platform lights its edges');
  stage.dispose();

  // A press glows and shivers before it drops; with reduced motion it glows and holds still.
  const lamps = (actors) => actors.scene.getObjectByName('press:pr1').getObjectByName('lamps').material.color.r;
  const head = (actors) => actors.scene.getObjectByName('press:pr1').position;
  const rig = actorsOf(LEVELS.vents);
  const vents = open(LEVELS.vents);
  const pr1 = vents.movers.find((m) => m.id === 'pr1');
  for (let i = 0; i < 300 && pr1.stage !== null; i++) stepWorld(vents, IDLE); // the head opens while it warns
  rig.sync(vents);
  const resting = lamps(rig);
  pr1.stage = 'warn';
  let still = true;
  for (let i = 0; i < 20; i++) {
    rig.sync(vents);
    if (head(rig).x !== pr1.x || head(rig).y !== pr1.y) still = false;
  }
  assert.ok(!still, 'a warning press shivers');
  rig.setReducedMotion(true);
  rig.sync(vents);
  assert.ok(lamps(rig) > 5 * resting, 'a warning press glows');
  assert.ok(head(rig).x === pr1.x && head(rig).y === pr1.y, 'with reduced motion the head holds still');
  rig.dispose();
});

test('Props: the lift barrier closes after boarding and opens at the terrace', () => {
  const stage = stageOf(LEVELS.ascent);
  const world = open(LEVELS.ascent);
  Object.assign(world.ascent, { idle: false });
  world.mode = 'liftSequence';
  const barrier = () => mesh(stage, 'ascent:ascent').getObjectByName('barrier').visible;
  const last = {};
  for (let i = 0; i < 1600 && world.mode !== 'complete'; i++) {
    stepWorld(world, IDLE);
    run(stage, world, 1);
    last[world.ascent.stage] = barrier();
  }
  assert.deepEqual(last, { board: false, barrier: true, rise: true, surface: true, terrace: false });
  assert.equal(world.mode, 'complete');
  near(world.ascent.cabinY, LEVELS.ascent.bounds.y1, 1e-6, 'the cabin floor at the end: ');
  stage.dispose();
});

/** ILO moving along the flat of the workshop range for `frames` frames at `speed(i)` units per second: per frame, its x, its ankles in the world, its hip height, arm and lean. */
function stride(frames, speed = () => 6.5) {
  const stage = stageOf(REAL);
  const world = open(REAL, 144, 22);
  const node = (name) => stage.scene.getObjectByName(name);
  const rows = [];
  for (let i = 0; i < frames; i++) {
    const v = speed(i);
    Object.assign(world.player, { vx: v, facing: Math.sign(v), grounded: true });
    world.player.x += v * FRAME;
    stage.sync(world, FRAME, []);
    stage.scene.updateMatrixWorld(true);
    rows.push({ frame: i, x: world.player.x, feet: ['L', 'R'].map((side) => node(`ankle${side}`).getWorldPosition(new THREE.Vector3())), hip: node('body').position.y, arm: node('shoulderL').rotation.z, lean: node('chest').rotation.z });
  }
  stage.dispose();
  return { rows, ground: world.player.y + 0.0625 }; // the height of an ankle pivot that stands on the ground
}

/** The stances of the foot `side` (0: left, 1: right) in `rows`: each `{ frame, sweep, travel }`: the frame of touch-down, the units the foot moved over the ground and the units ILO travelled while it stood there. */
function stances(rows, side, ground) {
  const out = [];
  let on = [];
  for (const row of rows) {
    if (row.feet[side].y >= ground + 0.004) { // off the ground: the stance that just ended counts once it is over
      if (on.length > 1) out.push(on);
      on = [];
    } else {
      on.push(row);
    }
  }
  return out.map((run) => ({ frame: run[0].frame, sweep: Math.max(...run.map((r) => r.feet[side].x)) - Math.min(...run.map((r) => r.feet[side].x)), travel: Math.abs(run.at(-1).x - run[0].x) }));
}

/** The furthest any foot moves in one frame, in units. */
const jump = (rows) => Math.max(...rows.slice(1).flatMap((row, i) => row.feet.map((foot, side) => Math.abs(foot.x - rows[i].feet[side].x))));

test('ILO: a foot that carries weight stays where it is, at a walk and at a run', { skip: REAL === null }, (t) => {
  const gaits = {};
  for (const [speed, steps] of [[2.5, 5], [6.5, 7.2]]) {
    const { rows, ground } = stride(300, () => speed);
    const steady = rows.slice(90); // the gait has settled
    const list = [0, 1].flatMap((side) => stances(steady, side, ground));
    const slide = Math.max(...list.map((s) => s.sweep / s.travel));
    assert.ok(slide <= 0.3, `at ${speed} units per second a stance foot slides ${(slide * 100).toFixed(1)}% of the way ILO travels`);
    const rate = list.length / (steady.length * FRAME);
    near(rate, steps, 0.3, `steps per second at ${speed} units per second: `);
    const range = (key) => Math.max(...steady.map((r) => r[key])) - Math.min(...steady.map((r) => r[key]));
    gaits[speed] = { slide, rate, bob: range('hip'), arm: range('arm'), lean: Math.abs(steady.at(-1).lean) };
    t.diagnostic(`${speed} units per second: ${rate.toFixed(2)} steps per second, a stance foot slides at most ${(slide * 100).toFixed(1)}% of the way, hip bob ${gaits[speed].bob.toFixed(3)}, arm swing ${gaits[speed].arm.toFixed(2)}, lean ${gaits[speed].lean.toFixed(2)}`);
  }
  assert.ok(gaits[6.5].bob > gaits[2.5].bob && gaits[6.5].arm > gaits[2.5].arm && gaits[6.5].lean > gaits[2.5].lean, 'the run has more bob, arm swing and lean than the walk');
});

test('ILO: a change of speed does not jump the gait', { skip: REAL === null }, () => {
  const swing = jump(stride(300).rows.slice(90)); // the fastest a foot moves in a frame at a steady run
  const change = (from, to, accel) => (i) => (i < 150 ? from : to > from ? Math.min(to, from + (i - 149) * accel * FRAME) : Math.max(to, from - (i - 149) * accel * FRAME));
  for (const [name, speed] of [['under acceleration', change(2.5, 6.5, PLAYER.groundAccel)], ['under braking', change(6.5, 2.5, PLAYER.groundBrake)], ['from rest', change(0, 6.5, PLAYER.groundAccel)]]) {
    const around = stride(200, speed).rows.slice(145, 165);
    const leap = jump(around);
    assert.ok(leap <= swing + 0.05, `${name}: a foot moves ${leap} units in one frame as the speed changes, a run's swing moves ${swing}`);
  }
});

test('ILO: a shutdown after a fatal hit shows the body in every frame', { skip: REAL === null }, () => {
  const stage = stageOf(REAL);
  const world = open(REAL);
  const { x, y } = world.player;
  run(stage, world, 1, [{ type: 'damage', x, y, cause: 'enemy' }]); // the hit that ends the run
  world.mode = 'shutdown';
  const body = mesh(stage, 'body');
  const hidden = [];
  for (let frame = 0; frame < 40; frame++) {
    run(stage, world, 1);
    if (!body.visible) hidden.push(frame);
  }
  assert.deepEqual(hidden, [], 'frames of the shutdown in which the body is hidden');
  stage.dispose();
});

test('Particles: 600 frames of heavy events keep every pool at its fixed size, and nothing outlives its lifetime', () => {
  const rig = actorsOf(STRESS);
  const pools = poolsOf(rig);
  assert.deepEqual(pools.map(([name]) => name).sort(), Object.keys(LIFETIME).sort(), 'every pool has a lifetime bound');
  const world = open(STRESS, 4, 0);
  const seam = world.seams[0];
  const relay = world.relays[0];
  let busiest = 0;
  for (let frame = 0; frame < 600; frame++) {
    // Every effect at once, every frame: a dash, a wave, vents at full blast, machines sparking, bolts in flight.
    const { x, y } = world.player;
    Object.assign(world.player, { dashT: 0.16, dashDir: 1 });
    world.pulse = frame % 3 === 0 ? { x, y: y + PLAYER.h / 2, r: 6 * ((frame % 20) / 20), age: 0, hit: new Set() } : null;
    for (const vent of world.vents) Object.assign(vent, { stage: 'active', t: vent.delay + vent.period - vent.active / 2 });
    Object.assign(enemy(world, 'sk1'), { state: 'stunned', t: 30 });
    Object.assign(enemy(world, 'sk2'), { state: 'disabled', t: 30 });
    Object.assign(enemy(world, 'd1'), { state: frame % 2 ? 'fire' : 'aim', t: 30, aimDir: { x: 1, y: 0 } });
    Object.assign(enemy(world, 'sg1'), { state: 'venting', t: 30 });
    Object.assign(enemy(world, 'sg2'), { state: 'firing', t: 30, beam: { ...enemy(world, 'sg2').lane } });
    world.bolts = Array.from({ length: 6 }, (_, i) => ({ id: `${frame}:${i}`, x: x + i, y: y + 2, vx: 5, vy: 1, life: 3, w: 0.3, h: 0.3 }));
    rig.sync(world, [
      { type: 'seamBreak', id: seam.id, x: seam.x + 0.25, y: seam.y + 1 }, { type: 'seamBreak', id: seam.id, x: seam.x + 0.75, y: seam.y + 2 },
      { type: 'shield', x, y }, { type: 'damage', x, y, cause: 'enemy' }, { type: 'land', x, y, speed: 13 },
      { type: 'relay', id: relay.id, x: relay.x, y: relay.y, lookAt: relay.lookAt }, { type: 'pulse', x, y },
    ]);
    let live = 0;
    for (const [name, pool] of pools) {
      assert.ok(pool.items.length <= pool.limit, `frame ${frame}: pool ${name} grew to ${pool.items.length}`);
      for (const item of pool.items) {
        if (!item.live) continue;
        live++;
        assert.ok(item.age <= item.life + 1e-9, `frame ${frame}: pool ${name}: a particle is ${item.age} old and lives ${item.life}`);
        assert.ok(item.life <= LIFETIME[name] + 1e-9, `frame ${frame}: pool ${name}: a particle lives ${item.life}`);
        if (item.x !== undefined) assert.ok([item.x, item.y, item.z, item.w, item.h].every(Number.isFinite), `frame ${frame}: pool ${name}: a particle is off the plane`);
      }
    }
    busiest = Math.max(busiest, live);
  }
  assert.ok(busiest > 60, 'the heavy frames kept many particles alive at once');
  // Then nothing happens for six seconds: only the air keeps its dust.
  world.pulse = null;
  world.bolts = [];
  Object.assign(world.player, { dashT: 0 });
  for (const e of world.enemies) Object.assign(e, { state: e.kind === 'sentinel' ? 'closed' : e.kind === 'skitter' ? 'dormant' : 'patrol', beam: null });
  for (const vent of world.vents) Object.assign(vent, { stage: 'dormant', t: 0 });
  for (let frame = 0; frame < 360; frame++) rig.sync(world);
  for (const [name, pool] of pools) {
    assert.equal(pool.items.filter((item) => item.live).length, name === 'effects.air' ? pool.limit : 0, `six quiet seconds later pool ${name} still holds a live particle`);
  }
  rig.dispose();
});

test('Effects: with reduced motion every effect spawns half as many and the flashes are gone', () => {
  const burst = (reduced) => {
    const effects = createEffects(new THREE.Scene());
    effects.setReducedMotion(reduced);
    const world = open(LEVELS.workshop);
    const { x, y } = world.player;
    const seam = world.seams[0];
    effects.sync(world, FRAME, [{ type: 'seamBreak', id: seam.id, x: seam.x, y: seam.y + 1.5 }, { type: 'damage', x, y, cause: 'enemy' }, { type: 'land', x, y, speed: 13 }, { type: 'shield', x, y }]);
    const live = (name) => effects.pools[name].items.filter((item) => item.live).length;
    const counts = { seam: live('seam'), flash: live('flash'), dust: live('dust'), shield: live('shield'), air: live('air') };
    effects.dispose();
    return counts;
  };
  const full = burst(false);
  const half = burst(true);
  assert.ok(full.flash > 0, 'the recoil flash shows without reduced motion');
  assert.deepEqual(half, { seam: Math.ceil(full.seam / 2), flash: 0, dust: Math.ceil(full.dust / 2), shield: full.shield, air: Math.ceil(full.air / 2) });
  // A stunned skitter sparks at half the rate too.
  const sparks = (reduced) => {
    const machines = createMachines(new THREE.Scene(), SKITTER);
    machines.setReducedMotion(reduced);
    const world = open(SKITTER);
    Object.assign(enemy(world, 'sk1'), { state: 'stunned', t: 30 });
    for (let i = 0; i < 60; i++) machines.sync(world, FRAME);
    const live = machines.pools.spark.items.filter((item) => item.live).length;
    machines.dispose();
    return live;
  };
  const fullSparks = sparks(false);
  assert.ok(fullSparks > 0 && sparks(true) <= Math.ceil(fullSparks / 2) + 1, 'reduced motion halves the sparks');
});

test('Renderer: LEVEL with every actor lit stays inside 150 calls and 300000 triangles', { skip: REAL === null }, (t) => {
  const view = createRenderer(createCanvas({ width: 960, height: 540 }), REAL);
  const world = open(REAL);
  // Every actor at its brightest: relays, stations, sockets and switches on, vents firing, machines in their lit states.
  for (const relay of world.relays) relay.active = true;
  for (const station of world.stations) station.active = true;
  for (const socket of world.sockets) Object.assign(socket, { cell: 'brightest', powered: true });
  for (const latch of world.switches) latch.on = true;
  for (const vent of world.vents) Object.assign(vent, { stage: 'active', t: vent.delay + vent.period - vent.active / 2 });
  for (const e of world.enemies) Object.assign(e, { t: 30, state: { sentinel: 'firing', drone: 'aim', skitter: 'alert' }[e.kind], beam: e.lane ? { ...e.lane } : null });
  const spots = [
    [REAL.spawn.x, REAL.spawn.y], [REAL.ascent.x, REAL.ascent.y],
    ...['cells', 'sockets', 'relays', 'stations', 'archives', 'caches', 'vents', 'switches'].flatMap((key) => REAL[key].map((object) => [object.x, object.y - (key === 'relay' ? 1.2 : 0)])),
    ...world.movers.map((m) => [m.fx + m.w / 2, m.fy + 0.2]), ...REAL.enemies.map((e) => [e.x, e.y]),
  ];
  const seams = world.seams;
  const worst = { calls: 0, triangles: 0 };
  for (const [x, y] of spots) {
    placePlayer(world, x, y);
    for (let frame = 0; frame < 30; frame++) {
      const { x: px, y: py } = world.player;
      Object.assign(world.player, { dashT: 0.16, dashDir: 1 });
      world.pulse = frame % 4 === 0 ? { x: px, y: py + PLAYER.h / 2, r: 3, age: 0, hit: new Set() } : null;
      world.bolts = Array.from({ length: 4 }, (_, i) => ({ id: `bolt${i}`, x: px - 2 + i, y: py + 1, vx: 5, vy: 0, life: 3, w: 0.3, h: 0.3 }));
      const events = frame % 5 === 0 ? [
        ...seams.map((seam) => ({ type: 'seamBreak', id: seam.id, x: seam.x, y: seam.y + seam.h / 2 })),
        { type: 'shield', x: px, y: py }, { type: 'damage', x: px, y: py, cause: 'enemy' }, { type: 'land', x: px, y: py, speed: 13 },
        ...world.relays.map((relay) => ({ type: 'relay', id: relay.id, x: relay.x, y: relay.y, lookAt: relay.lookAt })),
      ] : [];
      view.sync(world, DT, events);
      const { calls, triangles } = view.stats();
      assert.ok(calls > 0 && calls <= 150 && triangles <= 300000, `ILO at (${x}, ${y}), frame ${frame}: ${calls} calls, ${triangles} triangles`);
      worst.calls = Math.max(worst.calls, calls);
      worst.triangles = Math.max(worst.triangles, triangles);
    }
  }
  t.diagnostic(`LEVEL with every actor lit: at most ${worst.calls} calls and ${worst.triangles} triangles in a frame`);
  view.dispose();
});

// --- ILO: the model of GOAL §5, part by part, and its animation set ---

const CERAMIC = new THREE.Color(PALETTE.ceramic);
const CHARCOAL = new THREE.Color(PALETTE.charcoal);
const fixed = (value, digits = 3) => value.toFixed(digits);
const dark = (color) => Math.max(color.r, color.g, color.b) <= 0.05; // no channel above a twentieth
/** Whether a vertex carries `target`, a palette color: the geometry keeps its channels as 32-bit floats. */
const painted = (color, target) => Math.abs(color.r - target.r) < 1e-6 && Math.abs(color.g - target.g) < 1e-6 && Math.abs(color.b - target.b) < 1e-6;

/** The parts of ILO's model by where they hang: the chest carries the torso, the module, the two shoulders, the head and the cape. */
function partsOf(model) {
  const chest = model.getObjectByName('chest');
  const head = chest.children[4];
  /** The pivots of one limb, by joint: `{ hip, knee, ankle }` for a leg, `{ shoulder, elbow }` for an arm. */
  const limb = (side) => Object.fromEntries(['hip', 'knee', 'ankle', 'shoulder', 'elbow'].map((joint) => [joint, model.getObjectByName(`${joint}${side}`)]));
  return {
    body: model.getObjectByName('body'), chest, head, limb,
    torso: chest.children[0], module: chest.children[1], shoulders: [chest.children[2], chest.children[3]], cape: chest.children[5],
    shell: head.children[0], lens: head.children[1], antenna: head.children[2],
  };
}

/** ILO on the flat floor of the workshop range, facing `facing`, shown for `frames` frames: the stage, its world and the parts of its model. */
function standing(frames = 60, facing = 1) {
  const stage = stageOf(LEVELS.workshop);
  const world = open(LEVELS.workshop, 2.5, 0);
  world.player.facing = facing;
  run(stage, world, frames);
  return { stage, world, ...partsOf(mesh(stage, 'ilo')) };
}

/** Every vertex of what `node` carries, with its color, at its place in the frame of `frame`: world units for the scene, fine voxels for a part of ILO's body. */
function verticesIn(node, frame) {
  node.updateWorldMatrix(true, false);
  frame.updateWorldMatrix(true, false);
  const toFrame = frame.matrixWorld.clone().invert();
  const out = [];
  node.traverse((child) => {
    if (!child.isMesh) return;
    const { position, color } = child.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      out.push({
        p: new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).applyMatrix4(toFrame),
        color: new THREE.Color().fromBufferAttribute(color, i),
      });
    }
  });
  return out;
}
const boxOf = (vertices) => new THREE.Box3().setFromPoints(vertices.map((vertex) => vertex.p));
const sizeOf = (box) => box.getSize(new THREE.Vector3());
const centerOf = (box) => box.getCenter(new THREE.Vector3());
/** The mesh a pivot or a group carries. */
const carried = (node) => node.children.find((child) => child.isMesh);

test('ILO: the model is as wide and as tall as the body that collides, and stands on its soles at its position', (t) => {
  const TOLERANCE = 0.05; // units
  for (const facing of [1, -1]) {
    const { stage, world } = standing(60, facing);
    const model = mesh(stage, 'ilo');
    const { x, y } = world.player; // the position of ILO: the center of its feet
    const range = { wide: [], tall: [], soles: [], middle: [] };
    for (let frame = 0; frame < 240; frame++) { // four seconds of idle: the scan, the breathing and the sway of the antenna
      stage.sync(world, FRAME, []);
      stage.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model, true); // from the vertices, not from boxes around turned boxes
      const size = sizeOf(box);
      assert.ok(Math.abs(size.x - PLAYER.w) <= TOLERANCE, `facing ${facing}, frame ${frame}: the model is ${fixed(size.x)} units wide; the body that collides is ${PLAYER.w}`);
      assert.ok(Math.abs(size.y - PLAYER.h) <= TOLERANCE, `facing ${facing}, frame ${frame}: the model is ${fixed(size.y)} units tall; the body that collides is ${PLAYER.h}`);
      assert.ok(Math.abs(box.min.y - y) <= TOLERANCE, `facing ${facing}, frame ${frame}: the soles are ${fixed(box.min.y - y)} units from the position, which is at the feet`);
      assert.ok(Math.abs(centerOf(box).x - x) <= TOLERANCE, `facing ${facing}, frame ${frame}: the middle of the model is ${fixed(centerOf(box).x - x)} units beside the position`);
      range.wide.push(size.x); range.tall.push(size.y); range.soles.push(box.min.y - y); range.middle.push(centerOf(box).x - x);
    }
    const of = (values) => `${fixed(Math.min(...values))} to ${fixed(Math.max(...values))}`;
    t.diagnostic(`facing ${facing}, in idle: ${of(range.wide)} wide, ${of(range.tall)} tall, the soles ${of(range.soles)} from the position, the middle ${of(range.middle)} beside it`);
    stage.dispose();
  }
});

test('ILO: a compact torso stands above the hips, with the head on top of it', () => {
  const { stage, torso, head, limb } = standing();
  const scene = stage.scene;
  const trunk = boxOf(verticesIn(torso, scene));
  const skull = boxOf(verticesIn(head, scene));
  const hips = ['L', 'R'].map((side) => limb(side).hip.getWorldPosition(new THREE.Vector3()).y);
  assert.ok(sizeOf(trunk).y <= PLAYER.h / 3, `the torso is ${fixed(sizeOf(trunk).y)} units tall of a body ${PLAYER.h}: not compact`);
  assert.ok(trunk.min.y > Math.max(...hips), `the torso starts at y ${fixed(trunk.min.y)}, at or below the hips at ${fixed(Math.max(...hips))}`);
  assert.ok(centerOf(skull).y > trunk.max.y, `the center of the head is at y ${fixed(centerOf(skull).y)}, not above the top of the torso at ${fixed(trunk.max.y)}`);
  stage.dispose();
});

test('ILO: the head is a block of ceramic, as wide at the top of its block as at its bottom, and narrower above: chamfered', () => {
  const { stage, shell, head } = standing();
  const vertices = verticesIn(shell, head).filter((vertex) => painted(vertex.color, CERAMIC)); // the head's own frame
  const box = boxOf(vertices);
  assert.ok(sizeOf(box).x >= VOXEL.FINE && sizeOf(box).y >= VOXEL.FINE, 'the head has no ceramic in it');
  const half = new Map(); // a height -> how far the ceramic reaches from the middle there
  for (const vertex of vertices) {
    const y = fixed(vertex.p.y, 6);
    half.set(y, Math.max(half.get(y) ?? 0, Math.abs(vertex.p.x)));
  }
  const levels = [...half.keys()].sort((a, b) => Number(a) - Number(b));
  const widest = Math.max(...half.values());
  const wide = levels.filter((level) => widest - half.get(level) <= 1e-6); // the heights of the full width
  const shoulder = levels.indexOf(wide.at(-1));
  assert.ok(wide.length >= 2, `the ceramic of the head is at its full width on ${wide.length} heights: a block has a bottom and a shoulder`);
  assert.deepEqual(levels.slice(levels.indexOf(wide[0]), shoulder + 1), wide, 'between its bottom and its shoulder the head is narrower than its full width: its sides are not straight');
  const above = levels.slice(shoulder + 1);
  assert.ok(above.length >= 1, 'nothing of the head stands above its shoulders: there is no top to chamfer');
  for (const level of above) assert.ok(widest - half.get(level) >= VOXEL.FINE / 2, `at y ${level}, above the block, the head comes in ${fixed(widest - half.get(level))} units from its sides: its corners are not chamfered`);
  stage.dispose();
});

test('ILO: a dark panel covers the front of the head', () => {
  const { stage, shell, head } = standing();
  const vertices = verticesIn(shell, head);
  const box = boxOf(vertices);
  const size = sizeOf(box);
  const front = vertices.filter((vertex) => dark(vertex.color) && vertex.p.z >= box.max.z - VOXEL.FINE / 2);
  assert.ok(front.length >= 4, `${front.length} dark vertices lie on the front of the head`);
  const panel = sizeOf(boxOf(front));
  assert.ok(panel.x >= 0.5 * size.x && panel.y >= 0.4 * size.y, `the dark panel on the face is ${fixed(panel.x)} by ${fixed(panel.y)} voxels on a head ${fixed(size.x)} by ${fixed(size.y)}`);
  stage.dispose();
});

test('ILO: one amber lens sits on the face panel, off its middle, toward the way ILO faces, and the body turns that way too', () => {
  const AMBER = new THREE.Color(PALETTE.amber);
  for (const facing of [1, -1]) {
    const { stage, body, head, lens, shell } = standing(60, facing);
    const amber = [];
    head.traverse((child) => { if (child.isMesh && verticesIn(child, head).some((vertex) => painted(vertex.color, AMBER))) amber.push(child); });
    assert.ok(amber.length === 1 && amber[0] === lens, `facing ${facing}: ${amber.length} parts of the head carry the palette's amber`);
    const disc = boxOf(verticesIn(lens, head).filter((vertex) => painted(vertex.color, AMBER))); // the head's own frame
    const shellVertices = verticesIn(shell, head);
    const shellBox = boxOf(shellVertices);
    const panel = boxOf(shellVertices.filter((vertex) => dark(vertex.color) && vertex.p.z >= shellBox.max.z - VOXEL.FINE / 2));
    const center = centerOf(disc);
    assert.ok(center.x * facing > 0 && Math.abs(center.x) >= VOXEL.FINE / 2, `facing ${facing}: the lens is at x ${fixed(center.x)} of the face: not off the middle toward the facing`);
    assert.ok(disc.min.x >= panel.min.x - 1e-6 && disc.max.x <= panel.max.x + 1e-6 && disc.min.y >= panel.min.y - 1e-6 && disc.max.y <= panel.max.y + 1e-6, `facing ${facing}: the lens runs x ${fixed(disc.min.x)} to ${fixed(disc.max.x)}, y ${fixed(disc.min.y)} to ${fixed(disc.max.y)}; the panel x ${fixed(panel.min.x)} to ${fixed(panel.max.x)}, y ${fixed(panel.min.y)} to ${fixed(panel.max.y)}`);
    assert.ok(disc.min.z > panel.max.z, `facing ${facing}: the lens starts at z ${fixed(disc.min.z)}, behind the front of the panel at ${fixed(panel.max.z)}`);
    assert.ok(body.rotation.y * facing > 0, `facing ${facing}: the body is turned ${fixed(body.rotation.y)} rad: it does not face the way ILO faces`);
    stage.dispose();
  }
});

test('ILO: a short antenna stands on top of the head and sways', () => {
  const { stage, world, shell, head, antenna } = standing();
  const skull = boxOf(verticesIn(shell, head));
  const rod = boxOf(verticesIn(antenna, head)); // the head's own frame
  assert.ok(Math.abs(rod.min.y - skull.max.y) <= VOXEL.FINE && rod.max.y > skull.max.y, `the antenna runs from y ${fixed(rod.min.y)} to ${fixed(rod.max.y)}; the head ends at ${fixed(skull.max.y)}`);
  assert.ok(rod.max.y - skull.max.y <= 0.3 * sizeOf(skull).y, `the antenna is ${fixed(rod.max.y - skull.max.y)} voxels tall on a head ${fixed(sizeOf(skull).y)}: not short`);
  const tilts = new Set();
  for (let frame = 0; frame < 120; frame++) { // two seconds of idle
    stage.sync(world, FRAME, []);
    tilts.add(fixed(antenna.rotation.z, 4));
  }
  const sway = Math.max(...tilts) - Math.min(...tilts);
  assert.ok(sway >= 0.05, `in idle the antenna sways ${fixed(sway, 4)} rad: it does not move`);
  stage.dispose();
});

test('ILO: four chunky charcoal limbs hang from shoulder, elbow, hip and knee pivots, each turning in a crouch, with an oversized hand on each arm', () => {
  const { stage, world, limb } = standing();
  const QUARTER = 1.25;
  /** How wide the mesh under `pivot` is at each height it has vertices on, in the pivot's frame. */
  const widths = (pivot) => {
    const vertices = verticesIn(carried(pivot), pivot);
    const box = boxOf(vertices);
    const at = new Map();
    for (const vertex of vertices) {
      const key = fixed(vertex.p.y, 6);
      at.set(key, Math.max(at.get(key) ?? 0, Math.abs(vertex.p.x)));
    }
    const bottom = box.min.y;
    const height = sizeOf(box).y;
    return { box, in: (from, to) => [...at].filter(([y]) => Number(y) >= bottom + from * height - 1e-6 && Number(y) <= bottom + to * height + 1e-6).map(([, half]) => 2 * half) };
  };
  for (const side of ['L', 'R']) {
    const { hip, knee, ankle, shoulder, elbow } = limb(side);
    const label = `the ${side} side`;
    for (const pivot of [hip, knee, ankle, shoulder, elbow]) assert.ok(pivot?.isGroup, `${label}: no ${pivot?.name ?? 'missing'} pivot`);
    for (const pivot of [hip, knee, shoulder, elbow]) assert.ok(verticesIn(carried(pivot), stage.scene).some((vertex) => painted(vertex.color, CHARCOAL)), `${label}: the limb under ${pivot.name} is not charcoal`);
    // Chunky: every segment is at least a third as wide as it is long, at its narrowest.
    for (const pivot of [hip, knee, shoulder]) {
      const { box, in: levels } = widths(pivot);
      const narrowest = Math.min(...levels(0, 1));
      assert.ok(narrowest >= sizeOf(box).y / 3, `${label}: the limb under ${pivot.name} is ${fixed(narrowest)} voxels wide and ${fixed(sizeOf(box).y)} long: a stick, not a chunky limb`);
    }
    // An oversized hand: the widest part of the lowest fifth of the forearm is a quarter wider than the narrowest part of its middle half.
    const arm = widths(elbow);
    const hand = Math.max(...arm.in(0, 0.2));
    const fore = Math.min(...arm.in(0.25, 0.75));
    assert.ok(verticesIn(carried(elbow), stage.scene).some((vertex) => painted(vertex.color, CERAMIC)), `${label}: the arm ends in no ceramic hand`);
    assert.ok(hand >= QUARTER * fore, `${label}: the hand is ${fixed(hand)} voxels wide on a forearm ${fixed(fore)}: not oversized`);
    // A chain: the hip above the knee above the ankle, the shoulder above the elbow.
    const [hipY, kneeY, ankleY] = [hip, knee, ankle].map((pivot) => pivot.getWorldPosition(new THREE.Vector3()).y);
    assert.ok(hipY > kneeY && kneeY > ankleY, `${label}: the leg does not hang from the hip through the knee to the ankle`);
    assert.ok(shoulder.getWorldPosition(new THREE.Vector3()).y > elbow.getWorldPosition(new THREE.Vector3()).y, `${label}: the arm does not hang from the shoulder through the elbow`);
    // Articulated: a crouch turns every pivot of the limb.
    setMode(world, 'shutdown');
    world.modeTime = 1; // a second into the shutdown: ILO has slumped into its crouch
    run(stage, world, 45);
    for (const pivot of [hip, knee, ankle, shoulder, elbow]) assert.ok(pivot.rotation.x !== 0 || pivot.rotation.y !== 0 || pivot.rotation.z !== 0, `${label}: the ${pivot.name} pivot does not turn when ILO crouches`);
    setMode(world, 'play');
    run(stage, world, 60);
  }
  stage.dispose();
});

test('ILO: two oversized feet stand apart under the legs, each wider than its leg', () => {
  const { stage, body, limb } = standing();
  const feet = {};
  for (const side of ['L', 'R']) {
    const { hip, knee, ankle } = limb(side);
    const extent = (pivot) => { const box = boxOf(verticesIn(carried(pivot), body)); return [box.min.x, box.max.x]; }; // the body's frame
    feet[side] = extent(ankle);
    const leg = Math.max(sizeOf(boxOf(verticesIn(carried(hip), body))).x, sizeOf(boxOf(verticesIn(carried(knee), body))).x);
    const foot = feet[side][1] - feet[side][0];
    assert.ok(foot >= 1.25 * leg, `the ${side} foot is ${fixed(foot)} voxels wide on a leg ${fixed(leg)} wide: not oversized`);
  }
  assert.ok(feet.L[1] < feet.R[0] || feet.R[1] < feet.L[0], `the feet meet: the left from ${fixed(feet.L[0])} to ${fixed(feet.L[1])}, the right from ${fixed(feet.R[0])} to ${fixed(feet.R[1])}`);
  stage.dispose();
});

test('ILO: a small cyan module sits in the chest, in front of the torso', () => {
  const { stage, module, torso, chest } = standing();
  const vertices = verticesIn(module, chest); // the chest's own frame
  assert.ok(vertices.some((vertex) => painted(vertex.color, new THREE.Color(PALETTE.teal))), 'the module is not the palette\'s cyan');
  const part = boxOf(vertices);
  const trunk = boxOf(verticesIn(torso, chest));
  const size = sizeOf(trunk);
  const partSize = sizeOf(part);
  assert.ok(partSize.x <= 0.4 * size.x && partSize.y <= 0.4 * size.y, `the module is ${fixed(partSize.x)} by ${fixed(partSize.y)} voxels on a torso ${fixed(size.x)} by ${fixed(size.y)}: not small`);
  const center = centerOf(part);
  assert.ok(center.x >= trunk.min.x && center.x <= trunk.max.x && center.y >= trunk.min.y && center.y <= trunk.max.y, `the module's middle is at ${fixed(center.x)}, ${fixed(center.y)}: outside the torso`);
  assert.ok(part.max.z > trunk.max.z, `the module ends at z ${fixed(part.max.z)}, inside the torso, which reaches ${fixed(trunk.max.z)}`);
  stage.dispose();
});

test('ILO: a short rust-orange cape hangs behind the torso from one shoulder, and never reaches the feet', () => {
  const BRONZE = new THREE.Color(PALETTE.bronze);
  const CAPE = new THREE.Color(PALETTE.cape);
  const { stage, shoulders, cape, torso, chest, limb } = standing();
  const scene = stage.scene;
  const near = shoulders.find((shoulder) => Math.sign(shoulder.position.x) === Math.sign(cape.position.x));
  const gap = [(cape.position.x - near.position.x) * VOXEL.FINE, (cape.position.y - near.position.y) * VOXEL.FINE]; // in units: the chest is placed in fine voxels
  assert.ok(Math.abs(gap[0]) <= VOXEL.FINE && Math.abs(gap[1]) <= VOXEL.FINE, `the cape hangs from (${cape.position.x}, ${cape.position.y}) in the chest, the nearest shoulder pivot at (${near.position.x}, ${near.position.y})`);
  const vertices = verticesIn(cape, chest); // the chest's own frame, in units
  const cloth = vertices.filter((vertex) => !painted(vertex.color, BRONZE));
  assert.ok(cloth.some((vertex) => painted(vertex.color, CAPE)), 'the cape is not the palette\'s rust orange');
  assert.ok(vertices.some((vertex) => painted(vertex.color, BRONZE)), 'the cape has no clasp');
  const trunk = boxOf(verticesIn(torso, chest));
  const hanging = boxOf(cloth);
  assert.ok(hanging.max.z < (trunk.min.z + trunk.max.z) / 2, `the cape reaches z ${fixed(hanging.max.z)}, in front of the middle of the torso at ${fixed((trunk.min.z + trunk.max.z) / 2)}`);
  assert.ok(hanging.min.y < cape.position.y - 1, `the cape comes down to y ${fixed(hanging.min.y)} from its clasp at y ${fixed(cape.position.y)} in the chest: it does not hang`);
  const worn = boxOf(verticesIn(cape, scene).filter((vertex) => !painted(vertex.color, BRONZE))); // the scene's frame
  assert.ok(sizeOf(worn).y <= PLAYER.h / 2, `the cape is ${fixed(sizeOf(worn).y)} units long on a body ${PLAYER.h}: not short`);
  const feet = Math.max(...['L', 'R'].map((side) => boxOf(verticesIn(carried(limb(side).ankle), scene)).max.y));
  assert.ok(worn.min.y > feet, `the cape comes down to y ${fixed(worn.min.y)}, over the feet, which reach ${fixed(feet)}`);
  stage.dispose();
});

/** One visual frame of the simulation, as main.js runs it: two steps, the pressed edges on the first only. Returns the events. */
function simulate(world, input) {
  stepWorld(world, input);
  const held = { ...input };
  for (const edge of ['jumpPressed', 'dashPressed', 'pulsePressed', 'interactPressed', 'retryPressed']) held[edge] = false;
  stepWorld(world, world.mode === 'play' ? held : press());
  return world.events.splice(0);
}
/** `world` as the model sees it without an animation: its player reads `hide.fields` instead of what the simulation gave, or its mode is not the one it is in (`hide.mode`). */
const seenAs = (world, hide = {}) => ({ ...world, mode: hide.mode ?? world.mode, player: { ...world.player, ...hide.fields } });
/** Walk on the spot at `speed` units per second: the gait follows the speed, as it does in a run. */
function pace(world, speed) {
  const p = world.player;
  Object.assign(p, { vx: speed, facing: Math.sign(speed), grounded: true });
  p.x += speed * FRAME;
}
const without = (events, type) => events.filter((event) => event.type !== type);
const JUMP = (world, frame) => ({ events: simulate(world, press({ jump: true, jumpPressed: frame === 0 })) });
const DROP = (world) => ({ events: simulate(world, IDLE) });
/** Hold toward the wall; from frame `jumpAt` jump off it. */
const SLIDE = (world, frame, jumpAt = -1) => ({ events: simulate(world, press({ left: true, jump: frame >= jumpAt, jumpPressed: frame === jumpAt })) });
const mode = (name, prepare) => (world, frame) => (frame === 0 && (prepare?.(world), setMode(world, name)), DROP(world));
const SHAFT_WALL = [33.375, 3]; // in the air against the west wall of the shaft of the core range
/** ILO arrives carrying the first cell of the level. */
const carrying = (world) => { Object.assign(world.cells[0], { state: 'carried' }); world.player.carrying = world.cells[0].id; };

/**
 * Every animation of GOAL §5: where ILO starts (`[level, x, y]`), how a frame of the simulation runs (`step`), the
 * frames in which the animation shows (from a frame, or from an event, for so many frames), and what the model must
 * not be shown in the run without the animation (`hide`: an event, fields of the player, or the mode the run is in).
 */
const ANIMATIONS = {
  walking: { at: [CORE, 5, 0], from: 20, for: 60, step: (w) => (pace(w, 2.5), { events: [] }), hide: { fields: { vx: 0 } } },
  running: { at: [CORE, 5, 0], from: 20, for: 60, step: (w) => (pace(w, 6.5), { events: [] }), hide: { fields: { vx: 0 } } },
  takeoff: { at: [CORE, 5, 0], from: 0, for: 7, step: JUMP, hide: { event: 'jump' } },
  ascent: { at: [CORE, 5, 0], from: 10, for: 11, step: JUMP, hide: { fields: { vy: 0 } } },
  falling: { at: [CORE, 5, 3], from: 2, for: 19, step: DROP, hide: { fields: { grounded: true, vy: 0 } } },
  'landing compression': { at: [CORE, 5, 3], from: 'land', for: 10, step: DROP, hide: { event: 'land' } },
  'wall slide': { at: [CORE, ...SHAFT_WALL], from: 5, for: 36, step: SLIDE, hide: { fields: { sliding: false } } },
  'wall jump': { at: [CORE, ...SHAFT_WALL], from: 6, for: 12, step: (w, f) => SLIDE(w, f, 6), hide: { event: 'jump' } },
  'dash lean': { at: [CORE, 5, 0], from: 0, for: 9, step: (w, f) => ({ events: simulate(w, press({ right: true, dashPressed: f === 0 })) }), hide: { fields: { dashT: 0 } } },
  'pulse emission': { at: [CORE, 5, 0], from: 0, for: 18, step: (w, f) => ({ events: simulate(w, press({ pulsePressed: f === 0 })) }), hide: { event: 'pulse' } },
  'lifting and carrying a cell': { at: [LEVELS.cells, ...OBJECT_SPOTS.cells.near], from: 10, for: 50, step: (w, f) => ({ events: simulate(w, press({ interactPressed: f === 0 })) }), hide: { fields: { carrying: null } } },
  'socket interaction': { at: [LEVELS.workshop, 14.5, 0], setup: carrying, from: 1, for: 29, step: (w, f) => ({ events: simulate(w, press({ interactPressed: f === 0 })) }), hide: { event: 'cellInsert' } },
  'relay activation': { at: [CORE, 5, 0], from: 18, for: 71, step: mode('relayActivation'), hide: { mode: 'play' } },
  'damage recoil': { at: [CORE, 5, 0], from: 0, for: 18, hit: true, step: DROP, hide: { event: 'damage' } },
  shutdown: { at: [CORE, 5, 0], from: 27, for: 45, step: mode('shutdown'), hide: { mode: 'play' } },
  'checkpoint reboot': { at: [CORE, 5, 0], from: 76, for: 50, step: mode('shutdown'), hide: { mode: 'play' } }, // the reboot that follows the shutdown
  'lift arrival': { at: [CORE, 76, 10], from: 10, for: 51, step: mode('liftSequence', (w) => { w.ascent.idle = false; }), hide: { mode: 'play' } },
};
const LAST = 125; // the last frame any animation shows in; every run goes from frame 0 to this frame

/** The parts of a model of ILO in the order they come: the same for every model of ILO. */
function partsInOrder(model) {
  const nodes = [];
  model.traverse((node) => { if (node !== model) nodes.push(node); });
  return nodes;
}
/** The pose of ILO's model, one row per part in that order: its place in the model's frame, in units, and its rotation. */
function poseOf(model, nodes) {
  model.updateWorldMatrix(true, true);
  return nodes.map((node) => [node.getWorldPosition(new THREE.Vector3()).sub(model.position), node.quaternion.clone()]);
}
/** How far two poses are apart: the most any part turns, in radians, and moves, in units. */
function apart(a, b) {
  let turn = 0;
  let move = 0;
  for (const [i, [p, q]] of a.entries()) {
    turn = Math.max(turn, 2 * Math.acos(Math.min(1, Math.abs(q.dot(b[i][1])))));
    move = Math.max(move, p.distanceTo(b[i][0]));
  }
  return { turn, move };
}
const farther = (a, b) => ({ turn: Math.max(a.turn, b.turn), move: Math.max(a.move, b.move) });
const nearest = (a, b) => ({ turn: Math.min(a.turn, b.turn), move: Math.min(a.move, b.move) });
const SAME = { turn: Infinity, move: Infinity }; // where the closest comparison starts
const isAnother = (distance, other) => distance.turn >= other.turn || distance.move >= other.move;

/** Play `recipe` on a fresh model: its pose after every frame, and the events the simulation gave. `shown` is false for the run without the animation. */
function play(recipe, shown) {
  const [level, x, y] = recipe.at;
  const world = open(level, x, y);
  recipe.setup?.(world);
  const scene = new THREE.Scene();
  const ilo = createIlo(scene);
  const nodes = partsInOrder(ilo.group);
  const poses = [];
  const given = [];
  for (let frame = 0; frame <= LAST; frame++) {
    if (recipe.hit && frame === 0) { // a hit without energy to shield: integrity pays, as a hit in play does
      world.player.energy = 0;
      assert.equal(hitPlayer(world, { kind: 'enemy', x: world.player.x, y: world.player.y, w: 1, h: 1, sx: world.player.x - 1, sy: world.player.y }), 'damage');
    }
    const { events } = recipe.step(world, frame);
    given.push(events.map((event) => event.type));
    const player = JSON.stringify(world.player); // a pose never moves the body that collides
    ilo.sync(shown ? world : seenAs(world, recipe.hide), FRAME, shown ? events : recipe.hide?.mode ? [] : without(events, recipe.hide?.event)); // a run without its mode shows no pose of an event either
    assert.equal(JSON.stringify(world.player), player, `frame ${frame}: the pose changed the player`);
    poses.push(poseOf(ilo.group, nodes));
  }
  const head = nodes.indexOf(partsOf(ilo.group).head);
  ilo.dispose();
  return { poses, given, head };
}

test('ILO: every animation of GOAL §5 is a pose of its own; none is the idle pose or the pose without its cause', (t) => {
  const OTHER = { turn: 0.1, move: 0.02 }; // a pose is another pose when a part turns a tenth of a radian or moves two hundredths of a unit
  const idle = play({ at: [CORE, 5, 0], step: DROP }, true);
  const yaw = idle.poses.map((pose) => new THREE.Euler().setFromQuaternion(pose[idle.head][1]).y);
  const scan = Math.max(...yaw) - Math.min(...yaw);
  assert.ok(scan >= 0.2, `standing still, ILO's head turns ${fixed(scan, 4)} rad: idle scanning is missing`);
  const failures = [];
  for (const [name, recipe] of Object.entries(ANIMATIONS)) {
    const on = play(recipe, true);
    const off = recipe.hide ? play(recipe, false) : null;
    const from = typeof recipe.from === 'string' ? on.given.findIndex((types, frame) => frame > 0 && types.includes(recipe.from)) : recipe.from;
    if (from < 0) {
      failures.push(`${name}: the simulation never gave a ${recipe.from} event`);
      continue;
    }
    // The pose of a mode holds to the end of its window, so at its closest frame it must still be another pose. A
    // pose that an event or a state brings shows somewhere in its window, so its furthest frame must be another pose.
    const hold = Boolean(recipe.hide?.mode);
    const keep = hold ? nearest : farther;
    const how = hold ? 'at its closest frame' : 'through its window';
    let fromIdle = hold ? SAME : { turn: 0, move: 0 };
    let fromOff = hold ? SAME : { turn: 0, move: 0 };
    for (let frame = from; frame < from + recipe.for; frame++) {
      fromIdle = keep(fromIdle, apart(on.poses[frame], idle.poses[frame]));
      if (off) fromOff = keep(fromOff, apart(on.poses[frame], off.poses[frame]));
    }
    if (!isAnother(fromIdle, OTHER)) failures.push(`${name}: its pose is the idle pose within ${fixed(fromIdle.turn, 4)} rad and ${fixed(fromIdle.move, 4)} units, ${how}`);
    if (off && !isAnother(fromOff, OTHER)) failures.push(`${name}: its pose is the same, within ${fixed(fromOff.turn, 4)} rad and ${fixed(fromOff.move, 4)} units, as without its ${recipe.hide.event ?? (recipe.hide.mode ? `mode ${recipe.hide.mode}` : JSON.stringify(recipe.hide.fields))}, ${how}`);
    t.diagnostic(`${name}: ${hold ? 'at its closest' : 'up to'} ${fixed(fromIdle.turn)} rad and ${fixed(fromIdle.move)} units from idle${off ? `, ${hold ? 'at its closest' : 'up to'} ${fixed(fromOff.turn)} rad and ${fixed(fromOff.move)} units from the pose without it` : ''}`);
  }
  assert.ok(failures.length === 0, failures.join('\n'));
});
