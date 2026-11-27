import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInput } from '../src/input.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { createUI } from '../src/ui/ui.js';
import { LEVEL } from './fixtures/core.js';
import { LEVELS } from './fixtures/objects.js';
import { installDom } from './fakes/dom.js';

const CARDS = ['#card-title', '#card-pause', '#card-recovery', '#card-complete'];
const NO_RECORDS = { version: 1, bestTime: null, bestArchiveTime: null, fewestRecoveries: null, fewestRecoveriesTime: null };
const RECORDS = { version: 1, bestTime: 303.4, bestArchiveTime: null, fewestRecoveries: 2, fewestRecoveriesTime: 303.4 };
const RESULT = { time: 303.46, recoveries: 2, archives: 3, caches: 1, disabled: 2, relays: ['A', 'B', 'C'], fullArchive: true };

/** Names of the state fields that are on. */
const ON = (state) => Object.keys(state).filter((name) => state[name] === true);

/** Value of each row of a list the interface builds, with its marks in brackets. */
function rows(list) {
  const out = {};
  let last = null;
  for (const child of list.children) {
    if (child.tagName === 'DT') {
      last = child.textContent;
      out[last] = '';
    }
    else if (child.tagName === 'DD') {
      // The value, then the `New best` mark of a record this expedition set, beside it in the same cell.
      out[last] = child.children.map((node, index) => (index === 0 ? node.textContent : ` [${node.textContent}]`)).join('');
    }
  }
  return out;
}

/**
 * A fresh page with the interface mounted as index.html mounts it, a `play` world of the core fixture,
 * a clock the test sets and the log of the actions the interface called.
 */
function mount(t, { coarse = false, level = LEVEL } = {}) {
  const { window, document } = installDom({ coarse });
  const clock = { now: 1000 };
  t.mock.method(performance, 'now', () => clock.now);
  const calls = [];
  const actions = {
    begin: () => calls.push('begin'),
    resume: () => calls.push('resume'),
    retry: () => calls.push('retry'),
    restart: () => calls.push('restart'),
    pause: () => calls.push('pause'),
    mute: () => calls.push('mute'),
    reducedMotion: (on) => calls.push(`reducedMotion ${on}`),
  };
  const touchRoot = document.createElement('div');
  const root = document.createElement('div');
  touchRoot.id = 'touch';
  root.id = 'ui';
  document.body.append(touchRoot, root);
  const ui = createUI({ root, touchRoot, actions });
  const world = createWorld(level);
  world.mode = 'play';
  const ctx = { records: RECORDS, flags: null };
  return {
    window, document, clock, calls, root, touchRoot, ui, world, ctx,
    q: (selector) => root.querySelector(selector),
    in: (id, selector) => root.querySelector(id).querySelector(selector),
    cards: () => CARDS.filter((id) => !root.querySelector(id).hidden),
    view: () => (root.querySelector('#overlay').hidden ? null : root.querySelector('#overlay').dataset.view),
    /** Set world fields and player fields, then run the sync of one frame. */
    sync(fields = {}, player = {}) {
      Object.assign(world, fields);
      Object.assign(world.player, player);
      ui.sync(world, ctx);
    },
  };
}

/** A key event for the control that has the focus (the body by default); false when the input module handled it. */
const key = (h, code, init = {}) => h.document.activeElement.dispatch('keydown', { code, ...init });
const keyUp = (h, code, init = {}) => h.document.activeElement.dispatch('keyup', { code, ...init });
const touchButton = (h, act) => h.touchRoot.querySelector(`[data-act="${act}"]`);

// --- HUD ---

test('HUD: every value comes from the world', (t) => {
  const h = mount(t);
  const { world } = h;
  world.relays = [{ id: 'A', active: true }, { id: 'B', active: false }, { id: 'C', active: true }];
  world.archives = [{ id: 'A', collected: true }, { id: 'B', collected: false }, { id: 'C', collected: true }];
  world.clock = 303.44;
  h.sync({}, { hp: 2, energy: 40 });
  assert.equal(h.q('.hud').hidden, false);

  assert.deepEqual(h.q('.integrity').querySelectorAll('.segment').map((segment) => segment.classList.contains('off')), [false, false, true]);
  assert.equal(h.q('.integrity').getAttribute('role'), 'meter');
  assert.equal(h.q('.integrity').getAttribute('aria-valuenow'), '2');
  assert.equal(h.q('.integrity').getAttribute('aria-valuemax'), '3');

  assert.equal(h.q('.meter-fill').style.width, '40%');
  assert.equal(h.q('.meter-value').textContent, '40');
  assert.equal(h.q('.resonance').getAttribute('aria-valuemin'), '0');
  assert.equal(h.q('.resonance').getAttribute('aria-valuemax'), '100');
  assert.equal(h.q('.resonance').getAttribute('aria-valuenow'), '40');
  const label = h.q('.resonance').getAttribute('aria-label');
  assert.match(label, /Resonance/);
  assert.match(label, /Pulse costs 35/);
  assert.match(label, /Shield costs 50/);
  assert.deepEqual(h.q('.meter').querySelectorAll('.meter-cost').map((tick) => [tick.getAttribute('data-cost'), tick.style.left]),
    [['pulse', '35%'], ['shield', '50%']]);

  assert.deepEqual(h.q('.relays').querySelectorAll('.relay').map((chip) => [
    chip.dataset.relay, chip.classList.contains('active'), chip.querySelector('.relay-state').textContent, chip.getAttribute('aria-label'),
  ]), [
    ['A', true, 'Online', 'Relay A online'],
    ['B', false, 'Offline', 'Relay B offline'],
    ['C', true, 'Online', 'Relay C online'],
  ]);

  assert.equal(h.q('.hud-run').querySelector('.hud-item').querySelector('.hud-value').textContent, '2/3');
  assert.equal(h.q('.hud-clock').querySelector('.hud-value').textContent, '5:03.4');

  // A world without relays or archives (the core fixture alone) shows three offline relays and 0/3.
  h.sync({ relays: [], archives: [], clock: 0 });
  assert.deepEqual(h.q('.relays').querySelectorAll('.relay').map((chip) => chip.querySelector('.relay-state').textContent), ['Offline', 'Offline', 'Offline']);
  assert.equal(h.q('.hud-run').querySelector('.hud-item').querySelector('.hud-value').textContent, '0/3');
  assert.equal(h.q('.hud-clock').querySelector('.hud-value').textContent, '0:00.0');
});

test('HUD: resonance stays inside 0 to 100 and turns low below the pulse cost', (t) => {
  const h = mount(t);
  h.sync({}, { energy: 150 });
  assert.deepEqual([h.q('.meter-fill').style.width, h.q('.meter-value').textContent, h.q('.resonance').getAttribute('aria-valuenow')], ['100%', '100', '100']);
  assert.equal(h.q('.resonance').classList.contains('low'), false);
  h.sync({}, { energy: -5 });
  assert.deepEqual([h.q('.meter-fill').style.width, h.q('.meter-value').textContent], ['0%', '0']);
  assert.equal(h.q('.resonance').classList.contains('low'), true);
  h.sync({}, { energy: 35 });
  assert.equal(h.q('.resonance').classList.contains('low'), false);
});

test('HUD: ability icons are subdued exactly while the ability cannot be used', (t) => {
  const h = mount(t);
  const icon = (id) => h.q(`[data-ability="${id}"]`);
  const off = (id) => icon(id).classList.contains('off');
  const state = () => ['dash', 'pulse', 'shield'].map(off);
  assert.deepEqual(h.q('.hud-run').querySelectorAll('.ability').map((node) => node.textContent), ['»Dash', '◎Pulse', '△Shield']);

  h.sync(); // standing on the floor with full energy
  assert.deepEqual(state(), [false, false, false]);
  assert.equal(h.q('.carry').hidden, true);

  h.sync({}, { dashCd: 0.3 });
  assert.deepEqual(state(), [true, false, false]);
  assert.equal(icon('dash').getAttribute('aria-label'), 'Dash: cooling down');
  h.sync({}, { dashCd: 0, grounded: false, dashAir: false });
  assert.deepEqual(state(), [true, false, false]);
  assert.equal(icon('dash').getAttribute('aria-label'), 'Dash: spent in the air');
  h.sync({}, { grounded: false, dashAir: true });
  assert.deepEqual(state(), [false, false, false]);

  h.sync({}, { grounded: true, energy: 34 });
  assert.deepEqual(state(), [false, true, true]);
  assert.equal(icon('pulse').getAttribute('aria-label'), 'Pulse: needs 35 resonance');
  assert.equal(icon('shield').getAttribute('aria-label'), 'Shield: needs 50 resonance');
  h.sync({}, { energy: 49.5 });
  assert.deepEqual(state(), [false, false, true]);
  h.sync({}, { energy: 50 });
  assert.deepEqual(state(), [false, false, false]);

  h.sync({}, { carrying: 'c1' });
  assert.deepEqual(state(), [true, true, false]);
  assert.equal(h.q('.carry').hidden, false);
  assert.equal(h.q('.carry').textContent, 'Carrying cell');
  assert.equal(icon('dash').getAttribute('aria-label'), 'Dash: unavailable while carrying');
  h.sync({}, { carrying: null });
  assert.deepEqual(state(), [false, false, false]);
  assert.equal(h.q('.carry').hidden, true);
});

test('HUD: visible in play, relay activation and a recovery; hidden under the title, pause and results and during the lift', (t) => {
  const h = mount(t);
  const hidden = () => h.q('.hud').hidden;
  h.sync({ mode: 'play', paused: false });
  assert.equal(hidden(), false);
  h.sync({ mode: 'relayActivation' });
  assert.equal(hidden(), false);
  h.sync({ mode: 'liftSequence' });
  assert.equal(hidden(), true);
  for (const mode of ['shutdown', 'reboot']) {
    h.sync({ mode, paused: false });
    assert.equal(hidden(), false, mode);
  }
  for (const [mode, paused] of [['play', true], ['title', false], ['complete', false]]) {
    h.sync({ mode, paused, result: mode === 'complete' ? RESULT : null });
    assert.equal(hidden(), true, mode);
  }
  h.sync({ mode: 'play', paused: false });
  assert.equal(hidden(), false);
});

test('HUD: pause and mute are named 44 pixel buttons without a touch action', (t) => {
  const h = mount(t);
  const mute = h.q('.mute');
  const pause = h.q('.pause');
  for (const button of [mute, pause]) {
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.classList.contains('hud-button'), true);
    assert.equal(button.hasAttribute('data-act'), false);
    assert.equal(button.hasAttribute('disabled'), false);
  }
  assert.equal(mute.getAttribute('aria-label'), 'Mute sound');
  assert.equal(pause.getAttribute('aria-label'), 'Pause');
  assert.equal(mute.getAttribute('aria-pressed'), 'false');
  assert.equal(h.root.querySelector('[data-act]'), null, 'touch actions live in #touch only');
});

test('HUD: the pause button is inert during a recovery and live again after it', (t) => {
  const h = mount(t);
  const pause = h.q('.pause');
  const state = () => [pause.disabled, pause.getAttribute('aria-disabled')];
  for (const mode of ['play', 'relayActivation', 'liftSequence']) {
    h.sync({ mode, paused: false });
    assert.deepEqual(state(), [false, 'false'], mode);
  }
  for (const mode of ['shutdown', 'reboot']) {
    h.sync({ mode, paused: false });
    assert.deepEqual(state(), [true, 'true'], mode);
    assert.equal(h.q('.hud').hidden, false, 'the button stays in view, subdued');
    pause.dispatch('click', { detail: 1 });
    assert.deepEqual(h.calls, [], `${mode}: a disabled control takes no click`);
  }
  h.sync({ mode: 'play', paused: false });
  assert.deepEqual(state(), [false, 'false']);
  pause.dispatch('click', { detail: 1 });
  assert.deepEqual(h.calls, ['pause']);
});

// --- Prompt ---

test('Prompt: on with a key cap, on without one, and off without a prompt or outside play', (t) => {
  const h = mount(t);
  assert.equal(h.q('#prompt').hidden, true);
  h.sync({ prompt: { key: 'E', text: 'Insert Cell' } });
  assert.equal(h.q('#prompt').hidden, false);
  const cap = h.q('#prompt').querySelector('.keycap');
  assert.equal(cap.hidden, false);
  assert.equal(cap.textContent, 'E');
  assert.equal(h.q('.prompt-text').textContent, 'Insert Cell');

  h.sync({ prompt: { key: null, text: 'Restore all three relays first' } });
  assert.equal(h.q('#prompt').hidden, false);
  assert.equal(cap.hidden, true);
  assert.equal(h.q('.prompt-text').textContent, 'Restore all three relays first');

  h.sync({ prompt: null });
  assert.equal(h.q('#prompt').hidden, true);

  // A prompt of the world never outlives play: not in a recovery, not while paused.
  h.sync({ prompt: { key: 'E', text: 'Insert Cell' }, mode: 'shutdown' });
  assert.equal(h.q('#prompt').hidden, true);
  h.sync({ mode: 'play', paused: true });
  assert.equal(h.q('#prompt').hidden, true);
  h.sync({ paused: false });
  assert.equal(h.q('#prompt').hidden, false);
});

/** What assistive technology reads of a node: its text, without what is hidden from it. */
const spoken = (node) => (node.getAttribute('aria-hidden') === 'true' ? ''
  : node.children.length === 0 ? node.textContent : node.children.map(spoken).join(''));

test('Prompt: a keyboard keeps its key; with touch controls the prompt names its button and takes the touch class', (t) => {
  const h = mount(t);
  const prompt = () => h.q('#prompt');
  /** The cap, the text on screen and what assistive technology reads. */
  const shown = () => [prompt().querySelector('.keycap').hidden, prompt().querySelector('.prompt-pill').textContent, spoken(prompt())];
  const touch = () => prompt().classList.contains('touch');
  h.sync({ prompt: { key: 'E', text: 'Insert Cell' } });
  assert.deepEqual(shown(), [false, 'E—Insert Cell', 'E Insert Cell']);
  assert.equal(touch(), false, 'a keyboard keeps the bottom center');
  h.sync({ prompt: { key: 'Q', text: 'Echo Pulse' } });
  assert.deepEqual(shown(), [false, 'Q—Echo Pulse', 'Q Echo Pulse']);

  // The first touch turns the controls on: the prompt names its button as the button is labeled, and the stylesheet
  // (`.prompt.touch`) places it in the middle of the touch band.
  h.window.dispatch('touchstart');
  h.sync();
  assert.equal(touch(), true);
  assert.deepEqual(shown(), [false, 'Pulse—Echo Pulse', 'Pulse Echo Pulse']);
  assert.equal(prompt().querySelector('.keycap').textContent, touchButton(h, 'pulse').textContent);
  h.sync({ prompt: { key: 'E', text: 'Insert Cell' } });
  assert.deepEqual(shown(), [false, 'Use—Insert Cell', 'Use Insert Cell']);
  // A key with no touch button loses its cap; a prompt without a key reads its words alone.
  h.sync({ prompt: { key: 'R', text: 'Retry' } });
  assert.deepEqual(shown(), [true, '—Retry', 'Retry']);
  h.sync({ prompt: { key: null, text: 'Lift offline · 0/3 relays' } });
  assert.deepEqual(shown(), [true, '—Lift offline · 0/3 relays', 'Lift offline · 0/3 relays']);
});

test('Prompt: a coarse-pointer device names the button and takes the touch class from the start', (t) => {
  const h = mount(t, { coarse: true });
  h.sync({ prompt: { key: 'E', text: 'Insert Cell' } });
  assert.equal(h.q('#prompt').classList.contains('touch'), true);
  assert.deepEqual([h.q('#prompt').querySelector('.keycap').textContent, spoken(h.q('#prompt'))], ['Use', 'Use Insert Cell']);
});

test('Prompt: the pulse the simulation asks for reads Q — Echo Pulse on a keyboard and Pulse — Echo Pulse with touch controls', (t) => {
  // The objects fixture: a hidden seam hangs 3.5 units from x 5, so there the simulation asks for a pulse (GOAL §17).
  const h = mount(t, { level: LEVELS.stations });
  h.sync({}, { x: 5 });
  const frame = (held = {}) => {
    stepWorld(h.world, held);
    h.ui.sync(h.world, h.ctx);
  };
  frame();
  const prompt = () => h.q('#prompt');
  const shown = () => [prompt().querySelector('.prompt-pill').textContent, spoken(prompt())];
  assert.deepEqual(h.world.prompt, { key: 'Q', text: 'Echo Pulse' });
  assert.deepEqual([prompt().hidden, ...shown(), prompt().classList.contains('touch')], [false, 'Q—Echo Pulse', 'Q Echo Pulse', false]);
  h.window.dispatch('touchstart');
  frame();
  assert.deepEqual([...shown(), prompt().classList.contains('touch')], ['Pulse—Echo Pulse', 'Pulse Echo Pulse', true]);
  frame({ pulsePressed: true });
  assert.equal(prompt().hidden, true);            // the pulse is spent: nothing asks for another one now
});

// --- Overlays ---

test('Overlays: each state shows its own card and its texts, and only that card', (t) => {
  const h = mount(t);
  assert.equal(h.view(), null);
  assert.deepEqual(h.cards(), []);

  h.sync({ mode: 'title', paused: false });
  assert.equal(h.view(), 'title');
  assert.deepEqual(h.cards(), ['#card-title']);
  assert.equal(h.in('#card-title', 'h1').textContent, 'DEEPWAKE');
  assert.equal(h.in('#card-title', '.lede').textContent, 'Restore three relays. Reach the ascent lift.');
  assert.equal(h.in('#card-title', '.begin').textContent, 'Begin Expedition');
  assert.equal(h.in('#card-title', '.records-line').textContent, 'Best completion time 5:03.4 · Fewest recoveries 2');
  h.ctx.records = NO_RECORDS;
  h.sync();
  assert.equal(h.in('#card-title', '.records-line').textContent, 'No records yet');
  h.ctx.records = RECORDS;

  for (const mode of ['play', 'relayActivation', 'liftSequence']) {
    h.sync({ mode });
    assert.equal(h.view(), null, mode);
    assert.deepEqual(h.cards(), []);
  }

  h.sync({ mode: 'play', paused: true });
  assert.equal(h.view(), 'pause');
  assert.deepEqual(h.cards(), ['#card-pause']);
  assert.equal(h.in('#card-pause', 'h2').textContent, 'Expedition Paused');
  assert.equal(h.in('#card-pause', '.resume').textContent, 'Resume');
  assert.equal(h.in('#card-pause', '.resume').classList.contains('primary'), true);
  assert.equal(h.in('#card-pause', '.retry').textContent, 'Retry from Checkpoint');
  assert.equal(h.in('#card-pause', '.restart').textContent, 'Restart Expedition');
  assert.equal(h.in('#card-pause', '.records-line').textContent, 'Best completion time 5:03.4 · Fewest recoveries 2');
  assert.deepEqual(h.in('#card-pause', '.controls').children.map((line) => [
    line.querySelector('.keys').textContent, line.children[1].textContent,
  ]), [
    ['AD←→', 'Move'], ['SpaceZ', 'Jump'], ['ShiftX', 'Dash'], ['Q', 'Echo Pulse'], ['E', 'Interact'], ['PEsc', 'Pause'], ['R', 'Retry from Checkpoint'],
  ]);
  assert.equal(h.in('#card-pause', '.setting-sound').tagName, 'INPUT');
  assert.equal(h.in('#card-pause', '.setting-motion').tagName, 'INPUT');
  // Pause also covers a relay cinematic or the lift.
  h.sync({ mode: 'relayActivation', paused: true });
  assert.equal(h.view(), 'pause');

  for (const mode of ['shutdown', 'reboot']) {
    h.sync({ mode, paused: false });
    assert.equal(h.view(), 'recovery', mode);
    assert.deepEqual(h.cards(), ['#card-recovery']);
    assert.equal(h.in('#card-recovery', 'h2').textContent, 'Rebooting at Station');
    assert.equal(h.in('#card-recovery', 'p').textContent, 'Automatic return after a brief transition.');
    assert.equal(h.in('#card-recovery', 'button'), null, 'nothing to interact with');
  }
});

test('Complete: the result rows, the records with their marks, and the full-archive heading', (t) => {
  const h = mount(t);
  h.ctx.flags = { bestTime: true, bestArchiveTime: true, fewestRecoveries: false };
  h.ctx.records = { ...RECORDS, bestTime: 303.46, bestArchiveTime: 303.46 };
  h.sync({ mode: 'complete', result: RESULT });
  assert.equal(h.view(), 'complete');
  assert.equal(h.in('#card-complete', '.card-kicker').textContent, 'Signal Restored');
  assert.equal(h.in('#card-complete', 'h2').textContent, 'Full Archive Expedition');
  assert.deepEqual(rows(h.in('#card-complete', '.stats')), {
    'Expedition time': '5:03.5', Recoveries: '2', Archives: '3/3', 'Caches found': '1', 'Machines disabled': '2',
    'Relay A': 'Online', 'Relay B': 'Online', 'Relay C': 'Online',
  });
  assert.deepEqual(rows(h.in('#card-complete', '.records')), {
    'Best Completion Time': '5:03.5 [New best]',
    'Best Full-Archive Time': '5:03.5 [New best]',
    'Fewest Recoveries': '2 in 5:03.4',
  });
  assert.equal(h.in('#card-complete', '.new').textContent, 'New Expedition');

  // An ordinary expedition and a result that set nothing.
  h.ctx.flags = null;
  h.ctx.records = RECORDS;
  h.sync({ result: { ...RESULT, archives: 1, caches: 0, disabled: 0, relays: ['A', 'B', 'C'] } });
  assert.equal(h.in('#card-complete', 'h2').textContent, 'Expedition Complete');
  assert.equal(rows(h.in('#card-complete', '.stats')).Archives, '1/3');
  assert.equal(rows(h.in('#card-complete', '.records'))['Best Full-Archive Time'], 'No record yet');
  assert.equal(h.in('#card-complete', '.new-best'), null);
  // The card is built once per result: further frames add nothing.
  const count = h.in('#card-complete', '.stats').children.length;
  h.sync();
  assert.equal(h.in('#card-complete', '.stats').children.length, count);
  h.sync({ result: { ...RESULT, recoveries: 0 } });
  assert.equal(rows(h.in('#card-complete', '.stats')).Recoveries, '0');
});

// --- Archive fragment and panel ---

test('Archive fragment: the event opens a blocking card, dismiss or a click closes it', (t) => {
  const h = mount(t);
  const event = { type: 'archive', id: 'A', title: 'Cable Log 4', text: 'The conduits hummed once.\nThen the lights failed.' };
  h.sync({ prompt: { key: 'E', text: 'Read' } });
  assert.equal(h.ui.isFragmentOpen(), false);
  assert.equal(h.q('#fragment-layer').hidden, true);

  h.ui.handle(event);
  assert.equal(h.ui.isFragmentOpen(), true);
  assert.equal(h.q('#fragment-layer').hidden, false);
  assert.equal(h.in('#fragment', '.card-kicker').textContent, 'Memory Archive A');
  assert.equal(h.in('#fragment', 'h2').textContent, 'Cable Log 4');
  assert.equal(h.in('#fragment', '.fragment-text').textContent, 'The conduits hummed once.\nThen the lights failed.');
  h.sync({ prompt: { key: 'E', text: 'Read' } });
  assert.equal(h.q('#prompt').hidden, true, 'no interaction prompt over a fragment');
  assert.equal(h.q('.hud').hidden, false);

  h.ui.dismissFragment();
  assert.equal(h.ui.isFragmentOpen(), false);
  assert.equal(h.q('#fragment-layer').hidden, true);
  h.sync();
  assert.equal(h.q('#prompt').hidden, false);

  h.ui.handle({ ...event, id: undefined });
  assert.equal(h.ui.isFragmentOpen(), true);
  assert.equal(h.in('#fragment', '.card-kicker').textContent, 'Memory Archive');
  h.q('#fragment').dispatch('click', { detail: 1 });
  assert.equal(h.ui.isFragmentOpen(), false);
  assert.equal(h.q('#fragment-layer').hidden, true);

  // Another event leaves nothing open.
  for (const type of ['station', 'relay', 'cache', 'pulseEmpty', 'complete', 'jump']) h.ui.handle({ type });
  assert.equal(h.ui.isFragmentOpen(), false);
});

test('Archive fragment: it waits under an overlay and never outlives its expedition', (t) => {
  const h = mount(t);
  h.ui.handle({ type: 'archive', id: 'B', title: 'T', text: 'X' });
  h.sync({ paused: true });
  assert.equal(h.ui.isFragmentOpen(), true, 'still blocking');
  assert.equal(h.q('#fragment-layer').hidden, true, 'but the pause menu is on top');
  h.sync({ paused: false });
  assert.equal(h.q('#fragment-layer').hidden, false);

  const next = createWorld(LEVEL);
  next.mode = 'play';
  h.ui.sync(next, h.ctx);
  assert.equal(h.ui.isFragmentOpen(), false);
  assert.equal(h.q('#fragment-layer').hidden, true);
});

test('Pause: the archive panel lists three entries, each found with its text or undiscovered', (t) => {
  const h = mount(t);
  h.sync({ mode: 'play', paused: true });
  const entries = () => h.in('#card-pause', '.archive-list').children.map((entry) => [
    entry.classList.contains('undiscovered'), entry.children[0].textContent, entry.children[1].textContent,
  ]);
  assert.deepEqual(entries(), [
    [true, 'Archive A', 'Undiscovered'], [true, 'Archive B', 'Undiscovered'], [true, 'Archive C', 'Undiscovered'],
  ]);
  h.sync({ archives: [{ id: 'A', title: 'Shift Log', text: 'First line.\nSecond line.', collected: true }] });
  assert.deepEqual(entries(), [[false, 'Shift Log', 'First line.\nSecond line.'], [true, 'Archive B', 'Undiscovered'], [true, 'Archive C', 'Undiscovered']]);
  h.sync({ archives: [
    { id: 'A', title: 'Shift Log', text: 'First line.\nSecond line.', collected: true },
    { id: 'C', title: 'Reservoir Note', text: 'Deep water.', collected: true },
  ] });
  assert.deepEqual(entries()[2], [false, 'Reservoir Note', 'Deep water.']);
});

// --- Buttons and settings ---

test('Buttons: each calls its action exactly once per activation', (t) => {
  const h = mount(t);
  const click = (selector, detail = 1) => h.q(selector).dispatch('click', { detail });
  h.sync({ mode: 'title', paused: false });
  click('.begin');
  assert.deepEqual(h.calls, ['begin']);

  h.calls.length = 0;
  h.sync({ mode: 'complete', result: RESULT });
  click('.new');
  assert.deepEqual(h.calls, ['begin']);

  h.calls.length = 0;
  h.sync({ mode: 'play', paused: true });
  click('.resume');
  assert.deepEqual(h.calls, ['resume']);
  click('.retry');
  assert.deepEqual(h.calls, ['resume', 'retry']);

  // Restart needs a second press.
  click('.restart');
  assert.deepEqual(h.calls, ['resume', 'retry']);
  assert.equal(h.in('#card-pause', '.restart').textContent, 'Press again to confirm restart');
  assert.equal(h.in('#card-pause', '.restart').classList.contains('confirm'), true);
  click('.restart');
  assert.deepEqual(h.calls, ['resume', 'retry', 'restart']);

  h.calls.length = 0;
  h.sync({ paused: false });
  click('.pause');
  click('.mute');
  assert.deepEqual(h.calls, ['pause', 'mute']);

  // Leaving the pause menu disarms the restart it asked to confirm.
  h.calls.length = 0;
  h.sync({ paused: true });
  assert.equal(h.in('#card-pause', '.restart').textContent, 'Restart Expedition');
  click('.restart');
  h.sync({ paused: false });
  h.sync({ paused: true });
  assert.equal(h.in('#card-pause', '.restart').textContent, 'Restart Expedition');
  click('.restart');
  assert.deepEqual(h.calls, [], 'it asks again');
  assert.equal(h.in('#card-pause', '.restart').textContent, 'Press again to confirm restart');
});

test('Buttons: the pause toggles call mute and reduced motion', (t) => {
  const h = mount(t);
  h.sync({ mode: 'play', paused: true });
  const sound = h.in('#card-pause', '.setting-sound');
  const motion = h.in('#card-pause', '.setting-motion');
  assert.equal(sound.getAttribute('type'), 'checkbox');
  sound.checked = false;
  sound.dispatch('change');
  motion.checked = true;
  motion.dispatch('change');
  assert.deepEqual(h.calls, ['mute', 'reducedMotion true']);
  motion.checked = false;
  motion.dispatch('change');
  assert.deepEqual(h.calls, ['mute', 'reducedMotion true', 'reducedMotion false']);
});

test('Buttons: a pointer click takes the focus off a HUD button, a keyboard press keeps it', (t) => {
  const h = mount(t);
  const mute = h.q('.mute');
  mute.focus();
  assert.equal(h.document.activeElement, mute);
  mute.dispatch('click', { detail: 1 });
  assert.equal(h.document.activeElement, h.document.body);
  mute.focus();
  mute.dispatch('click', { detail: 0 });
  assert.equal(h.document.activeElement, mute);
});

test('Focus: an overlay holds its primary action, a fragment holds itself, and hiding lets go', (t) => {
  const h = mount(t);
  h.sync({ mode: 'title', paused: false });
  assert.equal(h.document.activeElement, h.q('.begin'));
  h.sync({ mode: 'play', paused: true });
  assert.equal(h.document.activeElement, h.q('.resume'));
  h.sync({ paused: false });
  assert.equal(h.document.activeElement, h.document.body);
  h.sync({ mode: 'complete', result: RESULT });
  assert.equal(h.document.activeElement, h.q('.new'));
  h.sync({ mode: 'shutdown' });
  assert.equal(h.document.activeElement, h.document.body, 'recovery has nothing to focus');
  h.sync({ mode: 'play' });
  h.ui.handle({ type: 'archive', id: 'A', title: 'T', text: 'X' });
  assert.equal(h.document.activeElement, h.q('#fragment'));
  h.ui.dismissFragment();
  assert.equal(h.document.activeElement, h.document.body);
});

test('Sound and reduced motion: the state reaches the button and the pause toggles', (t) => {
  const h = mount(t);
  h.ui.setMuted(true);
  assert.equal(h.q('.mute').getAttribute('aria-pressed'), 'true');
  assert.equal(h.in('#card-pause', '.setting-sound').checked, false);
  h.ui.setMuted(false);
  assert.equal(h.q('.mute').getAttribute('aria-pressed'), 'false');
  assert.equal(h.in('#card-pause', '.setting-sound').checked, true);
  h.ui.setReducedMotion(true);
  assert.equal(h.in('#card-pause', '.setting-motion').checked, true);
  assert.equal(h.root.classList.contains('reduced-motion'), true);
  h.ui.setReducedMotion(false);
  assert.equal(h.in('#card-pause', '.setting-motion').checked, false);
  assert.equal(h.root.classList.contains('reduced-motion'), false);
});

// --- Notifications ---

test('Notifications: one line at a time for 2.5 s at most, a bounded count, none for an empty pulse', (t) => {
  const h = mount(t);
  const line = () => h.q('.toast-line');
  const text = () => (line().hidden ? null : line().textContent);
  h.sync();
  assert.equal(h.q('.toast').getAttribute('aria-live'), 'polite');
  assert.equal(text(), null);

  h.ui.handle({ type: 'station', id: 'st0', x: 1.5, y: 0 });
  assert.equal(text(), null, 'shown by the next sync');
  h.sync();
  assert.equal(text(), 'Station linked');
  h.clock.now += 2499;
  h.sync();
  assert.equal(text(), 'Station linked');
  h.clock.now += 1;
  h.sync();
  assert.equal(text(), null);

  h.ui.handle({ type: 'relay', id: 'B', x: 0, y: 0, lookAt: { x: 1, y: 1 } });
  h.ui.handle({ type: 'cache', id: 'c1', gained: 25 });
  h.ui.handle({ type: 'cache', id: 'c2', gained: 0 });
  h.ui.handle({ type: 'relay', id: 'C', x: 0, y: 0, lookAt: { x: 1, y: 1 } });
  h.sync();
  assert.equal(text(), 'Relay B online');
  h.clock.now += 2500;
  h.sync();
  assert.equal(text(), 'Cache found · Resonance +25');
  h.clock.now += 2500;
  h.sync();
  assert.equal(text(), 'Cache found');
  h.clock.now += 2500;
  h.sync();
  assert.equal(text(), null, 'a fourth line at once was dropped');

  h.ui.handle({ type: 'pulseEmpty' });
  h.sync();
  assert.equal(text(), null);
  assert.equal(h.q('.resonance').classList.contains('flash'), true);
  h.clock.now += 399;
  h.sync();
  assert.equal(h.q('.resonance').classList.contains('flash'), true);
  h.clock.now += 1;
  h.sync();
  assert.equal(h.q('.resonance').classList.contains('flash'), false);
});

test('Notifications: a cache with a fractional gain shows a whole number', (t) => {
  const h = mount(t);
  h.ui.handle({ type: 'cache', id: 'k1', gained: 9.99999999999929 });
  h.sync();
  assert.deepEqual([h.q('.toast-line').hidden, h.q('.toast-line').textContent], [false, 'Cache found · Resonance +10']);
});

// --- Touch controls ---

test('Touch buttons: the six actions, shown after the first touch', (t) => {
  const buttons = (h) => h.touchRoot.querySelectorAll('[data-act]').map((button) => [
    button.dataset.act, button.getAttribute('aria-label'), button.getAttribute('type'),
  ]);
  const expected = [['left', 'Move left'], ['right', 'Move right'], ['jump', 'Jump'], ['dash', 'Dash'], ['pulse', 'Pulse'], ['interact', 'Use']]
    .map(([act, text]) => [act, text, 'button']);
  const fine = mount(t);
  assert.deepEqual(buttons(fine), expected);
  assert.equal(fine.document.documentElement.classList.contains('is-touch'), false);
  assert.deepEqual(fine.touchRoot.querySelectorAll('.touch-cluster').map((cluster) => cluster.classList.contains('touch-act')), [false, true]);
  assert.deepEqual(fine.touchRoot.querySelector('.touch-move').querySelectorAll('[data-act]').map((button) => button.dataset.act), ['left', 'right']);
  assert.deepEqual(fine.touchRoot.querySelector('.touch-act').querySelectorAll('[data-act]').map((button) => button.dataset.act), ['jump', 'dash', 'pulse', 'interact']);

  assert.equal(fine.window.dispatch('touchstart'), true, 'nothing hinders the touch itself');
  assert.equal(fine.document.documentElement.classList.contains('is-touch'), true);
});

test('Touch buttons: a coarse-pointer device shows them from the start', (t) => {
  const h = mount(t, { coarse: true });
  assert.equal(h.window.matchMedia('(pointer: coarse)').matches, true);
  assert.equal(h.window.matchMedia('(pointer: fine)').matches, false);
  assert.equal(h.document.documentElement.classList.contains('is-touch'), true);
});

test('Touch controls: hidden under every overlay and a fragment, back when the game shows', (t) => {
  const h = mount(t, { coarse: true });
  const shown = () => h.touchRoot.classList.contains('covered') === false;
  assert.equal(shown(), false, 'hidden until the first frame: the title covers the game');
  h.sync({ mode: 'play', paused: false });
  assert.equal(shown(), true);
  h.sync({ mode: 'title' });
  assert.equal(shown(), false, 'under the title');
  h.sync({ mode: 'play', paused: true });
  assert.equal(shown(), false, 'under the pause menu');
  h.sync({ paused: false });
  assert.equal(shown(), true);
  h.ui.handle({ type: 'archive', id: 'A', title: 'T', text: 'X' });
  h.sync();
  assert.equal(shown(), false, 'under a fragment');
  h.ui.dismissFragment();
  h.sync();
  assert.equal(shown(), true);
  for (const mode of ['shutdown', 'reboot']) {
    h.sync({ mode, paused: false });
    assert.equal(shown(), false, `${mode}: under the recovery caption`);
  }
  h.sync({ mode: 'play', paused: false });
  assert.equal(shown(), true);
  h.sync({ mode: 'complete', result: RESULT });
  assert.equal(shown(), false, 'under the results');
  h.sync({ mode: 'play', paused: false });
  assert.equal(shown(), true);
});

/** The controls list of the pause menu: what names the control, then what it does. */
const controlsList = (h) => h.in('#card-pause', '.controls').children.map((line) => [line.querySelector('.keys').textContent, line.children[1].textContent]);
const KEYBOARD = [['AD←→', 'Move'], ['SpaceZ', 'Jump'], ['ShiftX', 'Dash'], ['Q', 'Echo Pulse'], ['E', 'Interact'], ['PEsc', 'Pause'], ['R', 'Retry from Checkpoint']];
const BUTTONS = [['LeftRight', 'Move'], ['Jump', 'Jump, hold for height'], ['Dash', 'Dash'], ['Pulse', 'Echo Pulse'], ['Use', 'Interact'], ['Pause button', 'Pause']];

test('Touch wording: a coarse-pointer device names the buttons in the pause menu and taps the fragment away', (t) => {
  const h = mount(t, { coarse: true });
  h.sync({ mode: 'play', paused: true });
  assert.deepEqual(controlsList(h), BUTTONS);
  h.ui.handle({ type: 'archive', id: 'A', title: 'T', text: 'X' });
  h.sync({ paused: false });
  assert.equal(h.in('#fragment', '.fragment-dismiss').textContent, 'Tap anywhere to close');
});

test('Touch wording: the first touch changes the pause menu and the fragment; a keyboard keeps its keys', (t) => {
  const h = mount(t);
  const dismiss = () => h.in('#fragment', '.fragment-dismiss').textContent;
  assert.deepEqual(controlsList(h), KEYBOARD);
  assert.equal(dismiss(), 'Press E or Enter, or click anywhere, to close');
  h.window.dispatch('touchstart');
  h.sync({ mode: 'play', paused: true });
  assert.deepEqual(controlsList(h), BUTTONS);
  assert.equal(dismiss(), 'Tap anywhere to close');
  // Built once per input: a frame that changes nothing rebuilds nothing.
  const lines = h.in('#card-pause', '.controls').children;
  h.sync();
  assert.equal(h.in('#card-pause', '.controls').children[0], lines[0]);
});

// --- Input ---

test('Input: every key sets its fields, is kept from scrolling, and lets go on key up', (t) => {
  const h = mount(t);
  const input = createInput();
  const TABLE = [
    ['KeyA', ['left']], ['ArrowLeft', ['left']], ['KeyD', ['right']], ['ArrowRight', ['right']],
    ['Space', ['jump', 'jumpPressed']], ['KeyZ', ['jump', 'jumpPressed']],
    ['ShiftLeft', ['dashPressed']], ['ShiftRight', ['dashPressed']], ['KeyX', ['dashPressed']],
    ['KeyQ', ['pulsePressed']], ['KeyE', ['interactPressed']], ['KeyR', ['retryPressed']],
    ['KeyP', ['pausePressed']], ['Escape', ['pausePressed']], ['Enter', ['confirmPressed']],
  ];
  for (const [code, fields] of TABLE) {
    input.reset();
    assert.equal(key(h, code), false, `${code} is handled`);
    assert.deepEqual(ON(input.state), fields, code);
    assert.equal(keyUp(h, code), false, `${code} key up is handled`);
    assert.deepEqual(ON(input.state), fields.filter((name) => !['left', 'right', 'jump'].includes(name)), `${code} released`);
  }
  for (const code of ['KeyW', 'KeyS', 'Tab', 'F5', 'Backspace']) {
    input.reset();
    assert.equal(key(h, code), true, `${code} is not handled`);
    assert.deepEqual(ON(input.state), [], code);
  }
});

test('Input: a repeat is ignored but still kept from scrolling; two keys for one action hold it until both leave', (t) => {
  const h = mount(t);
  const input = createInput();
  key(h, 'Space');
  input.afterStep();
  assert.equal(key(h, 'Space', { repeat: true }), false);
  assert.deepEqual(ON(input.state), ['jump'], 'no second press');
  key(h, 'KeyE', { repeat: true });
  assert.equal(input.state.interactPressed, false, 'a repeat never interacts');

  key(h, 'KeyA');
  key(h, 'ArrowLeft');
  keyUp(h, 'KeyA');
  assert.equal(input.state.left, true);
  keyUp(h, 'ArrowLeft');
  assert.equal(input.state.left, false);
});

test('Input: browser shortcuts and the keys of a focused control are left alone', (t) => {
  const h = mount(t);
  const input = createInput();
  for (const [code, init] of [['KeyR', { ctrlKey: true }], ['KeyR', { metaKey: true }], ['KeyP', { ctrlKey: true }], ['ArrowLeft', { altKey: true }], ['KeyD', { altKey: true }]]) {
    assert.equal(key(h, code, init), true, `${JSON.stringify(init)} ${code} belongs to the browser`);
    assert.deepEqual(ON(input.state), [], code);
  }

  // Space activates a focused button or field, Enter a focused button.
  const mute = h.q('.mute');
  mute.focus();
  assert.equal(key(h, 'Space'), true);
  assert.equal(key(h, 'Enter'), true);
  assert.deepEqual(ON(input.state), []);
  h.sync({ mode: 'play', paused: true });
  const motion = h.in('#card-pause', '.setting-motion');
  motion.focus();
  assert.equal(key(h, 'Space'), true);
  assert.deepEqual(ON(input.state), []);
  assert.equal(key(h, 'Enter'), false);
  assert.deepEqual(ON(input.state), ['confirmPressed']);
  // Pause and retry still work from a control of the pause menu.
  const resume = h.q('.resume');
  resume.focus();
  assert.equal(key(h, 'Escape'), false);
  assert.deepEqual(ON(input.state), ['pausePressed', 'confirmPressed']);
  input.reset();
  assert.equal(key(h, 'KeyR'), false);
  assert.deepEqual(ON(input.state), ['retryPressed']);
  // Anywhere else the game has every key.
  input.reset();
  h.document.body.focus();
  keyUp(h, 'Space');
  key(h, 'Space');
  assert.deepEqual(ON(input.state), ['jump', 'jumpPressed']);
});

test('Input: a gameplay edge survives a frame without steps and is cleared by a step; overlay edges never survive a frame', (t) => {
  const h = mount(t);
  const input = createInput();
  key(h, 'KeyQ');
  input.endFrame(0);
  assert.deepEqual(ON(input.state), ['pulsePressed']);
  input.afterStep();
  assert.deepEqual(ON(input.state), [], 'used by the first step');

  key(h, 'KeyE');
  input.endFrame(3);
  assert.deepEqual(ON(input.state), [], 'a frame that steps uses the edge');

  key(h, 'Enter');
  key(h, 'KeyP');
  input.endFrame(0);
  assert.deepEqual(ON(input.state), [], 'overlay edges go with every frame');

  key(h, 'KeyD');
  input.endFrame(1);
  assert.deepEqual(ON(input.state), ['right'], 'a held key stays held');
});

test('Input: R reaches the simulation as a retry', (t) => {
  const h = mount(t);
  const input = createInput();
  assert.equal(h.world.mode, 'play');
  key(h, 'KeyR');
  assert.deepEqual(ON(input.state), ['retryPressed']);
  stepWorld(h.world, input.state);
  assert.equal(h.world.mode, 'shutdown');
  assert.equal(h.world.cause, 'retry');
  assert.equal(h.world.recoveries, 1);
  assert.deepEqual(h.world.events.map((event) => event.type), ['shutdown']);
});

test('Input: a lost focus and a hidden page release everything; a visible page does not', (t) => {
  const h = mount(t);
  const input = createInput();
  const hold = () => {
    key(h, 'KeyD');
    touchButton(h, 'right').dispatch('pointerdown', { pointerId: 1 });
    key(h, 'KeyQ');
  };
  hold();
  assert.deepEqual(ON(input.state), ['right', 'pulsePressed']);
  h.window.dispatch('blur');
  assert.deepEqual(ON(input.state), []);
  hold();
  h.document.hidden = true;
  h.document.dispatch('visibilitychange');
  assert.deepEqual(ON(input.state), []);
  hold();
  h.document.hidden = false;
  h.document.dispatch('visibilitychange');
  assert.deepEqual(ON(input.state), ['right', 'pulsePressed']);
});

test('Fake DOM: a hidden page reports `hidden` and `visibilityState` together', (t) => {
  const h = mount(t);
  const page = () => [h.document.hidden, h.document.visibilityState];
  assert.deepEqual(page(), [false, 'visible']);
  h.document.hidden = true;
  assert.deepEqual(page(), [true, 'hidden']);
  h.document.visibilityState = 'visible';
  assert.deepEqual(page(), [false, 'visible'], 'either flag sets the other');
});

test('Input: touch buttons press, release, cancel and lose capture', (t) => {
  const h = mount(t);
  const input = createInput();
  const jump = touchButton(h, 'jump');
  assert.equal(h.document.querySelector('#touch'), h.touchRoot, 'the input module listens on #touch');

  assert.equal(jump.dispatch('pointerdown', { pointerId: 7 }), false, 'the press is handled');
  assert.deepEqual(ON(input.state), ['jump', 'jumpPressed']);
  assert.equal(h.touchRoot.hasPointerCapture(7), true);
  input.afterStep();
  assert.deepEqual(ON(input.state), ['jump'], 'held until release');
  jump.dispatch('pointerup', { pointerId: 7 });
  assert.deepEqual(ON(input.state), []);
  // The capture the browser releases after a normal pointer up changes nothing else.
  key(h, 'KeyA');
  jump.dispatch('lostpointercapture', { pointerId: 7 });
  assert.deepEqual(ON(input.state), ['left']);

  // A cancelled pointer, or a capture lost while the pointer is down, releases every held input.
  jump.dispatch('pointerdown', { pointerId: 8 });
  jump.dispatch('pointercancel', { pointerId: 8 });
  assert.deepEqual(ON(input.state), []);
  jump.dispatch('pointerdown', { pointerId: 9 });
  jump.dispatch('lostpointercapture', { pointerId: 9 });
  assert.deepEqual(ON(input.state), []);

  // A touch beside the buttons is not a game input.
  assert.equal(h.touchRoot.dispatch('pointerdown', { pointerId: 10 }), true);
  assert.deepEqual(ON(input.state), []);
});

test('Input: several pointers at once, so ILO moves while jumping', (t) => {
  const h = mount(t);
  const input = createInput();
  touchButton(h, 'left').dispatch('pointerdown', { pointerId: 1 });
  touchButton(h, 'jump').dispatch('pointerdown', { pointerId: 2 });
  assert.deepEqual(ON(input.state), ['left', 'jump', 'jumpPressed']);
  stepWorld(h.world, input.state);
  assert.deepEqual(h.world.events.filter((event) => event.type === 'jump').length, 1);
  input.afterStep();
  touchButton(h, 'jump').dispatch('pointerup', { pointerId: 2 });
  assert.deepEqual(ON(input.state), ['left']);
  touchButton(h, 'right').dispatch('pointerdown', { pointerId: 3 });
  touchButton(h, 'dash').dispatch('pointerdown', { pointerId: 4 });
  assert.deepEqual(ON(input.state), ['left', 'right', 'dashPressed']);
  touchButton(h, 'left').dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(ON(input.state), ['right', 'dashPressed']);
  touchButton(h, 'pulse').dispatch('pointerdown', { pointerId: 1 });
  assert.deepEqual(ON(input.state), ['right', 'dashPressed', 'pulsePressed']);
});

test('Live world: the interface follows a run from play through a recovery and back', (t) => {
  const h = mount(t);
  const input = createInput();
  const idle = { ...input.state };
  const seen = new Set();
  /** One frame as the glue runs it: step, hand every event to the interface, sync, end the frame. */
  const frame = () => {
    stepWorld(h.world, input.state);
    for (const event of h.world.events) {
      seen.add(event.type);
      h.ui.handle(event);
    }
    h.world.events.length = 0;
    h.ui.sync(h.world, h.ctx);
    input.endFrame(1);
  };
  /** `count` frames that let go of every key first and then hold what `held` gives for each frame. */
  const run = (count, held = {}) => {
    Object.assign(input.state, idle);
    for (let i = 0; i < count; i++) {
      Object.assign(input.state, typeof held === 'function' ? held(i) : held);
      frame();
    }
  };
  run(20, { right: true, pulsePressed: true });
  run(12, (i) => ({ jump: true, jumpPressed: i === 0, dashPressed: i === 4 }));
  assert.ok(seen.has('pulse') && seen.has('jump') && seen.has('dash'));
  assert.equal(h.view(), null);
  assert.equal(h.q('.hud').hidden, false);
  assert.equal(h.q('#fragment-layer').hidden, true);

  key(h, 'KeyR');
  frame();
  assert.equal(h.view(), 'recovery');
  assert.equal(h.q('.hud').hidden, false, 'the bar stays to show the spent integrity');
  assert.equal(h.q('#prompt').hidden, true);
  run(200);
  assert.equal(h.world.mode, 'play');
  assert.equal(h.world.recoveries, 1);
  assert.equal(h.view(), null);
  assert.equal(h.q('.hud').hidden, false);
  assert.ok(seen.has('shutdown') && seen.has('reboot'));

  // A fall into the pit of the fixture recovers the same way.
  Object.assign(h.world.player, { x: 27, y: -2, vx: 0, vy: 0 });
  run(1);
  assert.equal(h.view(), 'recovery');
  // A fall shuts down for 1.2 s, a retry for 0.5 s; the reboot takes 0.9 s after either.
  run(300);
  assert.equal(h.world.recoveries, 2);
  assert.equal(h.view(), null);
});

test('Input: dispose removes every listener', (t) => {
  const h = mount(t);
  const input = createInput();
  input.dispose();
  assert.equal(key(h, 'KeyD'), true);
  assert.equal(touchButton(h, 'jump').dispatch('pointerdown', { pointerId: 1 }), true);
  assert.deepEqual(ON(input.state), []);
});

// --- Page and stylesheet ---

/** True when `css`, comments removed, is well formed: `selector { declarations }` rules, at-rules holding rules. */
function wellFormed(css) {
  const closeOf = (open) => {
    for (let depth = 1, i = open + 1; i < css.length; i++) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}' && (depth -= 1) === 0) return i;
    }
    return -1;
  };
  const declaration = (text) => /^\s*[-\w]+\s*:\s*\S/.test(text);
  const block = (start, end) => {
    for (let i = start; i < end;) {
      while (i < end && /\s/.test(css[i])) i++;
      if (i >= end) return true;
      const open = css.indexOf('{', i);
      if (open === -1 || open >= end) return css.slice(i, end).split(';').every((part) => part.trim() === '' || declaration(part));
      const semi = css.indexOf(';', i);
      if (semi !== -1 && semi < open) {
        if (!declaration(css.slice(i, semi))) return false;
        i = semi + 1;
        continue;
      }
      const close = closeOf(open);
      if (css.slice(i, open).trim() === '' || close === -1 || close >= end || !block(open + 1, close)) return false;
      i = close + 1;
    }
    return true;
  };
  return block(0, css.length);
}

test('Page: index.html mounts the roots in the order the glue and the input read them', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/, 'safe-area insets need viewport-fit=cover');
  assert.match(html, /href="src\/style.css"/);
  const order = ['id="game"', 'id="touch"', 'id="ui"', 'src="src/main.js"'].map((token) => html.indexOf(token));
  assert.ok(order.every((at) => at >= 0), order);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /<div id="touch" role="group" aria-label="Touch controls"><\/div>/);
});

test('Styles: well formed, and every class the interface sets has a rule', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(wellFormed(css), true);
  const source = readFileSync(new URL('../src/ui/ui.js', import.meta.url), 'utf8');
  const classes = new Set();
  for (const [, literal] of source.matchAll(/class: ('[^']*'|`[^`]*`)/g)) {
    // Of a template literal only the fixed start names a class.
    for (const token of literal.slice(1, -1).replace(/\$\{[\s\S]*$/, '').split(/\s+/)) {
      if (token !== '' && !token.endsWith('-')) classes.add(token);
    }
  }
  for (const [, name] of source.matchAll(/classList\.(?:toggle|add)\('([^']+)'/g)) classes.add(name);
  // Names that only mark a control for the tests and the glue.
  const unstyled = new Set(['integrity', 'relays', 'pause', 'begin', 'resume', 'retry', 'new', 'setting-sound', 'setting-motion', 'touch-move']);
  const missing = [...classes].filter((name) => !unstyled.has(name) && !new RegExp(`\\.${name}(?![\\w-])`).test(css));
  assert.deepEqual(missing, []);
});

test('Styles: the layout guarantees are written down', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.match(rule('.hud-button'), /width: 44px/);
  assert.match(rule('.hud-button'), /height: 44px/);
  assert.match(rule('button:disabled'), /opacity/);
  assert.equal(css.includes('button:hover {'), false, 'hover leaves a disabled control alone');
  assert.match(css, /--touch-size: clamp\(56px/);
  assert.match(rule('#touch button'), /touch-action: none/);
  assert.match(rule('#touch button'), /user-select: none/);
  assert.match(rule('#touch'), /safe-area-inset-bottom/);
  assert.match(rule('.hud'), /position: fixed/);
  assert.match(rule('.overlay'), /inset: 0/);
  assert.match(rule('.card,\n.fragment'), /max-height: 100dvh/);
  assert.match(rule('.card,\n.fragment'), /overflow: auto/);
  assert.match(rule('.fragment-layer'), /inset: 0/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.reduced-motion \* \{\s*animation: none !important/);
  assert.match(css, /@media \(max-height: 480px\)/);
  assert.match(rule('@media (pointer: coarse)'), /min-width: 44px/);
  assert.match(rule('@media (pointer: coarse)'), /min-height: 44px/);
});
