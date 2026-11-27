// Effects (contract §5.1, GOAL §18): the transient visuals of the run: a dash trail, the pulse ring, crystal
// fragments, shield facets, a recoil flash, landing dust, conduit light, ambient dust, vent steam and the dust
// drift at the surface. Every effect is a pool of fixed size, and the box-shaped particles of one blending mode
// share one mesh. Everything draws at world z 0.12 and above, except the pulse ring, which sits a little behind
// the terrain's front faces so that rock cuts it.

import * as THREE from '../../vendor/three/three.module.js';
import { PLAYER, PULSE } from '../config.js';
import { staticHits } from '../sim/collision.js';
import { depthOffset } from './camera.js';
import { PALETTE, VoxelBuilder, hash, material } from './voxel.js';

/** Seconds: the longest any particle of an effect lives. */
const LIFE = Object.freeze({
  dash: 0.24, ring: PULSE.expandTime + 0.12, seam: 0.9, shield: 0.36, flash: 0.2, dust: 0.55, conduit: 0.65,
  air: 10, steam: 1.2, drift: 4.5,
});
/** Particles per effect, ever. */
const LIMIT = Object.freeze({ dash: 24, ring: 1, seam: 28, shield: 2, flash: 10, dust: 20, conduit: 7, air: 28, steam: 24, drift: 20 });
const RING_DEPTH = 0.3; // units behind the gameplay plane: behind every front face of the terrain
const RING_AFTER = 0.12; // seconds the ring takes to fade once the wave is over
const SHARD = [0xe0a247, 0xc9862f, 0xf0bd5e]; // the facet tones of a seam (as terrain.js draws it)
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const turn = Math.PI * 2;

const template = new VoxelBuilder().box(0, 0, 0, 1, 1, 1, 0xffffff).build();
const CORNER = template.attributes.position.array; // the 24 corners of a unit box, at ±0.5
const FACE = Array.from(template.index.array); // its 12 triangles
template.dispose();
const VERTICES = 24;
const TRIANGLES = 12;

/**
 * A pool of at most `limit` particles. A particle is a box of `w × h × d` centred at `(x, y, z)` with an sRGB
 * `color` and a peak alpha `a`; it moves with `(vx, vy, vz)`, gains `g` per second, is damped by `drag` per second,
 * grows `grow` units per second, rests on `floor`, and fades over `life` seconds of `age`.
 */
export function particlePool(limit) {
  const items = Array.from({ length: limit }, () => ({ live: false, age: 0, life: 1 }));
  return {
    limit,
    items,
    /** Wake a free particle, or the one closest to its end when every slot is busy; `fields` shape it. */
    spawn(fields) {
      let slot = null;
      for (const item of items) {
        if (!item.live) {
          slot = item;
          break;
        }
        if (slot === null || item.age / item.life > slot.age / slot.life) slot = item;
      }
      return Object.assign(slot, { vx: 0, vy: 0, vz: 0, g: 0, drag: 0, grow: 0, floor: -Infinity }, fields, { live: true, age: 0 });
    },
    /** Age and move the live particles by `dt` seconds; one that has lived its life is gone. */
    step(dt) {
      for (const p of items) {
        if (!p.live) continue;
        p.age += dt;
        if (p.age >= p.life) {
          p.live = false;
          continue;
        }
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp;
        p.vy = p.vy * damp + p.g * dt;
        p.vz *= damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const grow = p.grow * dt;
        p.w += grow;
        p.h += grow;
        p.d += grow;
        if (p.y - p.h / 2 < p.floor) {
          p.y = p.floor + p.h / 2;
          p.vx *= 0.6;
          p.vy = p.vy < 0 ? -p.vy * 0.35 : 0;
        }
      }
    },
  };
}

/**
 * One mesh for the live particles of `pools`: at most the sum of their limits, one draw call, never culled.
 * `additive` stacks light (sparks, streaks); otherwise every box is a translucent haze (dust, steam, shards).
 */
export function particleMesh(pools, additive) {
  const capacity = pools.reduce((sum, pool) => sum + pool.limit, 0);
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 4), 4);
  const index = new Uint32Array(capacity * TRIANGLES * 3);
  for (let i = 0; i < capacity; i++) {
    for (let k = 0; k < TRIANGLES * 3; k++) index[i * TRIANGLES * 3 + k] = FACE[k] + i * VERTICES;
  }
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const own = additive ? material('glow') : new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const object = new THREE.Mesh(geometry, own);
  object.frustumCulled = false;
  object.visible = false;
  const tint = new THREE.Color();
  return {
    object,
    /** Put every live particle into the mesh. */
    draw() {
      let count = 0;
      for (const pool of pools) {
        for (const p of pool.items) {
          if (!p.live) continue;
          const edge = Math.min(0.35, p.life / 3);
          const alpha = p.a * clamp(Math.min(p.age / (edge * 0.25), (p.life - p.age) / edge), 0, 1);
          tint.setHex(p.color);
          for (let v = 0; v < VERTICES; v++) {
            const at = count * VERTICES + v;
            position.array[at * 3] = p.x + CORNER[v * 3] * p.w;
            position.array[at * 3 + 1] = p.y + CORNER[v * 3 + 1] * p.h;
            position.array[at * 3 + 2] = p.z + CORNER[v * 3 + 2] * p.d;
            color.array[at * 4] = tint.r;
            color.array[at * 4 + 1] = tint.g;
            color.array[at * 4 + 2] = tint.b;
            color.array[at * 4 + 3] = alpha;
          }
          count++;
        }
      }
      geometry.setDrawRange(0, count * TRIANGLES * 3);
      position.needsUpdate = true;
      color.needsUpdate = true;
      object.visible = count > 0;
    },
    dispose() {
      geometry.dispose();
      if (!additive) own.dispose();
    },
  };
}

/** A unit ring in the xy-plane, transparent inside and bright at the rim: scaled by the wave's radius it is the wave front. */
function ringGeometry() {
  const b = new VoxelBuilder();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * turn;
    const c = ((i + 1) / 48) * turn;
    b.quad(
      [[Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0], [Math.cos(c) * 0.78, Math.sin(c) * 0.78, 0], [Math.cos(c), Math.sin(c), 0], [Math.cos(a), Math.sin(a), 0]],
      [[PALETTE.crystal, 0], [PALETTE.crystal, 0], [PALETTE.crystalCore, 0.9], [PALETTE.crystalCore, 0.9]],
    );
  }
  return b.build();
}

/** The shield: nine flat facets in a ring around ILO's middle, bright inside and fading out, with gaps between them. */
function shieldGeometry() {
  const b = new VoxelBuilder();
  for (let i = 0; i < 9; i++) {
    const a = ((i + 0.5) / 9) * turn;
    const at = (r, angle, z) => [Math.cos(angle) * r, Math.sin(angle) * r, z];
    b.quad(
      [at(0.46, a - 0.2, 0.1), at(0.46, a + 0.2, 0.1), at(0.86, a + 0.25, 0), at(0.86, a - 0.25, 0)],
      [[PALETTE.crystalCore, 0.95], [PALETTE.crystalCore, 0.95], [PALETTE.teal, 0.3], [PALETTE.teal, 0.3]],
    );
  }
  return b.build();
}

/** The top of the highest static solid below `(x, y)`: where falling fragments come to rest. */
function floorUnder(world, x, y) {
  let top = -Infinity;
  for (const solid of staticHits(world, { x: x - 0.1, y: y - 5, w: 0.2, h: 5 })) {
    if (solid.y + solid.h <= y + 0.02) top = Math.max(top, solid.y + solid.h);
  }
  return top;
}

/**
 * The effects as `{ sync(world, dt, events), setReducedMotion(on), pools, dispose() }`; `pools` maps the
 * name of each effect to its fixed pool. With reduced motion every effect spawns half as many, and the flashes
 * (the recoil flash, the shield's spread) are gone.
 */
export function createEffects(scene) {
  const root = new THREE.Group();
  root.name = 'effects';
  scene.add(root);
  const pools = Object.fromEntries(Object.keys(LIMIT).map((name) => [name, particlePool(LIMIT[name])]));
  const lights = [pools.dash, pools.flash, pools.conduit];
  const hazes = [pools.seam, pools.dust, pools.air, pools.steam, pools.drift];
  const boxes = [...lights, ...hazes];
  const glow = particleMesh(lights, true);
  const haze = particleMesh(hazes, false);
  const ringGeometryShared = ringGeometry();
  const ring = new THREE.Mesh(ringGeometryShared, material('glow').clone());
  ring.name = 'pulseRing';
  const facetsGeometry = shieldGeometry();
  const facets = pools.shield.items.map((item) => {
    const object = new THREE.Mesh(facetsGeometry, material('glow').clone());
    item.mesh = object;
    root.add(object);
    return object;
  });
  const owned = [ring.material, haze.object.material, ...facets.map((object) => object.material)];
  const behind = depthOffset(RING_DEPTH);
  root.add(glow.object, haze.object, ring);

  let frame = 0;
  let roll = 0;
  let steam = 0;
  let drift = 0;
  let seeded = false;
  let reduced = false;
  const rnd = (salt) => hash(roll++, salt, 71);
  const share = (count) => (reduced ? Math.ceil(count / 2) : count);
  const born = (pool, fields) => pools[pool].spawn({ life: LIFE[pool], ...fields });

  /** The pulse ring: it follows the wave, then fades out where the wave ended, never wider than the wave was. */
  function ringSync(world, dt) {
    const wave = world.pulse ?? null;
    const item = pools.ring.items[0];
    if (wave !== null) {
      Object.assign(item, { live: true, age: wave.age, life: LIFE.ring });
      ring.position.set(wave.x + behind.x, wave.y + behind.y, behind.z);
      ring.scale.setScalar(Math.max(wave.r, 0.001));
      ring.material.opacity = 1 - 0.5 * Math.min(1, wave.age / PULSE.expandTime);
    } else if (item.live) {
      item.age += dt;
      item.live = item.age < item.life;
      ring.material.opacity = 0.5 * clamp((item.life - item.age) / RING_AFTER, 0, 1);
    }
    ring.visible = item.live;
  }

  /** Shield facets: they spread a little and fade. */
  function shieldSync() {
    for (const item of pools.shield.items) {
      const object = item.mesh;
      object.visible = item.live;
      if (!item.live) continue;
      const t = item.age / item.life;
      object.material.opacity = (1 - t) * (reduced ? 0.5 : 1);
      object.scale.setScalar(reduced ? 1 : 1 + 0.18 * t);
    }
  }

  /** Ambient dust: motes drift around ILO; each lives out its life and is reborn somewhere else around ILO. */
  function airSync(p) {
    const quota = share(LIMIT.air);
    let live = 0;
    for (const item of pools.air.items) live += item.live ? 1 : 0;
    for (; live < quota; live++) {
      const mote = born('air', {
        x: p.x + (rnd(30) - 0.5) * 26, y: p.y + (rnd(31) - 0.5) * 16, z: rnd(32) * 1.6 - 0.6,
        w: 0.035 + 0.035 * rnd(33), h: 0.035 + 0.035 * rnd(34), d: 0.035 + 0.035 * rnd(35),
        vx: (rnd(36) - 0.5) * 0.16, vy: -0.02 - 0.06 * rnd(37), color: 0xcdd8e2, a: 0.22 + 0.25 * rnd(38),
        life: LIFE.air * (0.5 + 0.5 * rnd(39)),
      });
      if (!seeded) mote.age = rnd(40) * mote.life;
    }
    seeded = true;
  }

  /** Steam over every active vent near ILO, and the warm dust that drifts once the lift reaches the surface. */
  function weatherSync(world, dt) {
    const p = world.player;
    for (const vent of world.vents ?? []) {
      if (vent.stage !== 'active' || Math.abs(vent.x - p.x) > 24) continue;
      steam += dt * share(12);
      while (steam >= 1) {
        steam -= 1;
        born('steam', {
          x: vent.x + (rnd(50) - 0.5) * 0.5, y: vent.y + vent.h - 0.15, z: 0.3 + 0.1 * rnd(51), w: 0.16 + 0.1 * rnd(52), h: 0.14, d: 0.16,
          vx: (rnd(53) - 0.5) * 0.5, vy: 0.5 + 0.5 * rnd(54), grow: 0.5, color: 0xdfe8ee, a: 0.26, life: LIFE.steam * (0.7 + 0.3 * rnd(55)),
        });
      }
    }
    const stage = world.ascent?.stage;
    if ((world.mode === 'liftSequence' || world.mode === 'complete') && (stage === 'surface' || stage === 'terrace')) {
      drift += dt * share(10);
      while (drift >= 1) {
        drift -= 1;
        born('drift', {
          x: p.x + (rnd(60) - 0.5) * 12, y: p.y + (rnd(61) - 0.5) * 8, z: 0.2 + 1.2 * rnd(62), w: 0.04 + 0.04 * rnd(63), h: 0.04, d: 0.04,
          vx: (rnd(64) - 0.5) * 0.5, vy: (rnd(65) - 0.5) * 0.16, color: 0xffe9c4, a: 0.55, life: LIFE.drift * (0.6 + 0.4 * rnd(66)),
        });
      }
    }
  }

  /** What one event leaves behind. */
  function burst(e, world) {
    switch (e.type) {
      case 'seamBreak': {
        const floor = floorUnder(world, e.x, e.y);
        for (let i = 0; i < share(12); i++) {
          const angle = rnd(10) * turn;
          const speed = 1.5 + 4 * rnd(11);
          const size = 0.06 + 0.12 * rnd(15);
          born('seam', {
            x: e.x + (rnd(12) - 0.5) * 0.6, y: e.y + (rnd(13) - 0.5) * 1.6, z: 0.3 + 0.2 * rnd(14), w: size, h: size * (0.6 + 0.8 * rnd(16)), d: size,
            vx: Math.cos(angle) * speed, vy: Math.abs(Math.sin(angle)) * speed * 0.8 + 0.8, g: -20, floor,
            color: SHARD[i % SHARD.length], a: 1, life: LIFE.seam * (0.6 + 0.4 * rnd(17)),
          });
        }
        break;
      }
      case 'shield': {
        const item = pools.shield.spawn({ life: LIFE.shield });
        item.mesh.position.set(e.x, e.y + PLAYER.h / 2, 0.7);
        break;
      }
      case 'damage':
      case 'crush': {
        // The recoil flash: eight short dashes thrown out from ILO's middle. Reduced motion drops it.
        if (reduced) break;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7]]) {
          born('flash', {
            x: e.x + dx * 0.4, y: e.y + PLAYER.h / 2 + dy * 0.5, z: 0.7, w: Math.abs(dx) * 0.3 + 0.05, h: Math.abs(dy) * 0.3 + 0.05, d: 0.02,
            vx: dx * 3, vy: dy * 3, color: PALETTE.hazard, a: 0.9,
          });
        }
        break;
      }
      case 'land': {
        const count = Math.ceil(clamp(2 + (e.speed ?? 0) / 3.5, 2, 7) / (reduced ? 2 : 1));
        for (let i = 0; i < count; i++) {
          const side = i % 2 === 0 ? 1 : -1;
          born('dust', {
            x: e.x + side * (0.1 + 0.3 * rnd(20)), y: e.y + 0.06, z: 0.3 + 0.2 * (rnd(21) - 0.5), w: 0.1 + 0.08 * rnd(22), h: 0.08, d: 0.1,
            vx: side * (0.5 + 1.3 * rnd(23)), vy: 0.2 + 0.6 * rnd(24), g: -2.5, drag: 4, grow: 0.9, color: 0xa9b4bf, a: 0.45,
            life: LIFE.dust * (0.7 + 0.3 * rnd(25)),
          });
        }
        break;
      }
      case 'relay': {
        // Conduit light: a short train of light runs from the node toward the point the relay looks at.
        const dx = e.lookAt.x - e.x;
        const dy = e.lookAt.y - e.y;
        const length = Math.hypot(dx, dy) || 1;
        for (let i = 0; i < 7; i++) {
          const size = 0.3 - i * 0.03;
          born('conduit', {
            x: e.x - (dx / length) * i * 0.3, y: e.y - (dy / length) * i * 0.3, z: 0.5, w: size, h: size, d: 0.05,
            vx: (dx / length) * 7, vy: (dy / length) * 7, color: i === 0 ? 0xfff0c8 : PALETTE.amber, a: 0.9 - i * 0.1,
          });
        }
        break;
      }
      default:
    }
  }

  /** Show the run's effects for this frame. `events` are the frame's simulation events; nothing moves while `dt` is 0. */
  function sync(world, dt, events = []) {
    const p = world.player;
    frame++;
    for (const e of events) {
      if (e.type === 'reboot') {
        // A recovery clears what was in flight; the air itself stays.
        for (const pool of [...boxes, pools.shield, pools.ring]) {
          for (const item of pool.items) item.live = false;
        }
      } else {
        burst(e, world);
      }
    }
    // Dash trail: a streak per frame behind ILO while it dashes (one every other frame with reduced motion).
    if (p.dashT > 0 && (!reduced || frame % 2 === 0)) {
      born('dash', {
        x: p.x - p.dashDir * 0.15, y: p.y + 0.3 + 0.9 * rnd(1), z: 0.5 + 0.2 * (rnd(2) - 0.5), w: 0.3 + 0.5 * rnd(3), h: 0.04 + 0.05 * rnd(4), d: 0.03,
        vx: -p.dashDir * (1 + rnd(5)), color: 0xbfefff, a: 0.7, life: LIFE.dash * (0.7 + 0.3 * rnd(6)),
      });
    }
    airSync(p);
    weatherSync(world, dt);
    for (const pool of boxes) pool.step(dt);
    for (const item of pools.shield.items) {
      if (item.live && (item.age += dt) >= item.life) item.live = false; // a facet only ages: it is a mesh, not a box
    }
    ringSync(world, dt);
    shieldSync();
    glow.draw();
    haze.draw();
  }

  return {
    sync,
    pools,
    /** With reduced motion: half the particles, no flash, no spread. */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      scene.remove(root);
      glow.dispose();
      haze.dispose();
      ringGeometryShared.dispose();
      facetsGeometry.dispose();
      for (const own of owned) own.dispose();
    },
  };
}
