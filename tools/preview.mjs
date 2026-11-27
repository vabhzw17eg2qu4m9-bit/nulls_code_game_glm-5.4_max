#!/usr/bin/env node
// Renders a stage without a browser (contract §5.1): a small software rasterizer writes a PNG, so composition can be
// checked in Node. It is evidence of composition only: scene graph, world matrices, the stage camera, back-face
// culling, a z-buffer, vertex colors times the material color, shading by normal, the scene background, plain alpha.
// No textures, no lights beyond one key direction, no tone mapping.
//
//   node tools/preview.mjs <x> <y> <out.png> [--width 960] [--height 540] [--pose name] [--level core] [--facing left|right]
//     [--view <units>] [--at <x>,<y>] [--steps n] [--reduced] [--target <kind>:<id>] [--effect <name>]...
//     [--enemy <kind>:<state>] [--cell loose|carried|socketed] [--socket on|off] [--switch on|off] [--relay off|on|pulse]
//     [--station on|off] [--archive kept|collected] [--cache full|collected] [--vent dormant|warning|active]
//     [--mover <0..1>] [--press rest|warn|drop|rise] [--lift <stage>]
//
// `<x>, <y>` is where ILO stands. `--pose` is one of idle, walk, run, jump, fall, land, slide, walljump, dash, pulse,
// carry, shutdown, reboot. The level is `src/level/level.js`, or the core fixture with `--level core`.
// `--view` is the visible width in world units and `--at <x>,<y>` the center of the image (default: what the camera
// rig gives). The other options put the objects, the enemies and the effects of the real world into a state
// (`SETTERS`, `EFFECTS`).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import * as THREE from '../vendor/three/three.module.js';
import { DT, LIFT, PLAYER, PULSE } from '../src/config.js';
import { placeCamera, viewRect } from '../src/render/camera.js';
import { createStage } from '../src/render/renderer.js';
import { buildGrid } from '../src/sim/collision.js';
import { createPlayer, placePlayer } from '../src/sim/player.js';
import { createWorld, stepWorld } from '../src/sim/world.js';

// How a pose is set up: player fields (speeds and sides follow the facing), events replayed on the first sync, the
// mode and its age, and how long `sync` runs: `steps` of `dt` seconds (default 1/60). Timed poses stay inside their
// own duration.
const POSES = {
  idle: { steps: 40 },
  walk: { p: { vx: 2.5 }, steps: 44 },
  run: { p: { vx: 6.5 }, steps: 50 },
  jump: { p: { grounded: false, vy: 8 }, events: ['jump'], steps: 3, dt: 0.03 },
  fall: { p: { grounded: false, vy: -10 }, steps: 16 },
  land: { events: [{ type: 'land', speed: 13 }], steps: 3, dt: 0.05 },
  slide: { p: { grounded: false, sliding: true, wall: 1, vy: -3 }, steps: 16 },
  walljump: { p: { grounded: false, vy: 7, vx: -7 }, events: [{ type: 'jump', wall: 1 }], steps: 3, dt: 0.04 },
  dash: { p: { dashT: 0.16, dashDir: 1, vx: 15 }, steps: 8 },
  pulse: { events: ['pulse'], steps: 3, dt: 0.08 },
  carry: { p: { carrying: 'preview' }, steps: 40 },
  shutdown: { mode: 'shutdown', modeTime: 0.6, steps: 50 },
  reboot: { mode: 'reboot', modeTime: 0.9, steps: 40 },
};
const SIDED = new Set(['vx', 'wall', 'dashDir']); // player fields that flip with the facing

const USAGE = `usage: node tools/preview.mjs <x> <y> <out.png> [--width 960] [--height 540] [--pose name] [--level core] [--facing left|right]
       [--view <units>] [--at <x>,<y>] [--steps n] [--reduced] [--target <kind>:<id>] [--effect <name>]...
       [--enemy <kind>:<state>] [--cell loose|carried|socketed] [--socket on|off] [--switch on|off] [--relay off|on|pulse]
       [--station on|off] [--archive kept|collected] [--cache full|collected] [--vent dormant|warning|active]
       [--mover <0..1>] [--press rest|warn|drop|rise] [--lift <stage>]`;

/** The options of `render` from a command line without the program path, checked. */
export function parse(argv) {
  const [x, y, out, ...rest] = argv;
  const options = {
    x: Number(x), y: Number(y), out, pose: 'idle', width: 960, height: 540, core: false, facing: 1,
    view: 0, at: null, steps: 0, reduced: false, target: null, effects: [], set: {},
  };
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i].replace(/^--/, '');
    const value = rest[i + 1] === undefined || rest[i + 1].startsWith('--') ? 'on' : rest[++i];
    if (name === 'pose') options.pose = value;
    else if (name === 'width') options.width = Number(value);
    else if (name === 'height') options.height = Number(value);
    else if (name === 'level') options.core = value === 'core';
    else if (name === 'facing') options.facing = value === 'left' ? -1 : 1;
    else if (name === 'view') options.view = Number(value);
    else if (name === 'at') options.at = { x: Number(value.split(',')[0]), y: Number(value.split(',')[1]) };
    else if (name === 'steps') options.steps = Number(value);
    else if (name === 'reduced') options.reduced = true;
    else if (name === 'target') options.target = value;
    else if (name === 'effect') options.effects.push(value);
    else if (name in SETTERS) options.set[name] = value;
    else throw new Error(`unknown option '--${name}'\n${USAGE}`);
  }
  if (![options.x, options.y, options.width, options.height, options.view].every(Number.isFinite) || out === undefined || out.startsWith('--')) {
    throw new Error(USAGE);
  }
  if (!(options.pose in POSES)) throw new Error(`unknown pose '${options.pose}': ${Object.keys(POSES).join(', ')}`);
  for (const effect of options.effects) {
    if (!(effect in EFFECTS)) throw new Error(`unknown effect '${effect}': ${Object.keys(EFFECTS).join(', ')}`);
  }
  return options;
}

async function loadLevel(core) {
  const fixture = () => import('../tests/fixtures/core.js').then((module) => module.LEVEL);
  if (core) return fixture();
  return import('../src/level/level.js').then((module) => module.LEVEL, (error) => {
    console.error(`src/level/level.js cannot be loaded: ${error.code ?? error.message}`);
    process.exit(1);
  });
}

/** A world of the stable simulation modules only: a stage needs nothing the object and enemy modules add. */
function makeWorld(level, x, y) {
  const world = {
    level, time: 0, clock: 0, mode: 'play', modeTime: 0, player: createPlayer(x, y), camera: { lookAt: null },
    seams: level.seams, reveals: [], movers: [], cells: [], sockets: level.sockets ?? [], switches: level.switches ?? [],
    relays: level.relays ?? [], ascent: level.ascent, grid: buildGrid(level.solids), events: [],
  };
  placePlayer(world, x, y);
  return world;
}

const NEUTRAL = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false, pulsePressed: false, interactPressed: false, retryPressed: false,
});
const SPENT = 12; // steps a machine has already spent in the state an image asks for
const nearest = (list, at) => list.toSorted((a, b) => Math.abs(a.x - at.x) - Math.abs(b.x - at.x))[0];

/**
 * Mover power as the simulation computes it: a mover without `poweredBy` always runs. A shutter is put where its
 * power leaves it, open or shut: nothing steps the world after this.
 */
function power(world) {
  for (const m of world.movers) {
    m.powered = m.poweredBy.length === 0 || m.poweredBy.some((id) => world.sockets.some((s) => s.id === id && s.cell !== null)
      || world.switches.some((s) => s.id === id && s.on) || world.relays.some((r) => r.id === id && r.active));
    if (m.kind === 'shutter') {
      m.t = m.powered ? 1 : 0;
      m.x = m.fx + (m.tx - m.fx) * m.t;
      m.y = m.fy + (m.ty - m.fy) * m.t;
    }
  }
}

/**
 * The setters: each takes the world and its option value and leaves every object of its kind in the state named.
 * `at` is where ILO stands: what a machine faces or aims at.
 */
const SETTERS = {
  /**
   * Every enemy of `kind` in `state`. A sentinel that fires and a drone that shoots get there the real way: one step
   * of the simulation with ILO beside the first of them computes the beam and lets the bolt go.
   */
  enemy(world, spec, at) {
    const [kind, state] = spec.split(':');
    const mine = world.enemies.filter((e) => e.kind === kind);
    const shot = state === 'firing' || state === 'fire';
    for (const e of mine) {
      Object.assign(e, { state: shot ? (kind === 'sentinel' ? 'warning' : 'aim') : state, t: shot ? Math.round((kind === 'sentinel' ? 0.9 : 0.8) / DT) - 1 : SPENT, beam: null });
      const dx = at.x - e.x;
      const dy = at.y + PLAYER.h / 2 - (e.y + e.h / 2);
      if (state === 'alert' || state === 'lunge') e.facing = Math.sign(dx) || 1;
      if (state === 'aim') e.aimDir = { x: dx / Math.hypot(dx, dy), y: dy / Math.hypot(dx, dy) };
    }
    if (shot && mine.length > 0) {
      const [first] = mine;
      placePlayer(world, first.x + 3 * (kind === 'sentinel' ? first.dir : 1), first.y - 0.3); // in its lane
      stepWorld(world, NEUTRAL);
      for (const e of mine) e.t = kind === 'sentinel' ? 24 : 6;
    }
  },
  skitter: (world, state, at) => SETTERS.enemy(world, `skitter:${state}`, at),
  drone: (world, state, at) => SETTERS.enemy(world, `drone:${state}`, at),
  sentinel: (world, state, at) => SETTERS.enemy(world, `sentinel:${state}`, at),
  /** Every cell loose at home, the first one carried, or each in the socket of its rank. */
  cell(world, state) {
    world.player.carrying = null;
    for (const socket of world.sockets) Object.assign(socket, { cell: null, powered: false });
    world.cells.forEach((cell, i) => {
      const socket = state === 'socketed' ? world.sockets[i] : undefined;
      if (socket === undefined) Object.assign(cell, { state: 'loose', socket: null, x: cell.home.x, y: cell.home.y });
      else {
        Object.assign(cell, { state: 'socketed', socket: socket.id, x: socket.x, y: socket.y });
        Object.assign(socket, { cell: cell.id, powered: true });
      }
      if (state === 'carried' && i === 0) {
        cell.state = 'carried';
        world.player.carrying = cell.id;
      }
    });
    power(world); // the shutters a socket opens stand open
  },
  /** Every socket with a cell in it (lit), or empty. */
  socket(world, on) {
    for (const socket of world.sockets) Object.assign(socket, { cell: on === 'off' ? null : socket.cell ?? 'preview', powered: on !== 'off' });
    power(world);
  },
  switch(world, on) {
    for (const latch of world.switches) latch.on = on !== 'off';
    power(world);
  },
  /** Every relay active or not; `pulse` also starts the celebration of the one nearest ILO. */
  relay(world, on, at) {
    for (const relay of world.relays) relay.active = on !== 'off';
    power(world);
    const near = nearest(world.relays, at);
    if (on === 'pulse' && near !== undefined) {
      world.mode = 'relayActivation';
      world.modeTime = 0.7;
      world.camera.lookAt = { ...near.lookAt };
    }
  },
  station(world, on) {
    for (const station of world.stations) station.active = on !== 'off';
  },
  archive(world, value) {
    for (const archive of world.archives) archive.collected = value === 'collected';
  },
  cache(world, value) {
    for (const cache of world.caches) cache.collected = value === 'collected';
  },
  /** Every vent in `stage`, halfway through it. */
  vent(world, stage) {
    for (const vent of world.vents) {
      const cycle = vent.period - vent.warn - vent.active;
      vent.t = stage === 'warning' ? vent.delay + cycle + vent.warn / 2 : stage === 'active' ? vent.delay + cycle + vent.warn + vent.active / 2 : 0;
      vent.stage = stage;
    }
  },
  /** Every platform, shutter and cabin at `part` of its travel. */
  mover(world, part) {
    for (const m of world.movers) {
      if (m.kind === 'press') continue;
      m.t = Number(part);
      m.x = m.fx + (m.tx - m.fx) * m.t;
      m.y = m.fy + (m.ty - m.fy) * m.t;
    }
  },
  /** Every press resting, warning at rest, or halfway down or up. */
  press(world, stage) {
    for (const m of world.presses) {
      m.x = m.fx;
      m.y = m.fy + (m.ty - m.fy) * (stage === 'drop' || stage === 'rise' ? 0.5 : 0);
      m.stage = stage === 'rest' ? null : stage;
    }
  },
  /** The ascent lift in `stage`, reached the real way: the simulation scripts the sequence up to the middle of it. */
  lift(world, stage) {
    if (world.ascent === null) return;
    world.ascent.idle = false;
    world.mode = 'liftSequence';
    const start = LIFT.board + LIFT.barrier + LIFT.rise;
    // The terrace 1.2 s in: its barrier has opened and ILO has begun to walk out.
    const until = { board: LIFT.board / 2, barrier: LIFT.board + LIFT.barrier * 0.8, rise: start - LIFT.rise / 2, surface: start + LIFT.surface / 2, terrace: start + LIFT.surface + 1.2 }[stage];
    for (let i = 0; i < Math.round(until / DT); i++) stepWorld(world, NEUTRAL);
  },
};
/** The order the setters run in: what is powered before what it moves, the enemies after the rest, the lift's script last. */
const ORDER = ['cell', 'socket', 'switch', 'relay', 'station', 'archive', 'cache', 'vent', 'mover', 'press', 'enemy', 'skitter', 'drone', 'sentinel', 'lift'];

/**
 * What an effect needs: setters to run first, player fields, how far the pulse wave has grown, the events replayed
 * on the first sync, and how many steps show it.
 */
const EFFECTS = {
  dash: { p: { dashT: 0.16, dashDir: 1, vx: 15 }, steps: 8 },
  pulse: { wave: 0.6, steps: 2 },
  seam: {
    steps: 10,
    events: (world, at) => {
      const seam = nearest(world.seams, at);
      seam.broken = true;
      return [{ type: 'seamBreak', id: seam.id, x: seam.x + seam.w / 2, y: seam.y + seam.h / 2 }];
    },
  },
  shield: { steps: 3, events: (world, at) => [{ type: 'shield', x: at.x, y: at.y }] },
  damage: { steps: 2, events: (world, at) => [{ type: 'damage', x: at.x, y: at.y, cause: 'enemy' }] },
  land: { steps: 4, events: (world, at) => [{ type: 'land', x: at.x, y: at.y, speed: 13, surface: 'rock' }] },
  relay: {
    steps: 4,
    events: (world, at) => {
      const { id, x, y, lookAt } = nearest(world.relays, at);
      return [{ type: 'relay', id, x, y, lookAt: { ...lookAt } }];
    },
  },
  vent: { set: { vent: 'active' }, steps: 45 },
  surface: { set: { lift: 'surface' }, steps: 70 },
};

/**
 * The world of the simulation with the objects, the enemies and the effects in the state `options` asks for. Returns
 * the world, the events to replay on the first sync, and whether a script has placed ILO.
 */
function stagedWorld(level, options) {
  const world = createWorld(level);
  world.mode = 'play';
  const at = { x: options.x, y: options.y };
  let scripted = false;
  const run = (name, value) => {
    SETTERS[name](world, value, at);
    scripted ||= name === 'lift';
  };
  for (const name of ORDER) if (options.set[name] !== undefined) run(name, options.set[name]);
  const events = [];
  for (const name of options.effects) {
    const setup = EFFECTS[name];
    for (const [key, value] of Object.entries(setup.set ?? {})) run(key, value);
    events.push(...(setup.events?.(world, at) ?? []));
    if (setup.wave !== undefined) {
      world.pulse = { x: at.x, y: at.y + PLAYER.h / 2, r: PULSE.radius * setup.wave, age: PULSE.expandTime * setup.wave, hit: new Set() };
    }
  }
  if (options.target !== null) {
    const [kind, id] = options.target.split(':');
    world.interactTarget = { kind, id };
  }
  world.events.length = 0;
  return { world, events, scripted };
}

const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A PNG of `width × height` sRGB bytes. */
export function png(width, height, bytes) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) bytes.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Draw `scene` as `camera` sees it; returns `width × height × 3` sRGB bytes. */
export function rasterize(scene, camera, width, height) {
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  const clip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(clip);
  const buffer = new Float32Array(width * height * 3);
  const depth = new Float32Array(width * height).fill(Infinity);
  const back = scene.background;
  for (let i = 0; i < buffer.length; i += 3) buffer.set([back.r, back.g, back.b], i);
  // A lit face gets what Three.js computes for a Lambert material: per channel, the irradiance of the scene's
  // hemisphere, ambient and directional lights, over pi.
  const hemis = [];
  const dirs = [];
  const rgb = (color) => [color.r, color.g, color.b];
  scene.traverseVisible((object) => {
    if (object.isHemisphereLight) hemis.push([rgb(object.color), rgb(object.groundColor), object.intensity, object.getWorldPosition(new THREE.Vector3()).normalize()]);
    else if (object.isAmbientLight) hemis.push([rgb(object.color), rgb(object.color), object.intensity, new THREE.Vector3(0, 1, 0)]);
    else if (object.isDirectionalLight && object.intensity > 0) dirs.push([rgb(object.color), object.intensity, object.getWorldPosition(new THREE.Vector3()).sub(object.target.getWorldPosition(new THREE.Vector3())).normalize()]);
  });

  // What draws: meshes with a position attribute whose bounding sphere meets the view, translucent ones last and far
  // ones first. A mesh without geometry or positions (a sentinel's beam before it fires) draws nothing, and so does
  // anything hidden: `traverseVisible` never enters an invisible object.
  const opaque = [];
  const translucent = [];
  const center = new THREE.Vector3();
  scene.traverseVisible((object) => {
    if (!object.isMesh || object.geometry?.attributes?.position === undefined) return;
    if (object.geometry.boundingSphere === null) object.geometry.computeBoundingSphere();
    const sphere = object.geometry.boundingSphere.clone().applyMatrix4(object.matrixWorld);
    if (object.frustumCulled && !frustum.intersectsSphere(sphere)) return;
    center.setFromMatrixPosition(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    (object.material.transparent ? translucent : opaque).push([object, center.z]);
  });
  translucent.sort((a, b) => a[1] - b[1]);

  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const paint = [[1, 1, 1], [1, 1, 1], [1, 1, 1]]; // vertex color times the material color, per corner
  const shades = [new Float64Array(3), new Float64Array(3), new Float64Array(3)]; // light on each corner, per channel
  const alphas = [1, 1, 1];
  const screen = [0, 0, 0, 0, 0, 0];
  const normal = new THREE.Vector3();

  for (const [object] of [...opaque, ...translucent]) {
    const { geometry, material } = object;
    const toScreen = clip.clone().multiply(object.matrixWorld); // local to normalized device coordinates
    const position = geometry.attributes.position;
    const colors = geometry.attributes.color;
    const unlit = material.isMeshLambertMaterial !== true; // anything but a lit material shows its colors as they are
    const mirrored = object.matrixWorld.determinant() < 0;
    const { start } = geometry.drawRange;
    const end = start + Math.min(geometry.drawRange.count, geometry.index ? geometry.index.count : position.count);
    for (let t = start; t + 2 < end; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = geometry.index ? geometry.index.getX(t + k) : t + k;
        corners[k].fromBufferAttribute(position, i).applyMatrix4(toScreen);
        screen[k * 2] = ((corners[k].x + 1) * width) / 2;
        screen[k * 2 + 1] = ((1 - corners[k].y) * height) / 2;
        for (let c = 0; c < 3; c++) paint[k][c] = colors === undefined ? 1 : colors.array[i * colors.itemSize + c];
        if (material.color !== undefined) {
          paint[k][0] *= material.color.r;
          paint[k][1] *= material.color.g;
          paint[k][2] *= material.color.b;
        }
        alphas[k] = material.opacity * (colors?.itemSize === 4 ? colors.getW(i) : 1);
        shades[k].fill(unlit ? 1 : 0);
        if (!unlit) {
          normal.fromBufferAttribute(geometry.attributes.normal, i).transformDirection(object.matrixWorld);
          for (const [sky, ground, intensity, dir] of hemis) {
            const w = (0.5 * normal.dot(dir) + 0.5) * intensity;
            for (let c = 0; c < 3; c++) shades[k][c] += ground[c] * (intensity - w) + sky[c] * w;
          }
          for (const [color, intensity, dir] of dirs) {
            const dot = Math.max(0, normal.dot(dir)) * intensity;
            for (let c = 0; c < 3; c++) shades[k][c] += color[c] * dot;
          }
          for (let c = 0; c < 3; c++) shades[k][c] /= Math.PI;
        }
      }
      // Screen y runs down, so a front face has a negative area; a mirrored object flips that.
      let area = (screen[2] - screen[0]) * (screen[5] - screen[1]) - (screen[4] - screen[0]) * (screen[3] - screen[1]);
      if (area === 0 || ((area < 0) === mirrored && material.side !== THREE.DoubleSide)) continue;
      if (area > 0) {
        for (const list of [paint, shades, alphas, corners]) [list[1], list[2]] = [list[2], list[1]];
        [screen[2], screen[4]] = [screen[4], screen[2]];
        [screen[3], screen[5]] = [screen[5], screen[3]];
        area = -area;
      }
      const [x0, y0, x1, y1, x2, y2] = screen;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
      const [z0, z1, z2] = corners.map((corner) => corner.z);
      const translucentMesh = material.transparent;
      const additive = translucentMesh && material.blending === THREE.AdditiveBlending;
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5;
          const cy = py + 0.5;
          const e0 = (x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0);
          const e1 = (x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1);
          const e2 = (x0 - x2) * (cy - y2) - (y0 - y2) * (cx - x2);
          if (e0 > 0 || e1 > 0 || e2 > 0) continue;
          const w0 = e1 / area;
          const w1 = e2 / area;
          const w2 = e0 / area;
          const pixel = py * width + px;
          const z = w0 * z0 + w1 * z1 + w2 * z2;
          if (z > depth[pixel]) continue;
          const alpha = w0 * alphas[0] + w1 * alphas[1] + w2 * alphas[2];
          for (let c = 0; c < 3; c++) {
            const src = w0 * paint[0][c] * shades[0][c] + w1 * paint[1][c] * shades[1][c] + w2 * paint[2][c] * shades[2][c];
            buffer[pixel * 3 + c] = additive ? buffer[pixel * 3 + c] + src * alpha : translucentMesh ? src * alpha + buffer[pixel * 3 + c] * (1 - alpha) : src;
          }
          if (!translucentMesh) depth[pixel] = z;
        }
      }
    }
  }
  const bytes = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) bytes[i * 3 + c] = Math.round(255 * srgb(Math.min(1, Math.max(0, buffer[i * 3 + c]))));
  }
  return bytes;
}

/**
 * Render one image for parsed `options` (see `parse`): the level with ILO at `(x, y)` in its pose. Returns PNG bytes.
 */
export async function render(options) {
  const level = await loadLevel(options.core);
  const setup = POSES[options.pose];
  const stage = createStage(level);
  // With an actor option, the real world: the setters and the effects leave it in the state asked for.
  const staged = options.target !== null || options.effects.length > 0 || Object.keys(options.set).length > 0;
  const { world, events: replayed, scripted } = staged ? stagedWorld(level, options) : { world: makeWorld(level, options.x, options.y), events: [], scripted: false };
  if (staged && !scripted) {
    placePlayer(world, options.x, options.y);
    if (options.set.cell === 'carried') world.player.carrying = world.cells[0]?.id ?? null;
  }
  world.player.facing = options.facing;
  const fields = { ...setup.p };
  for (const name of options.effects) Object.assign(fields, EFFECTS[name].p);
  for (const [name, value] of Object.entries(fields)) world.player[name] = SIDED.has(name) ? value * options.facing : value;
  if (setup.mode !== undefined) {
    world.mode = setup.mode;
    world.modeTime = setup.modeTime;
  }
  const events = [...(setup.events ?? []).map((event) => (typeof event === 'string' ? { type: event } : event)), ...replayed];
  const dt = setup.dt ?? 1 / 60;
  const steps = options.steps || options.effects.reduce((count, name) => Math.max(count, EFFECTS[name].steps ?? 0), setup.steps);
  stage.setReducedMotion(options.reduced);
  stage.resize(options.width, options.height);
  for (let step = 0; step < steps; step++) {
    stage.sync(world, dt, step === 0 ? events : []);
    world.time += dt;
  }
  // A close-up shows `view` units of width around `at`; otherwise the camera stays where the rig put it.
  if (options.view > 0 || options.at !== null) {
    const origin = stage.camera.position.clone();
    const axis = stage.camera.getWorldDirection(new THREE.Vector3());
    const center = origin.addScaledVector(axis, -origin.z / axis.z); // where the camera axis meets the gameplay plane
    const rigged = 2 * viewRect({ x: 0, y: 0, unitsPerPixel: 1 }, options.width, options.height).x1; // units across the plane at 1 unit per pixel
    placeCamera(stage.camera, { x: options.at?.x ?? center.x, y: options.at?.y ?? center.y, unitsPerPixel: (options.view || rigged) / rigged, shakeX: 0, shakeY: 0 }, options.width, options.height);
  }
  return png(options.width, options.height, rasterize(stage.scene, stage.camera, options.width, options.height));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parse(process.argv.slice(2));
  writeFileSync(options.out, await render(options));
  console.log(`${options.out}: pose ${options.pose}, ILO at (${options.x}, ${options.y}) facing ${options.facing > 0 ? 'right' : 'left'}, ${options.width}x${options.height}, view ${options.view || 'rig'}${options.at ? ` at ${options.at.x},${options.at.y}` : ''}`);
}
