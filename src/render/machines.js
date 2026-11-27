// Machines (contract §5.1): the enemy models of GOAL §12, the cable skitter, the prism drone with its bolts and the
// shutter sentinel, each with a look per state (shape and motion first, light second) and a contact shadow where a
// machine meets the ground.

import * as THREE from '../../vendor/three/three.module.js';
import { DT } from '../config.js';
import { dynamicSolids, overlaps, staticHits } from '../sim/collision.js';
import { particleMesh, particlePool } from './effects.js';
import { PALETTE, VoxelBuilder, contactShadow, hash, material } from './voxel.js';

const Z = 0.12; // world z of a machine's back face: in front of the terrain and of wall-mounted scenery
const DROP = 10; // units of fall below which a machine still casts its contact shadow
const FLIGHT = 20; // units of a bolt's whole flight (speed 5, life 4 s): how far a targeting line looks
const STRIDE = 2.2; // walk cycles per unit a skitter travels
const RATE = 30; // per second: how fast a machine's pose approaches the pose of its state
const CYAN = 0x9fefff; // sparks
const LENS = { patrol: 0x59d8e6, aim: PALETTE.amber, fire: 0xfff0c8, stunned: 0x9fb6bd, disabled: 0x9fb6bd }; // the drone's lens by state
const HIPS = [[-0.36, 0.06], [0, 0.06], [0.36, 0.06], [-0.36, 0.5], [0, 0.5], [0.36, 0.5]]; // skitter legs: the far side front to rear, then the near side
const OPEN = { closed: 0.05, warning: 0.22, firing: 0.62, venting: 1, disabled: 0.5 }; // how far the sentinel's panels slide apart: shut leaves a slit
const CORE = { closed: 0.35, warning: 0.9, firing: 2.4, venting: 1.8, disabled: 0.04 }; // and how bright its core burns through them
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const approach = (value, target, dt) => value + (target - value) * (1 - Math.exp(-RATE * dt));

/** A thin member from `(x0, y0)` to `(x1, y1)` at depth `z`: a row of `size` cubes, the voxel way to draw a slope. */
function strut(b, x0, y0, x1, y1, z, size, color) {
  const count = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / (size * 0.75)));
  for (let i = 0; i <= count; i++) {
    b.box(x0 + ((x1 - x0) * i) / count, y0 + ((y1 - y0) * i) / count, z, size, size, size, color);
  }
}

// --- Cable skitter ---

/** The hull in the frame of the body: +x is the nose, y 0 the hull's bottom, z 0 its back face. */
function skitterHull() {
  const b = new VoxelBuilder();
  b.box(0, 0.15, 0.28, 1.0, 0.3, 0.56, PALETTE.steel, 'FBTRL'); // the skid plate below is its floor
  b.tone = 0.75;
  b.box(0, 0.03, 0.28, 1.02, 0.06, 0.58, PALETTE.steelDark);
  b.box(0, 0.315, 0.3, 0.7, 0.03, 0.4, PALETTE.steelDark);
  b.tone = 1;
  b.box(0, 0.335, 0.3, 0.34, 0.01, 0.2, PALETTE.bronze, 'FTR');
  b.box(0, 0.22, 0.565, 0.66, 0.12, 0.01, PALETTE.charcoal, 'FTR');
  b.box(0.5, 0.15, 0.28, 0.03, 0.24, 0.5, PALETTE.bronze, 'FTR');
  b.box(-0.5, 0.15, 0.28, 0.03, 0.24, 0.5, PALETTE.rust, 'FTL');
  b.box(0.3, 0.31, 0.28, 0.22, 0.02, 0.3, 0x1e2328, 'FTR');
  for (let i = 0; i < 4; i++) b.box(0.22 + i * 0.055, 0.322, 0.28, 0.02, 0.01, 0.26, PALETTE.steel, 'FTR');
  for (const x of [-0.42, 0.42]) b.box(x, 0.2, 0.566, 0.06, 0.06, 0.01, PALETTE.metalEdge, 'F');
  return b;
}

/** The amber sensor bar in the hull's visor slot. */
function skitterBar() {
  const b = new VoxelBuilder();
  b.box(0, 0.22, 0.572, 0.56, 0.06, 0.012, PALETTE.amber, 'FTR');
  return b;
}

/** A leg in the frame of its hip: an upper member out to a bronze knee, a shin down to the foot. */
function skitterLeg() {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 0.085, 0.085, 0.085, PALETTE.steel);
  strut(b, 0, 0, 0.15, -0.05, 0, 0.06, PALETTE.charcoal);
  b.box(0.15, -0.05, 0, 0.085, 0.085, 0.085, PALETTE.bronze);
  strut(b, 0.15, -0.05, 0.19, -0.27, 0, 0.05, PALETTE.charcoal);
  b.box(0.19, -0.285, 0, 0.1, 0.03, 0.08, PALETTE.steel);
  return b;
}

/** The trailing cable in the frame of the skitter's feet: it leaves the tail, sags to the ground and runs back to a plug. */
function skitterCable() {
  const b = new VoxelBuilder();
  const count = 34;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    b.box(-0.5 - 1.9 * t, Math.max(0.035, 0.34 * (1 - t / 0.32)), 0.2 + 0.12 * Math.sin(t * 9), 0.07, 0.07, 0.07, i % 6 === 0 ? PALETTE.bronze : 0x1c2126);
  }
  b.box(-2.46, 0.07, 0.2, 0.18, 0.14, 0.14, PALETTE.steel);
  b.box(-2.38, 0.07, 0.2, 0.04, 0.16, 0.16, PALETTE.bronze);
  return b;
}

/**
 * The pose a skitter reaches for in its state. `lift` is the hull bottom above the ground, `pitch` a nose-up tilt,
 * `front`, `middle` and `rear` the leg angles (positive swings a foot forward), `len` how far the legs reach out.
 */
function skitterPose(e, seconds, phase) {
  const P = { lift: 0.3, pitch: 0, roll: 0, yaw: 0, bar: 0.9, front: 0, middle: 0, rear: 0, len: 1, walk: 0 };
  const settle = Math.exp(-seconds * 5);
  switch (e.state) {
    case 'dormant': return { ...P, lift: 0.1, bar: 0.15, front: -0.9, middle: -0.2, rear: 0.9, len: 0.5 };
    case 'alert': return { ...P, lift: 0.4, pitch: 0.24, bar: 2.4, front: 0.6, middle: 0.1, rear: -0.45, len: 1.05 };
    case 'lunge': return { ...P, lift: 0.26, pitch: -0.2, bar: 2.2, front: -0.5, middle: -0.7, rear: -0.9, len: 0.8 };
    case 'recover': return { ...P, lift: 0.3 - 0.08 * settle, pitch: 0.14 * Math.sin(seconds * 16) * settle, front: 0.25, rear: -0.25, len: 0.88 };
    case 'stunned': return { ...P, lift: 0.1, bar: 0, front: 1.25, middle: 1.2, rear: -1.25, len: 0.8 };
    case 'disabled': return { ...P, lift: 0.06, roll: -1.25, yaw: 0.4, bar: 0, front: 0.9, middle: -0.2, rear: 0.7, len: 0.7 };
    default: return { ...P, walk: 0.5, lift: 0.3 + 0.02 * Math.sin(phase * 2), pitch: 0.03 * Math.sin(phase * 2) };
  }
}

// --- Prism drone ---

/** The faceted body in the frame of the drone's middle, z 0 at its back face. */
function droneCore() {
  const b = new VoxelBuilder();
  b.box(0, 0, 0.22, 0.5, 0.34, 0.44, PALETTE.steelDark);
  b.box(0, 0.19, 0.2, 0.34, 0.14, 0.4, PALETTE.steel);
  b.box(0, -0.19, 0.2, 0.34, 0.14, 0.4, PALETTE.steel);
  b.box(0, 0.3, 0.17, 0.18, 0.08, 0.34, PALETTE.bronze);
  b.box(0, -0.3, 0.17, 0.18, 0.08, 0.34, PALETTE.bronze);
  b.box(0, 0, 0.445, 0.3, 0.3, 0.02, PALETTE.charcoal, 'FTR');
  b.box(0.252, 0, 0.22, 0.01, 0.12, 0.2, PALETTE.bronze, 'R');
  return b;
}

/** The lens on the front of the body: it slides toward what the drone looks at. */
function droneLens() {
  const b = new VoxelBuilder();
  b.box(0, 0, 0.462, 0.17, 0.17, 0.012, 0xffffff, 'FTRL');
  b.box(0, 0, 0.468, 0.09, 0.09, 0.012, 0xffffff, 'FTRL');
  return b;
}

/** Three plates spaced around the body's middle: the mesh turns about z, so they orbit. */
function dronePlates() {
  const b = new VoxelBuilder();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 0.66;
    const y = Math.sin(a) * 0.66;
    b.box(x, y, 0.22, 0.34, 0.14, 0.06, PALETTE.steel);
    b.box(x, y, 0.22, 0.22, 0.06, 0.07, PALETTE.bronze);
    b.box(x, y, 0.255, 0.06, 0.06, 0.005, PALETTE.crystal, 'F');
  }
  return b;
}

/** A targeting line of unit length along +x from the lens. */
function droneLine() {
  const b = new VoxelBuilder();
  b.box(0.5, 0, 0, 1, 0.035, 0.035, [PALETTE.amber, 0.45]);
  b.box(0.5, 0, 0, 1, 0.012, 0.012, [0xfff0c8, 0.9]);
  return b;
}

/** A bolt in the frame of its centre: a glowing shot with a short tail behind it (toward -x). */
function boltShot() {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 0.3, 0.3, 0.3, [PALETTE.amber, 0.4]);
  b.box(0, 0, 0, 0.2, 0.2, 0.2, [0xffd890, 0.85]);
  b.box(0, 0, 0, 0.1, 0.1, 0.1, [0xffffff, 1]);
  for (const [x, size, alpha] of [[-0.26, 0.18, 0.5], [-0.44, 0.13, 0.3], [-0.58, 0.08, 0.15]]) {
    b.box(x, 0, 0, 0.22, size, size, [PALETTE.amber, alpha]);
  }
  return b;
}

// --- Shutter sentinel ---

/** The housing in the frame of the fixture: local +x is the side it fires toward, y 0 the floor, z 0 the wall. */
function sentinelFrame() {
  const b = new VoxelBuilder();
  b.box(0, 1, 0.05, 1.5, 2, 0.1, PALETTE.steelDark);
  b.box(0, 1.75, 0.3, 1.5, 0.5, 0.4, PALETTE.steel);
  b.box(0, 0.25, 0.3, 1.5, 0.5, 0.4, PALETTE.steel);
  b.box(-0.68, 1, 0.3, 0.14, 1, 0.4, PALETTE.steel);
  b.box(0.68, 1, 0.3, 0.14, 1, 0.4, PALETTE.steel);
  b.box(0.08, 1, 0.052, 0.5, 0.44, 0.104, PALETTE.charcoal); // the recess the core sits in: the armor panels slide in front of it
  for (const y of [0.25, 1.75]) {
    b.box(0, y, 0.505, 1.3, 0.04, 0.01, PALETTE.bronze, 'F');
    for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) b.box(x, y + 0.14, 0.505, 0.14, 0.03, 0.01, 0x1e2328, 'F');
  }
  for (const x of [-0.68, 0.68]) for (const y of [0.7, 1.3]) b.box(x, y, 0.505, 0.06, 0.06, 0.01, PALETTE.metalEdge, 'F');
  b.box(0.68, 1, 0.505, 0.1, 0.34, 0.01, 0x1e2328, 'F'); // the muzzle port
  b.box(0.75, 1, 0.26, 0.06, 0.6, 0.28, PALETTE.bronze, 'FTR');
  for (const y of [0.3, 1.7]) b.box(-0.4, y, -0.04, 0.3, 0.08, 0.08, PALETTE.bronze);
  b.box(0, 2.04, 0.3, 0.24, 0.08, 0.16, PALETTE.steelDark);
  return b;
}

/** An armor panel in the frame of its lower edge: ribs, rivets and a dark lip along the edge that meets the other panel. */
function sentinelPanel() {
  const b = new VoxelBuilder();
  b.box(0, 0.25, 0.21, 1.2, 0.5, 0.18, PALETTE.steel);
  for (const y of [0.2, 0.4]) {
    b.box(0, y, 0.305, 1.06, 0.05, 0.01, PALETTE.bronze, 'F');
    for (const x of [-0.44, -0.15, 0.15, 0.44]) b.box(x, y, 0.315, 0.07, 0.07, 0.01, PALETTE.metalEdge, 'F');
  }
  b.box(0, 0.02, 0.3, 1.2, 0.04, 0.01, 0x1e2328, 'F');
  return b;
}

/** The red-orange core in the aperture: stepped squares that brighten toward the muzzle. */
function sentinelCore() {
  const b = new VoxelBuilder();
  b.box(0.08, 1, 0.054, 0.44, 0.44, 0.108, 0x7a2410);
  b.box(0.08, 1, 0.088, 0.3, 0.3, 0.056, PALETTE.hazard);
  b.box(0.08, 1, 0.102, 0.16, 0.16, 0.036, 0xffd9a0);
  b.box(0.68, 1, 0.507, 0.05, 0.2, 0.01, PALETTE.hazard, 'F'); // the port on the muzzle side burns with the core
  return b;
}

/** The warning light on top of the housing. */
function sentinelLamp() {
  const b = new VoxelBuilder();
  b.box(0, 2.1, 0.3, 0.2, 0.06, 0.14, 0xffb080, 'FT');
  b.box(0, 2.13, 0.3, 0.12, 0.02, 0.1, 0xffffff, 'FT');
  return b;
}

/** A beam of `w × h` in the frame of its rect's corner: a translucent envelope, a bright middle and a white core. */
function sentinelBeam(w, h) {
  const b = new VoxelBuilder();
  b.box(w / 2, h / 2, 0.34, w, h, 0.36, [0xff7a40, 0.3]);
  b.box(w / 2, h / 2, 0.34, w, h * 0.6, 0.34, [0xffa060, 0.4]);
  b.box(w / 2, h / 2, 0.34, w, h * 0.24, 0.3, [0xffe0b0, 0.75]);
  b.box(w / 2, h / 2, 0.34, w, h * 0.1, 0.26, [0xffffff, 0.95]);
  return b.build();
}

/** The warning line along the lane: a unit length along +x. */
function sentinelLine() {
  const b = new VoxelBuilder();
  b.box(0.5, 0, 0, 1, 0.05, 0.05, [PALETTE.hazard, 0.4]);
  b.box(0.5, 0, 0, 1, 0.016, 0.016, [0xffd9a0, 0.85]);
  return b;
}

/**
 * How far `rect` travels along `(dx, dy)` before it meets solid cover, at most `max` units. With `tall`, only
 * cover that spans the rect's whole height counts: the rule that cuts a sentinel's beam.
 */
function reach(world, rect, dx, dy, max, tall) {
  const solids = dynamicSolids(world);
  for (let d = 0.1; d <= max; d += 0.1) {
    const probe = { x: rect.x + dx * d, y: rect.y + dy * d, w: rect.w, h: rect.h };
    const block = (s) => overlaps(probe, s) && (!tall || (s.y <= rect.y && s.y + s.h >= rect.y + rect.h));
    if (staticHits(world, probe).some(block) || solids.some(block)) return d - 0.1;
  }
  return max;
}

/** The sentinel's lane up to its cover: what its warning line shows, and its beam when the simulation gives none. */
function laneOf(world, e) {
  const lane = e.lane;
  const d = reach(world, lane, e.dir, 0, lane.w, true);
  return { x: e.dir > 0 ? lane.x : lane.x + lane.w - d, y: lane.y, w: d, h: lane.h };
}

/**
 * The machines of `level` as `{ sync(world, dt, events), setReducedMotion(on), pools, dispose() }`; `pools` maps
 * the name of each particle effect to its fixed pool. With reduced motion nothing trembles or flashes: a telegraph
 * holds a steady light instead, and half as many particles spawn.
 */
export function createMachines(scene, level) {
  const root = new THREE.Group();
  root.name = 'machines';
  scene.add(root);
  const geometries = new Set();
  const materials = new Set();
  const built = (builder) => {
    const geometry = builder.build();
    geometries.add(geometry);
    return geometry;
  };
  const lit = (geometry) => new THREE.Mesh(geometry, material('plain'));
  /** A glowing part with a material of its own, so `sync` can dim or brighten it; `additive` makes it translucent light. */
  const glowPart = (geometry, additive) => {
    const object = new THREE.Mesh(geometry, additive ? material('glow').clone() : new THREE.MeshBasicMaterial({ vertexColors: true }));
    materials.add(object.material);
    return object;
  };
  const unit = (kind, id, x, y, z = 0) => {
    const group = new THREE.Group();
    group.name = `${kind}:${id}`;
    group.position.set(x, y, z);
    root.add(group);
    return group;
  };
  const pools = { spark: particlePool(20), wisp: particlePool(12), ember: particlePool(12) };
  const list = Object.values(pools);
  const glow = particleMesh(list, true);
  const views = [];
  root.add(glow.object);
  // One geometry per part, shared by every machine of its kind.
  const shapes = {
    cable: built(skitterCable()), bar: built(skitterBar()), hull: built(skitterHull()), leg: built(skitterLeg()),
    core: built(droneCore()), plates: built(dronePlates()), lens: built(droneLens()), line: built(droneLine()), bolt: built(boltShot()),
    frame: built(sentinelFrame()), panel: built(sentinelPanel()), heart: built(sentinelCore()), lamp: built(sentinelLamp()), lane: built(sentinelLine()),
  };
  const lensTint = new THREE.Color();
  const aimTint = new THREE.Color();
  let time = 0;
  let roll = 0;
  let reduced = false;
  const rnd = (salt) => hash(roll++, salt, 83);
  const rate = (full) => (reduced ? full / 2 : full);
  const blink = (period) => reduced || Math.sin((time / period) * Math.PI * 2) > 0;

  /** Put `shadow` on the ground under a machine at `(x, y)`, smaller the higher the machine is. */
  function groundShadow(world, shadow, x, y) {
    let top = -Infinity;
    for (const solid of staticHits(world, { x: x - 0.3, y: y - DROP, w: 0.6, h: DROP + 0.02 })) {
      if (solid.y + solid.h <= y + 0.02) top = Math.max(top, solid.y + solid.h);
    }
    const height = y - top;
    shadow.visible = height < DROP;
    if (shadow.visible) {
      shadow.position.set(x, top + 0.012, -0.1);
      shadow.scale.setScalar(clamp(1 - height / DROP, 0.35, 1));
    }
  }

  // --- Cable skitter: a low hull on six legs, a trailing cable, an amber sensor bar ---

  function skitter(def) {
    const group = unit('skitter', def.id, def.x, def.y, Z);
    const facing = new THREE.Group();
    group.add(facing);
    facing.add(lit(shapes.cable));
    const body = new THREE.Group();
    facing.add(body);
    const bar = glowPart(shapes.bar);
    bar.name = 'bar';
    body.add(lit(shapes.hull), bar);
    const legs = HIPS.map(([x, z]) => {
      const leg = lit(shapes.leg);
      leg.position.set(x, 0, z);
      body.add(leg);
      return leg;
    });
    const shadow = contactShadow(1.3);
    root.add(shadow);
    const c = { lift: 0.1, pitch: 0, roll: 0, yaw: 0, bar: 0.15, len: 0.5, walk: 0, a: HIPS.map(() => 0) };
    const view = { kind: 'skitter', id: def.id, group, facing, body, bar, legs, shadow, c, phase: 0, lastX: def.x, off: 0, spark: 0 };
    views.push(view);
  }

  function skitterSync(view, e, world, dt) {
    const seconds = e.t * DT;
    const P = skitterPose(e, seconds, view.phase);
    view.off = e.state === 'disabled' ? view.off + dt : 0;
    view.phase += Math.abs(e.x - view.lastX) * STRIDE * Math.PI * 2;
    view.lastX = e.x;
    if (e.state === 'stunned') {
      // Stunned: the hull shakes on its splayed legs and cyan sparks jump off it.
      if (!reduced) {
        P.roll = 0.08 * Math.sin(time * 25);
        P.yaw = 0.2 * Math.sin(time * 17);
      }
      view.spark += dt * rate(20);
    }
    if (e.state === 'alert') P.bar = reduced ? 2.4 : blink(0.14) ? 2.6 : 0.5;
    const c = view.c;
    for (const key of ['lift', 'pitch', 'roll', 'yaw', 'bar', 'len', 'walk']) c[key] = approach(c[key], P[key], dt);
    view.legs.forEach((leg, l) => {
      const station = l % 3;
      const far = l < 3;
      const base = station === 0 ? P.front : station === 2 ? P.rear : far && e.state === 'stunned' ? -P.middle : P.middle;
      const swing = ((station + (far ? 0 : 1)) % 2) * Math.PI;
      c.a[l] = approach(c.a[l], base + P.walk * Math.sin(view.phase + swing), dt);
      leg.rotation.z = c.a[l];
      leg.scale.y = c.len - 0.2 * c.walk * Math.max(0, Math.cos(view.phase + swing));
    });
    view.group.position.x = e.x;
    view.group.position.y = e.y;
    view.facing.scale.x = e.facing || 1;
    view.body.position.y = c.lift;
    view.body.rotation.set(c.roll, c.yaw, c.pitch);
    view.bar.material.color.setScalar(c.bar);
    groundShadow(world, view.shadow, e.x, e.y);
    while (view.spark >= 1) {
      view.spark -= 1;
      pools.spark.spawn({
        x: e.x + (rnd(1) - 0.5), y: e.y + c.lift + 0.3 - rnd(2) * 0.3, z: Z + 0.5, w: 0.05 + 0.04 * rnd(3), h: 0.05, d: 0.05,
        vx: (rnd(4) - 0.5) * 3, vy: 0.5 + 1.7 * rnd(5), g: -9, color: CYAN, a: 0.9, life: 0.3 + 0.2 * rnd(6),
      });
    }
    // Disabled: dark and tipped on its back, with a last wisp off the hull.
    if (e.state === 'disabled' && view.off < 3 && rnd(7) < dt * rate(8)) {
      pools.wisp.spawn({
        x: e.x + (rnd(8) - 0.5) * 0.6, y: e.y + 0.2, z: Z + 0.3, w: 0.08, h: 0.08, d: 0.08, vy: 0.25 + 0.15 * rnd(9), vx: (rnd(10) - 0.5) * 0.2,
        grow: 0.25, color: 0xbfe8e8, a: 0.22, life: 1.1,
      });
    }
  }

  // --- Prism drone: a faceted unit, three orbiting plates, a lens that takes aim ---

  function drone(def) {
    const group = unit('drone', def.id, def.x, def.y, Z);
    const body = new THREE.Group();
    body.position.y = 0.45;
    group.add(body);
    body.add(lit(shapes.core));
    const plates = lit(shapes.plates);
    plates.name = 'plates';
    const lens = glowPart(shapes.lens);
    lens.name = 'lens';
    body.add(plates, lens);
    const line = glowPart(shapes.line, true);
    line.name = 'targetLine';
    root.add(line);
    const shadow = contactShadow(0.9);
    root.add(shadow);
    views.push({ kind: 'drone', id: def.id, group, body, plates, lens, line, shadow, angle: 0.8, state: def.state ?? 'patrol', tint: new THREE.Color(LENS.patrol), c: { speed: 2.2, drop: 0, tilt: 0, turn: 0, light: 1, kick: 0 } });
  }

  function droneSync(view, e, world, dt) {
    const seconds = e.t * DT;
    const c = view.c;
    const P = { speed: 2.2, drop: 0, tilt: -0.05 * (e.facing || 1), turn: 0, light: 1, kick: 0, lens: LENS.patrol };
    switch (e.state) {
      case 'aim': Object.assign(P, { speed: 0, tilt: 0, light: 1.3, lens: LENS.aim }); break;
      case 'fire': Object.assign(P, { speed: 0, tilt: 0, light: 2.4, kick: 0.14, lens: LENS.fire }); break;
      case 'cooldown': Object.assign(P, { drop: 0.05, tilt: 0, lens: aimTint.setHex(LENS.aim).lerp(lensTint.setHex(LENS.patrol), clamp(seconds / 2.5, 0, 1)).getHex() }); break;
      case 'stunned':
        Object.assign(P, { speed: 0, drop: 0.22, tilt: reduced ? 0.3 : 0.35 * Math.sin(seconds * 9), turn: reduced ? 0 : 0.2 * Math.sin(seconds * 13), light: reduced ? 0.2 : blink(0.12) ? 0.45 : 0.08, lens: LENS.stunned });
        break;
      case 'disabled': Object.assign(P, { speed: 0, drop: 0.3, tilt: 0.5, turn: 0.5, light: 0.04, lens: LENS.disabled }); break;
      default:
    }
    if (e.state === 'fire' && view.state !== 'fire' && !reduced) {
      // The shot: a small flash off the lens.
      for (let i = 0; i < 3; i++) {
        pools.spark.spawn({ x: e.x, y: e.y + 0.45, z: Z + 0.5, w: 0.1, h: 0.1, d: 0.05, vx: e.aimDir.x * 2 + (rnd(20) - 0.5), vy: e.aimDir.y * 2 + (rnd(21) - 0.5), color: 0xffe0a0, a: 0.8, life: 0.16 });
      }
    }
    view.state = e.state;
    for (const key of ['speed', 'drop', 'tilt', 'turn', 'light', 'kick']) c[key] = approach(c[key], P[key], dt);
    view.tint.lerp(aimTint.setHex(P.lens), 1 - Math.exp(-8 * dt));
    const aim = e.aimDir ?? { x: 1, y: 0 };
    view.angle += c.speed * (reduced ? 0.5 : 1) * dt;
    const bob = 0.04 * (c.speed / 2.2) * Math.sin(time * 3 + view.angle);
    view.body.position.set(-aim.x * c.kick, 0.45 - c.drop + bob - aim.y * c.kick, 0);
    view.body.rotation.set(0, c.turn, c.tilt);
    view.plates.rotation.z = view.angle;
    view.lens.position.set(aim.x * 0.07, aim.y * 0.07, 0);
    view.lens.material.color.copy(view.tint).multiplyScalar(c.light);
    // Aim: a narrow line runs from the lens along the aim direction as far as a bolt would get.
    view.line.visible = e.state === 'aim';
    if (view.line.visible) {
      const far = reach(world, { x: e.x - 0.15, y: e.y + 0.45, w: 0.3, h: 0.3 }, aim.x, aim.y, FLIGHT, false);
      const length = (far - 0.4) * Math.min(1, seconds / 0.5);
      view.line.position.set(e.x + aim.x * 0.4, e.y + 0.45 + aim.y * 0.4, Z + 0.5);
      view.line.rotation.z = Math.atan2(aim.y, aim.x);
      view.line.scale.set(Math.max(length, 0.001), 1, 1);
      view.line.material.opacity = reduced ? 0.8 : 0.6 + 0.3 * Math.sin(time * 18);
    }
    groundShadow(world, view.shadow, e.x, e.y);
  }

  // --- Shutter sentinel: a wall fixture whose armor slides apart over a burning core ---

  function sentinel(def) {
    const group = unit('sentinel', def.id, def.x, def.y);
    const facing = new THREE.Group(); // mirrored toward the side the sentinel fires at
    facing.scale.x = def.dir;
    facing.position.z = Z;
    group.add(facing);
    const upper = lit(shapes.panel);
    upper.name = 'upperPanel';
    const lower = lit(shapes.panel);
    lower.name = 'lowerPanel';
    lower.scale.y = -1;
    const core = glowPart(shapes.heart);
    core.name = 'core';
    const lamp = new THREE.Mesh(shapes.lamp, material('emissive'));
    lamp.name = 'lamp';
    facing.add(lit(shapes.frame), upper, lower, core, lamp);
    // The lane line and the beam lie in the lane, so they take world directions.
    const line = glowPart(shapes.lane, true);
    line.name = 'laneLine';
    const beam = new THREE.Mesh(new THREE.BufferGeometry(), material('glow').clone());
    beam.name = 'beam';
    beam.visible = false; // nothing to draw until a sync gives it a beam
    materials.add(beam.material);
    group.add(line, beam);
    views.push({ kind: 'sentinel', id: def.id, group, upper, lower, core, lamp, line, beam, rect: null, ember: 0, c: { open: 0, core: CORE.closed } });
  }

  function sentinelSync(view, e, world, dt) {
    const seconds = e.t * DT;
    const c = view.c;
    c.open = approach(c.open, OPEN[e.state] ?? 0, dt);
    c.core = approach(c.core, CORE[e.state] ?? CORE.closed, dt);
    view.group.position.x = e.x;
    view.group.position.y = e.y;
    const part = c.open * 0.44;
    view.upper.position.y = 1 + part;
    view.lower.position.y = 1 - part;
    view.core.material.color.setScalar(c.core);
    // Warning: the light and the lane line blink together; firing and venting: the light stays on.
    const warning = e.state === 'warning';
    view.lamp.visible = warning ? blink(0.3) : e.state === 'firing' || e.state === 'venting';
    view.line.visible = warning;
    if (warning) {
      const rect = laneOf(world, e);
      view.line.position.set((e.dir > 0 ? rect.x : rect.x + rect.w) - e.x, rect.y + rect.h / 2 - e.y, Z + 0.4);
      view.line.rotation.z = e.dir > 0 ? 0 : Math.PI;
      view.line.scale.set(Math.max(rect.w, 0.001), 1, 1);
      view.line.material.opacity = reduced ? 0.9 : blink(0.3) ? 0.95 : 0.3;
    }
    // Firing: the beam fills the lane rect exactly. It flares in, holds and dies with the burst.
    view.beam.visible = e.state === 'firing';
    if (view.beam.visible) {
      const rect = e.beam ?? laneOf(world, e);
      const key = `${rect.x}|${rect.y}|${rect.w}|${rect.h}`;
      if (key !== view.rect) {
        view.beam.geometry.dispose();
        geometries.delete(view.beam.geometry);
        view.beam.geometry = sentinelBeam(rect.w, rect.h);
        geometries.add(view.beam.geometry);
        view.beam.position.set(rect.x - e.x, rect.y - e.y, Z);
        view.rect = key;
      }
      view.beam.material.opacity = Math.min(1, seconds / 0.05, (0.8 - seconds) / 0.12) * (reduced ? 1 : 0.86 + 0.14 * Math.sin(time * 60));
    }
    // Venting: the core is exposed and bright, and embers rise off it.
    view.ember += e.state === 'venting' ? dt * rate(10) : 0;
    while (view.ember >= 1) {
      view.ember -= 1;
      pools.ember.spawn({ x: e.x + (rnd(30) - 0.5) * 0.3, y: e.y + 1, z: Z + 0.4, w: 0.04 + 0.03 * rnd(31), h: 0.04, d: 0.04, vy: 0.4 + 0.6 * rnd(32), vx: (rnd(33) - 0.5) * 0.4, color: 0xffa060, a: 0.8, life: 0.6 });
    }
  }

  for (const def of level.enemies ?? []) {
    if (def.kind === 'skitter') skitter(def);
    else if (def.kind === 'drone') drone(def);
    else sentinel(def);
  }
  // Bolts: every bolt in flight gets a shot of the pool, turned along its course.
  const shots = Array.from({ length: 4 }, () => {
    const object = new THREE.Mesh(shapes.bolt, material('glow'));
    object.name = 'bolt';
    object.visible = false;
    root.add(object);
    return object;
  });
  pools.bolt = { limit: shots.length, items: shots.map((object) => ({ live: false, age: 0, life: 4, object })) };

  /** Show every machine as it is in `world` now. Nothing moves while `dt` is 0. */
  function sync(world, dt) {
    time += dt;
    for (const e of world.enemies ?? []) {
      const view = views.find((candidate) => candidate.id === e.id);
      if (view === undefined) continue;
      if (view.kind === 'skitter') skitterSync(view, e, world, dt);
      else if (view.kind === 'drone') droneSync(view, e, world, dt);
      else sentinelSync(view, e, world, dt);
    }
    const bolts = world.bolts ?? [];
    pools.bolt.items.forEach((item, i) => {
      const b = bolts[i];
      item.live = b !== undefined;
      item.age = item.life - (b?.life ?? item.life);
      item.object.visible = item.live;
      if (item.live) {
        item.object.position.set(b.x, b.y + 0.15, 0.4);
        item.object.rotation.z = Math.atan2(b.vy, b.vx);
      }
    });
    for (const pool of list) pool.step(dt);
    glow.draw();
  }

  return {
    sync,
    pools,
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      scene.remove(root);
      for (const geometry of geometries) geometry.dispose();
      for (const own of materials) own.dispose();
      glow.dispose();
    },
  };
}
