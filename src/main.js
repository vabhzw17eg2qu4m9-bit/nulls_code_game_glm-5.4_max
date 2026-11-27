// Entry point (contract §2 and §6): the fixed simulation step, input, interface, audio and the view.

import { createAudio } from './audio/audio.js';
import { DT } from './config.js';
import { LEVEL } from './level/level.js';
import { createInput } from './input.js';
import { createRenderer } from './render/renderer.js';
import { viewRect } from './render/camera.js';
import { createWorld, inspect, setMode, stepWorld } from './sim/world.js';
import { createUI } from './ui/ui.js';
import { loadRecords, loadSettings, saveRecords, saveSettings, submitResult } from './ui/records.js';

const MAX_FRAME = 0.1; // seconds one frame may pass on; a longer stall does not catch up
const MAX_STEPS = 8;
const PAUSABLE = new Set(['play', 'relayActivation', 'liftSequence']); // the modes P, Escape and the pause button pause
const IDLE = {
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
};

/** The view on the canvas, or null without a usable WebGL 2 context. */
function createView() {
  try {
    return createRenderer(document.querySelector('#game'), LEVEL);
  } catch (error) {
    // The player reads the message on the page; the developer finds the cause here.
    console.error(error);
    return null;
  }
}

/**
 * Tell the view what of the canvas the interface covers, in canvas pixels: the HUD bar at the top and, when the
 * touch controls show, the band they fill with the width of each cluster. The canvas fills the window, so the boxes
 * of the interface are boxes of the canvas.
 */
function measureBands(view, canvas) {
  const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
  const shown = (rect) => rect !== undefined && rect.width > 0 && rect.height > 0;
  const hud = box('.hud');
  const touch = box('#touch');
  const move = box('.touch-move');
  const act = box('.touch-act');
  const scale = canvas.width / Math.max(canvas.clientWidth, 1); // backing pixels per CSS pixel
  view.setBands({
    top: (shown(hud) ? hud.bottom : 0) * scale,
    bottom: (shown(touch) ? canvas.clientHeight - touch.top : 0) * scale,
    left: (shown(touch) && shown(move) ? move.right : 0) * scale,
    right: (shown(touch) && shown(act) ? canvas.clientWidth - act.left : 0) * scale,
  });
}

/** The message that replaces a game which cannot run or has stopped: on top of everything, always readable. */
function fatal(text) {
  document.querySelector('#ui').append(Object.assign(document.createElement('p'), { id: 'fatal', className: 'fatal', textContent: text }));
}

function start(view) {
  const sound = createAudio();
  const input = createInput();
  const canvas = document.querySelector('#game');

  let world = createWorld(LEVEL);
  let records = loadRecords();
  let settings = loadSettings();
  let submitted = false; // the result of the current expedition is folded into the records
  let resultFlags = null;
  let accumulator = 0;
  let last = performance.now();
  let wasReading = false;

  /** A new world in `play`: from the title, from the results, or as the full restart of the pause menu. */
  function begin() {
    world = createWorld(LEVEL);
    world.mode = 'play';
    submitted = false;
    resultFlags = null;
    accumulator = 0;
    input.reset();
  }

  function setPaused(on) {
    world.paused = on;
    input.reset();
  }

  /**
   * Retry from Checkpoint: one recovery, so the reboot sequence plays like any other. The simulation recovers from
   * `play` only: from the relay look or the lift the run is back in play first, and the lift commits its result again
   * when it leaves next.
   */
  function retry() {
    if (world.mode !== 'play') {
      world.result = null;
      setMode(world, 'play');
    }
    world.paused = false;
    input.reset();
    input.state.retryPressed = true;
  }

  function applySettings() {
    sound.setMuted(settings.muted);
    view.setReducedMotion(settings.reducedMotion);
    ui.setMuted(settings.muted);
    ui.setReducedMotion(settings.reducedMotion);
  }

  const actions = {
    begin,
    resume() {
      setPaused(false);
    },
    retry,
    restart: begin,
    pause() {
      if (PAUSABLE.has(world.mode)) setPaused(world.paused !== true);
    },
    mute() {
      settings.muted = !settings.muted;
      applySettings();
      saveSettings({ muted: settings.muted });
    },
    reducedMotion(on) {
      settings.reducedMotion = on;
      applySettings();
      saveSettings({ reducedMotion: on });
    },
  };

  const ui = createUI({ root: document.querySelector('#ui'), touchRoot: document.querySelector('#touch'), actions });

  /** True while the simulation advances: past the title, short of the results, unpaused, no archive open. */
  const running = () => world.mode !== 'title' && world.mode !== 'complete' && world.paused !== true && !ui.isFragmentOpen();

  /** Overlay keys act between frames; the simulation never sees them. */
  function handleOverlay() {
    const state = input.state;
    const { mode, paused } = world;
    if (mode === 'title' || mode === 'complete') {
      if (state.confirmPressed) begin();
    } else if (PAUSABLE.has(mode) && (state.pausePressed || paused)) {
      // The pause key works from a focused overlay button as well; every other key of the pause menu follows.
      if (state.pausePressed) setPaused(!paused);
      else if (state.confirmPressed) setPaused(false);
      else if (state.retryPressed) retry();
    } else if (ui.isFragmentOpen() && (state.confirmPressed || state.interactPressed)) ui.dismissFragment();
  }

  function finish() {
    submitted = true;
    const outcome = submitResult(records, world.result);
    records = outcome.records;
    resultFlags = outcome.flags;
    saveRecords(records);
  }

  function tick(now) {
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleOverlay();
    // Keys pressed while an archive was open must not fire the moment it closes.
    const reading = ui.isFragmentOpen();
    if (wasReading && !reading) input.reset();
    wasReading = reading;

    let steps = 0;
    const events = [];
    const live = running();
    const mode = world.mode;
    if (live) {
      accumulator += dt;
      steps = Math.min(Math.floor(accumulator / DT), MAX_STEPS);
      accumulator = Math.min(accumulator - steps * DT, DT);
      for (let i = 0; i < steps; i++) {
        stepWorld(world, input.state);
        // Every gameplay edge is used by the first step of a frame, whatever comes later in that frame.
        if (i === 0) input.afterStep();
        events.push(...world.events);
        world.events.length = 0;
      }
    }
    // A recovery is a scene transition: whatever was held when it began stays released.
    if (world.mode === 'shutdown' && mode !== 'shutdown') input.reset();
    if (world.mode === 'complete' && !submitted) finish();

    // The view and the sound stand still while the game is paused, an archive is open or the page is hidden.
    // The title and the results keep their ambient motion: it needs frame time, not a step.
    const visualDt = world.paused !== true && !reading && !document.hidden ? dt : 0;
    // The interface moves with the mode, the prompt and the pointer; the view keeps clear of it.
    measureBands(view, canvas);
    view.sync(world, visualDt, events);
    sound.sync(world, visualDt, events);
    ui.sync(world, { records, flags: resultFlags });
    for (const event of events) ui.handle(event);
    input.endFrame(steps);
  }

  function frame(now) {
    try {
      tick(now);
    } catch (error) {
      // One message, then the loop stops: a frozen frame with its reason beats a blank screen.
      fatal(`DEEPWAKE stopped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    requestAnimationFrame(frame);
  }

  /** A hidden page pauses the game: coming back finds the pause menu, never a run that went on unseen. */
  const onVisibility = () => {
    if (document.hidden && PAUSABLE.has(world.mode)) setPaused(true);
  };
  document.addEventListener('visibilitychange', onVisibility);

  const resize = () => {
    view.resize();
    measureBands(view, canvas);
  };
  window.addEventListener('resize', resize);
  const unlock = () => sound.unlock();
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('pointerdown', unlock, true);

  /** The part of the gameplay plane the whole canvas shows, `{ x0, y0, x1, y1 }` in world units: where the camera of
   *  the stage looks now. It looks along its local -z axis at the plane z 0. */
  function shownRect() {
    const { camera } = view.stage;
    const m = camera.matrixWorld.elements;
    const along = m[14] / m[10]; // from the camera to the plane, in lengths of that axis
    return viewRect({ x: m[12] - m[8] * along, y: m[13] - m[9] * along, unitsPerPixel: (2 * camera.right) / canvas.width },
      canvas.width, canvas.height);
  }

  // Checks only (contract §6): nothing of this shows in the player interface.
  window.DEEPWAKE = {
    inspect: () => ({ ...inspect(world), view: shownRect() }),
    advance(seconds, input = IDLE) {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        stepWorld(world, { ...IDLE, ...input });
        world.events.length = 0;
      }
    },
    warp(x, y) {
      Object.assign(world.player, { x, y, vx: 0, vy: 0 });
    },
    get world() {
      return world;
    },
  };

  applySettings();
  resize();
  requestAnimationFrame(frame);
}

const view = createView();
if (view === null) fatal('DEEPWAKE needs WebGL, which this browser does not provide.');
else start(view);
