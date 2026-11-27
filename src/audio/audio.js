// DEEPWAKE audio (contract §5.2, GOAL §18): synthesized effects and procedural music in Web Audio.
// Nothing exists until `unlock()` runs inside a user gesture; without a usable AudioContext every method
// is a no-op.

const LOOKAHEAD = 0.25; // seconds of music scheduled ahead, never more
const MAX_LIFE = 3; // seconds a sound lasts at most
const TICK = 0.5; // seconds between two steps of the music grid
const STEPS = 16; // steps in one music loop
const FADE = 1.5; // seconds of a music crossfade
const MUSIC_LEVEL = 0.25; // music bus gain
const TELEGRAPH = 2 * MUSIC_LEVEL; // peak of the lead voice of every danger cue: 6 dB above the music bus gain
const RESUME_FADE = 0.6; // seconds of the music fade after a pause
const PAUSE_FADE = 0.2; // seconds of the music fade into a pause
const MUTE_TIME = 0.05; // seconds of a mute ramp
const LOOP_FADE = 0.08; // seconds of a loop's release
const REACH = 14; // units from ILO to the screen edge: full pan there
const NEAR = 8; // units at which a sound is half as loud
const PAN = 0.7;
const FLOOR = 0.0001; // silence for exponential ramps, which never reach 0

// A voice: `wave` (an oscillator type or noise) at `freq`, gliding to `to`; an optional `filter`
// [type, frequency, Q], gliding to `filterTo`; its life `dur`, its `peak`, the `attack`, a `hold` at full
// level, an `offset` from now and a `pan`.

// --- Effects ---

const STEP = {
  rock: [
    { wave: 'noise', filter: ['lowpass', 380, 0.7], dur: 0.08, peak: 0.2 },
    { wave: 'sine', freq: 95, to: 60, dur: 0.07, peak: 0.1 },
  ],
  metal: [
    { wave: 'noise', filter: ['bandpass', 2100, 4], dur: 0.12, peak: 0.14 },
    { wave: 'sine', freq: 580, to: 520, dur: 0.16, peak: 0.08 },
  ],
  platform: [
    { wave: 'noise', filter: ['bandpass', 800, 1.2], dur: 0.09, peak: 0.16 },
    { wave: 'sine', freq: 150, to: 110, dur: 0.06, peak: 0.1 },
  ],
  cell: [
    { wave: 'noise', filter: ['highpass', 4000, 1], dur: 0.04, peak: 0.08 },
    { wave: 'sine', freq: 1500, to: 1300, dur: 0.09, peak: 0.1 },
  ],
};
const CLICK = { wave: 'noise', filter: ['bandpass', 2600, 5], dur: 0.05, peak: 0.25 };
const THUD = { wave: 'sine', freq: 130, to: 60, dur: 0.16, peak: 0.4 };
const CLANK = { wave: 'noise', filter: ['bandpass', 2200, 4], dur: 0.08, peak: TELEGRAPH };
const POWER_ON = [
  { wave: 'sine', freq: 520, to: 780, dur: 0.3, peak: 0.18 },
  { wave: 'sine', freq: 1560, dur: 0.4, peak: 0.06 },
];
const POWER_OFF = [{ wave: 'sine', freq: 640, to: 320, dur: 0.25, peak: 0.15 }];
const TAKEOFF = [
  { wave: 'sine', freq: 170, to: 330, dur: 0.16, peak: 0.18 },
  { wave: 'noise', filter: ['lowpass', 900, 1], dur: 0.06, peak: 0.06 },
];
const WALL_JUMP = [
  { wave: 'noise', filter: ['bandpass', 1500, 1], dur: 0.12, peak: 0.2 },
  { wave: 'sine', freq: 220, to: 420, dur: 0.14, peak: 0.16 },
];
const SHATTER = [
  { wave: 'noise', filter: ['highpass', 3000, 1], dur: 0.3, peak: 0.4 },
  { wave: 'sine', freq: 2300, dur: 0.3, peak: 0.15 },
  { wave: 'sine', freq: 3100, dur: 0.25, peak: 0.12, offset: 0.03 },
  { wave: 'sine', freq: 4100, dur: 0.2, peak: 0.1, offset: 0.07 },
];
const SEAT = [
  { wave: 'sine', freq: 140, to: 70, dur: 0.12, peak: 0.35 },
  { wave: 'noise', filter: ['lowpass', 900, 1], dur: 0.08, peak: 0.25 },
];
const POWER_DOWN = [
  { wave: 'sawtooth', freq: 400, to: 45, dur: 0.9, peak: 0.3, filter: ['lowpass', 1500, 1] },
  { wave: 'sine', freq: 240, to: 30, dur: 0.9, peak: 0.2 },
];
const ALERT = [
  { wave: 'noise', filter: ['bandpass', 3000, 5], dur: 0.08, peak: TELEGRAPH },
  { wave: 'triangle', freq: 520, to: 1040, dur: 0.22, peak: TELEGRAPH, filter: ['lowpass', 2500, 1] },
];
const AIM = [{ wave: 'sine', freq: 1100, to: 1650, dur: 0.8, peak: TELEGRAPH, attack: 0.05, hold: 0.6 }];
const WARNING = [
  { wave: 'square', freq: 196, dur: 0.3, peak: TELEGRAPH, filter: ['lowpass', 900, 1] },
  { wave: 'square', freq: 247, dur: 0.45, peak: TELEGRAPH, offset: 0.35, filter: ['lowpass', 900, 1] },
];
const ENEMY = {
  alert: (a, s) => burst(a, s, ...ALERT),
  aim: (a, s) => burst(a, s, ...AIM),
  warning: (a, s) => burst(a, s, ...WARNING),
  stunned: (a, s) => burst(a, s,
    { wave: 'noise', filter: ['bandpass', 2600, 2], dur: 0.3, peak: 0.3 },
    { wave: 'square', freq: 640, to: 190, dur: 0.3, peak: 0.2, filter: ['lowpass', 2000, 1] }),
  disabled: (a, s) => burst(a, s, CLICK, ...POWER_DOWN),
};
const ATTACK = {
  skitter: [
    { wave: 'noise', filter: ['bandpass', 2200, 1], dur: 0.25, peak: 0.35 },
    { wave: 'sine', freq: 300, to: 180, dur: 0.2, peak: 0.2 },
  ],
  drone: [
    { wave: 'sawtooth', freq: 1400, to: 220, dur: 0.2, peak: 0.3 },
    { wave: 'noise', filter: ['highpass', 2500, 1], dur: 0.1, peak: 0.2 },
  ],
  sentinel: [
    { wave: 'sawtooth', freq: 110, to: 92, dur: 0.9, peak: 0.3, filter: ['lowpass', 500, 1] },
    { wave: 'noise', filter: ['bandpass', 3000, 2], dur: 0.9, peak: 0.2 },
  ],
};
const STAGES = {
  board: (a, s) => burst(a, s, CLICK, { ...THUD, peak: 0.2 }),
  barrier: (a, s) => burst(a, s, { wave: 'noise', filter: ['lowpass', 700, 1], dur: 0.2, peak: 0.3 }, THUD,
    { wave: 'sine', freq: 2800, dur: 0.4, peak: 0.05 }),
  rise: (a, s) => burst(a, s, { wave: 'sine', freq: 48, to: 72, dur: 2.8, peak: 0.3, attack: 1.2, hold: 2.3 }),
  surface: (a, s) => burst(a, s,
    { wave: 'sine', freq: 880, dur: 1.6, peak: 0.12, attack: 0.2 },
    { wave: 'sine', freq: 1320, dur: 1.8, peak: 0.09, attack: 0.2, offset: 0.3 },
    { wave: 'noise', filter: ['highpass', 800, 1], dur: 1.2, peak: 0.08, attack: 0.5 }),
  terrace: (a, s) => burst(a, s, THUD,
    { wave: 'noise', filter: ['lowpass', 380, 0.7], dur: 0.08, peak: 0.25, offset: 0.3 },
    { wave: 'sine', freq: 95, to: 60, dur: 0.07, peak: 0.12, offset: 0.3 }),
};

/** Events that carry only an id: the lists that hold the thing the sound comes from. */
const HOLDERS = {
  cellPickup: 'cells', cellDrop: 'cells', cellInsert: 'cells', cellRemove: 'cells', socketPower: 'sockets',
  press: 'presses', liftStop: 'lifts', relayUnpowered: 'relays',
};

const SOUNDS = {
  jump: (a, s, e) => burst(a, s, ...(e.wall ? WALL_JUMP : TAKEOFF)),
  land: landing,
  step: (a, s, e) => burst(a, s, ...(STEP[e.surface] ?? STEP.rock)),
  dash: (a, s) => burst(a, s,
    { wave: 'noise', filter: ['highpass', 700, 1], filterTo: 3200, dur: 0.2, peak: 0.3 },
    { wave: 'sine', freq: 900, to: 200, dur: 0.18, peak: 0.12 }),
  dashStop: (a, s) => burst(a, s,
    { wave: 'sine', freq: 110, to: 50, dur: 0.12, peak: 0.4 },
    { wave: 'noise', filter: ['lowpass', 300, 1], dur: 0.1, peak: 0.3 }),
  seamBreak: (a, s) => burst(a, s, ...SHATTER),
  pulse: (a, s) => burst(a, s,
    { wave: 'sine', freq: 880, to: 240, dur: 0.5, peak: 0.25 },
    { wave: 'sine', freq: 1760, to: 660, dur: 0.45, peak: 0.08 }),
  pulseEmpty: (a, s) => burst(a, s, { wave: 'sine', freq: 180, dur: 0.12, peak: 0.12, hold: 0.06 }),
  pulseBlock: (a, s) => burst(a, s, CLICK, { wave: 'sine', freq: 1250, to: 900, dur: 0.2, peak: 0.15 }),
  reveal: (a, s) => burst(a, s,
    { wave: 'sine', freq: 2640, dur: 0.6, peak: 0.05 },
    { wave: 'sine', freq: 3520, dur: 0.4, peak: 0.03 }),
  shield: (a, s) => burst(a, s,
    { wave: 'sine', freq: 2100, dur: 0.25, peak: 0.2 },
    { wave: 'sine', freq: 3150, dur: 0.18, peak: 0.1 },
    { wave: 'noise', filter: ['highpass', 5000, 1], dur: 0.08, peak: 0.1 }),
  damage: (a, s) => burst(a, s,
    { wave: 'square', freq: 160, to: 70, dur: 0.25, peak: 0.3, filter: ['lowpass', 1500, 1] },
    { wave: 'noise', filter: ['lowpass', 1200, 1], dur: 0.2, peak: 0.3 }),
  crush: (a, s) => burst(a, s,
    { wave: 'square', freq: 90, to: 40, dur: 0.4, peak: 0.5, filter: ['lowpass', 600, 1] },
    { wave: 'noise', filter: ['lowpass', 500, 1], dur: 0.35, peak: 0.5 },
    { wave: 'sine', freq: 420, to: 400, dur: 0.5, peak: 0.15 }),
  shutdown: (a, s) => burst(a, s,
    { wave: 'sawtooth', freq: 240, to: 38, dur: 1.2, peak: 0.22, attack: 0.02, hold: 0.9, filter: ['lowpass', 700, 1] },
    { wave: 'sine', freq: 120, to: 30, dur: 1.2, peak: 0.2, attack: 0.02, hold: 0.9 }),
  reboot: (a, s) => burst(a, s,
    { wave: 'triangle', freq: 90, to: 440, dur: 0.8, peak: 0.2, attack: 0.05, filter: ['lowpass', 1200, 1] },
    { wave: 'sine', freq: 880, dur: 0.6, peak: 0.08, offset: 0.55 }),
  cellPickup: (a, s) => burst(a, s,
    { wave: 'sine', freq: 196, to: 294, dur: 0.12, peak: 0.2 },
    { wave: 'noise', filter: ['bandpass', 700, 1], dur: 0.05, peak: 0.12 }),
  cellDrop: (a, s) => burst(a, s, THUD, { wave: 'noise', filter: ['lowpass', 400, 1], dur: 0.12, peak: 0.3 }),
  cellInsert: (a, s) => burst(a, s, CLICK, { wave: 'sine', freq: 440, to: 660, dur: 0.18, peak: 0.15, offset: 0.07 }),
  cellRemove: (a, s) => burst(a, s, CLICK, { wave: 'sine', freq: 520, to: 330, dur: 0.14, peak: 0.12, offset: 0.06 }),
  cellReject: (a, s) => burst(a, s,
    { wave: 'sine', freq: 150, dur: 0.07, peak: 0.14 },
    { wave: 'sine', freq: 120, dur: 0.09, peak: 0.14, offset: 0.1 }),
  socketPower: (a, s, e) => burst(a, s, ...(e.on ? POWER_ON : POWER_OFF)),
  shutterStop: (a, s, e) => burst(a, s, ...SEAT.map((spec) => ({ ...spec, peak: spec.peak * (e.open ? 0.6 : 1) }))),
  liftStop: (a, s) => burst(a, s,
    { wave: 'sine', freq: 140, to: 80, dur: 0.15, peak: 0.3 },
    { wave: 'sine', freq: 990, dur: 0.4, peak: 0.06 }),
  switch: (a, s) => burst(a, s,
    { wave: 'noise', filter: ['bandpass', 1800, 3], dur: 0.06, peak: 0.3 },
    { wave: 'square', freq: 220, to: 110, dur: 0.1, peak: 0.12, filter: ['lowpass', 900, 1] }),
  vent: vent,
  press: press,
  relay: (a, s) => burst(a, s,
    { wave: 'sine', freq: 440, to: 660, dur: 1.2, peak: 0.2, attack: 0.1, hold: 0.7 },
    { wave: 'sine', freq: 660, to: 990, dur: 1.2, peak: 0.12, attack: 0.1, hold: 0.7 },
    { wave: 'sine', freq: 220, to: 330, dur: 1.4, peak: 0.15, attack: 0.1, hold: 0.8 }),
  relayUnpowered: (a, s) => burst(a, s,
    { wave: 'sine', freq: 140, to: 90, dur: 0.2, peak: 0.3 },
    { wave: 'noise', filter: ['lowpass', 500, 1], dur: 0.15, peak: 0.2 }),
  station: (a, s) => burst(a, s,
    { wave: 'sine', freq: 660, dur: 0.5, peak: 0.14 },
    { wave: 'sine', freq: 990, dur: 0.7, peak: 0.12, offset: 0.12 },
    { wave: 'sine', freq: 1320, dur: 0.9, peak: 0.08, offset: 0.24 }),
  archive: (a, s) => burst(a, s,
    { wave: 'sine', freq: 523.25, dur: 1.6, peak: 0.12, attack: 0.05 },
    { wave: 'sine', freq: 1046.5, dur: 1.4, peak: 0.07, offset: 0.25 },
    { wave: 'sine', freq: 1568, dur: 1.2, peak: 0.04, offset: 0.5 }),
  cache: (a, s) => burst(a, s,
    { wave: 'sine', freq: 880, to: 1320, dur: 0.2, peak: 0.15 },
    { wave: 'sine', freq: 1760, dur: 0.3, peak: 0.08, offset: 0.1 }),
  liftSequence: (a, s, e) => STAGES[e.stage]?.(a, s),
  complete: resolution,
  enemyState: (a, s, e) => ENEMY[e.state]?.(a, clear(s)),
  enemyAttack: (a, s, e) => burst(a, clear(s), ...(ATTACK[e.kind] ?? ATTACK.drone)),
  boltHit: (a, s) => burst(a, s,
    { wave: 'noise', filter: ['bandpass', 2800, 2], dur: 0.12, peak: 0.25 },
    { wave: 'sine', freq: 1200, to: 400, dur: 0.1, peak: 0.15 }),
};

/** Continuous sounds while their cause lasts: ILO's wall scrape and the hum of a moving shutter, lift or ascent. */
const SLIDE = [{ wave: 'noise', filter: ['bandpass', 1500, 0.8], dur: MAX_LIFE, peak: 0.1, attack: 0.08 }];
const HUMS = {
  shutter: [{ wave: 'noise', filter: ['lowpass', 320, 2], dur: MAX_LIFE, peak: 0.22, attack: 0.06 }],
  lift: [
    { wave: 'sawtooth', freq: 56, filter: ['lowpass', 200, 1], dur: MAX_LIFE, peak: 0.16, attack: 0.15 },
    { wave: 'noise', filter: ['lowpass', 170, 1], dur: MAX_LIFE, peak: 0.2, attack: 0.15 },
  ],
  ascent: [
    { wave: 'sawtooth', freq: 49, filter: ['lowpass', 220, 1], dur: MAX_LIFE, peak: 0.2, attack: 0.6 },
    { wave: 'sine', freq: 98, dur: MAX_LIFE, peak: 0.1, attack: 0.6 },
  ],
};

// --- Music ---
// One palette on a grid of `STEPS` steps of `TICK` seconds. An arrangement is a drone frequency and parts:
// [voice, the pitches it cycles through, the steps it sounds on, its level, its stereo spread].

const DRONE = { wave: 'sawtooth', dur: MAX_LIFE, peak: 0.2, attack: 1, filter: ['lowpass', 160, 1] };
const WARM = { wave: 'triangle', dur: 2.5, peak: 0.16, attack: 0.3, filter: ['lowpass', 900, 1] };
const SHAKER = { wave: 'noise', filter: ['bandpass', 6000, 2], dur: 0.06, peak: 0.08 };
const BELL = { wave: 'triangle', dur: 2.8, peak: 0.14, filter: ['lowpass', 3200, 1] };
const THUMP = { wave: 'sine', freq: 70, to: 42, dur: 0.5, peak: 0.34 };
const METAL = { wave: 'noise', filter: ['bandpass', 3100, 9], dur: 0.1, peak: 0.12 };
const TONE = { wave: 'sine', dur: 2, peak: 0.16, attack: 0.05 };
const SPARK = { wave: 'sine', dur: 1.2, peak: 0.07 };
const DRONE_STEPS = [0, 5, 10];

const ARRANGEMENTS = {
  workshop: {
    drone: 55,
    parts: [[WARM, [220, 261.63, 329.63, 392], [0, 3, 6, 10, 13]], [SHAKER, null, [4, 12]]],
  },
  reservoir: {
    drone: 82.41,
    parts: [
      [BELL, [493.88, 659.25, 783.99, 587.33], [0, 4, 8, 12], 1, 0.6],
      [BELL, [739.99, 987.77], [2, 10], 0.5, 0.6],
    ],
  },
  foundry: {
    drone: 73.42,
    parts: [
      [THUMP, null, [0, 8]],
      [THUMP, null, [4, 12], 0.6],
      [METAL, null, [3, 7, 11, 15]],
      [WARM, [146.83, 174.61], [2, 10], 0.7],
    ],
  },
  ascent: {
    drone: 55,
    parts: [
      [THUMP, null, [0, 4, 8, 12]],
      [TONE, [440, 523.25, 659.25], [0, 3, 6, 10, 13]],
      [SPARK, [1318.51, 1760], [7, 15]],
    ],
  },
};

const RESOLUTION = [[220, 0, 0.12], [329.63, 0.05, 0.09], [440, 0.1, 0.09], [554.37, 0.2, 0.07], [659.25, 0.5, 0.05]];

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** A failed `resume` or `close` needs no action: the next gesture tries again. */
const ignore = (promise) => promise.catch(() => {});

/** Close a context, open or closed already, without throwing. */
const release = (ctx) => ignore(Promise.resolve().then(() => ctx.close()));

/** Hold whatever `param` sounds now and glide it linearly to `value` within `seconds`. */
function glide(param, value, now, seconds) {
  param.cancelAndHoldAtTime(now);
  param.linearRampToValueAtTime(value, now + seconds);
}

/** Pan toward a source `d` units from ILO (at most PAN) and soften it with the distance. */
function placed(d) {
  return { pan: PAN * clamp(d / REACH, -1, 1), reach: 1 / (1 + Math.abs(d) / NEAR) };
}

/** A danger cue keeps its full level whatever its distance: only its pan tells where it is. */
const clear = (s) => ({ pan: s.pan, reach: 1 });

/**
 * One voice into `bus`: a waveform or white noise through an optional filter, an envelope and a pan.
 * It starts at `o.at` or `offset` seconds from now, fades out by `o.dur` (at most MAX_LIFE), then stops and
 * disconnects its nodes. A looping voice lasts until the function it returns runs.
 */
function voice(a, bus, o) {
  const ctx = a.ctx;
  const at = o.at ?? ctx.currentTime + (o.offset ?? 0);
  const end = at + Math.min(o.dur, MAX_LIFE);
  const peak = o.peak * (o.reach ?? 1);
  const src = o.wave === 'noise' ? ctx.createBufferSource() : ctx.createOscillator();
  if (o.wave === 'noise') {
    src.buffer = a.noise;
    src.loop = true;
  } else {
    src.type = o.wave;
    src.frequency.setValueAtTime(o.freq, at);
    if (o.to !== undefined) src.frequency.exponentialRampToValueAtTime(o.to, end);
  }
  const filter = o.filter === undefined ? null : ctx.createBiquadFilter();
  if (filter !== null) {
    filter.type = o.filter[0];
    filter.frequency.setValueAtTime(o.filter[1], at);
    if (o.filterTo !== undefined) filter.frequency.exponentialRampToValueAtTime(o.filterTo, end);
    filter.Q.value = o.filter[2] ?? 1;
  }
  const env = ctx.createGain();
  const attack = at + Math.min(o.attack ?? 0.005, o.dur / 2);
  env.gain.setValueAtTime(FLOOR, at);
  env.gain.exponentialRampToValueAtTime(peak, attack);
  if (o.hold !== undefined) {
    // A hold longer than the capped life ends halfway through what is left of it.
    const held = at + o.hold;
    env.gain.setValueAtTime(peak, held < end ? held : (attack + end) / 2);
  }
  const loop = o.loop === true;
  if (!loop) env.gain.exponentialRampToValueAtTime(FLOOR, end);
  const pan = ctx.createStereoPanner();
  pan.pan.value = o.pan ?? 0;
  src.connect(filter ?? env);
  if (filter !== null) filter.connect(env);
  env.connect(pan);
  pan.connect(bus);
  if (o.wave === 'noise') src.start(at, Math.random() * 0.9);
  else src.start(at);
  const nodes = [src, filter, env, pan];
  src.onended = () => nodes.forEach((node) => node?.disconnect());
  if (loop) {
    return () => {
      glide(env.gain, FLOOR, ctx.currentTime, LOOP_FADE);
      src.stop(ctx.currentTime + LOOP_FADE + 0.02);
    };
  }
  src.stop(end);
}

/** Every voice of `specs` on the effects bus, at the pan and reach of `s`. */
function burst(a, s, ...specs) {
  for (const spec of specs) voice(a, a.fx, { ...spec, pan: s.pan, reach: s.reach });
}

function landing(a, s, e) {
  const weight = clamp((e.speed ?? 12) / 24, 0.3, 1);
  burst(a, s, { wave: 'sine', freq: 120, to: 55, dur: 0.14, peak: 0.35 * weight },
    ...(STEP[e.surface] ?? STEP.rock).map((spec) => ({ ...spec, peak: spec.peak * (0.5 + weight / 2) })));
}

/** A vent hisses up before it fires and roars while it does; its rest needs no cue. */
function vent(a, s, e, world) {
  const active = world.vents.find((vent) => vent.id === e.id)?.active ?? 1;
  if (e.stage === 'warning') {
    burst(a, clear(s),
      { wave: 'noise', filter: ['highpass', 1200, 1], filterTo: 4200, dur: 0.6, peak: TELEGRAPH, attack: 0.3 },
      { wave: 'sine', freq: 660, to: 990, dur: 0.6, peak: 0.12 });
  } else if (e.stage === 'active') {
    burst(a, s, { wave: 'noise', filter: ['lowpass', 1400, 1], dur: active, peak: 0.45, attack: 0.05, hold: active * 0.8 });
  }
}

/** A press rattles before it drops, slams as it lands a moment later, and rises in silence. */
function press(a, s, e) {
  if (e.stage === 'warn') {
    burst(a, clear(s), CLANK, { ...CLANK, offset: 0.2 },
      { wave: 'square', freq: 98, to: 86, dur: 0.4, peak: 0.2, filter: ['lowpass', 400, 1] });
  } else if (e.stage === 'drop') {
    burst(a, clear(s), { wave: 'noise', filter: ['lowpass', 600, 1], dur: 0.3, peak: 0.4 },
      { wave: 'sine', freq: 80, to: 38, dur: 0.35, peak: 0.5, offset: 0.3 });
  }
}

/** The quiet chord the expedition ends on. */
function resolution(a) {
  RESOLUTION.forEach(([freq, offset, peak], i) => voice(a, a.music, {
    wave: 'sine', freq, offset, peak, dur: MAX_LIFE, attack: 0.8, hold: 1.6, pan: (i - 2) * 0.25,
  }));
}

/** Play one simulation event; nothing happens for a type without a sound. */
function play(a, world, event) {
  const holder = HOLDERS[event.type] === undefined ? undefined : world[HOLDERS[event.type]]?.find((o) => o.id === event.id);
  const sound = SOUNDS[event.type];
  if (sound !== undefined) sound(a, placed((event.x ?? holder?.x ?? world.player.x) - world.player.x), event, world);
}

/** Start a loop and remember what keeps it going. */
function startLoop(a, key, d, specs, lasts) {
  const s = placed(d);
  a.loops.set(key, { lasts, voices: specs.map((spec) => voice(a, a.fx, { ...spec, ...s, loop: true })) });
}

function syncLoops(a, world) {
  const live = !world.paused && !hidden();
  if (live && world.player.sliding && !a.loops.has('slide')) {
    startLoop(a, 'slide', 0, SLIDE, (w) => w.player.sliding);
  }
  if (live) {
    for (const m of world.movers) {
      // A loop-mode mover reports one frame of motion the other way as it seats: a hum needs two frames to start.
      if (m.moving && a.rolling.has(m) && m.kind in HUMS && !a.loops.has(m)) {
        startLoop(a, m, m.x + m.w / 2 - world.player.x, HUMS[m.kind], (w) => w.movers.includes(m) && m.moving);
      }
    }
    if (world.mode === 'liftSequence' && world.ascent?.stage === 'rise' && !a.loops.has('ascent')) {
      startLoop(a, 'ascent', world.ascent.x - world.player.x, HUMS.ascent, (w) => w.mode === 'liftSequence' && w.ascent?.stage === 'rise');
    }
  }
  a.rolling = new Set(world.movers.filter((m) => m.moving));
  for (const [key, loop] of a.loops) {
    if (live && loop.lasts(world)) continue;
    for (const stop of loop.voices) stop();
    a.loops.delete(key);
  }
}

/** Music off and every loop stopped: a pause, a hidden page or a failing context. */
function silence(a) {
  for (const loop of a.loops.values()) for (const stop of loop.voices) stop();
  a.loops.clear();
  glide(a.music.gain, 0, a.ctx.currentTime, PAUSE_FADE);
  a.musicOn = false;
}

/** The arrangement a world hears: `ascent` during the lift, nothing once `complete`. */
function arrangementOf(world) {
  if (world.mode === 'liftSequence') return 'ascent';
  if (world.mode === 'complete') return null;
  return Object.hasOwn(ARRANGEMENTS, world.regionId) ? world.regionId : 'workshop';
}

/** Crossfade to arrangement `name` over FADE seconds: the new material rises while the old one fades. */
function switchArrangement(a, name, now) {
  let incoming = a.tracks.find((track) => track.name === name);
  for (const track of a.tracks) {
    if (track !== incoming && track.until === Infinity) {
      glide(track.gain.gain, 0, now, FADE);
      track.until = now + FADE;
    }
  }
  if (name === null) return;
  if (incoming === undefined) {
    incoming = { name, gain: a.ctx.createGain(), until: Infinity };
    incoming.gain.gain.value = 0;
    incoming.gain.connect(a.music);
    a.tracks.push(incoming);
  }
  glide(incoming.gain.gain, 1, now, FADE);
  incoming.until = Infinity;
}

/** The notes arrangement `track` plays on loop step `i`, all starting at `at`. */
function playStep(a, track, i, at) {
  const { drone, parts } = ARRANGEMENTS[track.name];
  if (DRONE_STEPS.includes(i)) voice(a, track.gain, { ...DRONE, freq: drone, at });
  for (const [spec, pitches, steps, level = 1, spread = 0] of parts) {
    const k = steps.indexOf(i);
    if (k >= 0) {
      voice(a, track.gain, { ...spec, at, freq: pitches?.[k % pitches.length] ?? spec.freq, peak: spec.peak * level, pan: spread * (1 - 2 * (k % 2)) });
    }
  }
}

/** Music for the state of `world`: on unless paused or hidden, following the region and the mode. */
function syncMusic(a, world) {
  const on = !(world.paused || hidden());
  if (on !== a.musicOn) {
    if (on) glide(a.music.gain, MUSIC_LEVEL, a.ctx.currentTime, RESUME_FADE);
    else silence(a);
    a.musicOn = on;
  }
  if (!on) return;
  const now = a.ctx.currentTime;
  const name = arrangementOf(world);
  if (name !== a.arrangement) {
    switchArrangement(a, name, now);
    a.arrangement = name;
  }
  a.tracks = a.tracks.filter((track) => {
    if (now < track.until) return true;
    track.gain.disconnect();
    return false;
  });
  if (a.next < now) {
    a.step = Math.ceil(now / TICK);
    a.next = a.step * TICK;
  }
  while (a.next < now + LOOKAHEAD) {
    for (const track of a.tracks) if (a.next <= track.until) playStep(a, track, a.step % STEPS, a.next);
    a.step += 1;
    a.next = a.step * TICK;
  }
}

/** The one AudioContext and its buses: music and effects into the master gain, then a compressor. */
function open(a) {
  const ctx = a.ctx = new globalThis.AudioContext();
  const master = a.master = ctx.createGain();
  const music = a.music = ctx.createGain();
  const fx = a.fx = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  master.gain.value = a.muted ? 0 : 1;
  music.gain.value = 0;
  compressor.threshold.value = -18;
  compressor.knee.value = 20;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;
  fx.connect(master);
  music.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.destination);
  a.noise = noiseBuffer(ctx);
  if (typeof document !== 'undefined') {
    a.onVisibility = () => guard(a, () => {
      if (hidden()) silence(a);
    });
    document.addEventListener('visibilitychange', a.onVisibility);
  }
}

/** One second of white noise: every noise voice plays this buffer. */
function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Close the context and forget it: nothing sounds and every method is a no-op until the next `unlock()`. */
function drop(a) {
  const { ctx, onVisibility } = a;
  if (onVisibility !== null && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  a.ctx = a.master = a.music = a.fx = a.noise = null;
  a.onVisibility = null;
  a.loops.clear();
  a.rolling.clear();
  a.tracks = [];
  a.arrangement = undefined;
  a.musicOn = null;
  a.step = 0;
  a.next = 0;
  if (ctx !== null) release(ctx);
}

function unlock(a) {
  if (typeof globalThis.AudioContext !== 'function') return;
  if (a.ctx !== null && a.ctx.state === 'closed') drop(a);
  if (a.ctx === null) open(a);
  if (a.ctx !== null && a.ctx.state !== 'running') ignore(a.ctx.resume());
}

function setMuted(a, on) {
  a.muted = Boolean(on);
  if (a.master !== null) glide(a.master.gain, a.muted ? 0 : 1, a.ctx.currentTime, MUTE_TIME);
}

function sync(a, world, events) {
  if (a.ctx === null || a.ctx.state !== 'running') return;
  syncLoops(a, world);
  for (const event of events ?? []) play(a, world, event);
  syncMusic(a, world);
}

/**
 * Audio must never stop the game: an AudioContext that throws is closed and audio stays silent until the
 * next `unlock()`. The failure goes to the console, where a developer finds it.
 */
function guard(a, run) {
  try {
    run();
  } catch (error) {
    console.error('DEEPWAKE audio stopped by an AudioContext failure', error);
    drop(a);
  }
}

export function createAudio() {
  const a = {
    ctx: null, master: null, music: null, fx: null, noise: null, onVisibility: null,
    muted: false, loops: new Map(), rolling: new Set(), tracks: [], arrangement: undefined, musicOn: null, step: 0, next: 0,
  };
  return {
    /** Create or resume the audio context inside a user gesture. Idempotent; safe without Web Audio. */
    unlock: () => guard(a, () => unlock(a)),
    /**
     * Once per frame: the effects of `events`, the loops and the music of `world`. `dt` is the frame time of
     * the contract; scheduling follows the AudioContext clock instead.
     */
    sync: (world, dt, events) => guard(a, () => sync(a, world, events)),
    setMuted: (on) => guard(a, () => setMuted(a, on)),
    get muted() {
      return a.muted;
    },
    dispose: () => guard(a, () => drop(a)),
  };
}
