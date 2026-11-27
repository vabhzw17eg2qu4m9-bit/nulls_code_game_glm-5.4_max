import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/audio/audio.js';
import { placePlayer } from '../src/sim/player.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { LEVEL, SPOTS } from './fixtures/core.js';
import { install } from './fakes/audio.js';

const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const FRAME = 1 / 60; // one frame at 60 Hz: two fixed steps, one sync
const EPSILON = 1e-9;
const SOURCE = new Set(['oscillator', 'bufferSource']);
const TICK = 0.5; // seconds between two music steps
const LOOKAHEAD = 0.25; // seconds of music the sound may schedule ahead
const FADE = 1.5; // seconds of a music crossfade
const MAX_LIFE = 3; // seconds a sound may last
const X = SPOTS.floor[0]; // where ILO stands in the table below

/** Every event name of contract §3.14. */
const NAMES = [
  'jump', 'land', 'step', 'dash', 'dashStop', 'seamBreak', 'pulse', 'pulseEmpty', 'pulseBlock', 'reveal',
  'shield', 'damage', 'crush', 'shutdown', 'reboot', 'cellPickup', 'cellDrop', 'cellInsert',
  'cellRemove', 'cellReject', 'socketPower', 'shutterStop', 'liftStop', 'switch',
  'vent', 'press', 'relay', 'relayUnpowered', 'station', 'archive', 'cache', 'liftSequence', 'complete',
  'enemyState', 'enemyAttack', 'boltHit',
];

const held = (extra = {}) => ({ ...IDLE, ...extra });
const near = (actual, expected, tolerance = EPSILON) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const settle = () => new Promise((resolve) => setImmediate(resolve));

// --- Reading what the fake recorded ---

const first = (node, name) => node.calls.find((call) => call.name === name);
const last = (node, name) => node.calls.findLast((call) => call.name === name);
const startOf = (source) => first(source, 'start');
const stopOf = (source) => last(source, 'stop');
/** A source stopped in the same sync that started it: a one-shot rather than a loop. */
const isOneShot = (source) => stopOf(source)?.time === startOf(source).time;
const sourcesOf = (ctx) => ctx.nodes.filter((node) => SOURCE.has(node.kind));
const sourcesSince = (ctx, mark) => sourcesOf(ctx).filter((node) => ctx.nodes.indexOf(node) >= mark);
/** The last linear ramp of a gain: its target, when it was scheduled and when it lands. */
const lastRamp = (param) => {
  const call = last(param, 'linearRampToValueAtTime');
  return { value: call.args[0], at: call.time, time: call.args[1] };
};
const isBus = (node) => node.kind === 'gain' && node.outputs[0]?.kind === 'gain' && node.outputs[0].outputs[0]?.kind === 'compressor';
/** Where a node was first connected: the wiring it was given, which outlives the connection itself. */
const wired = (node) => first(node, 'connect')?.args[0];
/** The nodes a voice was wired through, the voice included, up to its bus; readable after the voice ended. */
const chainOf = (source) => {
  const chain = [];
  for (let node = source; node !== undefined && !isBus(node); node = wired(node)) chain.push(node);
  return chain;
};
const busOf = (source) => wired(chainOf(source).at(-1));
/** The sources that went into `bus`. */
const voices = (sources, bus) => sources.filter((source) => busOf(source) === bus);
/** The highest level a voice's envelopes reach. */
const rampValue = (call) => (call.name.endsWith('RampToValueAtTime') ? call.args[0] : 0);
const peakOf = (source) => Math.max(...chainOf(source).filter((node) => node.gain !== undefined).map((node) => Math.max(...node.gain.calls.map(rampValue))));
/** The frequency a filter or an oscillator was set to. */
const freqOf = (node) => first(node.frequency, 'setValueAtTime')?.args[0];
const panOf = (source) => chainOf(source).find((node) => node.kind === 'panner').pan.value;
/** The loop sources among `sources` whose filter sits at `freq` with quality `q`: a named continuous sound. */
const loopVoices = (sources, freq, q) => sources
  .filter((source) => !isOneShot(source))
  .filter((source) => chainOf(source).some((node) => node.kind === 'biquad' && freqOf(node) === freq && node.Q.value === q));
/** The nodes a voice owns, from its source to its panner; the buses and the track gains stay out. */
const ownNodes = (source) => chainOf(source).slice(0, chainOf(source).findIndex((node) => node.kind === 'panner') + 1);
/** Waveform and frequencies of some voices: what makes one surface sound unlike another. Peaks and pan left out. */
const timbre = (sources) => sources
  .map((source) => [source.kind === 'oscillator' ? source.type : 'noise', ...chainOf(source).flatMap((node) => node.frequency?.calls.map((call) => call.args[0]) ?? [])].join(' '))
  .sort();
const reachesDestination = (node) => {
  for (let at = node; at !== undefined; at = at.outputs[0]) if (at.kind === 'destination') return true;
  return false;
};
const types = (events) => events.map((event) => event.type);

// --- Worlds ---

/** A `play` world with ILO at a fixture spot. `createWorld` already committed the start station. */
function open(spot = 'floor', level = LEVEL) {
  const world = createWorld(level);
  world.mode = 'play';
  placePlayer(world, ...SPOTS[spot]);
  world.events.length = 0;
  return world;
}

/** A looping lift in the east of the fixture range, with the fields a level's `lifts` entry gets. */
function addLift(world) {
  const lift = {
    id: 'lift1', kind: 'lift', x: 74, y: 0, w: 1.6, h: 0.4, fx: 74, fy: 0, tx: 74, ty: 3,
    mode: 'loop', yields: true, crushes: false, enabled: true, poweredBy: [],
    speed: 2, pauseA: 0.5, pauseB: 0.5, wait: 0, t: 0, dir: 1, moving: false, powered: true, blocked: false,
  };
  world.movers.push(lift);
  return lift;
}

/** A cycling vent of contract §3.10 standing at `x` on the floor. */
function addVent(world, x, period = 4) {
  const vent = { id: 'v1', x, y: 0, w: 1, h: 6, period, warn: 1, active: 1.5, delay: 0.2, t: 0, stage: 'dormant' };
  world.vents.push(vent);
  return vent;
}

/** A beam that stays over `x`, as in sim-core: `stepWorld` rebuilds `world.hazards`, so the source re-adds itself. */
function beam(world, x, sx = x + 4) {
  const source = { kind: 'beam', x, y: 0, w: 1, h: 2, sx, sy: 0.75 };
  let current = [];
  Object.defineProperty(world, 'hazards', {
    configurable: true,
    get: () => current,
    set: (rebuilt) => { current = [...rebuilt, source]; },
  });
}

/** Capture what the module reports on the console: the failure tests need the report, the output needs quiet. */
function quiet(t) {
  const said = [];
  const was = console.error;
  console.error = (...args) => said.push(args);
  t.after(() => { console.error = was; });
  return said;
}

/** A recorder, a sound and a world. `closed` expects the test to release the context itself. */
function rig(t, spot = 'floor', { level = LEVEL, closed = false } = {}) {
  const rec = install();
  const sound = createAudio();
  const world = open(spot, level);
  sound.unlock();
  const ctx = rec.contexts[0];
  t.after(() => {
    rec.uninstall();
    assert.equal(ctx.state, closed ? 'closed' : 'running', 'the audio context was dropped by an exception');
  });
  /** One `sync` with `events`, then the clock; returns the sources it started. */
  const sync = (events, dt = FRAME) => {
    const mark = ctx.nodes.length;
    sound.sync(world, dt, events);
    rec.tick(dt);
    return sourcesSince(ctx, mark);
  };
  const fx = busOf(sync([{ type: 'pulseEmpty' }])[0]);
  const master = ctx.destination.inputs[0].inputs[0];
  const music = master.inputs.find((node) => node !== fx);
  return {
    rec, sound, world, ctx, fx, music, master,
    /** Two fixed steps and one sync, as the glue runs a frame. */
    frame(input = IDLE) {
      stepWorld(world, input);
      stepWorld(world, held({ ...input, jumpPressed: false, dashPressed: false, pulsePressed: false, interactPressed: false, retryPressed: false }));
      const events = world.events.splice(0);
      return { events, sources: sync(events) };
    },
    /** One sync with hand-made events, or with none. */
    emit: (events, dt = FRAME) => sync(events, dt),
    /** The waveform-and-frequency prints of what `event` sounds like on the effects bus. */
    prints: (event) => timbre(voices(sync([event]), fx)),
  };
}

/**
 * Step `count` frames. For every event: the prints of all the effects its frame played, and `first`, the first
 * effect of its frame, which is the event's own lead voice when the frame played that event alone.
 */
function heard(r, count, input = IDLE) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const frame = r.frame(typeof input === 'function' ? input(i) : input);
    const fx = voices(frame.sources, r.fx);
    out.push(...frame.events.map((event) => ({ event, prints: timbre(fx), first: fx[0] })));
  }
  return out;
}
/** True when every print of `part` is among those of `whole`, one for one. */
const includes = (whole, part) => {
  const left = [...whole];
  return part.every((print) => {
    const i = left.indexOf(print);
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
};
/** Every event of `entries` sounded in play as its own replay sounds. */
function assertSoundsAsReplay(entries, r, label) {
  for (const { event, prints } of entries) {
    const replay = r.prints(event);
    if (replay.length > 0) assert.ok(includes(prints, replay), `${label}: ${JSON.stringify(event)} sounds unlike its replay`);
  }
}

/** The event types of `entries` that start with one of `prefixes`: the events under test, without bystanders. */
const names = (entries, ...prefixes) => types(entries.map((entry) => entry.event)).filter((type) => prefixes.some((prefix) => type.startsWith(prefix)));

/** One hand-made event per row: `event`, and the world state its sound reads, if any. */
const ROWS = [
  { label: 'jump', event: { type: 'jump', x: X, y: 0, wall: 0 } },
  { label: 'wall jump', event: { type: 'jump', x: 36.4, y: 3, wall: 1 } },
  { label: 'land', event: { type: 'land', x: X, y: 0, speed: 12, surface: 'rock' } },
  ...['rock', 'metal', 'platform', 'cell'].map((surface) => ({ label: `step on ${surface}`, event: { type: 'step', x: X, y: 0, surface } })),
  { label: 'dash', event: { type: 'dash', x: X, y: 0, dir: 1 } },
  { label: 'dashStop', event: { type: 'dashStop', x: X, y: 0 } },
  { label: 'seamBreak', event: { type: 'seamBreak', id: 'seam1', x: 44.25, y: 1.5 } },
  { label: 'pulse', event: { type: 'pulse', x: X, y: 0.75 } },
  { label: 'pulseEmpty', event: { type: 'pulseEmpty' } },
  { label: 'pulseBlock', event: { type: 'pulseBlock', x: 30, y: 2 } },
  { label: 'reveal', event: { type: 'reveal', ids: ['seam1'] } },
  { label: 'shield', event: { type: 'shield', x: X, y: 0 } },
  { label: 'damage', event: { type: 'damage', x: X, y: 0, cause: 'beam' } },
  { label: 'crush', event: { type: 'crush', x: 71.5, y: 0 } },
  { label: 'shutdown', event: { type: 'shutdown', cause: 'fall' } },
  { label: 'reboot', event: { type: 'reboot', stationId: 'st0', x: 1.5, y: 0 } },
  { label: 'cellPickup', event: { type: 'cellPickup', id: 'c1' } },
  { label: 'cellDrop', event: { type: 'cellDrop', id: 'c1', x: 6, y: 0 } },
  { label: 'cellInsert', event: { type: 'cellInsert', id: 'c1', socketId: 's1' } },
  { label: 'cellRemove', event: { type: 'cellRemove', id: 'c1', socketId: 's1' } },
  { label: 'cellReject', event: { type: 'cellReject' } },
  { label: 'socketPower on', event: { type: 'socketPower', id: 's1', on: true } },
  { label: 'socketPower off', event: { type: 'socketPower', id: 's1', on: false } },
  { label: 'shutterStop', event: { type: 'shutterStop', id: 'shut1', open: false }, moving: 'shut1' },
  { label: 'liftStop', event: { type: 'liftStop', id: 'lift1' }, moving: 'lift1' },
  { label: 'switch', event: { type: 'switch', id: 'sw1', x: 62, y: 1 } },
  { label: 'vent warning', event: { type: 'vent', id: 'v1', stage: 'warning', x: 60, y: 0 } },
  { label: 'vent active', event: { type: 'vent', id: 'v1', stage: 'active', x: 60, y: 0 } },
  { label: 'vent active for 5 s', event: { type: 'vent', id: 'v1', stage: 'active', x: 60, y: 0 }, vent: 5 },
  { label: 'press warn', event: { type: 'press', id: 'press1', stage: 'warn' } },
  { label: 'press drop', event: { type: 'press', id: 'press1', stage: 'drop' } },
  { label: 'relay', event: { type: 'relay', id: 'A', x: 30, y: 2, lookAt: { x: 40, y: 0 } } },
  { label: 'relayUnpowered', event: { type: 'relayUnpowered', id: 'A' } },
  { label: 'station', event: { type: 'station', id: 'st0', x: 1.5, y: 0 } },
  { label: 'archive', event: { type: 'archive', id: 'A', title: 't', text: 'x' } },
  { label: 'cache', event: { type: 'cache', id: 'k1', gained: 25 } },
  ...['board', 'barrier', 'rise', 'surface', 'terrace'].map((stage) => ({ label: `liftSequence ${stage}`, event: { type: 'liftSequence', stage } })),
  { label: 'complete', event: { type: 'complete', result: {} }, music: true, mode: 'complete' },
  ...['skitter', 'drone', 'sentinel'].map((kind) => ({ label: `enemyAttack ${kind}`, event: { type: 'enemyAttack', kind, id: 'e1', x: 30, y: 2 } })),
  { label: 'boltHit', event: { type: 'boltHit', x: 30, y: 2 } },
  { label: 'skitter alert', event: { type: 'enemyState', kind: 'skitter', id: 'e1', state: 'alert', x: 30, y: 2 } },
  { label: 'drone aim', event: { type: 'enemyState', kind: 'drone', id: 'e2', state: 'aim', x: 30, y: 3 } },
  { label: 'sentinel warning', event: { type: 'enemyState', kind: 'sentinel', id: 'e3', state: 'warning', x: 30, y: 2 } },
  { label: 'enemy stunned', event: { type: 'enemyState', kind: 'skitter', id: 'e1', state: 'stunned', x: 30, y: 2 } },
  { label: 'enemy disabled', event: { type: 'enemyState', kind: 'drone', id: 'e2', state: 'disabled', x: 30, y: 3 } },
];

/** Events that stay silent on purpose: the event, and why. */
const SILENT = [
  [{ type: 'vent', id: 'v1', stage: 'dormant', x: 60, y: 0 }, 'the jet falling silent is the cue'],
  [{ type: 'press', id: 'press1', stage: 'rise' }, 'rising is the safe phase; the slam ended the drop'],
  ...['dormant', 'patrol', 'recover'].map((state) => [{ type: 'enemyState', kind: 'skitter', id: 'e1', state, x: 30, y: 0 }, 'a resting machine needs no cue']),
  [{ type: 'enemyState', kind: 'drone', id: 'e2', state: 'cooldown', x: 30, y: 3 }, 'a resting machine needs no cue'],
  ...['closed', 'venting'].map((state) => [{ type: 'enemyState', kind: 'sentinel', id: 'e3', state, x: 30, y: 2 }, 'a resting machine needs no cue']),
  ...[['skitter', 'lunge'], ['drone', 'fire'], ['sentinel', 'firing']].map(([kind, state]) => [{ type: 'enemyState', kind, id: 'e1', state, x: 30, y: 2 }, 'the enemyAttack event carries the attack']),
];

/** Play one row of the table: its event, with the world state its sound reads. */
function playRow(r, row) {
  const mover = row.moving === undefined ? undefined : r.world.movers.find((m) => m.id === row.moving) ?? addLift(r.world);
  const was = mover && { moving: mover.moving, powered: mover.powered };
  r.world.mode = row.mode ?? 'play';
  if (row.vent !== undefined) addVent(r.world, 60).active = row.vent;
  if (mover !== undefined) {
    // The mover has moved for a frame already: a hum starts on the second frame of motion.
    Object.assign(mover, { moving: true, powered: true });
    r.emit([]);
  }
  const sources = r.emit([row.event]);
  r.world.mode = 'play';
  if (mover !== undefined) Object.assign(mover, was);
  return sources;
}

// --- Without a context ---

test('Without Web Audio: import is safe, nothing is created and every method is a no-op', () => {
  assert.equal(globalThis.AudioContext, undefined);
  const sound = createAudio();
  const world = open();
  assert.doesNotThrow(() => {
    sound.sync(world, FRAME, [{ type: 'pulse' }]);
    sound.unlock();
    sound.sync(world, FRAME, [{ type: 'pulse' }]);
    sound.setMuted(true);
  });
  assert.equal(sound.muted, true);
  sound.setMuted(false);
  sound.dispose();
  sound.sync(world, FRAME, [{ type: 'step', x: 5, y: 0, surface: 'rock' }]);
  assert.equal(sound.muted, false);
});

test('Nothing exists before unlock; two unlocks share one context, its buses, and a mute set earlier', async (t) => {
  const rec = install();
  t.after(() => rec.uninstall());
  const sound = createAudio();
  const world = open();
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  sound.setMuted(true);
  assert.equal(rec.contexts.length, 0);
  assert.equal(sound.muted, true);
  sound.unlock();
  sound.unlock();
  await settle();
  assert.equal(rec.contexts.length, 1);
  const [ctx] = rec.contexts;
  assert.equal(ctx.state, 'running');
  const [compressor] = ctx.destination.inputs;
  const [master] = compressor.inputs;
  assert.deepEqual(master.inputs.map((node) => node.kind), ['gain', 'gain']);
  assert.equal(master.gain.value, 0, 'the context opens muted');
  sound.setMuted(false);
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  const started = sourcesOf(ctx);
  const [fx, music] = master.inputs;
  assert.ok(busOf(started[0]) === fx && busOf(started[1]) === fx, 'the pulse goes to the effects bus');
  for (const source of started.slice(2)) {
    assert.ok(busOf(source) === music || busOf(source) === fx, 'a source that skips both buses');
    assert.ok(reachesDestination(source), 'a source that never reaches the destination');
  }
  assert.ok(compressor.inputs.length === 1 && compressor.inputs[0] === master, 'mute covers every sound: the master is the only way out');
});

test('Mute ramps the master gain to 0 within 0.05 s and back to 1', (t) => {
  const r = rig(t);
  r.sound.setMuted(true);
  assert.equal(r.sound.muted, true);
  const down = lastRamp(r.master.gain);
  assert.deepEqual([down.value, down.at, down.time], [0, r.ctx.currentTime, r.ctx.currentTime + 0.05]);
  r.rec.tick(1);
  r.sound.setMuted(false);
  assert.equal(r.sound.muted, false);
  const up = lastRamp(r.master.gain);
  assert.deepEqual([up.value, up.at, up.time], [1, r.ctx.currentTime, r.ctx.currentTime + 0.05]);
  r.sound.setMuted('yes');
  assert.equal(r.sound.muted, true);
  r.sound.setMuted(undefined);
  assert.equal(r.sound.muted, false);
});

// --- Effects ---

test('Every §3.14 event has its sound, or is silent by design', (t) => {
  const r = rig(t);
  assert.deepEqual(new Set([...ROWS.map((row) => row.event.type), ...SILENT.map(([event]) => event.type)]), new Set(NAMES));
  for (const row of ROWS) {
    const sources = playRow(r, row);
    const heard = voices(sources, row.music === true ? r.music : r.fx);
    assert.ok(heard.length >= 1, `${row.label} is silent`);
    for (const source of heard) assert.ok(peakOf(source) > 0 && peakOf(source) <= 1, `${row.label}: a voice outside 0..1`);
  }
  for (const [event, reason] of SILENT) {
    const name = `${event.type} ${event.stage ?? event.state ?? ''}`.trim();
    assert.ok(voices(r.emit([event]), r.fx).length === 0, `${name} should stay silent: ${reason}`);
  }
});

test('Every source gets a stop within 3 s of its start and is disconnected once ended', (t) => {
  const r = rig(t);
  for (const row of ROWS) playRow(r, row);
  const all = sourcesOf(r.ctx);
  const nodes = all.map(ownNodes);
  const oneShots = all.filter(isOneShot);
  assert.ok(oneShots.length >= 100, `only ${oneShots.length} one-shots`);
  for (const source of all) {
    const start = startOf(source).args[0];
    const stop = stopOf(source);
    assert.ok(stop !== undefined, `a source started at ${start} never got a stop`);
    assert.ok(stop.args[0] > start && stop.args[0] - start <= MAX_LIFE + EPSILON, `a source lives from ${start} to ${stop.args[0]}`);
  }
  for (const source of all.filter((source) => !isOneShot(source))) {
    assert.ok(stopOf(source).time > startOf(source).time, 'a loop that outlived its cause was never stopped');
  }
  // Automations play in the order they are dated; a cancel may come earlier and starts the order again.
  for (const node of nodes.flat()) {
    for (const value of Object.values(node)) {
      if (value?.calls === undefined || value === node.context) continue; // the parameters, not their context
      let until = -Infinity;
      for (const { name, args } of value.calls) {
        if (name === 'cancelAndHoldAtTime') until = args[0];
        else if (name === 'cancelScheduledValues') until = Math.min(until, args[0]);
        else {
          assert.ok(args[1] >= until, `a ${node.kind} automation is dated before an earlier one`);
          until = args[1];
        }
      }
    }
  }
  r.rec.tick(5);
  assert.ok(all.every((source) => source.ended), 'a source whose stop time passed did not end');
  for (const chain of nodes) {
    for (const node of chain) assert.ok(node.outputs.length === 0, `a ${node.kind} stayed connected after its voice ended`);
  }
});

// --- Effects in play ---

test('Footsteps differ by surface, in play as in the table', (t) => {
  const r = rig(t);
  const prints = new Map(['rock', 'metal', 'platform', 'cell'].map((surface) => [
    surface,
    r.prints({ type: 'step', x: r.world.player.x, y: r.world.player.y, surface }),
  ]));
  for (const [a, pa] of prints) {
    for (const [b, pb] of prints) if (a !== b) assert.notDeepEqual(pa, pb, `${a} and ${b} footsteps sound alike`);
  }
  /** Walk right from `spot` for `seconds`; the prints of the frames that played footsteps and nothing else. */
  const walk = (spot, seconds) => {
    placePlayer(r.world, ...spot);
    const heardBy = new Map();
    for (let i = 0; i < Math.round(seconds / FRAME); i += 1) {
      const { events, sources } = r.frame(held({ right: true }));
      if (events.length > 0 && events.every((event) => event.type === 'step')) {
        for (const event of events) heardBy.set(event.surface, timbre(voices(sources, r.fx)));
      }
    }
    return heardBy;
  };
  const rock = walk(SPOTS.floor, 1);
  const metal = walk([9.6, 3], 0.4); // on top of the fixture's metal ceiling block
  assert.deepEqual(rock.get('rock'), prints.get('rock'));
  assert.deepEqual(metal.get('metal'), prints.get('metal'));
  assert.equal(rock.has('metal'), false);
  assert.equal(metal.has('rock'), false);
});

test('Takeoff and landing follow the event: a wall jump differs, a landing weighs its speed', (t) => {
  const r = rig(t);
  const takeoff = r.prints({ type: 'jump', x: X, y: 0, wall: 0 });
  assert.ok(takeoff.length >= 2);
  assert.notDeepEqual(takeoff, r.prints({ type: 'jump', x: 36.4, y: 3, wall: 1 }));
  const thud = (speed) => peakOf(voices(r.emit([{ type: 'land', x: X, y: 0, speed, surface: 'rock' }]), r.fx)[0]);
  near(thud(24), 0.35);
  near(thud(12), 0.175);
  near(thud(2), 0.35 * 0.3, 1e-9);

  // In play: a jump from the floor, then a landing after a fall of 3 units.
  const played = heard(r, 70, (i) => held({ jump: i < 8, jumpPressed: i === 0 }));
  placePlayer(r.world, X, 3);
  played.push(...heard(r, 60));
  assert.deepEqual([...new Set(types(played.map((entry) => entry.event)))], ['jump', 'land']);
  assertSoundsAsReplay(played, r, 'jump and fall');
  assert.ok(includes(played.find(({ event }) => event.type === 'jump').prints, takeoff));
  for (const { event, first } of played.filter(({ event }) => event.type === 'land')) {
    near(peakOf(first), 0.35 * Math.min(1, Math.max(0.3, event.speed / 24)), 1e-9);
  }
});

test('A dash, its stop at a wall and the seam it breaks sound in play as in the table', (t) => {
  const r = rig(t);
  placePlayer(r.world, 49.3, 0); // close enough to the thin wall for the dash to end at it
  const intoWall = heard(r, 30, (i) => held({ right: true, dashPressed: i === 3 }));
  assert.deepEqual(names(intoWall, 'dash'), ['dash', 'dashStop']);
  assertSoundsAsReplay(intoWall, r, 'dash into a wall');
  placePlayer(r.world, ...SPOTS.beforeSeam);
  const throughSeam = heard(r, 40, (i) => held({ right: true, dashPressed: i === 3 }));
  assert.deepEqual(names(throughSeam, 'dash', 'seam'), ['dash', 'seamBreak']);
  assertSoundsAsReplay(throughSeam, r, 'dash through a seam');
});

test('The echo pulse, its dry fire and the reveal of a seam sound in play as in the table', (t) => {
  const r = rig(t, 'beforeSeam');
  const full = heard(r, 50, (i) => held({ pulsePressed: i === 0 }));
  assert.deepEqual(types(full.map((entry) => entry.event)), ['pulse', 'reveal']);
  assertSoundsAsReplay(full, r, 'pulse at a seam');
  r.world.player.energy = 0;
  const dry = heard(r, 20, (i) => held({ pulsePressed: i === 0 }));
  assert.deepEqual(types(dry.map((entry) => entry.event)), ['pulseEmpty']);
  const cue = voices(r.emit([{ type: 'pulseEmpty' }]), r.fx);
  assert.equal(cue.length, 1, 'one quiet cue');
  assert.ok(peakOf(cue[0]) > 0 && peakOf(cue[0]) <= 0.15, `the cue peaks at ${peakOf(cue[0])}`);
});

test('A sound with a position is panned toward it, at most 0.7, and softens with distance', (t) => {
  const r = rig(t);
  const at = (dx) => voices(r.emit([{ type: 'pulseBlock', x: r.world.player.x + dx, y: 2 }]), r.fx)[0];
  near(panOf(at(0)), 0);
  near(panOf(at(7)), 0.35);
  near(panOf(at(-7)), -0.35);
  near(panOf(at(14)), 0.7);
  near(panOf(at(40)), 0.7, 1e-9, 'capped beyond the screen edge');
  near(peakOf(at(0)) / peakOf(at(8)), 2);
  assert.ok(peakOf(at(30)) < peakOf(at(8)), 'a far sound is not softer than a near one');
  // An event without a position sounds where ILO stands.
  near(panOf(voices(r.emit([{ type: 'pulseEmpty' }]), r.fx)[0]), 0);
  near(panOf(voices(r.emit([{ type: 'cellDrop', id: 'c1', x: r.world.player.x - 10, y: 0 }]), r.fx)[0]), -0.5);
});

test('Every telegraph sounds at least 6 dB above the music bus', (t) => {
  const r = rig(t);
  const level = lastRamp(r.music.gain).value;
  assert.ok(level > 0);
  const cues = [
    { type: 'vent', id: 'v1', stage: 'warning', x: 40, y: 0 },
    { type: 'press', id: 'press1', stage: 'warn' },
    { type: 'enemyState', kind: 'skitter', id: 'e1', state: 'alert', x: 40, y: 0 },
    { type: 'enemyState', kind: 'drone', id: 'e2', state: 'aim', x: 40, y: 3 },
    { type: 'enemyState', kind: 'sentinel', id: 'e3', state: 'warning', x: 40, y: 2 },
  ];
  for (const event of cues) {
    const peaks = voices(r.emit([event]), r.fx).map(peakOf);
    const lead = Math.max(...peaks);
    assert.ok(lead >= 2 * level - EPSILON, `${event.type} ${event.stage ?? event.state} leads at ${lead} against music ${level}`);
  }
});

test('ILO sliding down a wall: one scrape loop, started once and stopped once', (t) => {
  const r = rig(t, 'shaftAir');
  const scrapes = [];
  for (let i = 0; i < 150; i += 1) scrapes.push(...loopVoices(r.frame(held({ right: true })).sources, 1500, 0.8));
  assert.equal(scrapes.length, 1, 'one scrape loop for one slide');
  const [scrape] = scrapes;
  assert.equal(scrape.calls.filter((call) => call.name === 'stop').length, 1, 'one stop');
  assert.ok(stopOf(scrape).time > startOf(scrape).time, 'stopped after the slide, not with its start');
  assert.equal(r.world.player.sliding, false, 'ILO still slides');
});

/** The loop sources of the context whose filter sits at `freq` with quality `q`; each stopped exactly once, after its start. */
function humsStopped(ctx, freq, q) {
  const loops = loopVoices(sourcesOf(ctx), freq, q);
  for (const loop of loops) {
    assert.equal(loop.calls.filter((call) => call.name === 'stop').length, 1, 'a hum stopped twice');
    assert.ok(stopOf(loop).time > startOf(loop).time, 'a hum stopped with its start');
  }
  return loops.length;
}

test('Machinery: a shutter and a lift hum while they move, one loop per move, and a vent hisses through its cycle', (t) => {
  const r = rig(t, 'beforeShutter');
  const shutter = r.world.movers.find((m) => m.id === 'shut1');
  const power = (on) => {
    r.world.switches.find((s) => s.id === 'sw1').on = on;
    shutter.powered = on;
  };
  power(true);
  const opening = heard(r, 60);
  power(false);
  const closing = heard(r, 60);
  for (const run of [opening, closing]) assert.deepEqual(names(run, 'shutter'), ['shutterStop']);
  assertSoundsAsReplay([...opening, ...closing], r, 'shutter');
  assert.equal(humsStopped(r.ctx, 320, 2), 2, 'one hum per shutter move');

  addLift(r.world);
  const riding = heard(r, 100);
  assert.deepEqual(names(riding, 'lift'), ['liftStop']);
  assertSoundsAsReplay(riding, r, 'lift');
  assert.equal(humsStopped(r.ctx, 170, 1), 1, 'one lift hum, its rumble');
  assert.equal(humsStopped(r.ctx, 200, 1), 1, 'one lift hum, its drone');

  addVent(r.world, 58);
  const cycle = heard(r, 300).filter(({ event }) => event.type === 'vent');
  assert.deepEqual(cycle.map(({ event }) => event.stage), ['warning', 'active', 'dormant']);
  assertSoundsAsReplay(cycle, r, 'vent');
});

test('A beam over ILO: two shields, then damage; each sounds in play as in the table', (t) => {
  const r = rig(t);
  beam(r.world, X, X + 4);
  const hits = heard(r, 200).filter(({ event }) => event.type === 'shield' || event.type === 'damage');
  assert.deepEqual(types(hits.map((entry) => entry.event)), ['shield', 'shield', 'damage']);
  assertSoundsAsReplay(hits, r, 'beam');
});

test('A press that crushes ILO: the slam, the shutdown and the reboot sound in play as in the table', (t) => {
  const r = rig(t, 'underPress');
  const crushed = heard(r, 300);
  assert.deepEqual(names(crushed, 'crush', 'shutdown', 'reboot'), ['crush', 'shutdown', 'reboot']);
  assertSoundsAsReplay(crushed, r, 'press crush');
});

// --- Music ---

/** The notes among `sources` that play on an arrangement's track: that track, when the note starts and its print. */
const notesOf = (sources, music) => voices(sources, music).filter((note) => chainOf(note).at(-1).kind === 'gain').map((note) => {
  const at = startOf(note).args[0];
  near((at / TICK) % 1, 0, 1e-6); // every note sits on the grid
  return { track: chainOf(note).at(-1), at, print: timbre([note])[0] };
});

test('Music is scheduled at most 0.25 s ahead, on a half-second grid', (t) => {
  const r = rig(t);
  for (let i = 0; i < 240; i += 1) {
    const now = r.ctx.currentTime;
    for (const { at } of notesOf(r.emit([]), r.music)) {
      assert.ok(at >= now - EPSILON && at <= now + LOOKAHEAD + EPSILON, `a note at ${at} with the clock at ${now}`);
    }
  }
});

test('A paused world schedules no notes and fades the music out; on resume the music goes on from now, with no backlog', (t) => {
  const r = rig(t);
  r.emit([]);
  const level = lastRamp(r.music.gain).value;
  assert.ok(level > 0);
  r.world.paused = true;
  r.emit([]);
  const out = lastRamp(r.music.gain);
  assert.deepEqual([out.value, out.time - out.at], [0, 0.2]);
  r.rec.tick(30); // half a minute away
  assert.equal(notesOf(r.emit([]), r.music).length, 0, 'a note was scheduled while paused');
  r.world.paused = false;
  const now = r.ctx.currentTime;
  const notes = [];
  for (let i = 0; i < 40 && notes.length === 0; i += 1) notes.push(...notesOf(r.emit([]), r.music));
  assert.ok(notes.length >= 1, 'no note within 0.6 s after the resume');
  for (const { at } of notes) assert.ok(at >= now - EPSILON, `a note starts at ${at}, before the resume at ${now}`);
  assert.deepEqual([lastRamp(r.music.gain).value, lastRamp(r.music.gain).at], [level, now]);
});

test('A long run schedules a bounded number of notes per second', (t) => {
  const r = rig(t);
  let notes = 0;
  let busiest = 0;
  for (let i = 0; i < 1200; i += 1) { // 20 seconds
    const count = notesOf(r.emit([]), r.music).length;
    notes += count;
    busiest = Math.max(busiest, count);
  }
  assert.ok(notes >= 20 && notes <= 32, `${notes} notes in 20 seconds`);
  assert.ok(busiest <= 4, `${busiest} notes in one frame`);
});

test('A region change crossfades the music over 1.5 s, keeps the beat and changes the material', (t) => {
  const regions = [
    { id: 'workshop', name: 'Buried Workshop', x0: 0, x1: 40 },
    { id: 'reservoir', name: 'Crystal Reservoir', x0: 40, x1: 80 },
  ];
  const r = rig(t, 'floor', { level: { ...LEVEL, regions } });
  const notes = [];
  const collect = (sources) => notes.push(...notesOf(sources, r.music));
  collect(r.emit([]));
  placePlayer(r.world, 39.5, 0);
  let crossed;
  for (let i = 0; i < 60 && r.world.regionId !== 'reservoir'; i += 1) crossed = r.frame(held({ right: true }));
  assert.equal(r.world.regionId, 'reservoir');
  collect(crossed.sources);
  assert.equal(r.music.inputs.length, 2, 'the new region got no track of its own');
  const [workshop, reservoir] = r.music.inputs;
  const out = lastRamp(workshop.gain);
  const into = lastRamp(reservoir.gain);
  assert.deepEqual([out.value, out.time - out.at], [0, FADE]);
  assert.deepEqual([into.value, into.time - into.at], [1, FADE]);
  for (let i = 0; i < 300; i += 1) collect(r.emit([])); // 5 seconds, just across the border
  const during = notes.filter((note) => note.at >= out.at && note.at < out.at + FADE);
  assert.ok(during.some((note) => note.track === workshop) && during.some((note) => note.track === reservoir),
    'no crossfade: the two arrangements did not overlap');
  const after = notes.filter((note) => note.at >= out.at + FADE + TICK);
  assert.ok(after.length >= 2 && after.every((note) => note.track === reservoir), 'the old arrangement played on after the fade');
  const before = new Set(notes.filter((note) => note.track === workshop).map((note) => note.print));
  assert.ok(after.some((note) => !before.has(note.print)), 'the new region plays the same material as the old one');
});

test('The lift sequence swaps to the ascent arrangement, hums while it rises and ends on the quiet resolution chord', (t) => {
  const r = rig(t, 'floor');
  const workshop = r.music.inputs[0];
  // Three lit relays make the console answer a robot that stands in the boarding area with free hands.
  for (const id of ['A', 'B', 'C']) {
    r.world.relays.push({ id, x: 10, y: 2, active: true, socket: null, lookAt: { x: 20, y: 0 }, station: 'st0' });
  }
  placePlayer(r.world, 76, 0);
  const notes = [];
  const stages = [];
  const hums = [];
  let frame = r.emit([]);
  for (let i = 0; r.world.mode !== 'complete'; i += 1) {
    assert.ok(i < 800, `the lift did not finish: mode ${r.world.mode}, stage ${r.world.ascent.stage}`);
    frame = r.frame(held({ interactPressed: i === 5 }));
    for (const event of frame.events) if (event.type === 'liftSequence') stages.push(event.stage);
    hums.push(...loopVoices(frame.sources, 220, 1));
    notes.push(...notesOf(frame.sources, r.music).map((note) => ({ ...note, stage: r.world.ascent.stage })));
  }
  assert.deepEqual(stages, ['board', 'barrier', 'rise', 'surface', 'terrace']);
  const ride = notes.filter((note) => note.stage === 'rise');
  const ascent = ride[0].track;
  assert.notEqual(ascent, workshop);
  assert.equal(first(ascent.gain, 'linearRampToValueAtTime').args[0], 1, 'the ascent track never faded in');
  assert.equal(lastRamp(workshop.gain).value, 0, 'the workshop track never faded out');
  const before = new Set(notes.filter((note) => note.track === workshop).map((note) => note.print));
  assert.ok(ride.some((note) => !before.has(note.print)), 'the ascent arrangement repeats the workshop material');
  assert.equal(hums.length, 1, 'one hum for the rise');
  assert.equal(hums[0].calls.filter((call) => call.name === 'stop').length, 1, 'one stop');
  assert.ok(stopOf(hums[0]).time > startOf(hums[0]).time, 'the hum stopped with its start');

  // The chord goes straight to the music bus; no track sits between.
  const chord = voices(frame.sources, r.music).filter((note) => chainOf(note).at(-1).kind === 'panner');
  assert.ok(chord.length >= 3, `a chord of ${chord.length} voices`);
  assert.equal(new Set(chord.map(freqOf)).size, chord.length, 'two voices of the chord share a pitch');
  for (const note of chord) {
    assert.ok(peakOf(note) <= 0.12, `a resolution voice peaks at ${peakOf(note)}`);
    near(stopOf(note).args[0] - startOf(note).args[0], MAX_LIFE);
  }
  const end = lastRamp(ascent.gain).at;
  for (let i = 0; i < 150; i += 1) notes.push(...notesOf(r.emit([]), r.music)); // 2.5 seconds in `complete`
  assert.equal(notes.filter((note) => note.at >= end + FADE + TICK).length, 0, 'music played on after the expedition ended');
});

// --- Hidden pages, blocked and failing contexts ---

test('A hidden page silences the music at once, without a frame, and schedules nothing until it is visible again', async (t) => {
  const handlers = {};
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const page = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { handlers[type] = fn; },
    removeEventListener: (type) => { delete handlers[type]; },
  };
  globalThis.document = page;
  t.after(() => {
    if (had === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', had);
  });
  const r = rig(t, 'floor', { closed: true });
  r.world.player.sliding = true;
  r.emit([]);
  const [scrape] = sourcesOf(r.ctx).filter((source) => !isOneShot(source));
  assert.ok(scrape !== undefined, 'no scrape loop to silence');
  const level = lastRamp(r.music.gain).value;
  page.visibilityState = 'hidden';
  handlers.visibilitychange(); // no frame follows a hidden page
  const out = lastRamp(r.music.gain);
  assert.deepEqual([out.value, out.time - out.at], [0, 0.2]);
  assert.ok(stopOf(scrape) !== undefined && stopOf(scrape).time > startOf(scrape).time, 'the scrape played on');
  r.rec.tick(30);
  assert.equal(notesOf(r.emit([]), r.music).length, 0, 'a note was scheduled while hidden'); // a frame that still arrives
  page.visibilityState = 'visible';
  r.world.player.sliding = false;
  const now = r.ctx.currentTime;
  const notes = [];
  for (let i = 0; i < 40 && notes.length === 0; i += 1) notes.push(...notesOf(r.emit([]), r.music));
  assert.ok(notes.length >= 1, 'no note once visible');
  for (const { at } of notes) assert.ok(at >= now - EPSILON, `a note starts at ${at}, before the page came back at ${now}`);
  assert.deepEqual([lastRamp(r.music.gain).value, lastRamp(r.music.gain).at], [level, now]);
  r.sound.dispose();
  await settle();
  assert.equal(r.ctx.state, 'closed');
  assert.equal(handlers.visibilitychange, undefined, 'the page listener stayed behind');
});

test('A context the browser keeps suspended schedules nothing, reports nothing and makes no backlog once it runs', async (t) => {
  const rec = install();
  t.after(() => rec.uninstall());
  const said = quiet(t);
  let allowed = false; // the browser keeps autoplay blocked until a gesture it accepts
  class Blocked extends rec.AudioContext {
    resume() {
      return allowed ? super.resume() : Promise.reject(new DOMException('The AudioContext was not allowed to start', 'NotAllowedError'));
    }
  }
  globalThis.AudioContext = Blocked;
  const sound = createAudio();
  const world = open();
  sound.unlock();
  await settle();
  const [ctx] = rec.contexts;
  assert.equal(ctx.state, 'suspended');
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  rec.tick(30);
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  assert.equal(sourcesOf(ctx).length, 0, 'a suspended context scheduled a sound');
  assert.deepEqual(said, [], 'a blocked context is no failure');
  // A gesture goes through at last: one pulse sounds, nothing from the waiting.
  allowed = true;
  sound.unlock();
  assert.equal(ctx.state, 'running');
  assert.equal(rec.contexts.length, 1);
  const now = ctx.currentTime;
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  const started = sourcesOf(ctx);
  for (const source of started) assert.ok(startOf(source).args[0] >= now - EPSILON, 'a backlog played after the resume');
  const [fx] = ctx.destination.inputs[0].inputs[0].inputs;
  assert.equal(voices(started, fx).length, 2, 'one pulse, not three');
});

test('An AudioContext that cannot be built is reported, released, and every method stays a no-op until the next unlock', async (t) => {
  const rec = install();
  t.after(() => rec.uninstall());
  const said = quiet(t);
  class NoGain extends rec.AudioContext {
    createGain() {
      throw new DOMException('Cannot create a GainNode', 'NotSupportedError');
    }
  }
  globalThis.AudioContext = NoGain;
  const sound = createAudio();
  const world = open();
  sound.unlock();
  assert.equal(said.length, 1, 'the failure went unreported');
  assert.match(said[0].join(' '), /DEEPWAKE audio stopped/);
  await settle();
  assert.equal(rec.contexts[0].state, 'closed');
  assert.doesNotThrow(() => {
    sound.sync(world, FRAME, [{ type: 'pulse' }]);
    sound.setMuted(true);
    sound.dispose();
  });
  assert.equal(sound.muted, true);
  assert.equal(sourcesOf(rec.contexts[0]).length, 0);
  // The next gesture opens a healthy context, and the sound is back.
  globalThis.AudioContext = rec.AudioContext;
  sound.unlock();
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  assert.equal(rec.contexts.length, 2);
  assert.ok(sourcesOf(rec.contexts[1]).length >= 3, 'the sound did not come back');
});

test('An AudioContext that throws in play goes silent, is reported once, and the next gesture brings the sound back', async (t) => {
  const rec = install();
  t.after(() => rec.uninstall());
  const said = quiet(t);
  let broken = false;
  class Fragile extends rec.AudioContext {
    createOscillator() {
      if (broken) throw new Error('out of memory');
      return super.createOscillator();
    }
  }
  globalThis.AudioContext = Fragile;
  const sound = createAudio();
  const world = open();
  sound.unlock();
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  const [ctx] = rec.contexts;
  const before = sourcesOf(ctx).length;
  assert.ok(before >= 3);
  broken = true;
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  broken = false;
  assert.equal(said.length, 1, 'the failure went unreported');
  await settle();
  assert.equal(ctx.state, 'closed');
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  assert.equal(sourcesOf(ctx).length, before, 'a closed context scheduled a sound');
  assert.equal(said.length, 1, 'reported again');
  sound.unlock();
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  assert.equal(rec.contexts.length, 2);
  assert.ok(sourcesOf(rec.contexts[1]).length >= 3, 'the sound did not come back');
});

test('dispose closes the context and makes every method a no-op until the next unlock', async (t) => {
  const rec = install();
  t.after(() => rec.uninstall());
  const sound = createAudio();
  const world = open();
  sound.unlock();
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  const [ctx] = rec.contexts;
  const before = sourcesOf(ctx).length;
  sound.dispose();
  sound.dispose();
  await settle();
  assert.equal(ctx.state, 'closed');
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  assert.equal(sourcesOf(ctx).length, before);
  sound.setMuted(true);
  assert.equal(sound.muted, true);
  sound.unlock();
  sound.sync(world, FRAME, [{ type: 'pulse' }]);
  assert.equal(rec.contexts.length, 2);
  assert.ok(sourcesOf(rec.contexts[1]).length >= 3, 'the sound did not come back');
});
