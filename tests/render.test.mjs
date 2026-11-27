import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { DT, PLAYER } from '../src/config.js';
import { hitPlayer, placePlayer } from '../src/sim/player.js';
import { commitCheckpoint, createWorld, setMode, stepWorld } from '../src/sim/world.js';
import { createCameraRig, freeRect, placeCamera, viewRect } from '../src/render/camera.js';
import { createRenderer, createStage } from '../src/render/renderer.js';
import { PALETTE, material } from '../src/render/voxel.js';
import { createCanvas, createDocument } from './fakes/gl.js';
import { LEVEL as CORE, SPOTS as CORE_SPOTS } from './fixtures/core.js';

globalThis.document = createDocument(); // with a canvas to draw on, the pixel textures and the faces of the signs exist, as in a browser

const REAL = await import('../src/level/level.js').then((module) => module.LEVEL, () => null); // once the real level exists
const LEVELS = [['the core fixture', CORE], ['LEVEL', REAL]].filter(([, level]) => level !== null);
const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const FRAMES = 600;
const MAX_CALLS = 150;
const MAX_TRIANGLES = 300000;
/** Walk right and back on a fixed rhythm, jumping, dashing and pulsing: ILO runs into walls and off ledges as well. */
const drive = (i) => ({
  ...IDLE, right: i % 240 < 150, left: i % 240 >= 150,
  jumpPressed: i % 37 === 0, dashPressed: i % 53 === 0, pulsePressed: i % 71 === 0,
});

/** A `play` world with ILO at the spawn of `level`. */
function open(level) {
  const world = createWorld(level);
  world.mode = 'play';
  if (world.stations.length === 0) {
    world.stations.push(...level.stations.map((station) => ({ ...station })));
    commitCheckpoint(world, level.stations[0].id);
  }
  placePlayer(world, level.spawn.x, level.spawn.y);
  world.events.length = 0;
  return world;
}

/** The smallest camera zone of `level` that holds `p`, as the rig chooses it. */
function zoneOf(level, p) {
  let zone = null;
  for (const z of level.camera ?? []) {
    const holds = p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1;
    if (holds && (zone === null || (z.x1 - z.x0) * (z.y1 - z.y0) < (zone.x1 - zone.x0) * (zone.y1 - zone.y0))) zone = z;
  }
  return zone;
}

/** Every mesh of the scene has finite attributes; every drawn one lies inside the level grown by 30 units. */
function checkStatic(stage, level, label) {
  const { x0, y0, x1, y1 } = level.bounds;
  const box = new THREE.Box3();
  const ownerOf = (object) => `${object.parent?.parent?.name ?? ''}/${object.material.type}`;
  stage.scene.updateMatrixWorld(true);
  stage.scene.traverse((object) => {
    if (!object.isMesh) return;
    for (const [name, attribute] of Object.entries(object.geometry.attributes)) {
      for (let i = 0; i < attribute.array.length; i++) {
        assert.ok(Number.isFinite(attribute.array[i]), `${label}: ${ownerOf(object)} ${name}[${i}] is ${attribute.array[i]}`);
      }
    }
  });
  stage.scene.traverseVisible((object) => {
    if (!object.isMesh) return;
    object.geometry.computeBoundingBox();
    box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    assert.ok(
      box.min.x >= x0 - 30 && box.max.x <= x1 + 30 && box.min.y >= y0 - 30 && box.max.y <= y1 + 30,
      `${label}: ${ownerOf(object)} lies at ${box.min.toArray().map(Math.round)} .. ${box.max.toArray().map(Math.round)}, outside the level grown by 30`,
    );
  });
}

test('Renderer: without a WebGL 2 context it throws the message the glue shows', () => {
  assert.throws(() => createRenderer(createCanvas({ webgl: false }), CORE), /WebGL is not available\./);
});

for (const [name, level] of LEVELS) {
  test(`Renderer: ${name} draws ${FRAMES} frames of a driven world inside its budgets`, () => {
    const view = createRenderer(createCanvas({ width: 960, height: 540 }), level);
    checkStatic(view.stage, level, name);
    const world = open(level);
    const point = new THREE.Vector3();
    for (let i = 0; i < FRAMES; i++) {
      stepWorld(world, drive(i));
      view.sync(world, DT, world.events);
      const { calls, triangles } = view.stats();
      assert.ok(calls > 0, `frame ${i} draws nothing`);
      assert.ok(calls <= MAX_CALLS && triangles <= MAX_TRIANGLES, `frame ${i}: ${calls} calls, ${triangles} triangles`);
      // ILO, feet and head, is seen by the camera Three.js draws with.
      const { camera } = view.stage;
      for (const y of [world.player.y, world.player.y + 1.5]) {
        const ndc = point.set(world.player.x, y, 0.3).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
        assert.ok(Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1, `frame ${i}: ILO's point (${world.player.x}, ${y}) maps to ${ndc.x}, ${ndc.y}`);
      }
    }
    checkStatic(view.stage, level, `${name}, after the run`);
    view.dispose();
  });

  test(`Camera rig: ${name} keeps ILO in view and the view in its zone, without jumps`, () => {
    const rig = createCameraRig(level);
    const world = open(level);
    let previous = null;
    let zone;
    let stable = 0;
    for (let i = 0; i < FRAMES; i++) {
      stepWorld(world, drive(i));
      const view = rig.update(world, DT, 960, 540);
      const rect = viewRect(view, 960, 540);
      const p = world.player;
      assert.ok(p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y + 1.5 <= rect.y1,
        `frame ${i}: ILO at (${p.x}, ${p.y}) is outside the view ${JSON.stringify(rect)}`);
      // Once ILO has stayed in one zone for longer than the ease between zones, the view lies inside it.
      const now = zoneOf(level, p);
      stable = now === zone ? stable + 1 : 0;
      zone = now;
      if (zone !== null && stable > 40 && zone.x1 - zone.x0 > rect.x1 - rect.x0 && zone.y1 - zone.y0 > rect.y1 - rect.y0) {
        assert.ok(rect.x0 >= zone.x0 - 1e-6 && rect.x1 <= zone.x1 + 1e-6 && rect.y0 >= zone.y0 - 1e-6 && rect.y1 <= zone.y1 + 1e-6,
          `frame ${i}: the view ${JSON.stringify(rect)} leaves its zone ${JSON.stringify(zone)}`);
      }
      if (previous !== null && world.mode !== 'reboot') {
        assert.ok(Math.hypot(view.x - previous.x, view.y - previous.y) <= 2 + 1e-9, `frame ${i}: the view jumps by a frame-to-frame step above 2 units`);
      }
      previous = view;
    }
    // Any screen shape shows between 16 and 28.5 units of width (GOAL §14): ILO stays large on a phone and neighbor
    // zones stay out of a wide view.
    for (const [w, h] of [[360, 640], [320, 480], [200, 200], [780, 1688], [1688, 780], [2560, 1080]]) {
      const rect = viewRect(rig.update(world, 0, w, h), w, h);
      assert.ok(rect.x1 - rect.x0 >= 16 - 1e-6 && rect.x1 - rect.x0 <= 28.5 + 1e-6, `a ${w} x ${h} viewport shows ${(rect.x1 - rect.x0).toFixed(2)} units of width`);
    }
    // A 16:9 view keeps its 14 screen units of height to within 1 percent.
    const wide = rig.update(world, 0, 960, 540);
    assert.ok(Math.abs(540 * wide.unitsPerPixel - 14) <= 0.14, `a 960 x 540 view shows ${(540 * wide.unitsPerPixel).toFixed(3)} screen units of height`);
    // A reboot snaps the view to the station, where ILO stands again.
    setMode(world, 'shutdown');
    for (let i = 0; world.mode !== 'reboot'; i++) {
      assert.ok(i < 1000, 'the shutdown never ends');
      stepWorld(world, IDLE);
      const view = rig.update(world, DT, 960, 540);
      if (world.mode === 'reboot') {
        const fresh = createCameraRig(level).update(world, 0, 960, 540);
        assert.ok(Math.hypot(view.x - fresh.x, view.y - fresh.y) < 1e-9, 'the view does not snap to where a new rig looks');
      }
    }
  });
}

// --- The interface bands (GOAL §14): the view keeps ILO clear of the interface on every screen shape ---

/** Phones in CSS pixels, some with their safe-area insets: `[width, height, left, top, right, bottom]`. Over the canvas
 *  the HUD bar is 136 px tall in portrait and 66 px under 480 px of height; the band of touch controls is 150 px in
 *  portrait and 126 px in landscape, with a move pad 190 px wide and an action cluster 210 px wide (fixtures). */
const PHONES = [
  [360, 640], [375, 667], [390, 844, 0, 47, 0, 34], [412, 915],
  [640, 360], [667, 375], [844, 390, 47, 0, 0, 21],
];
const bandsOf = ([w, h, left = 0, top = 0, right = 0, bottom = 0]) => (h > w
  ? { top: top + 136, bottom: bottom + 150, left: left + 190, right: right + 210 }
  : { top: top + 66, bottom: bottom + 126, left: left + 190, right: right + 210 });

/** Route spots of LEVEL where ILO stands, each with the height it arrives from: the ascent's upper ledge, the first
 *  shaft's threshold, the reservoir island, Relay B, the foundry floor and the relay socket. */
const SPOTS = [[208, 54, 7], [216, 56, 6], [196, 22, 1.4], [88, 3, 6], [134.5, 13, 6], [150, 22, 5], [186.5, 22, 5]];
const meets = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

if (REAL !== null) {
  test('Camera rig: LEVEL keeps ILO clear of the interface bands on phones, wherever it arrives from', () => {
    const camera = new THREE.OrthographicCamera();
    const point = new THREE.Vector3();
    for (const phone of PHONES) {
      const [w, h] = phone;
      const bands = bandsOf(phone);
      const covered = [ // the interface over the canvas, in pixels: the HUD bar, the touch band, the move pad, the action cluster
        [0, 0, w, bands.top], [0, h - bands.bottom, w, h], [0, h - bands.bottom, bands.left, h], [w - bands.right, h - bands.bottom, w, h],
      ];
      for (const [x, y, rise] of SPOTS) {
        for (const arrive of ['from above', 'from below', 'after a fall']) {
          const world = open(REAL);
          const rig = createCameraRig(REAL);
          rig.setBands(bands);
          const label = `${w} x ${h}, ILO arriving ${arrive} at (${x}, ${y})`;
          /** One update of the rig; fails when ILO's rect of 0.75 × 1.5 units meets a part of the interface. */
          const check = (step) => {
            const p = world.player;
            placeCamera(camera, rig.update(world, DT, w, h), w, h);
            const at = (dx, dy) => {
              const ndc = point.set(p.x + dx, p.y + dy, 0).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
              return [(ndc.x + 1) * w / 2, (1 - ndc.y) * h / 2];
            };
            const [x0, y1] = at(-PLAYER.w / 2, 0);
            const [x1, y0] = at(PLAYER.w / 2, PLAYER.h);
            for (const rect of covered) {
              assert.ok(!meets([x0, y0, x1, y1], rect), `${label}, update ${step}: ILO at [${[x0, y0, x1, y1].map(Math.round)}] meets the interface at [${rect}]`);
            }
          };
          placePlayer(world, x, y + rise);
          if (arrive === 'after a fall') {
            for (let i = 0; i < 480; i++) { // ILO falls, lands and stands: a sentinel's shot may shake the view meanwhile
              check(i);
              stepWorld(world, IDLE);
            }
          } else {
            const from = y + (arrive === 'from above' ? rise : -rise);
            for (let i = 0; i <= 60; i++) { // ILO comes down (or up) to the spot
              Object.assign(world.player, { x, y: from + ((y - from) * i) / 60 });
              check(i);
            }
            for (let i = 61; i < 121; i++) { // and stands there
              stepWorld(world, IDLE);
              check(i);
            }
          }
        }
      }
    }
  });

  test('Camera rig: at 30, 60 and 144 updates a second the view travels the same distance in a second', () => {
    const level = { spawn: { x: 0, y: 0 }, camera: [] }; // without a zone nothing holds the view back
    const travelled = [30, 60, 144].map((rate) => {
      const world = { mode: 'play', player: { x: 0, y: 0, facing: 1, vx: 0, hp: PLAYER.h }, camera: { lookAt: null } };
      const rig = createCameraRig(level);
      const start = rig.update(world, 0, 960, 540);
      world.player.x = 100; // far to the right: for a whole second the view moves at its top speed
      let view = start;
      for (let i = 0; i < rate; i++) view = rig.update(world, 1 / rate, 960, 540);
      return Math.hypot(view.x - start.x, view.y - start.y);
    });
    assert.deepEqual(travelled.map((d) => d.toFixed(6)), ['90.000000', '90.000000', '90.000000']);
  });

  test('Camera rig: once the lift has surfaced, the terrace floor lies 2 units under the view center', () => {
    const zone = REAL.camera.find((camera) => camera.id === 'ascent');
    // Without bands, and under a 76 px HUD with a 60 px band of controls: then the opening above the cabin, up to 4.4
    // units over its floor, shows from the rise on, and `view.free` is the box the interface leaves.
    for (const bands of [{ top: 0, bottom: 0, left: 0, right: 0 }, { top: 76, bottom: 60, left: 0, right: 0 }]) {
      const rig = createCameraRig(REAL);
      rig.setBands(bands);
      const world = open(REAL);
      rig.update(world, 0, 960, 540);
      world.ascent.idle = false; // the console starts the lift, as tools/preview.mjs does
      world.mode = 'liftSequence';
      /** Fails unless the view has come to rest with the cabin floor 2 units under its center, inside the ascent zone. */
      const settled = (stage, view) => {
        const rect = viewRect(view, 960, 540);
        assert.ok(Math.abs(view.y - (world.ascent.cabinY + 2)) <= 1e-6, `${stage}: the view center is at y ${view.y.toFixed(5)}, not 2 units over the cabin floor at ${world.ascent.cabinY}`);
        assert.ok(rect.x0 >= zone.x0 - 1e-6 && rect.x1 <= zone.x1 + 1e-6 && rect.y0 >= zone.y0 - 1e-6 && rect.y1 <= zone.y1 + 1e-6,
          `${stage}: the view ${JSON.stringify(rect)} leaves camera zone ${zone.id}`);
      };
      let stage = world.ascent.stage;
      for (let i = 0; world.mode === 'liftSequence'; i++) { // the script of the lift, step by step
        assert.ok(i < 2000, 'the lift never ends');
        stepWorld(world, IDLE);
        const view = rig.update(world, DT, 960, 540);
        if (bands.top > 0 && ['rise', 'surface', 'terrace'].includes(stage)) {
          assert.ok(view.free.y1 >= world.ascent.cabinY + 4.4 - 1e-6, `${stage}: the free top of the view lies ${(view.free.y1 - world.ascent.cabinY).toFixed(3)} units over the cabin floor, under the top of the opening`);
        }
        if (world.mode === 'complete') settled('the end of the terrace stage', view);
        else if (world.ascent.stage === 'terrace' && stage === 'surface') settled('the end of the surface stage', view);
        stage = world.ascent.stage;
      }
      const last = rig.update(world, 0, 960, 540);
      for (let i = 0; i < 120; i++) settled('complete', rig.update(world, DT, 960, 540)); // the glue no longer steps
      assert.deepEqual(last.free, freeRect({ ...last, x: last.x + last.shakeX, y: last.y + last.shakeY }, 960, 540, bands), 'view.free is the box between the bands');
    }
  });

// --- Textures and palette (GOAL §4) ---

const TEXELS = 16; // texels per texture of GOAL §4
/** Minification that reads texels and never blends between them; the last two blend between a texture's mip maps. */
const NEAREST = [THREE.NearestFilter, THREE.NearestMipmapNearestFilter, THREE.NearestMipmapLinearFilter];

/** Every texture a mesh of `scene` shows, with the mesh that shows it. */
function texturesOf(scene) {
  const found = new Map(); // THREE.Texture -> a mesh that shows it
  scene.traverse((object) => {
    if (!object.isMesh) return;
    for (const m of [object.material].flat()) if (m.map) found.set(m.map, object);
  });
  return found;
}

/** Make every actor of `world` as bright as it gets: the look of a run at its busiest. */
function lightActors(world) {
  for (const relay of world.relays) relay.active = true;
  for (const station of world.stations) station.active = true;
  for (const socket of world.sockets) Object.assign(socket, { cell: 'lit', powered: true });
  for (const latch of world.switches) latch.on = true;
  for (const vent of world.vents) Object.assign(vent, { stage: 'active', t: vent.delay + vent.period - vent.active / 2 });
  for (const e of world.enemies) Object.assign(e, { t: 30, state: { sentinel: 'firing', drone: 'aim', skitter: 'alert' }[e.kind], beam: e.lane ? { ...e.lane } : null });
}

/**
 * Draw `frames` frames of `world` on `view` with everything going at once: the driven run, every actor lit, a dash,
 * a wave, bolts in flight and, every fifth frame, the events of seams breaking, hits, landings and relays.
 * `see()` runs after each frame.
 */
function stress(view, world, frames, see = () => {}) {
  const seams = world.seams;
  for (let frame = 0; frame < frames; frame++) {
    stepWorld(world, drive(frame));
    lightActors(world);
    const { x, y } = world.player;
    Object.assign(world.player, { dashT: 0.16, dashDir: 1 });
    world.pulse = frame % 3 === 0 ? { x, y: y + PLAYER.h / 2, r: 6 * ((frame % 20) / 20), age: 0, hit: new Set() } : null;
    world.bolts = Array.from({ length: 6 }, (_, i) => ({ id: `bolt:${frame}:${i}`, x: x + i, y: y + 2, vx: 5, vy: 1, life: 3, w: 0.3, h: 0.3 }));
    const events = frame % 5 === 0 ? [
      ...seams.map((seam) => ({ type: 'seamBreak', id: seam.id, x: seam.x, y: seam.y + seam.h / 2 })),
      { type: 'shield', x, y }, { type: 'damage', x, y, cause: 'enemy' }, { type: 'land', x, y, speed: 13 },
      ...world.relays.map((relay) => ({ type: 'relay', id: relay.id, x: relay.x, y: relay.y, lookAt: relay.lookAt })),
    ] : [];
    view.sync(world, DT, [...world.events, ...events]);
    see();
  }
}

if (REAL !== null) {
  test('Textures: the pixel textures are 16 × 16 texels and every texture, the faces of the signs included, is nearest filtered', (t) => {
    /** What a texture is: its size, whether it tiles a surface or is a sign's face, its filters, and what shows it. */
    const describe = (map, mesh) => ({
      width: map.image.width, height: map.image.height,
      tiled: map.wrapS === THREE.RepeatWrapping, // a surface texture repeats over its mesh; the face of a sign is shown once
      mag: map.magFilter, min: map.minFilter,
      owner: mesh.material === material('rock') ? 'the rock' : mesh.material === material('metal') ? 'the metal' : mesh.geometry.type === 'PlaneGeometry' ? 'a sign' : `${mesh.name || mesh.type} of ${mesh.parent?.name ?? 'the scene'}`,
    });
    const seen = new Map(); // THREE.Texture -> what it is
    for (const [, level] of LEVELS) { // the rock and the signs on LEVEL, the metal on the core fixture
      const stage = createStage(level);
      const census = () => { for (const [map, mesh] of texturesOf(stage.scene)) seen.set(map, describe(map, mesh)); };
      stage.sync(open(level), DT, []);
      census();
      stress(stage, open(level), FRAMES); // a run at its busiest, in case a texture is made on the way
      census();
      stage.dispose();
    }
    const all = [...seen.values()];
    const tiled = all.filter((tex) => tex.tiled);
    const faces = all.filter((tex) => !tex.tiled);
    assert.ok(tiled.length > 0, 'the scene shows no texture that tiles a surface');
    for (const tex of tiled) {
      assert.ok(tex.width <= TEXELS && tex.height <= TEXELS, `the pixel texture of ${tex.owner} is ${tex.width} × ${tex.height} texels: more than the ${TEXELS} × ${TEXELS} of GOAL §4`);
    }
    // A sign carries a line of words, which 16 texels cannot: its face is the one texture that is larger. Every sign
    // face is as many texels tall as the others, so their texel scale is one, and no taller than three of those texels.
    assert.equal(new Set(faces.map((tex) => tex.height)).size, 1, `the faces of the signs are not all as many texels tall: ${faces.map((tex) => tex.height).join(', ')}`);
    assert.ok(faces.every((tex) => tex.owner === 'a sign' && tex.height <= 3 * TEXELS), `a texture that is neither a surface texture nor a small sign face: ${JSON.stringify(faces.filter((tex) => tex.owner !== 'a sign' || tex.height > 3 * TEXELS))}`);
    for (const tex of all) {
      assert.equal(tex.mag, THREE.NearestFilter, `the texture of ${tex.owner}, ${tex.width} × ${tex.height}, magnifies with filter ${tex.mag}: linear, not nearest`);
      assert.ok(NEAREST.includes(tex.min), `the texture of ${tex.owner}, ${tex.width} × ${tex.height}, minifies with filter ${tex.min}: between texels, not nearest`);
    }
    const sizes = (list) => [...new Set(list.map((tex) => `${tex.width} × ${tex.height}`))].join(', ');
    t.diagnostic(`${all.length} textures: ${tiled.length} pixel textures, ${sizes(tiled)} texels, on ${[...new Set(tiled.map((tex) => tex.owner))].join(' and ')}; ${faces.length} sign faces, ${sizes(faces)} texels; all nearest filtered`);
  });

  test('Palette: the deep background and the rock are the colors of GOAL §4, in the palette, on the terrain and behind every region', (t) => {
    const AROUND = 0x18; // levels per channel that "around" a color of GOAL §4 allows
    const SPEC = { background: 0x101923, rock: 0x384552 }; // the colors of the §4 table given as numbers
    const channels = (hex) => [hex >> 16, (hex >> 8) & 255, hex & 255];
    const hex = (value) => value.toString(16).padStart(6, '0');
    /** The sRGB channels of `color`, a color of the scene, as the screen shows it. */
    const shown = (color) => channels(color.getHex(THREE.SRGBColorSpace));
    /** Whether `color`, as shown, lies around the sRGB `target` on every channel. */
    const around = (color, target) => shown(color).every((value, i) => Math.abs(value - channels(target)[i]) <= AROUND);
    for (const [key, target] of Object.entries(SPEC)) {
      const color = new THREE.Color(PALETTE[key]);
      assert.ok(around(color, target), `the palette's ${key} is #${hex(color.getHex(THREE.SRGBColorSpace))}, not around #${hex(target)}`);
    }
    const stage = createStage(REAL);
    const ROCK = new THREE.Color(PALETTE.rock);
    const EDGE = new THREE.Color(PALETTE.edge);
    /** How many times `base` the color is, when each of its channels is that multiple of the base's; otherwise null. */
    const shadeOf = (color, base) => {
      const ratio = [color.r / base.r, color.g / base.g, color.b / base.b];
      return Math.max(...ratio) - Math.min(...ratio) <= 1e-3 ? ratio.reduce((sum, value) => sum + value, 0) / 3 : null;
    };
    const lightness = (color) => color.getHSL({ h: 0, s: 0, l: 0 }).l;
    assert.ok(shadeOf(EDGE, ROCK) === null && lightness(EDGE) > lightness(ROCK), 'the palette\'s edge is not a lighter stone than its rock');
    // The rock ILO stands on is the palette's rock, a shade darker away from its top, with the palette's edge along its top.
    const tones = [];
    let edges = 0;
    const color = new THREE.Color();
    for (const mesh of stage.scene.getObjectByName('terrain').children) {
      if (!mesh.isMesh || mesh.material !== material('rock')) continue;
      const attribute = mesh.geometry.attributes.color;
      for (let i = 0; i < attribute.count; i++) {
        color.fromBufferAttribute(attribute, i);
        const tone = shadeOf(color, ROCK);
        if (tone !== null) tones.push(tone);
        else {
          assert.ok(shadeOf(color, EDGE) !== null, `the rock has a vertex of #${color.getHexString()}, a shade of neither the palette's rock nor its edge`);
          edges++;
        }
      }
    }
    assert.ok(tones.length > 0 && edges > 0, `the rock has ${tones.length} vertices of rock and ${edges} of edge`);
    const darkest = Math.min(...tones);
    const lightest = Math.max(...tones);
    assert.ok(darkest >= 0.4, `the rock goes down to ${darkest.toFixed(2)} of the palette's rock`);
    assert.ok(Math.abs(lightest - 1) <= 0.15, `the lightest rock is ${lightest.toFixed(2)} of the palette's rock, not around #384552`);
    t.diagnostic(`rock: ${tones.length} vertices, from ${darkest.toFixed(2)} to ${lightest.toFixed(2)} of #${hex(PALETTE.rock)}, and ${edges} of the edge #${hex(PALETTE.edge)}`);
    // The deep background, once each region has faded in: blue-black around #101923. The dawn of the ending is no background.
    const world = open(REAL);
    for (const region of REAL.regions) {
      Object.assign(world.player, { x: region.x0 + 2, y: (REAL.bounds.y0 + REAL.bounds.y1) / 2 });
      for (let frame = 0; frame < 360; frame++) stage.sync(world, DT, []); // six seconds: the region has faded in
      const background = stage.scene.background;
      assert.ok(around(background, SPEC.background), `the deep background of ${region.id} is #${hex(background.getHex(THREE.SRGBColorSpace))}, not around #${hex(SPEC.background)}`);
      t.diagnostic(`the deep background of ${region.id}: #${stage.scene.background.getHexString()}`);
    }
    stage.dispose();
  });

  test('Lights and reuse: LEVEL has three lights and casts no shadow, and nothing the scene or the context holds grows over 600 frames and two restarts', (t) => {
    const MAX_LIGHTS = 3; // the lights createScenery makes, the sky, the key and the dawn (src/render/scenery.js); no other module makes one
    const canvas = createCanvas({ width: 960, height: 540 });
    const view = createRenderer(canvas, REAL);
    view.resize();
    /** What the scene holds, shown or hidden: its objects and meshes, and the geometries, materials, textures and lights in use. */
    const census = () => {
      const held = { objects: 0, meshes: 0, geometries: new Set(), materials: new Set(), textures: new Set(), lights: 0 };
      view.stage.scene.traverse((object) => {
        held.objects++;
        if (object.isLight) held.lights++;
        if (!object.isMesh) return;
        held.meshes++;
        held.geometries.add(object.geometry);
        for (const m of [object.material].flat()) {
          held.materials.add(m);
          if (m.map) held.textures.add(m.map);
        }
      });
      const { objects, meshes, lights } = held;
      return { objects, meshes, lights, geometries: held.geometries.size, materials: held.materials.size, textures: held.textures.size };
    };
    view.sync(open(REAL), DT, []);
    const start = census();
    let after = null; // what the context holds at the end of the run before
    for (const run of [1, 2, 3]) { // each run starts from a fresh world: a restart
      const busiest = { ...start };
      stress(view, open(REAL), FRAMES, () => {
        const now = census();
        assert.ok(now.lights <= MAX_LIGHTS, `run ${run}: the scene has ${now.lights} lights, more than the ${MAX_LIGHTS} the scenery makes`);
        for (const key of Object.keys(busiest)) busiest[key] = Math.max(busiest[key], now[key]);
      });
      assert.deepEqual(busiest, start, `run ${run}: mid-run the scene holds more than at the start`);
      assert.deepEqual(census(), start, `run ${run}: after ${FRAMES} frames the scene holds more than at the start`);
      // Three.js hands a geometry to the context when it first draws it, so the first run fills the context up; a
      // restart and another run add nothing.
      if (after !== null) assert.deepEqual(canvas.gl.live, after, `run ${run}: the context holds more than after the run before`);
      after = { ...canvas.gl.live };
    }
    t.diagnostic(`the scene holds ${start.objects} objects, ${start.meshes} meshes, ${start.geometries} geometries, ${start.materials} materials, ${start.textures} textures and ${start.lights} lights at the start, through each run and after two restarts; the context holds ${after.buffers} buffers and ${after.textures} textures after each run`);
    // No light casts a shadow: the renderer draws no shadow maps (GOAL §19: reasonable shadow settings).
    const lights = [];
    view.stage.scene.traverse((object) => { if (object.isLight) lights.push(object); });
    for (const light of lights) {
      assert.equal(light.castShadow, false, `${light.type} casts shadows`);
      assert.equal(light.shadow?.map ?? null, null, `${light.type} has a shadow map`);
    }
    assert.ok(lights.some((light) => light.isHemisphereLight) && lights.some((light) => light.isDirectionalLight), 'the scenery lights the level from sky and key');
    view.dispose();
    assert.equal(canvas.gl.live.buffers, 0, 'dispose leaves geometry buffers in the context');
  });
}

test('Camera rig: a hit shakes the view by no more than a tenth of ILO\'s height, is still within a quarter of a second, and moves nothing with reduced motion', (t) => {
  const SMALL = PLAYER.h / 10; // units: a small amount for a view that shows ILO, 1.5 units tall, whole
  const BRIEF = 0.25; // seconds: a shake is brief
  const HIT = 30; // the frame of the hit
  for (const reduced of [false, true]) {
    const rig = createCameraRig(CORE);
    rig.setReducedMotion(reduced);
    const world = open(CORE, ...CORE_SPOTS.floor);
    const camera = new THREE.OrthographicCamera();
    const still = new THREE.OrthographicCamera();
    rig.update(world, 0, 960, 540);
    const moved = []; // per frame: how far the shake moved the view, in units
    for (let frame = 0; frame < HIT + 120; frame++) {
      if (frame === HIT) { // a hit below 50 energy: integrity pays, and the rig sees it
        world.player.energy = 0;
        assert.equal(hitPlayer(world, { kind: 'enemy', x: world.player.x, y: world.player.y, w: 1, h: 1, sx: world.player.x - 1, sy: world.player.y }), 'damage', 'the hit does not reach integrity');
      }
      stepWorld(world, IDLE);
      stepWorld(world, IDLE);
      const view = rig.update(world, 2 * DT, 960, 540);
      placeCamera(camera, view, 960, 540);
      placeCamera(still, { ...view, shakeX: 0, shakeY: 0 }, 960, 540);
      moved.push(camera.position.distanceTo(still.position));
    }
    const peak = Math.max(...moved);
    const settled = moved.slice(HIT + 1 + Math.ceil(BRIEF * 60));
    assert.ok(peak <= SMALL, `reduced motion ${reduced}: the hit moves the view by ${peak.toFixed(3)} units, more than ${SMALL}`);
    assert.ok(settled.every((distance) => distance === 0), `reduced motion ${reduced}: ${BRIEF} s after the hit the view still moves, by ${Math.max(...settled).toExponential(2)} units`);
    if (reduced) assert.equal(peak, 0, 'with reduced motion the hit moves the view');
    else assert.ok(peak > 0, 'the hit does not shake the view at all');
    t.diagnostic(`reduced motion ${reduced}: the hit moves the view by at most ${peak.toFixed(4)} units`);
  }
});

for (const [name, level] of LEVELS) {
  test(`Renderer: ${name} caps the pixel ratio at 2 and draws into a buffer of the CSS size times it`, () => {
    const CAP = 2; // MAX_PIXEL_RATIO of src/render/renderer.js (GOAL §19: cap the pixel ratio)
    const CSS = [1000, 600]; // the size the page gives the canvas, in CSS pixels
    try {
      // The device ratio, and the ratio the renderer must set: its own below the cap, the cap itself above it.
      for (const [device, ratio] of [[undefined, 1], [1, 1], [1.5, 1.5], [2, 2], [3, CAP], [4, CAP]]) {
        globalThis.devicePixelRatio = device;
        const canvas = createCanvas({ width: 960, height: 540 });
        [canvas.clientWidth, canvas.clientHeight] = CSS;
        const view = createRenderer(canvas, level);
        view.resize();
        view.sync(open(level), DT, []); // the rig frames the new size, as the first frame of the game does
        const buffer = [CSS[0] * ratio, CSS[1] * ratio];
        assert.deepEqual([canvas.width, canvas.height], buffer, `device ratio ${device}: the drawing buffer is ${canvas.width} × ${canvas.height}, not the CSS size times ${ratio}`);
        assert.deepEqual([...canvas.gl.viewportRect], [0, 0, ...buffer], `device ratio ${device}: the context draws into ${canvas.gl.viewportRect.join(' × ')}, not the whole buffer`);
        const { camera } = view.stage;
        assert.ok(Math.abs(camera.top - camera.bottom - 14) <= 0.14, `device ratio ${device}: the view shows ${(camera.top - camera.bottom).toFixed(3)} units of height, not 14`);
        assert.ok(Math.abs((camera.right - camera.left) / (camera.top - camera.bottom) - buffer[0] / buffer[1]) <= 1e-9, `device ratio ${device}: the view has not the shape of the buffer`);
        view.dispose();
      }
    } finally {
      delete globalThis.devicePixelRatio;
    }
  });
}
}
