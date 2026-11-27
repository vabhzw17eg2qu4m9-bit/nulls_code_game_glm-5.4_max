// The whole game in Node (contract §0 rule 12, §6): `src/main.js` boots and runs on the fake page, the fake WebGL
// and the fake Web Audio, with a clock and an animation frame the test turns by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../vendor/three/three.module.js';
import { RUN } from '../src/config.js';
import { install as installAudio } from './fakes/audio.js';
import { createCanvas } from './fakes/gl.js';
import { createStorage, installDom } from './fakes/dom.js';

const FRAME = 1000 / 60; // ms: one frame on the clock the test turns
const RECORDS = 'deepwake.records.v1';
const SETTINGS = 'deepwake.settings.v1';
const RECORD = { version: 1, bestTime: 303.4, bestArchiveTime: null, fewestRecoveries: 2, fewestRecoveriesTime: 303.4 };
const ARCHIVE = { type: 'archive', id: 'A', title: 'T', text: 'X' };
let boots = 0;

/** The roots of index.html on the fake document. Canvases answer as the canvases of the GL fake; `webgl: false` is a browser without WebGL 2. */
function buildPage(document, webgl, size) {
  const plain = document.createElement.bind(document);
  const canvas = (element, options) => {
    const { addEventListener, removeEventListener, setAttribute, ...members } = createCanvas(options);
    return Object.assign(element, members);
  };
  document.createElement = (tag) => (tag === 'canvas' ? canvas(plain(tag)) : plain(tag));
  const roots = { game: canvas(plain('canvas'), { webgl, width: size[0], height: size[1] }), touch: plain('div'), ui: plain('div') };
  for (const [id, element] of Object.entries(roots)) {
    element.id = id;
    document.body.append(element);
  }
  return roots;
}

const count = (target) => [...target.listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);

/**
 * A fresh game: the fake page, the fake Web Audio, a fixed clock and the hand-driven animation frame are in place
 * before `src/main.js` runs. Every boot is a new instance of the module.
 */
async function boot(t, { webgl = true, storage = createStorage(), size = [640, 360], ratio = 1, reduce = false } = {}) {
  const { window, document } = installDom({ storage, reduce });
  const roots = buildPage(document, webgl, size);
  const audio = installAudio();
  const clock = { now: 0, queue: [] }; // queue: frame callbacks requested and not run yet
  t.mock.method(performance, 'now', () => clock.now);
  globalThis.requestAnimationFrame = (callback) => clock.queue.push(callback);
  t.after(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.devicePixelRatio;
    audio.uninstall();
  });
  // Three.js reports its renderer to the devtools hook: there the test reads what each frame draws.
  const renderers = [];
  globalThis.__THREE_DEVTOOLS__ = { dispatchEvent: (event) => { if (typeof event.detail?.render === 'function') renderers.push(event.detail); } };
  // The cause of a missing view goes to the console for developers; the test reads the page.
  if (!webgl) t.mock.method(console, 'error', () => {});
  globalThis.devicePixelRatio = ratio; // backing pixels per CSS pixel
  await import(`${new URL('../src/main.js', import.meta.url)}?boot=${++boots}`);
  delete globalThis.__THREE_DEVTOOLS__;
  /** Per drawn frame: whether anything in the scene changed since the frame before: a pose, a size, a visibility, an opacity. Without frame time nothing moves. */
  const moved = [];
  const renderer = renderers[0];
  let last = null; // the camera of the last frame drawn
  if (renderer !== undefined) {
    const render = renderer.render;
    let previous = null;
    renderer.render = (scene, camera) => {
      last = camera;
      const picture = [];
      scene.traverse((object) => picture.push(
        object.position.x, object.position.y, object.position.z, object.quaternion.x, object.quaternion.y, object.quaternion.z,
        object.quaternion.w, object.scale.x, object.scale.y, object.scale.z, object.visible ? 1 : 0, object.material?.opacity ?? 0,
      ));
      moved.push(previous !== null && (previous.length !== picture.length || !previous.every((value, i) => value === picture[i])));
      previous = picture;
      return render.call(renderer, scene, camera);
    };
  }

  const writes = [];
  const setItem = storage.setItem;
  storage.setItem = (key, value) => {
    writes.push(key);
    setItem.call(storage, key, value);
  };

  const ui = roots.ui;
  const overlay = ui.querySelector('#overlay');
  const D = window.DEEPWAKE;
  const fatal = () => ui.querySelector('#fatal')?.textContent ?? null;

  /** Run `n` frames; the message a frame left behind, or null. */
  const frames = (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.now += FRAME;
      audio.tick(1 / 60);
      for (const callback of clock.queue.splice(0)) callback(clock.now);
    }
    return fatal();
  };

  /** A key event as the browser delivers it: to the focused element, bubbling up to the window. */
  const key = (type, code) => document.activeElement.dispatch(type, { code });
  const press = (code) => {
    const focused = document.activeElement;
    // A browser turns Enter on a focused button into a click; the fake page leaves that to the test.
    if (key('keydown', code) && code === 'Enter' && focused.tagName === 'BUTTON') focused.dispatch('click');
  };
  const release = (code) => key('keyup', code);
  /** Press `code`, run `n` frames, release it; the message a frame left behind, or null. */
  const tap = (code, n = 1) => {
    press(code);
    const left = frames(n);
    release(code);
    return left;
  };

  return {
    window, document, storage, audio, ui, D,
    moved,
    /** Where a point of the gameplay plane lies on the page, in CSS pixels from its top, in the last frame drawn: `[x, y]`. */
    screen: (x, y) => {
      const ndc = new Vector3(x, y, 0).applyMatrix4(last.matrixWorldInverse).applyMatrix4(last.projectionMatrix);
      return [((ndc.x + 1) * roots.game.clientWidth) / 2, ((1 - ndc.y) * roots.game.clientHeight) / 2];
    },
    inspect: () => D.inspect(),
    warp: (x, y) => D.warp(x, y),
    frames,
    /** Run frames until `stop()` holds (at most `max`); the message a frame left behind, or null. */
    until(stop, max = 600) {
      for (let i = 0; !stop() && i < max; i++) frames();
      assert.ok(stop(), `not reached within ${max} frames`);
      return fatal();
    },
    press, release, tap,
    q: (selector) => ui.querySelector(selector),
    in: (id, selector) => ui.querySelector(id).querySelector(selector),
    /** The overlay on screen: `title`, `pause`, `recovery`, `complete`, or null. */
    view: () => (overlay.hidden ? null : overlay.dataset.view),
    fatal,
    /** Frame callbacks still waiting: 1 while the loop runs, 0 once it stopped. */
    pending: () => clock.queue.length,
    /** The page flag a browser sets, with its event; the fake derives the `visibilityState` the audio module reads from it. */
    hide(on) {
      document.hidden = on;
      document.dispatch('visibilitychange');
    },
    written: (name) => writes.filter((key) => key === name).length,
    listeners: () => ({ window: count(window), document: count(document), touch: count(roots.touch) }),
  };
}

/** Fails when something moved among the last `n` drawn frames: paused, hidden or behind an archive, the view gets no time. */
const still = (h, n) => assert.ok(h.moved.length >= n && h.moved.slice(-n).every((moved) => !moved), 'the view got frame time');

/** Fails when nothing moved among the last `n` drawn frames: the view gets its time back. */
const flows = (h, n) => assert.ok(h.moved.slice(-n).some(Boolean), 'the view gets no frame time');

/** Where ILO is and how it moves; timers may run where it stands. */
const spot = (p) => [p.x, p.y, p.vx, p.vy];

/** A source the audio fake saw start and stop at the same moment: the voice of a sound effect, unlike a loop. */
const isEffect = (node) => (node.kind === 'oscillator' || node.kind === 'bufferSource')
  && node.calls.find((call) => call.name === 'start')?.time === node.calls.find((call) => call.name === 'stop')?.time;

test('Boot: the game runs from its title through pause, recovery and restarts', async (t) => {
  const storage = createStorage({ [RECORDS]: JSON.stringify(RECORD) });
  const h = await boot(t, { storage });
  const { D, document } = h;
  const player = () => h.inspect().player;
  const paused = () => h.inspect().paused === true;
  let booted; // the listeners of the boot and its first gesture

  await t.test('it boots in title behind the title overlay: the scene moves on while nothing steps', () => {
    assert.equal(h.frames(5), null);
    assert.equal(h.inspect().mode, 'title');
    assert.equal(h.view(), 'title');
    assert.equal(h.q('#card-title').hidden, false);
    const before = h.inspect();
    assert.equal(h.frames(2), null);
    assert.ok(h.moved.at(-1), 'nothing in the scene changes between two frames of the title');
    const after = h.inspect();
    assert.equal(after.step, before.step, 'the glue steps a title world');
    assert.deepEqual(after.player, before.player, 'ILO moved in title');
  });

  await t.test('the first pointer down unlocks the audio; Enter begins the expedition', () => {
    assert.equal(h.audio.contexts.length, 0, 'audio opens before a gesture');
    h.window.dispatch('pointerdown');
    assert.equal(h.audio.contexts.length, 1);
    booted = h.listeners();
    document.activeElement.blur(); // no button in focus: Enter is the overlay key of the glue itself
    h.press('KeyD'); // held through Begin
    assert.equal(h.tap('Enter', 3), null);
    const state = h.inspect();
    assert.equal(state.mode, 'play');
    assert.equal(state.paused, false);
    assert.equal(h.view(), null);
    assert.equal(h.q('#hud').hidden, false);
    assert.equal(state.player.x, D.world.level.spawn.x, 'a key held at the title moves ILO after Begin');
    h.release('KeyD');
    flows(h, 2);
  });

  await t.test('A, D and Space change ILO', () => {
    const start = player().x;
    h.press('KeyD');
    assert.equal(h.frames(12), null);
    const right = player();
    h.release('KeyD');
    assert.ok(right.x > start && right.facing === 1 && right.vx > 0, `D: ILO went from ${start} to ${right.x}`);
    assert.equal(h.until(() => player().vx === 0), null);
    const stop = player().x;
    h.press('KeyA');
    assert.equal(h.frames(12), null);
    const left = player();
    h.release('KeyA');
    assert.ok(left.x < stop && left.facing === -1 && left.vx < 0, `A: ILO went from ${stop} to ${left.x}`);
    assert.equal(h.until(() => player().vx === 0), null);
    const ground = player().y;
    h.press('Space');
    assert.equal(h.frames(6), null);
    const air = player();
    h.release('Space');
    assert.ok(air.y > ground && air.grounded === false, `Space: ILO went from ${ground} to ${air.y}`);
    assert.equal(h.until(() => player().grounded && player().vx === 0), null);
  });

  await t.test('P pauses: nothing moves and the pause overlay shows; P and Escape resume from the focused Resume button', () => {
    assert.equal(h.tap('KeyP'), null);
    assert.equal(paused(), true);
    assert.equal(h.view(), 'pause');
    assert.equal(h.q('#card-pause').hidden, false);
    const before = h.inspect();
    h.press('KeyD');
    assert.equal(h.frames(60), null);
    const held = h.inspect();
    assert.equal(held.step, before.step, 'steps ran while paused');
    assert.equal(held.clock, before.clock, 'the clock ran while paused');
    assert.deepEqual(held.player, before.player, 'ILO changed while paused');
    still(h, 60);
    assert.equal(document.activeElement, h.in('#card-pause', '.resume'));
    assert.equal(h.tap('Escape', 3), null);
    assert.equal(paused(), false);
    assert.equal(h.view(), null);
    flows(h, 3);
    // D was down through the pause: the reset released it, so ILO waits for a new press.
    assert.equal(player().x, before.player.x, 'a key held through the pause moves ILO');
    h.release('KeyD');
    h.press('KeyD');
    assert.equal(h.frames(10), null);
    assert.ok(player().x > before.player.x, 'D pressed again does not move ILO');
    h.release('KeyD');
    assert.equal(h.until(() => player().vx === 0), null);
  });

  await t.test('R runs one recovery, from play and from the pause menu; R during a recovery adds nothing', () => {
    let recoveries = h.inspect().recoveries;
    h.press('KeyD'); // held through the recovery
    assert.equal(h.tap('KeyR'), null);
    const hit = h.inspect();
    assert.equal(hit.mode, 'shutdown');
    assert.equal(hit.cause, 'retry');
    assert.equal(hit.recoveries, recoveries + 1);
    assert.equal(h.view(), 'recovery');
    assert.equal(h.tap('KeyR'), null);
    assert.equal(h.frames(20), null);
    assert.equal(h.tap('KeyR'), null);
    assert.equal(h.tap('KeyR'), null);
    assert.equal(h.until(() => h.inspect().mode === 'play'), null);
    assert.equal(h.inspect().recoveries, recoveries + 1, 'R during the recovery counted');
    assert.equal(h.view(), null);
    const station = player().x;
    assert.equal(h.frames(10), null);
    assert.equal(player().x, station, 'a key held through the recovery moves ILO');
    h.release('KeyD');

    assert.equal(h.tap('KeyP'), null);
    assert.equal(paused(), true);
    assert.equal(h.tap('KeyR'), null);
    assert.equal(paused(), false);
    assert.equal(h.until(() => h.inspect().mode === 'play'), null);
    assert.equal(h.inspect().recoveries, recoveries + 2, 'R from the pause menu did not count once');
  });

  await t.test('a hidden page pauses the game; visible again it is still paused behind the pause overlay', () => {
    assert.equal(paused(), false);
    h.hide(true);
    assert.equal(paused(), true);
    assert.equal(h.frames(5), null);
    assert.equal(h.view(), 'pause');
    h.hide(false);
    assert.equal(h.frames(5), null);
    assert.equal(paused(), true);
    assert.equal(h.view(), 'pause');
    assert.equal(h.tap('KeyP'), null);
    assert.equal(paused(), false);
  });

  await t.test('an archive fragment blocks every step until it is dismissed', () => {
    D.world.events.push({ ...ARCHIVE });
    assert.equal(h.frames(1), null); // this frame still steps, then hands the event to the interface
    assert.equal(h.q('#fragment-layer').hidden, false);
    assert.equal(h.q('#fragment-title').textContent, 'T');
    const before = h.inspect();
    h.press('KeyD');
    h.press('Space');
    assert.equal(h.frames(60), null);
    assert.equal(h.inspect().step, before.step, 'steps ran while the archive was open');
    assert.deepEqual(spot(player()), spot(before.player), 'ILO moved while the archive was open');
    still(h, 60);
    assert.equal(h.tap('KeyE', 2), null);
    flows(h, 2);
    assert.equal(h.q('#fragment-layer').hidden, true);
    assert.ok(h.inspect().step > before.step, 'the game did not continue');
    assert.deepEqual(spot(player()), spot(before.player), 'a key pressed while reading fired after it');
    h.release('KeyD');
    h.release('Space');

    D.world.events.push({ ...ARCHIVE });
    assert.equal(h.frames(1), null);
    assert.equal(document.activeElement, h.q('#fragment'));
    assert.equal(h.tap('Enter'), null);
    assert.equal(h.q('#fragment-layer').hidden, true);

    // P is the pause key here as well: the pause menu comes up, and the fragment is back once resumed.
    D.world.events.push({ ...ARCHIVE });
    assert.equal(h.frames(1), null);
    assert.equal(h.tap('KeyP', 2), null);
    assert.equal(paused(), true);
    assert.equal(h.q('#fragment-layer').hidden, true);
    assert.equal(h.tap('KeyP'), null);
    assert.equal(paused(), false);
    assert.equal(h.q('#fragment-layer').hidden, false);
    assert.equal(h.tap('KeyE'), null);
    assert.equal(h.q('#fragment-layer').hidden, true);
  });

  await t.test('DEEPWAKE: inspect, warp and advance', () => {
    const before = h.inspect();
    h.warp(before.player.x, before.player.y + 1);
    const warped = h.inspect();
    assert.equal(warped.step, before.step, 'warp steps the world');
    assert.deepEqual(spot(warped.player), [before.player.x, before.player.y + 1, 0, 0]);
    D.advance(0.25, { right: true });
    const after = h.inspect();
    assert.equal(after.step, before.step + 30);
    assert.ok(after.player.x > warped.player.x && after.player.facing === 1, 'advance did not run ILO right');
    assert.ok(Math.abs(after.clock - warped.clock - 0.25) < 1e-9, `the clock went from ${warped.clock} to ${after.clock}`);
    assert.equal(h.until(() => player().grounded && player().vx === 0), null);
  });

  await t.test('Restart Expedition gives a fresh world, keeps the records, and adds nothing over three restarts', () => {
    let previous = D.world;
    for (let i = 0; i < 3; i++) {
      assert.equal(h.tap('KeyP'), null);
      assert.equal(paused(), true);
      assert.ok(h.in('#card-pause', '.records-line').textContent.includes('Best completion time 5:03.4'), 'the pause menu lost the records');
      const restart = h.in('#card-pause', '.restart');
      h.press('KeyD'); // held through the restart
      restart.dispatch('click', { detail: 1 }); // the first press only arms it
      assert.equal(D.world, previous, 'the first press restarted');
      assert.equal(paused(), true);
      restart.dispatch('click', { detail: 1 });
      assert.equal(h.frames(2), null);
      h.release('KeyD');
      assert.notEqual(D.world, previous, 'the second press did not restart');
      previous = D.world;
      const state = h.inspect();
      assert.equal(state.mode, 'play');
      assert.equal(state.paused, false);
      assert.ok(state.clock < 0.1, `a new expedition starts at clock ${state.clock}`);
      assert.equal(state.player.x, D.world.level.spawn.x, 'a key held through the restart moves ILO');
      assert.equal(state.recoveries, 0);
      assert.equal(h.view(), null);
    }
    assert.deepEqual(h.listeners(), booted, 'listeners piled up over the restarts');
    assert.equal(h.audio.contexts.length, 1);
    assert.equal(storage.getItem(RECORDS), JSON.stringify(RECORD));
  });

  await t.test('a frame that throws leaves one message and stops the loop', () => {
    Object.defineProperty(D.world, 'player', { get: () => { throw new Error('boom'); } });
    assert.equal(h.frames(2), 'DEEPWAKE stopped: boom');
    assert.equal(h.pending(), 0, 'a frame was requested after the failure');
    assert.equal(h.ui.querySelectorAll('#fatal').length, 1);
  });
});

test('Boot: an expedition ends once, saves its result once, and a new one begins', async (t) => {
  const h = await boot(t);
  const { D, document, storage } = h;
  const { boarding } = D.world.ascent;

  /** Every relay on and ILO in the boarding area: E at the console starts the lift. */
  const board = () => {
    for (const relay of D.world.relays) relay.active = true;
    h.warp(boarding.x + boarding.w / 2, boarding.y);
    assert.equal(h.frames(2), null);
    assert.equal(h.inspect().interactTarget?.kind, 'lift', 'the lift console is not in range');
    assert.equal(h.tap('KeyE', 2), null);
    assert.equal(h.inspect().mode, 'liftSequence');
  };

  await t.test('Enter on the focused Begin button begins the expedition', () => {
    assert.equal(h.frames(3), null);
    assert.equal(document.activeElement, h.in('#card-title', '.begin'));
    assert.equal(h.tap('Enter', 3), null);
    assert.equal(h.inspect().mode, 'play');
  });

  await t.test('P pauses the relay look', () => {
    const relay = D.world.relays.find((entry) => entry.socket === null);
    assert.ok(relay, 'no relay takes a pulse without a socket');
    h.warp(relay.x, relay.y - 1.2);
    assert.equal(h.frames(2), null);
    assert.equal(h.tap('KeyQ', 3), null);
    assert.equal(h.inspect().mode, 'relayActivation');
    assert.equal(h.tap('KeyP'), null);
    const look = h.inspect();
    assert.equal(look.paused, true);
    assert.equal(h.view(), 'pause');
    assert.equal(h.frames(60), null);
    assert.equal(h.inspect().modeTime, look.modeTime, 'the relay look went on while paused');
    assert.equal(h.tap('KeyP'), null);
    assert.equal(h.inspect().paused, false);
    D.advance(RUN.relayTime);
    assert.equal(h.frames(1), null);
    assert.equal(h.inspect().mode, 'play');
  });

  await t.test('P pauses the lift; its end shows the complete overlay with the records written once', () => {
    board();
    const result = h.inspect().result;
    assert.deepEqual(result.relays, ['A', 'B', 'C']);
    assert.equal(h.until(() => D.world.ascent.stage === 'rise'), null);
    assert.equal(h.tap('KeyP'), null);
    const lift = h.inspect();
    assert.equal(lift.paused, true);
    assert.equal(h.view(), 'pause');
    assert.equal(h.frames(30), null);
    assert.equal(h.inspect().modeTime, lift.modeTime, 'the lift went on while paused');
    assert.equal(h.tap('KeyP'), null);
    D.advance(6); // through the rise and most of the surface hold
    assert.equal(h.until(() => h.inspect().mode === 'complete'), null);
    assert.equal(h.view(), 'complete');
    assert.equal(h.q('#card-complete').hidden, false);
    assert.equal(h.frames(30), null);
    assert.equal(h.written(RECORDS), 1, 'the records were not written exactly once');
    const saved = JSON.parse(storage.getItem(RECORDS));
    assert.equal(saved.bestTime, result.time);
    assert.equal(saved.fewestRecoveries, result.recoveries);
    const before = h.inspect();
    assert.equal(h.frames(2), null);
    assert.ok(h.moved.at(-1), 'nothing in the scene changes between two frames of the results');
    const after = h.inspect();
    assert.equal(after.step, before.step, 'the glue steps a finished expedition');
    assert.deepEqual(after.player, before.player, 'ILO moved on the results');
  });

  await t.test('New Expedition starts a fresh world in play with the clock near zero and the records kept', () => {
    const finished = D.world;
    const saved = storage.getItem(RECORDS);
    assert.equal(document.activeElement, h.in('#card-complete', '.new'));
    assert.equal(h.tap('Enter', 3), null);
    assert.notEqual(D.world, finished);
    const state = h.inspect();
    assert.equal(state.mode, 'play');
    assert.equal(state.paused, false);
    assert.ok(state.clock < 0.1, `a new expedition starts at clock ${state.clock}`);
    assert.equal(state.recoveries, 0);
    assert.equal(state.result, null);
    assert.ok(state.relays.every((relay) => relay.active === false), 'a relay survived into the new expedition');
    assert.equal(h.view(), null);
    flows(h, 2);
    assert.equal(storage.getItem(RECORDS), saved, 'the new expedition changed the records');
    assert.equal(h.written(RECORDS), 1);
    assert.equal(h.tap('KeyP'), null);
    assert.ok(h.in('#card-pause', '.records-line').textContent.includes('Best completion time'), 'the new expedition lost the records');
  });

  await t.test('a second expedition saves its own result; New Expedition also works by pointer', () => {
    assert.equal(h.tap('KeyP'), null); // leave the pause menu
    board();
    D.advance(13); // longer than the whole lift
    assert.equal(h.until(() => h.inspect().mode === 'complete'), null);
    assert.equal(h.frames(5), null);
    assert.equal(h.written(RECORDS), 2, 'the second expedition did not save its result');
    h.in('#card-complete', '.new').dispatch('click', { detail: 1 });
    assert.equal(h.frames(2), null);
    const state = h.inspect();
    assert.equal(state.mode, 'play');
    assert.ok(state.clock < 0.1, `a new expedition starts at clock ${state.clock}`);
  });
});

test('Boot: settings are applied at boot, toggled and saved; a hidden page gives the view no time', async (t) => {
  const settings = { muted: true, reducedMotion: true };
  const h = await boot(t, { storage: createStorage({ [SETTINGS]: JSON.stringify(settings) }) });
  const paused = () => h.inspect().paused === true;
  const context = () => h.audio.contexts[0];

  await t.test('stored settings are applied at boot, before any gesture', () => {
    assert.equal(h.frames(3), null);
    assert.equal(h.in('#hud', '.mute').getAttribute('aria-pressed'), 'true');
    assert.equal(h.in('#card-pause', '.setting-motion').checked, true);
    assert.equal(h.ui.classList.contains('reduced-motion'), true);
    assert.equal(h.audio.contexts.length, 0);
  });

  await t.test('the Begin button starts the game; the first key unlocks the audio, muted, and the pulse sounds', () => {
    h.in('#card-title', '.begin').dispatch('click', { detail: 1 });
    assert.equal(h.frames(2), null);
    assert.equal(h.inspect().mode, 'play');
    assert.equal(h.audio.contexts.length, 0);
    h.press('KeyQ');
    assert.equal(h.audio.contexts.length, 1);
    const opened = context().nodes.length;
    assert.equal(h.frames(2), null);
    h.release('KeyQ');
    assert.ok(context().nodes.slice(opened).some(isEffect), 'the pulse event did not reach the audio');
  });

  await t.test('mute and reduced motion toggle, apply and save', () => {
    const master = context().nodes.find((node) => node.kind === 'gain' && node.outputs[0]?.kind === 'compressor');
    assert.equal(master.gain.value, 0, 'the master gain does not start muted');
    h.in('#hud', '.mute').dispatch('click', { detail: 1 });
    assert.equal(h.in('#hud', '.mute').getAttribute('aria-pressed'), 'false');
    assert.equal(master.gain.calls.findLast((call) => call.name === 'linearRampToValueAtTime').args[0], 1, 'the master gain did not open');
    assert.equal(h.storage.getItem(SETTINGS), JSON.stringify({ muted: false, reducedMotion: true }));

    h.in('#hud', '.pause').dispatch('click', { detail: 1 });
    assert.equal(h.frames(1), null);
    assert.equal(paused(), true);
    const motion = h.in('#card-pause', '.setting-motion');
    motion.checked = false;
    motion.dispatch('change');
    assert.equal(h.storage.getItem(SETTINGS), JSON.stringify({ muted: false, reducedMotion: false }));
    assert.equal(h.ui.classList.contains('reduced-motion'), false);
  });

  await t.test('a hidden page gives the view no time, also during a recovery, which it does not pause', () => {
    assert.equal(h.tap('KeyP'), null);
    assert.equal(paused(), false);
    assert.equal(h.tap('KeyR'), null);
    assert.equal(h.inspect().mode, 'shutdown');
    h.hide(true);
    const before = h.inspect();
    assert.equal(h.frames(20), null);
    assert.ok(h.inspect().step > before.step, 'a recovery stands still while the page is hidden');
    still(h, 20);
    h.hide(false);
    assert.equal(h.frames(3), null);
    flows(h, 3);
  });
});

test('Boot: reduced motion follows the system for as long as the player sets none', async (t) => {
  /** The checkbox of the pause menu and the class on the page: the value in force. */
  const motion = (h) => [h.in('#card-pause', '.setting-motion').checked, h.ui.classList.contains('reduced-motion')];
  const storage = createStorage();

  await t.test('a system that asks for it: the game starts with reduced motion, and stores nothing', async (t) => {
    const h = await boot(t, { reduce: true, storage });
    assert.equal(h.frames(3), null);
    assert.deepEqual(motion(h), [true, true]);
    assert.equal(storage.getItem(SETTINGS), null);
  });

  await t.test('a mute toggle stores the mute only', async (t) => {
    const h = await boot(t, { reduce: true, storage });
    h.in('#card-title', '.begin').dispatch('click', { detail: 1 });
    assert.equal(h.frames(2), null);
    h.in('#hud', '.mute').dispatch('click', { detail: 1 });
    assert.equal(storage.getItem(SETTINGS), JSON.stringify({ muted: true }));
  });

  await t.test('the next start follows the system again, which now asks for none, and keeps the mute', async (t) => {
    const h = await boot(t, { reduce: false, storage });
    assert.equal(h.frames(3), null);
    assert.deepEqual(motion(h), [false, false]);
    assert.equal(h.in('#hud', '.mute').getAttribute('aria-pressed'), 'true');
  });

  await t.test('what the player stored wins: off against a system that asks for it', async (t) => {
    const h = await boot(t, { reduce: true, storage: createStorage({ [SETTINGS]: '{"muted":false,"reducedMotion":false}' }) });
    assert.equal(h.frames(3), null);
    assert.deepEqual(motion(h), [false, false]);
  });

  await t.test('what the player stored wins: on against a system that asks for none', async (t) => {
    const h = await boot(t, { reduce: false, storage: createStorage({ [SETTINGS]: '{"muted":false,"reducedMotion":true}' }) });
    assert.equal(h.frames(3), null);
    assert.deepEqual(motion(h), [true, true]);
  });
});

test('Boot: Retry from Checkpoint restores the checkpoint from a pause in the relay look and on the lift', async (t) => {
  const h = await boot(t);
  const { D } = h;
  const { boarding } = D.world.ascent;
  /** The station of the checkpoint: where a retry puts ILO. */
  const station = () => D.world.stations.find((s) => s.id === D.world.checkpoint.stationId);
  /** Every relay on and ILO in the boarding area: E at the console starts the lift. */
  const board = () => {
    for (const relay of D.world.relays) relay.active = true;
    h.warp(boarding.x + boarding.w / 2, boarding.y);
    assert.equal(h.frames(2), null);
    assert.equal(h.tap('KeyE', 2), null);
    assert.equal(h.inspect().mode, 'liftSequence');
  };
  /** Pause, then Retry from Checkpoint by way of `way`: one recovery, then the run in play at the checkpoint. */
  const retryFromPause = (way) => {
    const before = h.inspect();
    assert.equal(h.tap('KeyP'), null);
    assert.equal(h.view(), 'pause');
    way();
    assert.equal(h.frames(1), null);
    assert.deepEqual([h.inspect().mode, h.inspect().cause, h.view()], ['shutdown', 'retry', 'recovery']);
    assert.equal(h.until(() => h.inspect().mode === 'play'), null);
    const after = h.inspect();
    assert.equal(after.recoveries, before.recoveries + 1);
    assert.deepEqual([after.paused, after.camera.lookAt, h.view()], [false, null, null]);
    const at = station();
    assert.equal(after.player.x, at.x);
    assert.ok(Math.abs(after.player.y - at.y) < 0.05, `ILO at the station: y ${after.player.y}, the station ${at.y}`);
  };

  assert.equal(h.frames(3), null);
  assert.equal(h.tap('Enter', 3), null);
  assert.equal(h.inspect().mode, 'play');

  await t.test('R in the pause menu during the relay look runs one recovery, and play goes on without the look', () => {
    const relay = D.world.relays.find((entry) => entry.socket === null);
    h.warp(relay.x, relay.y - 1.2);
    assert.equal(h.frames(2), null);
    assert.equal(h.tap('KeyQ', 3), null);
    assert.equal(h.inspect().mode, 'relayActivation');
    retryFromPause(() => assert.equal(h.tap('KeyR'), null));
    assert.equal(h.frames(30), null);
    assert.equal(h.inspect().mode, 'play');
    assert.equal(h.inspect().camera.lookAt, null);
  });

  await t.test('the Retry button in the pause menu on the lift runs one recovery, and the lift can start again', () => {
    board();
    assert.notEqual(h.inspect().result, null, 'the lift committed its record when it left');
    assert.equal(h.until(() => D.world.ascent.stage === 'rise'), null);
    retryFromPause(() => h.in('#card-pause', '.retry').dispatch('click', { detail: 1 }));
    assert.deepEqual([h.inspect().result, D.world.ascent.idle], [null, true], 'the record of the lift that did not finish is gone');
    board();
    assert.equal(h.until(() => D.world.ascent.stage === 'rise'), null);
  });
});

test('Boot: without WebGL the page shows the message and nothing else starts', async (t) => {
  const h = await boot(t, { webgl: false });
  assert.equal(h.fatal(), 'DEEPWAKE needs WebGL, which this browser does not provide.');
  assert.equal(h.q('#fatal').className, 'fatal');
  assert.equal(h.ui.children.length, 1);
  assert.equal(h.D, undefined);
  assert.equal(h.pending(), 0);
  assert.deepEqual(h.listeners(), { window: 0, document: 0, touch: 0 });
  assert.equal(h.moved.length, 0);
});

test('Boot: the interface bands reach the view after a resize and when the touch controls appear', async (t) => {
  const h = await boot(t, { size: [640, 360], ratio: 2 }); // a phone on its side, two backing pixels per CSS pixel
  const { document } = h;
  const canvas = document.querySelector('#game');
  const touch = document.querySelector('#touch');
  /** The interface on a page `w × h` CSS pixels: a HUD bar `hud` px tall, and the band of touch controls in the lower `band` px. */
  const layout = (w, h, hud, band) => {
    document.querySelector('.hud').rect = { left: 0, top: 0, width: w, height: hud };
    if (band === null) return;
    const top = h - band;
    touch.rect = { left: 0, top, width: w, height: band };
    touch.querySelector('.touch-move').rect = { left: 0, top, width: 190, height: band };
    touch.querySelector('.touch-act').rect = { left: w - 210, top, width: 210, height: band };
  };
  const player = () => h.inspect().player;
  /** ILO's feet and head on the page, in CSS pixels from its top, and a world unit in pixels. */
  const feet = () => h.screen(player().x, player().y)[1];
  const head = () => h.screen(player().x, player().y + 1.5)[1];
  const unit = () => (feet() - head()) / 1.5;

  // Play begins with a 66 px HUD bar over the top of the page.
  h.window.dispatch('pointerdown');
  document.activeElement.blur();
  assert.equal(h.tap('Enter', 2), null);
  layout(640, 360, 66, null);
  assert.equal(h.frames(30), null);
  assert.equal(h.inspect().mode, 'play');

  // ILO thrown high: from the first frame its head stays half a unit under the bar.
  h.warp(player().x, player().y + 7);
  for (let i = 0; i < 90; i++) {
    assert.equal(h.frames(1), null);
    assert.ok(head() >= 66 + unit() / 2 - 1e-6, `frame ${i}: ILO's head is at ${head().toFixed(1)} px, behind the HUD bar`);
  }
  h.warp(h.D.world.level.spawn.x, h.D.world.level.spawn.y); // back on the floor of the spawn
  assert.equal(h.frames(90), null);

  // The touch controls appear in the lower 126 px of the page, where ILO's feet are: they rise a unit above it.
  const before = feet();
  assert.ok(before > 234, `without touch controls ILO's feet are at ${before.toFixed(1)} px`);
  h.window.dispatch('touchstart');
  layout(640, 360, 66, 126);
  assert.equal(h.frames(120), null);
  assert.ok(feet() <= 234 - unit() + 1e-6, `with the touch controls ILO's feet are at ${feet().toFixed(1)} px, behind the band from 234 px`);

  // The page resizes into a wider phone whose band of touch controls is taller: the bands follow the new layout, and
  // ILO's feet stay a unit above the band that now starts at 240 px.
  canvas.clientWidth = 844;
  canvas.clientHeight = 390;
  layout(844, 390, 66, 150);
  h.window.dispatch('resize');
  assert.equal(h.frames(120), null);
  assert.equal(canvas.width, 1688, 'the backing store follows the resize at two pixels per CSS pixel');
  assert.ok(feet() <= 240 - unit() + 1e-6, `after the resize ILO's feet are at ${feet().toFixed(1)} px, behind the band from 240 px`);
  assert.ok(head() >= 66 + unit() / 2 - 1e-6, `after the resize ILO's head is at ${head().toFixed(1)} px, behind the HUD bar`);
});
