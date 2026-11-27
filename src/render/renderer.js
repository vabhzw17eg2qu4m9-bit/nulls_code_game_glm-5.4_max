// The renderer (contract §5.1): a stage is the scene graph, the camera rig and the actors, with no WebGL; the
// renderer adds a THREE.WebGLRenderer to a stage.

import * as THREE from '../../vendor/three/three.module.js';
import { createCameraRig, placeCamera } from './camera.js';
import { createEffects } from './effects.js';
import { createIlo } from './ilo.js';
import { createMachines } from './machines.js';
import { createProps } from './props.js';
import { createScenery } from './scenery.js';
import { createTerrain } from './terrain.js';
import { PALETTE } from './voxel.js';

const MAX_PIXEL_RATIO = 2;
const START_SIZE = [960, 540]; // backing pixels of the view until `resize` says otherwise

/**
 * The stage of `level`: `{ scene, camera, sync, resize, setBands, setReducedMotion, dispose }` (contract §5.1).
 * `sync(world, dt, events)` runs once per frame; `dt` is visual seconds and 0 while paused. `resize(viewW, viewH)`
 * takes the size of the canvas backing store in pixels; `setBands({ top, bottom, left, right })` the parts of it the
 * interface covers.
 */
export function createStage(level) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.background);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const rig = createCameraRig(level);
  let [viewW, viewH] = START_SIZE;
  let view = { x: level.spawn.x, y: level.spawn.y, unitsPerPixel: 1, shakeX: 0, shakeY: 0 }; // the spawn, until the first sync
  placeCamera(camera, view, viewW, viewH);

  const ilo = createIlo(scene);
  const scenery = createScenery(scene, level, camera);
  const terrain = createTerrain(scene, level);
  const actors = [ilo, createMachines(scene, level), createProps(scene, level, ilo), createEffects(scene)];

  /** Put the camera where the rig looks now, for the current size. */
  function frame() {
    placeCamera(camera, view, viewW, viewH);
  }

  return {
    scene,
    camera,
    sync(world, dt, events) {
      view = rig.update(world, dt, viewW, viewH);
      frame();
      scenery.sync(world, dt, events, view);
      for (const actor of actors) actor.sync(world, dt, events);
    },
    resize(width, height) {
      viewW = Math.max(1, width);
      viewH = Math.max(1, height);
      frame();
    },
    /** The parts of the canvas the interface covers, in canvas pixels: `{ top, bottom, left, right }`. The rig keeps ILO clear of them. */
    setBands(bands) {
      rig.setBands(bands);
    },
    setReducedMotion(on) {
      rig.setReducedMotion(on);
      scenery.setReducedMotion(on);
      for (const actor of actors) actor.setReducedMotion?.(on);
    },
    dispose() {
      for (const actor of actors) actor.dispose();
      scenery.dispose();
      terrain.dispose();
    },
  };
}

/**
 * The view of `level` on `canvas`: a stage plus a `THREE.WebGLRenderer` (pixel ratio capped at 2, no shadow maps).
 * Throws `Error('WebGL is not available.')` when the canvas has no WebGL 2 context.
 */
export function createRenderer(canvas, level) {
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (context === null) throw new Error('WebGL is not available.');
  const stage = createStage(level);
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = false;
  let stats = { calls: 0, triangles: 0 };

  return {
    stage,
    /** Draw one frame: the stage follows `world`, then the renderer draws it. */
    sync(world, dt, events) {
      stage.sync(world, dt, events);
      renderer.render(stage.scene, stage.camera);
      stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    /** Match the backing store to the displayed size of the canvas, times the pixel ratio. */
    resize() {
      const width = canvas.clientWidth || canvas.width;
      const height = canvas.clientHeight || canvas.height;
      renderer.setSize(width, height, false);
      stage.resize(canvas.width, canvas.height);
    },
    setBands(bands) {
      stage.setBands(bands);
    },
    setReducedMotion(on) {
      stage.setReducedMotion(on);
    },
    /** `{ calls, triangles }` of the last drawn frame. */
    stats() {
      return stats;
    },
    dispose() {
      stage.dispose();
      renderer.dispose();
    },
  };
}
