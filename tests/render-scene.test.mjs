// The scene of the renderer (contract §5.1) on LEVEL with the real stage camera: the pale opening over the ascent
// lift and its fade toward the west, nothing in front of ILO anywhere on the route, the ruins of the terrace, and the
// floor plate of the lift's console.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/three.module.js';
import { PLAYER } from '../src/config.js';
import { placePlayer } from '../src/sim/player.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { createStage } from '../src/render/renderer.js';
import { createScenery } from '../src/render/scenery.js';
import { freeRect } from '../src/render/camera.js';

const LEVEL = await import('../src/level/level.js').then((module) => module.LEVEL, () => null); // once the real level loads
const SOURCE = readFileSync(new URL('../src/level/level.js', import.meta.url), 'utf8');
const FRAME = 1 / 60; // visual seconds per sync
const SIZE = [960, 540];
const VIEW = { x0: -1, x1: 1, y0: -1, y1: 1 }; // the view in normalized device coordinates

/** Every `(x, y)` named in the ROUTE block of the level's source: where ILO's feet stand or land on the course. */
const ROUTE = (() => {
  const lines = SOURCE.split('\n');
  const block = [];
  for (const line of lines.slice(lines.findIndex((l) => /^\/\/\s{3}M01\b/.test(l)))) {
    if (!/^\/\/\s{3,}\S/.test(line)) break;
    block.push(line);
  }
  return block.flatMap((line) => [...line.matchAll(/\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/g)].map(([, x, y]) => [Number(x), Number(y)]));
})();

/** A `play` world of LEVEL with ILO's feet at `(x, y)`. */
function open(x, y) {
  const world = createWorld(LEVEL);
  world.mode = 'play';
  placePlayer(world, x, y);
  world.events.length = 0;
  return world;
}

/** Sync `stage` `frames` times with `world`; the scene's matrices are current afterwards. */
function run(stage, world, frames) {
  for (let i = 0; i < frames; i++) stage.sync(world, FRAME, []);
  stage.scene.updateMatrixWorld(true);
}

/** The point of the gameplay plane (z 0) that shows at `(nx, ny)` of the view, in normalized device coordinates. */
function planePoint(camera, nx, ny) {
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const v = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
  return v.addScaledVector(dir, -v.z / dir.z);
}

/** The smallest rect, in view axes or in world axes, around `points`. */
const around = (points) => ({
  x0: Math.min(...points.map((p) => p.x)), x1: Math.max(...points.map((p) => p.x)),
  y0: Math.min(...points.map((p) => p.y)), y1: Math.max(...points.map((p) => p.y)),
});

/** Where the world-space box from `(x0, y0, z0)` to `(x1, y1, z1)` shows: normalized device coordinates. */
function onView(camera, x0, x1, y0, y1, z0 = 0, z1 = 0) {
  const points = [];
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) points.push(new THREE.Vector3(x, y, z).project(camera));
    }
  }
  return around(points);
}

/** Where `object` shows on the view: normalized device coordinates. */
const box = (camera, object) => {
  const b = new THREE.Box3().setFromObject(object);
  return onView(camera, b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z);
};

/** Where `object` appears to stand on the gameplay plane: a rect in world units, whatever its depth. */
function stands(object, camera) {
  const b = new THREE.Box3().setFromObject(object);
  const points = [];
  for (const x of [b.min.x, b.max.x]) {
    for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) {
        const v = new THREE.Vector3(x, y, z).project(camera);
        points.push(planePoint(camera, v.x, v.y));
      }
    }
  }
  return around(points);
}

const inside = (a, b) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
const meets = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
const show = (r) => `x ${r.x0.toFixed(2)}..${r.x1.toFixed(2)}, y ${r.y0.toFixed(2)}..${r.y1.toFixed(2)}`;

/**
 * The share of the samples over a patch of the pale face of the opening that no opaque mesh of the scene stands in
 * front of: a `w × h` patch, `dy` above the center of the face, sampled `n × m` and at its corners.
 */
function clearShare(stage, opening, face, w, h, dy, n, m) {
  stage.scene.updateMatrixWorld(true);
  const within = (object) => { for (let p = object; p; p = p.parent) if (p === opening) return true; return false; };
  const solids = [];
  stage.scene.traverse((object) => {
    if (object.isMesh && !object.material.transparent && !within(object) && object.geometry.attributes.position !== undefined) solids.push(object);
  });
  const ray = new THREE.Raycaster();
  const center = face.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(face.matrixWorld);
  let clear = 0;
  let total = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const point = new THREE.Vector3(center.x + w * (i / n - 0.5), center.y + dy + h * (j / m - 0.5), center.z + 0.06);
      const ndc = point.clone().project(stage.camera);
      total++;
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), stage.camera);
      const own = point.sub(ray.ray.origin).dot(ray.ray.direction);
      const hit = ray.intersectObjects(solids, false)[0];
      if (hit === undefined || hit.distance > own - 0.05) clear++;
    }
  }
  return clear / total;
}

/** The clear share of the whole cross of the pale face: its middle band and its top and bottom bands, by area. */
function clearCross(stage, opening, face) {
  const middle = clearShare(stage, opening, face, 3.8, 2.2, 0, 12, 3);
  const bands = (clearShare(stage, opening, face, 2.8, 0.3, 1.4, 8, 1) + clearShare(stage, opening, face, 2.8, 0.3, -1.4, 8, 1)) / 2;
  return { middle, bands, whole: (2.2 * middle + 0.4 * bands) / 2.6 };
}

test('Scene: the far layer reaches the bottom edge of the view of a phone held upright, where the camera sits lowest', { skip: LEVEL === null }, () => {
  // The title of a 390 x 844 screen and of one three times as tall as wide, at two pixels per CSS pixel, with the
  // interface bands of a phone (the bar above, the touch band below). The floor of the far layer runs past the bottom
  // edge: the scene background never shows as a band under it.
  const ray = new THREE.Raycaster();
  for (const [width, height] of [[390, 844], [360, 1080]]) {
    const stage = createStage(LEVEL);
    stage.resize(width * 2, height * 2);
    stage.setBands({ top: 220, bottom: 290, left: 0, right: 0 });
    run(stage, createWorld(LEVEL), 3);
    for (let i = 0; i <= 10; i++) {
      ray.setFromCamera(new THREE.Vector2(-0.95 + i * 0.19, -0.999), stage.camera); // along the bottom edge of the view
      assert.ok(ray.intersectObjects(stage.scene.getObjectByName('scenery').children, true).length > 0, `${width} x ${height}: the backdrop shows under the far layer`);
    }
    stage.dispose();
  }
});

test('Scene: the pale opening is in sight over the chimney from the service platform and over the lift from the top platform, above the cabin through the rise, and the dawn on the terrace', { skip: LEVEL === null }, (t) => {
  const stage = createStage(LEVEL);
  stage.resize(...SIZE);
  const { camera } = stage;
  const opening = stage.scene.getObjectByName('opening');
  const face = opening.children[0];
  const pale = () => face;
  const { x: lift, y: floor, w } = LEVEL.ascent;
  const cabin = { x0: lift - w / 2, x1: lift + w / 2 };
  const places = [];
  for (const [x, y, least] of [[208.5, 54, 0.8], [229, 66, 0.85]]) {
    run(stage, open(x, y), 120);
    const r = stands(pale(), camera);
    const sight = around([planePoint(camera, -1, -1), planePoint(camera, 1, 1)]);
    const ndc = box(camera, pale());
    places.push({ r, sight, ndc });
    assert.ok(inside(ndc, VIEW), `from (${x}, ${y}) the opening shows at ${show(ndc)} of the view`);
    assert.ok(r.y0 > y && r.x1 > x, `from (${x}, ${y}) the opening is not up and toward the lift: ${show(r)}`);
    if (x === 229) assert.ok(r.x0 <= cabin.x1 && r.x1 >= cabin.x0 && r.y0 >= y + PLAYER.h, `from the top platform the opening is not over the cabin, above ILO: ${show(r)}`);
    // In clear sight: nothing opaque of the level stands in front of the middle of its face, nor of most of it.
    assert.equal(clearShare(stage, opening, face, 0.2, 0.2, 0, 1, 1), 1, `from (${x}, ${y}) rock or scenery stands in front of the opening`);
    const seen = clearCross(stage, opening, face);
    assert.ok(seen.whole >= least, `from (${x}, ${y}) only ${(seen.whole * 100).toFixed(0)} % of the opening is in clear sight`);
    t.diagnostic(`from (${x}, ${y}) the opening stands at ${show(r)} of a view over ${show(sight)}: in clear sight ${(seen.whole * 100).toFixed(0)} % of it, its middle band ${(seen.middle * 100).toFixed(0)} %`);
  }
  // It is far away: between the two platforms the world slides across the view, and the opening a fraction of that.
  const world = (places[1].sight.x0 - places[0].sight.x0) / ((places[0].sight.x1 - places[0].sight.x0) / 2);
  const slide = (places[1].ndc.x0 + places[1].ndc.x1 - places[0].ndc.x0 - places[0].ndc.x1) / 2;
  assert.ok(Math.abs(slide) > 0.05 * Math.abs(world) && Math.abs(slide) < 0.5 * Math.abs(world), `the opening moves ${slide.toFixed(2)} across the view while the world moves ${world.toFixed(2)}: not like something far away`);
  t.diagnostic(`between the two platforms the world slides ${world.toFixed(2)} across the view and the opening ${slide.toFixed(2)}`);
  // Through the rise the cabin climbs from the top platform to the top of the level: the opening stays over it and above its floor.
  const ride = open(229, 66);
  ride.mode = 'liftSequence';
  let lowest = Infinity;
  for (let y = floor; y <= LEVEL.bounds.y1 + 1e-9; y += 3) {
    Object.assign(ride.ascent, { stage: 'rise', cabinY: y });
    Object.assign(ride.player, { x: lift, y });
    run(stage, ride, 60);
    const r = stands(pale(), camera);
    assert.ok(inside(box(camera, pale()), VIEW), `cabin at y ${y}: the opening shows at ${show(box(camera, pale()))} of the view`);
    assert.ok(r.x0 <= cabin.x1 && r.x1 >= cabin.x0, `cabin at y ${y}: the opening is not over the cabin: ${show(r)}`);
    lowest = Math.min(lowest, r.y0 - y);
  }
  assert.ok(lowest > 0, `through the rise the opening's lower edge comes ${(-lowest).toFixed(2)} below the floor of the cabin`);
  t.diagnostic(`through the rise the opening stays at least ${lowest.toFixed(2)} above the floor of the cabin`);
  // The dawn: nothing before the surface, then the bright sky that stays for the terrace.
  const glow = stage.scene.getObjectByName('dawnGlow');
  run(stage, open(229, 66), 30);
  assert.equal(glow.material.opacity, 0, 'at the top platform before the ride the dawn glow is off');
  Object.assign(ride.ascent, { stage: 'surface', cabinY: LEVEL.bounds.y1 });
  Object.assign(ride.player, { y: LEVEL.bounds.y1 });
  run(stage, ride, 180);
  assert.equal(glow.material.opacity, 1, 'on the surface the dawn has come in');
  ride.ascent.stage = 'terrace';
  run(stage, ride, 120);
  assert.ok(inside(box(camera, pale()), VIEW) && glow.material.opacity === 1, 'on the terrace the opening is in view under the dawn');
  stage.dispose();
});

test('Scene: nothing draws in front of ILO or the ground under it anywhere on the route', { skip: LEVEL === null }, (t) => {
  const stage = createStage(LEVEL);
  stage.resize(...SIZE);
  const { camera, scene } = stage;
  assert.ok(ROUTE.length >= 80, `the ROUTE block names ${ROUTE.length} places`);
  run(stage, open(...Object.values(LEVEL.spawn).map(Number).slice(0, 2)), 1);
  // The scenery in front of the actors: the gameplay plane is z 0 and actors draw from z 0.12 on.
  const front = [];
  scene.getObjectByName('scenery').traverse((object) => {
    if (!object.isMesh || object.geometry.attributes.position === undefined) return;
    const b = new THREE.Box3().setFromObject(object);
    if (!b.isEmpty() && b.min.z > 0.11) front.push(object);
  });
  const v = new THREE.Vector3();
  /** The triangles of `object` on the view, each as a box in normalized device coordinates. */
  const triangles = (object) => {
    const { position: p, index } = object.geometry;
    const out = [];
    for (let i = 0; i + 2 < (index ? index.count : p.count); i += 3) {
      const points = [];
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(p, index ? index.getX(i + k) : i + k).applyMatrix4(object.matrixWorld).project(camera);
        points.push({ x: v.x, y: v.y });
      }
      out.push(around(points));
    }
    return out;
  };
  let frames = 0;
  for (const [x, y] of ROUTE) {
    // ILO drops onto the place: the view lags behind, as it does after a descent in play.
    const world = open(x, y + 6);
    Object.assign(world.player, { vy: -18, grounded: false });
    for (let i = 0; i < 32; i++) {
      const p = world.player;
      if (!p.grounded && (p.y = Math.max(y, p.y - 0.3)) === y) Object.assign(p, { grounded: true, vy: 0 });
      stage.sync(world, FRAME, []);
      scene.updateMatrixWorld(true);
      const ilo = onView(camera, p.x - PLAYER.w / 2, p.x + PLAYER.w / 2, p.y, p.y + PLAYER.h);
      const ground = onView(camera, p.x - 1, p.x + 1, p.y - 2, p.y);
      for (const object of front) {
        for (const tri of triangles(object)) {
          assert.ok(!meets(tri, ilo) && !meets(tri, ground), `ILO at (${x}, ${y}), frame ${i}: a piece of the foreground covers ILO or the ground under its feet`);
        }
      }
      frames++;
    }
  }
  t.diagnostic(`${ROUTE.length} places of the route, ${frames} frames of their descents: ${front.length} scenery meshes draw in front of the actors`);
  stage.dispose();
});

test('Props: the console of the lift is a lit floor plate, and the deck of the cabin stays under ILO\'s feet', { skip: LEVEL === null }, () => {
  const stage = createStage(LEVEL);
  /** The lowest and the highest vertex of the mesh `name` for which `pick` holds, and how many there are. */
  const range = (name, pick) => {
    const p = stage.scene.getObjectByName(name).geometry.attributes.position;
    let low = Infinity;
    let high = -Infinity;
    let count = 0;
    for (let i = 0; i < p.count; i++) {
      if (!pick(p.getX(i), p.getY(i), p.getZ(i))) continue;
      count++;
      low = Math.min(low, p.getY(i));
      high = Math.max(high, p.getY(i));
    }
    return { low, high, count };
  };
  const plate = range('consolePlate', (x) => Math.abs(x) <= 0.6); // the plate itself, apart from the rails of the shaft
  assert.ok(plate.count > 0 && plate.low >= 0 && plate.high <= 0.12, `the console's plate rises from ${plate.low} to ${plate.high.toFixed(3)} units`);
  const rim = range('consoleRim', () => true);
  assert.ok(rim.count > 0 && rim.low >= 0.06 && rim.high <= 0.12, `the lit rim of the plate rises from ${rim.low.toFixed(3)} to ${rim.high.toFixed(3)} units`);
  const deck = range('cabinDeck', (x, y, z) => z > 0.3); // the deck in front of ILO, apart from the posts and the beam
  assert.ok(deck.count > 0 && deck.low <= -0.3 && deck.high <= 0.001, `the deck of the cabin rises to ${deck.high.toFixed(3)} over the floor`);
  const barrier = range('barrier', () => true);
  assert.ok(barrier.count > 0 && barrier.low >= -0.01, `the barrier of the cabin starts at ${barrier.low.toFixed(3)}`);
  stage.dispose();
});

test('Scene: the pale opening fades out toward the west, every material of it', { skip: LEVEL === null }, (t) => {
  const top = LEVEL.bounds.y1;
  // The rule on its own: the scenery of LEVEL looking at a view center, with the dawn in.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  const scenery = createScenery(scene, LEVEL, new THREE.OrthographicCamera());
  const opening = scene.getObjectByName('opening');
  const world = open(LEVEL.ascent.x, top);
  world.mode = 'liftSequence';
  Object.assign(world.ascent, { stage: 'surface', cabinY: top });
  const NO_BANDS = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const [x, expected] of [[190, 0], [197, 0.5], [205, 1]]) {
    const view = { x, y: top - 2, unitsPerPixel: 14 / SIZE[1] }; // what the rig gives at SIZE without bands
    for (let i = 0; i < 150; i++) scenery.sync(world, FRAME, [], { ...view, free: freeRect(view, ...SIZE, NO_BANDS) }); // 2.5 s: the dawn has come in
    const got = opening.children.map((child) => child.material.opacity);
    assert.ok(got.every((opacity) => Math.abs(opacity - expected) < 1e-9), `view x ${x}: opacities ${got.join(', ')}, not ${expected} for every material`);
    assert.equal(opening.visible, expected > 0, `view x ${x}: the opening is ${expected > 0 ? 'hidden' : 'shown'}`);
    t.diagnostic(`view x ${x}: the pale face, the spill and the dawn glow show ${got.join(', ')}`);
  }
  scenery.dispose();
  // Through the rig: the floor of the foundry west of x 192 never shows it, the service platform shows all of it.
  const stage = createStage(LEVEL);
  stage.resize(...SIZE);
  const shown = stage.scene.getObjectByName('opening');
  for (const [x, y, expected] of [[186.5, 22, 0], [196, 22, 0.4], [208.5, 54, 1]]) {
    run(stage, open(x, y), 150);
    const opacity = shown.children[0].material.opacity;
    assert.ok(Math.abs(opacity - expected) < 0.02, `ILO at (${x}, ${y}): the opening shows ${opacity}, not ${expected}`);
  }
  stage.dispose();
});

test('Scene: under the interface the pale opening stays in the free part of the view, above the cabin through the ride', { skip: LEVEL === null }, (t) => {
  const stage = createStage(LEVEL);
  stage.resize(...SIZE);
  const { camera } = stage;
  const face = stage.scene.getObjectByName('opening').children[0];
  const bands = { top: 76, bottom: 60, left: 0, right: 0 }; // canvas pixels: the HUD over the top of the canvas, touch controls under its bottom
  stage.setBands(bands);
  /** The rect of the plane that the view shows between its bands. */
  const free = () => {
    const whole = around([planePoint(camera, -1, -1), planePoint(camera, 1, 1)]);
    const unit = (whole.y1 - whole.y0) / SIZE[1];
    return { x0: whole.x0, x1: whole.x1, y0: whole.y0 + bands.bottom * unit, y1: whole.y1 - bands.top * unit };
  };
  const clearOf = (label) => {
    const r = stands(face, camera);
    const f = free();
    assert.ok(inside(r, f), `${label}: the opening stands at ${show(r)} of a view free over ${show(f)}`);
    return r;
  };
  for (const [x, y] of [[208.5, 54], [229, 66]]) {
    run(stage, open(x, y), 120);
    const r = clearOf(`from (${x}, ${y})`);
    assert.ok(r.y0 >= y + PLAYER.h, `from (${x}, ${y}) the opening comes down to ${show(r)}, over ILO`);
  }
  // Through the ride the cabin climbs from the top platform to the top of the level: the opening stays over it and above its floor.
  const ride = open(229, 66);
  ride.mode = 'liftSequence';
  const { x: lift, y: floor, w } = LEVEL.ascent;
  const cabin = { x0: lift - w / 2, x1: lift + w / 2 };
  let lowest = Infinity;
  for (const [name, y] of [['board', floor], ['barrier', floor], ['rise', floor + 3], ['rise', floor + 9], ['rise', floor + 15], ['rise', LEVEL.bounds.y1], ['surface', LEVEL.bounds.y1], ['terrace', LEVEL.bounds.y1]]) {
    Object.assign(ride.ascent, { stage: name, cabinY: y });
    Object.assign(ride.player, { x: lift, y });
    run(stage, ride, 60);
    const r = clearOf(`${name}, cabin at y ${y}`);
    assert.ok(r.x0 <= cabin.x1 && r.x1 >= cabin.x0, `${name}, cabin at y ${y}: the opening is not over the cabin: ${show(r)}`);
    lowest = Math.min(lowest, r.y0 - y);
  }
  assert.ok(lowest > 0, `through the ride the opening's lower edge comes ${(-lowest).toFixed(2)} below the floor of the cabin`);
  t.diagnostic(`through the ride the opening stays at least ${lowest.toFixed(2)} above the floor of the cabin, inside a view free up to ${show(free())}`);
  stage.dispose();
});

test('Scene: the terrace of the ending is a ruin that stands clear of the walk of ILO from the cabin', { skip: LEVEL === null }, (t) => {
  const stage = createStage(LEVEL);
  stage.resize(...SIZE);
  const { scene } = stage;
  const top = LEVEL.bounds.y1;
  const { x: lift, w } = LEVEL.ascent;
  run(stage, open(lift, top), 60);
  const ruins = scene.getObjectByName('ruins');
  assert.ok(ruins !== undefined, 'the scenery has no ruins on the terrace');
  /** Every piece by name, with its box in the world. */
  const pieces = ruins.children.map((piece) => ({ name: piece.name.slice(5), box: new THREE.Box3().setFromObject(piece) }));
  assert.deepEqual(pieces.map((piece) => piece.name), ['stumpWest', 'postWest', 'slab', 'stumpLow', 'stumpTall', 'railing']);
  // On the top surface of the terrace, inside the level from side to side: west of the shaft, or east of the cabin.
  const tops = LEVEL.solids.filter((solid) => solid.y + solid.h === top).map((solid) => [solid.x, solid.x + solid.w]);
  for (const { name, box } of pieces) {
    const [from, to] = name.endsWith('West') ? [221, 226] : [233, LEVEL.bounds.x1];
    assert.ok(Math.abs(box.min.y - top) < 1e-6 && box.max.y > top + 0.3, `${name} stands from y ${box.min.y.toFixed(3)} to ${box.max.y.toFixed(3)}, not on the terrace at y ${top}`);
    assert.ok(box.min.x >= from && box.max.x <= to, `${name} stands at x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)}, outside ${from}..${to}`);
    assert.ok(box.min.x >= LEVEL.bounds.x0, `${name} leaves the level to the west`);
    assert.ok(tops.some(([x0, x1]) => box.min.x >= x0 && box.max.x <= x1), `${name} does not stand on the rock`);
    assert.ok(box.max.x <= lift - w / 2 || box.min.x >= lift + w / 2, `${name} stands in the cabin`);
    t.diagnostic(`${name}: x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)}, up to y ${box.max.y.toFixed(2)}, its front at z ${box.max.z.toFixed(2)}`);
  }
  // Behind the body of ILO: every piece ends behind the back of ILO's model, so the body is clear wherever ILO stands.
  const body = new THREE.Box3().setFromObject(scene.getObjectByName('ilo'));
  assert.ok(pieces.every((piece) => piece.box.max.z < body.min.z), `a piece reaches past the back of ILO at z ${body.min.z.toFixed(2)}`);
  for (let x = lift; x <= 237; x += 0.25) {
    const standing = new THREE.Box3(new THREE.Vector3(x - PLAYER.w / 2, top, body.min.z), new THREE.Vector3(x + PLAYER.w / 2, top + PLAYER.h, body.max.z));
    for (const { name, box } of pieces) assert.ok(!box.intersectsBox(standing), `ILO standing at x ${x.toFixed(2)}: ${name} is in ILO's body`);
  }
  // The walk itself, as the simulation plays it: ILO's whole silhouette stays clear of every piece.
  const world = createWorld(LEVEL);
  for (const relay of world.relays) relay.active = true;
  world.mode = 'liftSequence';
  let steps = 0;
  while (world.mode === 'liftSequence' && steps < 2000) {
    stepWorld(world);
    steps++;
    const { x, y } = world.player;
    const silhouette = new THREE.Box3(new THREE.Vector3(x - PLAYER.w / 2, y, -Infinity), new THREE.Vector3(x + PLAYER.w / 2, y + PLAYER.h, Infinity));
    for (const { name, box } of pieces) assert.ok(!box.intersectsBox(silhouette), `step ${steps}, ILO at (${x.toFixed(2)}, ${y.toFixed(2)}): its silhouette meets ${name}`);
  }
  assert.ok(steps > 0 && world.mode === 'complete', `the lift did not end in complete after ${steps} steps`);
  t.diagnostic(`the walk ends with ILO at x ${world.player.x.toFixed(2)}: ${pieces.length} pieces behind it, the first from x ${Math.min(...pieces.filter((piece) => !piece.name.endsWith('West')).map((piece) => piece.box.min.x)).toFixed(2)}`);
  stage.dispose();
});

test('Scene: the scenery behind the actors lies on layers that follow the camera sideways, each at its own share of a 10 unit move', { skip: LEVEL === null }, (t) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(); // the scenery repaints the background of its region
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const scenery = createScenery(scene, LEVEL, camera);
  const root = scene.getObjectByName('scenery');
  const world = createWorld(LEVEL); // at rest: the layers follow the view, whatever ILO does
  const TRAVEL = 10; // units the camera moves sideways
  const PROBE = 3; // units of a shorter move, elsewhere: a layer's share of it says how far it goes on the longer one
  const free = { x0: -480, x1: 480, y0: -270, y1: 270 }; // the view of SIZE, without interface bands
  /** Where every group of the scenery stands with the view centered at (`x`, `y`), in the order of the scenery. */
  const at = (x, y = 0) => {
    scenery.sync(world, 0, [], { x, y, unitsPerPixel: 1, shakeX: 0, shakeY: 0, free });
    return root.children.map((group) => group.position.clone());
  };
  const drawn = root.children.filter((group) => {
    let found = false;
    group.traverse((object) => { if (object.isMesh) found = true; });
    return found;
  });
  assert.ok(drawn.length >= 2, `${drawn.length} groups of scenery draw something`);
  const rest = at(0);
  const far = at(TRAVEL);
  const nearProbe = at(60); // another place, `PROBE` units west of the next view
  const farProbe = at(60 + PROBE);
  const layers = new Map(); // a group behind the actors -> its share of the camera's move
  for (const group of drawn) {
    const i = root.children.indexOf(group);
    const long = far[i].x - rest[i].x;
    const short = farProbe[i].x - nearProbe[i].x;
    if (long === 0 && short === 0) continue; // stays with the world
    assert.ok(long > 0 && long < TRAVEL, `the camera moves ${TRAVEL} units: a layer of the scenery moves ${long.toFixed(4)}: it must go the same way, less far`);
    assert.ok(Math.abs(long - (short * TRAVEL) / PROBE) <= 1e-9, `the camera moves ${TRAVEL} units: the layer moves ${long.toFixed(4)}, but ${((short * TRAVEL) / PROBE).toFixed(4)} on its share of a ${PROBE} unit move elsewhere`);
    assert.ok(far[i].y === rest[i].y && far[i].z === rest[i].z, `the camera moves sideways: the layer moves ${(far[i].y - rest[i].y).toFixed(4)} units up and ${(far[i].z - rest[i].z).toFixed(4)} in depth`);
    group.updateWorldMatrix(true, true);
    const behind = new THREE.Box3().setFromObject(group).max.z;
    assert.ok(behind <= 0, `the layer reaches z ${behind.toFixed(3)}, in front of the gameplay plane (z 0) where the actors draw`);
    layers.set(group, long / TRAVEL);
  }
  const byDepth = [...layers.keys()].sort((a, b) => new THREE.Box3().setFromObject(b).max.z - new THREE.Box3().setFromObject(a).max.z);
  const shares = byDepth.map((group) => layers.get(group).toFixed(4));
  assert.ok(new Set(shares).size >= 2, `${layers.size} groups behind the actors follow the camera, all at the share ${[...new Set(shares)].join(', ')}: not layers of different depth`);
  t.diagnostic(`of ${drawn.length} groups of scenery, ${layers.size} lie behind the actors and take ${shares.join(', ')} of a ${TRAVEL} unit move of the camera, from the nearest; ${drawn.length - layers.size} stay with the world`);
  scenery.dispose();
});
