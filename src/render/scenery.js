// Scenery of the renderer (contract §5.1): the lights and the region identity, the parallax layers, the decor kinds
// of contract §4.3, signs, conduits, and the pale opening over the ascent lift with the dawn that ends the game.
import * as THREE from '../../vendor/three/three.module.js';
import { depthOffset } from './camera.js';
import { PALETTE, VoxelBuilder, hash, material, mesh } from './voxel.js';

const BAND = 24; // authored units: scenery merges per band, so only the bands in view draw
const RANGE = 40; // decorative animation suspends this far from the camera
const SIGN_H = 0.72; // units
const SIGN_PX = 48; // canvas pixels per unit of a sign
const SIGN_FONT = '"Courier New", monospace';
const DAWN_TIME = 2.2; // seconds of the `surface` stage the dawn takes to come in
const KEY = { right: 0.35, sky: 0.6, viewer: 0.75 }; // where the key light comes from, in camera axes
// A layer shows an authored point `p` at `p + (1 - k) * (camera - anchor)`: it keeps its authored size and moves at
// `k` times the camera speed relative to the world. `depth` is its distance behind the gameplay plane along the view
// axis. Wall-mounted scenery ends at z 0.1; actors draw at z 0.12 and above, so they always stay in front of it.
const LAYERS = {
  wall: { kx: 1, ky: 1, depth: -0.06 },
  near: { kx: 1, ky: 1, depth: 0 },
  mid: { kx: 0.4, ky: 0.4, depth: 6.5 },
  far: { kx: 0.15, ky: 0.15, depth: 10 },
};
// The pale opening is far away, on a layer of its own. From side to side it moves as slowly as the middle layer, anchored
// `over` units east of the lift: so it lines up with the chimney over the service platform from there, and with the
// shaft and the cabin from the top platform and on the ride. In height it keeps `above` the floor of the cabin, as far
// up as the view allows (`inside` from the view center), and inside the free part of the view that the rig hands out
// (`view.free`), `clear` of the bands of the interface: that lines it up with the chimney from the service platform. The
// chimney is 4 units wide, and the face of the opening as wide, so the slot frames it there. It draws behind the middle
// layer and in front of the far one. West of the service platform it fades out of the view: opaque from `fade[1]` east,
// gone from `fade[0]` west, so that the foundry never shows it as white shapes behind its beams.
const FACE = [[0, 2.4, 4], [1.4, 0.4, 3], [-1.4, 0.4, 3]]; // the pale cross: [y, height, width] of its middle band, its top bar and its bottom bar
const OPENING = {
 kx: LAYERS.mid.kx, over: 2.2, above: 4.7, inside: { play: 4.4, lift: 5.4 }, at: depthOffset(9), fade: [192, 202],
 half: FACE[1][0] + FACE[1][1] / 2, clear: 0.3, // half the height of the cross, and the units it keeps from the bands
};
const LAYER_OF = {
  sign: 'wall', lamp: 'wall', toolrack: 'wall',
  bench: 'near', cable: 'near', lightShaft: 'near', pool: 'near',
  column: 'mid', machine: 'mid', crystal: 'mid', shelf: 'mid', bridge: 'mid', rail: 'mid', waterfall: 'far',
};
// Regional identity (GOAL §4): light from above and below, the deep background, the tones of the far layer, one accent.
const MOODS = {
  workshop: { match: /workshop/, sky: 0xd3d6da, ground: 0x7a7168, backdrop: 0x131820, wall: 0x1c2129, frame: 0x242a33, mass: 0x161b22, accent: 0xd08a4a },
  reservoir: { match: /reservoir|crystal|cavern/, sky: 0xc4d8e4, ground: 0x5f757c, backdrop: 0x0e1a22, wall: 0x17272f, frame: 0x1f333c, mass: 0x12212a, accent: 0x7fd8e4 },
  foundry: { match: /foundry|forge/, sky: 0xdad2c8, ground: 0x6e5f54, backdrop: 0x181513, wall: 0x251e1a, frame: 0x2e2622, mass: 0x1b1715, accent: 0xe3a23c },
  ascent: { match: /ascent|shaft/, sky: 0xcfd9e2, ground: 0x66727c, backdrop: 0x101923, wall: 0x1b222b, frame: 0x222b35, mass: 0x151b22, accent: 0xcdd8e2 },
};
const MOOD_LIST = Object.values(MOODS);
/** The identity of a region by its id or name; the workshop for anything unknown. */
const moodOf = (region) => MOOD_LIST.find((mood) => mood.match.test(`${region?.id ?? ''} ${region?.name ?? ''}`.toLowerCase())) ?? MOODS.workshop;
const moodKind = (mood) => MOOD_LIST.indexOf(mood);
// Sign key labels, keyboard and touch; the touch words are those of the touch buttons in `src/ui/ui.js`.
const KEYS = {
  left: ['A', '◀'], right: ['D', '▶'], jump: ['SPACE', 'JUMP'], dash: ['SHIFT', 'DASH'],
  pulse: ['Q', 'PULSE'], interact: ['E', 'INTERACT'], retry: ['R', 'RETRY'],
};
const seedOf = (x, y) => Math.round(x * 8) + Math.round(y * 8) * 977;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** The models of the decor kinds, drawn at their anchor: x right, y up, z into the scene (0 is the front). */
const MODELS = {
  bench(p) {
    p.box('plain', 0, 0.78, -0.3, 1.8, 0.12, 0.6, 0x6b5a44, 'FTR');
    for (const x of [-0.8, 0.8]) {
      for (const z of [-0.1, -0.5]) p.box('plain', x, 0.36, z, 0.1, 0.72, 0.1, PALETTE.steelDark, 'FTR');
    }
    p.box('plain', 0, 0.26, -0.3, 1.6, 0.05, 0.5, PALETTE.steelDark, 'FT');
    p.box('plain', -0.45, 0.92, -0.25, 0.34, 0.16, 0.22, PALETTE.rust, 'FTR');
    p.box('plain', 0.28, 0.87, -0.15, 0.6, 0.06, 0.06, PALETTE.steel, 'FTR');
    p.box('plain', 0.68, 0.98, -0.38, 0.28, 0.28, 0.28, PALETTE.bronze, 'FTR');
  },
  toolrack(p, d, seed) {
    const w = Math.max(1, d.w ?? 2);
    p.box('plain', 0, 0.8, -0.06, w, 1.3, 0.08, PALETTE.steelDark, 'FTR');
    for (const y of [1.42, 0.18]) p.box('plain', 0, y, -0.04, w + 0.1, 0.08, 0.08, PALETTE.bronze, 'FTR');
    const tools = Math.max(1, Math.floor(w / 0.5));
    for (let i = 0; i < tools; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / tools;
      const pick = hash(i, 0, seed);
      if (pick < 0.3) {
        p.box('plain', x, 0.85, -0.01, 0.07, 0.6, 0.06, PALETTE.steel, 'FTR');
        p.box('plain', x, 1.18, -0.01, 0.2, 0.12, 0.06, PALETTE.steel, 'FTR');
      } else if (pick < 0.6) {
        p.box('plain', x, 0.85, -0.01, 0.06, 0.5, 0.06, 0x7a6446, 'FTR');
        p.box('plain', x, 1.13, -0.01, 0.24, 0.12, 0.08, PALETTE.steel, 'FTR');
      } else if (pick < 0.8) {
        p.box('plain', x, 0.85, -0.01, 0.05, 0.7, 0.06, PALETTE.bronze, 'FTR');
      } else {
        p.box('plain', x, 0.85, -0.01, 0.26, 0.26, 0.06, PALETTE.rust, 'FTR');
        p.box('plain', x, 0.85, 0.022, 0.12, 0.12, 0.005, PALETTE.steelDark, 'F');
      }
    }
  },
  lamp(p, d) {
    const warm = d.tone !== 'teal';
    const light = warm ? 0xff9a3c : 0x3fd8c0;
    p.box('plain', 0, 0.22, -0.06, 0.08, 0.08, 0.08, PALETTE.steelDark);
    p.box('plain', 0, 0.11, -0.01, 0.08, 0.2, 0.06, PALETTE.steel, 'FTRL');
    p.box('plain', 0, 0.02, 0, 0.5, 0.08, 0.12, PALETTE.steel, 'FTRL');
    p.box('emissive', 0, -0.07, 0, 0.3, 0.14, 0.08, warm ? 0xffc06a : 0x8af0dc, 'FTRLB');
    p.box('glow', 0, -0.1, 0.04, 0.9, 0.6, 0.005, [light, 0.5], 'F');
    p.quad('glow', [[-1.1, -2.4, 0.05], [1.1, -2.4, 0.05], [0.22, -0.16, 0.05], [-0.22, -0.16, 0.05]],
      [[light, 0], [light, 0], [light, 0.22], [light, 0.22]]);
  },
  lightShaft(p, d) {
    const h = Math.max(1, d.h ?? 4);
    p.quad('glow', [[-0.2, -h, 0], [1.8, -h, 0], [0.7, 0, 0], [-0.7, 0, 0]],
      [[0xe9e2cc, 0], [0xe9e2cc, 0], [0xe9e2cc, 0.16], [0xe9e2cc, 0.16]]);
  },
  pool(p, d) {
    const w = Math.max(1, d.w ?? 3);
    p.quad('pool', [[-w / 2, 0.02, -0.05], [w / 2, 0.02, -0.05], [w / 2, 0.02, -3.2], [-w / 2, 0.02, -3.2]],
      [[0x7fd4de, 0.5], [0x7fd4de, 0.5], [0x3f8f9e, 0.3], [0x3f8f9e, 0.3]]);
    for (let i = 0; i < 3; i++) {
      p.box('emissive', -w / 2 + (w * (i + 0.5)) / 3, 0.03, -0.5 - i * 0.9, w / 4, 0.005, 0.08, 0xc9f4f8, 'T');
    }
  },
  column(p, d) {
    const h = Math.max(1.5, d.h ?? 6);
    for (const y of [0.14, h - 0.14]) p.box('plain', 0, y, -0.45, 1.1, 0.28, 0.9, 0x2b3742, 'FTR');
    p.box('plain', 0, h / 2, -0.35, 0.8, h - 0.56, 0.7, 0x32404c, 'FTR');
    for (let y = 2.2; y < h - 0.6; y += 2.2) p.box('plain', 0, y, -0.34, 0.8, 0.08, 0.72, 0x27323c, 'FTR');
  },
  crystal(p, d) {
    const s = Math.max(0.5, d.size ?? 1);
    for (const [x, width, height] of [[0, 0.7 * s, 2.1 * s], [-0.5 * s, 0.4 * s, 1.1 * s], [0.45 * s, 0.32 * s, 0.8 * s]]) {
      for (let i = 0; i < 3; i++) {
        const part = 1 - i / 3;
        p.box('plain', x, (height * (i + 0.5)) / 3, -(width * part) / 2, width * part, height / 3, width * part, 0x8fd6e2, 'FTR');
      }
      p.box('emissive', x, height * 0.4, 0.005, width * 0.16, height * 0.6, 0.01, PALETTE.crystalCore, 'F');
    }
  },
  shelf(p, d) {
    const w = Math.max(1.5, d.w ?? 4);
    p.box('plain', 0, 0.25, -0.5, w, 0.5, 1, 0x2c3843, 'FTR');
    const teeth = Math.max(1, Math.round(w / 1.2));
    for (let i = 0; i < teeth; i++) {
      p.box('plain', -w / 2 + (w * (i + 0.5)) / teeth, -0.2, -0.4, 0.5, 0.4, 0.8, 0x27323c, 'FTR');
    }
    p.box('plain', -w / 4, 0.62, -0.3, 0.2, 0.24, 0.2, 0x8fd6e2, 'FTR');
    p.box('plain', w / 4 + 0.2, 0.56, -0.5, 0.14, 0.12, 0.14, 0x8fd6e2, 'FTR');
  },
  bridge(p, d) {
    const w = Math.max(2, d.w ?? 5);
    p.box('plain', 0, 0.08, -0.4, w, 0.16, 0.8, 0x5a4636, 'FTR');
    const posts = Math.max(2, Math.round(w / 1.2) + 1);
    for (let i = 0; i < posts; i++) p.box('plain', -w / 2 + (w * i) / (posts - 1), 0.5, -0.1, 0.08, 0.7, 0.08, PALETTE.steelDark, 'FTR');
    p.box('plain', 0, 0.85, -0.1, w, 0.07, 0.07, 0x6b5a40, 'FTR');
    p.box('plain', 0, 0.5, -0.1, w, 0.05, 0.05, 0x6b5a40, 'FTR');
  },
  rail(p, d) {
    const w = Math.max(1, d.w ?? 3);
    const posts = Math.round(w) + 1;
    for (let i = 0; i < posts; i++) p.box('plain', -w / 2 + (w * i) / (posts - 1), 0.45, -0.05, 0.08, 0.9, 0.08, 0x6b5a40, 'FTR');
    p.box('plain', 0, 0.9, -0.05, w, 0.07, 0.07, 0x6b5a40, 'FTR');
    p.box('plain', 0, 0.5, -0.05, w, 0.05, 0.05, 0x6b5a40, 'FTR');
  },
  waterfall(p, d) {
    const h = Math.max(2, d.h ?? 8);
    p.quad('glow', [[-0.45, -h, 0], [0.45, -h, 0], [0.45, 0, 0], [-0.45, 0, 0]],
      [[0x9fd8e0, 0.1], [0x9fd8e0, 0.1], [0x9fd8e0, 0.45], [0x9fd8e0, 0.45]]);
    p.box('plain', 0, 0.1, -0.3, 1.4, 0.3, 0.6, 0x1d2a33, 'FTR');
    p.box('emissive', 0, -h, -0.1, 1.2, 0.06, 0.2, 0x9fd8e0, 'FT');
  },
};

/** The sign `text` cut into key caps and words: `'{left}  Move'` becomes a cap and the word `Move`. */
function signTokens(text, touch) {
  return String(text ?? '').split(/(\{[a-z]+\})/).filter((part) => part.trim() !== '').map((part) => {
    const key = /^\{([a-z]+)\}$/.exec(part)?.[1];
    return KEYS[key] ? { label: KEYS[key][touch ? 1 : 0] } : { text: part.trim() };
  });
}

let measuring = null; // the 2D context sign words are measured on; without a canvas the width of a character is estimated
let measuredFor = 0;

/** Where every cap and word of a sign sits, in canvas pixels: one line, centered. */
function signLayout(tokens) {
  const height = Math.ceil(SIGN_H * SIGN_PX);
  const size = Math.round(height * 0.46);
  if (measuring === null && typeof document !== 'undefined') {
    measuring = document.createElement('canvas').getContext('2d');
  }
  if (measuring !== null && measuredFor !== size) {
    measuring.font = `bold ${size}px ${SIGN_FONT}`;
    measuredFor = size;
  }
  const items = tokens.map((token) => {
    const cap = token.label ? Math.round(size * 0.62 * token.label.length) + 14 : 0;
    const text = token.label ?? token.text;
    const words = measuring !== null ? measuring.measureText(text).width : text.length * size * 0.62;
    return { label: token.label, text, width: cap || words + 10, gap: cap ? 8 : 0 };
  });
  const content = items.reduce((sum, item) => sum + item.width + item.gap, 0);
  const width = Math.ceil(Math.max(1.2 * SIGN_PX, content + 28));
  let x = (width - content) / 2;
  for (const item of items) {
    item.x = x;
    x += item.width + item.gap;
  }
  return { items, size, height, width };
}

/** The face of a sign as a texture: dark plate, bronze border, key caps in amber, warm off-white words. Null without a canvas. */
function signMap(tokens) {
  if (typeof document === 'undefined') return null;
  const layout = signLayout(tokens);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const { size, height, items } = layout;
  const middle = height / 2;
  ctx.fillStyle = '#1a2129';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#8f7448';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.font = `bold ${size}px ${SIGN_FONT}`;
  ctx.textBaseline = 'middle';
  for (const item of items) {
    if (item.label) {
      ctx.fillStyle = '#2a2f36';
      ctx.fillRect(item.x, middle - size * 0.78, item.width, size * 1.56);
      ctx.strokeStyle = '#e3a23c';
      ctx.lineWidth = 3;
      ctx.strokeRect(item.x + 1.5, middle - size * 0.78 + 1.5, item.width - 3, size * 1.56 - 3);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2e9d8';
      ctx.fillText(item.label, item.x + item.width / 2, middle + 1);
    } else {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f2e9d8';
      ctx.fillText(item.text, item.x, middle + 1);
    }
  }
  // Nearest filtered, as every texture is (GOAL §4). The mip maps stay, so that a sign shown smaller than its texels
  // keeps its words.
  const map = new THREE.CanvasTexture(canvas);
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestMipmapLinearFilter;
  return map;
}

/** The machine kinds of the foundry. `move` takes the part that moves: `(builder, y, travel, motion)`. */
function machine(p, d, move) {
  const w = Math.max(1.5, d.w ?? 3);
  const h = Math.max(2, d.h ?? 4);
  const steel = 0x3c4650;
  const dark = 0x2a323a;
  const bronze = 0x6b5a40;
  const moving = new VoxelBuilder();
  if (d.type === 'press') {
    p.box('plain', 0, 0.1 * h, -0.4, w, 0.2 * h, 0.8, dark, 'FTR');
    for (const x of [-(w / 2) + 0.15 * w, w / 2 - 0.15 * w]) p.box('plain', x, 0.55 * h, -0.4, 0.3 * w, 0.9 * h, 0.7, steel, 'FTR');
    p.box('plain', 0, 0.95 * h, -0.4, w, 0.14 * h, 0.8, steel, 'FTR');
    p.box('emissive', 0, 1.04 * h, -0.05, 0.3, 0.12, 0.1, PALETTE.amber, 'F');
    moving.box(0, -0.1 * h, -0.4, 0.4 * w, 0.2 * h, 0.6, bronze, 'FTR');
    move(moving, 0.86 * h, 0.16 * h, 'slide');
  } else if (d.type === 'piston') {
    p.box('plain', 0, 0.1 * h, -0.4, w, 0.2 * h, 0.8, dark, 'FTR');
    p.box('plain', 0, 0.4 * h, -0.35, 0.5 * w, 0.4 * h, 0.7, bronze, 'FTR');
    moving.box(0, 0.25 * h, -0.3, 0.18 * w, 0.5 * h, 0.5, steel, 'FTR');
    moving.box(0, 0.5 * h, -0.3, 0.7 * w, 0.08 * h, 0.7, dark, 'FTR');
    move(moving, 0.6 * h, 0.14 * h, 'slide');
  } else if (d.type === 'turbine') {
    const r = 0.4 * Math.min(w, h);
    p.box('plain', 0, 0.5 * h, -0.5, w, h, 0.6, dark, 'FTR');
    for (let y = -r; y < r; y += 0.125) {
      moving.box(0, y + 0.0625, 0, 2 * Math.sqrt(Math.max(0, r * r - (y + 0.0625) ** 2)), 0.125, 0.1, 0x55606a, 'FTR');
    }
    for (let spoke = 0; spoke < 4; spoke++) {
      for (let k = 0.12; k < r; k += 0.125) {
        moving.box(k * Math.cos((spoke * Math.PI) / 2), k * Math.sin((spoke * Math.PI) / 2), 0.02, 0.125, 0.125, 0.08, bronze, 'FTR');
      }
    }
    moving.box(0, 0, 0.05, 0.3, 0.3, 0.12, bronze, 'FTR');
    move(moving, 0.5 * h, 0, 'spin');
  } else {
    p.box('plain', 0, 0.45 * h, -0.35, w, 0.9 * h, 0.7, steel, 'FTR');
    p.box('plain', 0, 0.95 * h, -0.35, 0.7 * w, 0.1 * h, 0.7, steel, 'FTR');
    for (const y of [0.75 * h, 0.25 * h]) p.box('plain', 0, y, -0.33, w + 0.06, 0.08 * h, 0.74, bronze, 'FTR');
    p.box('emissive', w / 2 - 0.4, 0.6 * h, 0.01, 0.2, 0.2, 0.02, PALETTE.amber, 'F');
  }
}

/** True when the object with `id` is powered now: a socket that holds a cell, a switch that is on, a relay that is active, a mover that runs. */
const powered = (world, id) => ['sockets', 'switches', 'relays', 'movers'].some((list) => (world[list] ?? []).some((o) => o.id === id && (o.powered || o.on || o.active)));

// --- The ruins of the observation terrace at the top of the ascent (GOAL §16) ---
// Weathered pale stone with a rust edge, in the terrain's rock material and the voxel style of the decor. A model
// stands on y 0 at its anchor, the top surface of the terrace, and ends 0.05 behind the gameplay plane: behind the
// body of ILO, which reaches back to z -0.01, wherever ILO stands.
const STONE = { base: 0xa9b2b7, pale: 0xd3d9dc, worn: 0x7e898f, joint: 0x5d686f, rust: PALETTE.rust, rustLight: 0xb8703e };

/**
 * A pillar broken at `height` on a plinth `wide` units across: drums of stone, each a shade of its own, rust down its
 * east edge and a jagged top.
 */
function stump(b, height, wide = 1, seed = 0, rubble = []) {
  const shaft = height - 0.3; // the shaft rises from the top of the plinth to the break
  const mid = 0.3 + shaft / 2;
  const drums = Math.max(2, Math.round(shaft / 0.4));
  b.tone = 0.94;
  b.box(0, 0.125, -0.55, wide, 0.25, 1, STONE.base, 'FTRL');
  b.box(0, 0.275, -0.5, wide - 0.16, 0.05, 0.84, STONE.pale, 'FTRL');
  for (let i = 0; i < drums; i++) {
    b.tone = 0.88 + 0.2 * hash(i, 1, seed);
    b.box(0, 0.3 + (shaft * (i + 0.5)) / drums, -0.5, 0.7, shaft / drums, 0.7, STONE.base, 'FTRL');
  }
  b.tone = 1;
  for (const x of [-0.16, 0.14]) b.box(x, mid, -0.145, 0.05, shaft - 0.12, 0.01, STONE.worn, 'F'); // grooves worn into the face
  for (let i = 1; i < drums; i++) {
    const joint = 0.3 + (shaft * i) / drums;
    b.box(0, joint, -0.145, 0.7, 0.025, 0.01, STONE.joint, 'F'); // where two drums meet
    b.box(0.355, joint, -0.5, 0.01, 0.025, 0.7, STONE.joint, 'R');
  }
  b.box(-0.24, 0.42, -0.145, 0.16, 0.16, 0.01, STONE.pale, 'F'); // a chip that flaked off
  b.box(0.33, 0.3 + shaft * 0.3, -0.13, 0.08, shaft * 0.6, 0.08, STONE.rust, 'FR'); // rust down the east edge, in two runs
  b.box(0.33, 0.3 + shaft * 0.9, -0.13, 0.08, shaft * 0.12, 0.08, STONE.rust, 'FR');
  b.box(0.2, height - 0.45, -0.145, 0.07, 0.36, 0.01, STONE.rustLight, 'F'); // and a drip from the break
  b.box(0, height + 0.01, -0.5, 0.68, 0.02, 0.68, STONE.rustLight, 'FTR'); // the break is rusted through
  for (const [x, w, h, z, d, color] of [[-0.21, 0.26, 0.24, -0.5, 0.6, STONE.pale], [0.06, 0.28, 0.11, -0.56, 0.5, STONE.base], [0.28, 0.13, 0.19, -0.44, 0.5, STONE.pale]]) {
    b.box(x, height + h / 2, z, w, h, d, color, 'FTRL'); // what is left of the last drum
  }
  for (const [x, z, s] of rubble) b.box(x, s / 2, z, s, s, s, STONE.base, 'FTRL'); // rubble at the foot
}

/** A slab that fell from a pillar and broke in two: the far end turned and up on rubble, rust bleeding from its fitting. */
function fallenSlab(b) {
  b.box(-0.3, 0.12, -0.45, 1, 0.24, 0.7, STONE.worn, 'FTRL'); // the long piece, on the ground
  b.box(-0.3, 0.245, -0.45, 0.96, 0.01, 0.66, STONE.pale, 'T'); // its top worn smooth
  b.box(0.62, 0.06, -0.65, 0.4, 0.12, 0.5, STONE.joint, 'FTR'); // the rubble the end piece rests on
  b.box(0.62, 0.25, -0.65, 0.5, 0.24, 0.9, STONE.worn, 'FTRL'); // the end piece, turned a quarter round
  b.box(0.62, 0.375, -0.65, 0.46, 0.01, 0.86, STONE.base, 'T');
  for (const [x, z, s, h] of [[0.12, -0.3, 0.14, 0.32], [0.12, -0.62, 0.12, 0.3], [0.42, -0.45, 0.12, 0.44], [0.42, -0.88, 0.1, 0.42]]) {
    b.box(x, h / 2, z, s, h, s, STONE.base, 'FTRL'); // the break: blocks left standing on either side of the crack
  }
  b.box(-0.3, 0.245, -0.13, 0.96, 0.01, 0.05, STONE.rust, 'T'); // rust along the front edge
  b.box(0.62, 0.375, -0.3, 0.3, 0.01, 0.06, STONE.rustLight, 'T'); // and from the fitting
  b.box(0.62, 0.42, -0.9, 0.18, 0.09, 0.18, STONE.rust, 'FTRL');
  for (const [x, z, s] of [[0.28, -0.18, 0.12], [-0.9, -0.25, 0.1], [-0.86, -0.68, 0.08]]) b.box(x, s / 2, z, s, s, s, STONE.base, 'FTRL'); // rubble
}

/** A post that leans east, leaning further for every unit it rises, out of a broken shoe; its top is snapped off. */
function leaningPost(b) {
  const lean = 0.28;
  b.box(0, 0.1, -0.4, 0.6, 0.2, 0.6, STONE.base, 'FTRL');
  b.box(0.2, 0.26, -0.4, 0.24, 0.12, 0.5, STONE.pale, 'FTR'); // the lip of the shoe, broken on the side it leans to
  for (let i = 0; i < 6; i++) {
    const y = 0.2 + (i + 0.5) * 0.25;
    b.box((y - 0.2) * lean, y, -0.4, 0.24, 0.25, 0.24, i === 2 || i === 4 ? STONE.pale : STONE.base, 'FTRL');
  }
  b.box(1.125 * lean, 1.325, -0.4, 0.25, 0.06, 0.25, STONE.rust, 'FTRL'); // a rusted band
  b.box(1.56 * lean, 1.76, -0.4, 0.16, 0.12, 0.16, STONE.pale, 'FTRL'); // the snapped top
}

/** A short railing with its last span broken off: three stone posts, rusted rails between the first two. */
function railing(b) {
  for (const [x, h] of [[-0.45, 0.85], [0, 0.8], [0.45, 0.3]]) {
    b.box(x, h / 2, -0.2, 0.16, h, 0.16, STONE.pale, 'FTRL');
    b.box(x, h + 0.03, -0.2, 0.2, 0.06, 0.2, STONE.base, 'FTRL'); // the cap
    b.box(x, 0.06, -0.2, 0.17, 0.12, 0.17, STONE.rust, 'FTRL'); // rust at the foot
  }
  b.box(-0.225, 0.76, -0.2, 0.44, 0.06, 0.06, STONE.rust, 'FTRL'); // the top rail
  b.box(-0.225, 0.45, -0.2, 0.44, 0.05, 0.05, STONE.rust, 'FTRL'); // the mid rail
  b.box(0.2, 0.76, -0.2, 0.22, 0.06, 0.06, STONE.rust, 'FTRL'); // the broken span: a stub left on the middle post
  b.box(0.36, 0.68, -0.2, 0.16, 0.05, 0.05, STONE.rust, 'FTRL'); // bent down, ending in the air
}

/**
 * The pieces of the terrace as `[name, x offset from the lift, model]`: west of the shaft, from x 221 to 226, a stump
 * and a leaning post; east of the cabin, from x 233 to 238, a fallen slab, two stumps and a railing at the east edge.
 * None of them stands in the cabin or in front of the walk of 3 units the lift takes ILO from the center of the cabin.
 */
const TERRACE = [
  ['stumpWest', -7.5, (b) => stump(b, 1.45, 1, 7, [[-0.64, -0.22, 0.12], [0.6, -0.5, 0.1]])],
  ['postWest', -5.1, leaningPost],
  ['slab', 4.55, fallenSlab],
  ['stumpLow', 5.85, (b) => stump(b, 1.1, 0.8, 5, [[-0.64, -0.22, 0.12]])],
  ['stumpTall', 6.75, (b) => stump(b, 2.1, 0.9, 3)],
  ['railing', 7.9, railing],
];

/**
 * The scenery of `level` as `{ sync(world, dt, events, view), dispose() }`; `view` is the rig's view of the frame.
 * It owns the lights of `scene` and adds its meshes to it; `camera` gives the direction the key light comes from.
 */
export function createScenery(scene, level, camera) {
  const bounds = level.bounds;
  const regions = level.regions ?? [];
  const regionAt = (x) => regions.find((region) => x <= region.x1) ?? regions.at(-1) ?? MOODS.workshop;
  const touch = globalThis.matchMedia?.('(pointer: coarse)')?.matches === true;
  const ref = { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 }; // the anchor of the slow layers
  /** The authored range of a layer on an axis: all the view can ever show of it, plus `margin`. */
  const spanX = (k, margin) => [ref.x + k * (bounds.x0 - ref.x) - margin, ref.x + k * (bounds.x1 - ref.x) + margin];
  const spanY = (k, margin) => [ref.y + k * (bounds.y0 - ref.y) - margin, ref.y + k * (bounds.y1 - ref.y) + margin];
  const [Y0, Y1] = spanY(LAYERS.far.ky, 14); // the far and mid layers cover the view for any camera height
  const [LOW, HIGH] = spanY(LAYERS.mid.ky, 14);
  const BASE = Y0 - 8; // the floor mass reaches the bottom edge of a portrait view, up to 3:1, at the lowest camera position
  /** Where a point of the level is authored in a layer: decor there stands where the camera sees it when it looks there. */
  const authored = (name, x, y) => {
    const { kx, ky } = LAYERS[name];
    return [ref.x + kx * (x - ref.x), ref.y + ky * (y - ref.y)];
  };
  const root = new THREE.Group();
  root.name = 'scenery';
  scene.add(root);
  const bands = new Map(); // "layer|ix|iy" -> { layer, ax, ay, shift, group, builders }
  const animated = [];
  const conduits = [];
  const ownedMaterials = [];
  const glazed = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const dim = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x555555 }); // a conduit that carries no power
  ownedMaterials.push(glazed, dim);

  function band(name, x, y) {
    const layer = LAYERS[name];
    // A layer slower than the camera is one rigid group anchored at `ref`; a still one is merged per band of `BAND` units.
    const still = layer.kx === 1;
    const ix = Math.floor(x / BAND);
    const iy = Math.floor(y / BAND);
    const key = still ? `${name}|${ix}|${iy}` : name;
    let b = bands.get(key);
    if (b === undefined) {
      const ax = still ? (ix + 0.5) * BAND : ref.x;
      const ay = still ? (iy + 0.5) * BAND : ref.y;
      const shift = depthOffset(layer.depth);
      b = { layer, ax, ay, shift, group: new THREE.Group(), builders: new Map() };
      b.group.position.set(ax + shift.x, ay + shift.y, shift.z); // at rest, as if the camera were on the anchor
      root.add(b.group);
      bands.set(key, b);
    }
    return b;
  }
  const builderIn = (b, kind) => b.builders.get(kind) ?? b.builders.set(kind, new VoxelBuilder()).get(kind);

  /** A box of authored size at authored `(x, y, z)` of layer `name`, merged into the band that holds it. */
  function put(name, kind, x, y, z, sx, sy, sz, color, faces, tone = 1) {
    const b = band(name, x, y);
    const builder = builderIn(b, kind);
    builder.tone = tone;
    builder.box(x - b.ax, y - b.ay, z, sx, sy, sz, color, faces);
  }

  /** Builders by material kind for one decor model; `box` and `quad` are those of `VoxelBuilder` with the kind first. */
  function parts() {
    const map = new Map();
    const of = (kind) => map.get(kind) ?? map.set(kind, new VoxelBuilder()).get(kind);
    return { map, box: (kind, ...args) => of(kind).box(...args), quad: (kind, ...args) => of(kind).quad(...args) };
  }

  /** Merge the parts of a model that stands on the level's `(x, y)` into the group of layer `name` that holds it. */
  function place(name, model, x, y) {
    const [ax, ay] = authored(name, x, y);
    const b = band(name, ax, ay);
    for (const [kind, builder] of model) builderIn(b, kind).add(builder, ax - b.ax, ay - b.ay, 0);
  }

  /** A mesh of its own on the level's `(x, y)` plus `dy`, animated by `sync`; `travel` is in world units. */
  function mover(name, builder, kind, x, y, dy, motion, speed, travel) {
    const [ax, ay] = authored(name, x, y);
    const b = band(name, ax, ay);
    const object = mesh(builder.build(), kind);
    object.position.set(ax - b.ax, ay - b.ay + dy, 0);
    b.group.add(object);
    animated.push({ object, kind: motion, x, y, base: object.position.y, speed, travel, phase: hash(seedOf(x, y), 1, 5) * 6.28 });
    return object;
  }

  // --- Generated layers ---
  function spire(name, x, y, height, tone) {
    for (let i = 0; i < 3; i++) {
      const part = 1 - i / 3;
      put(name, 'plain', x, y + (height * (i + 0.5)) / 3, -(0.6 * height * part) / 4, 1.2 * part, height / 3, 0.3 * height * part, 0x2c4e58, 'FTR', tone);
    }
    put(name, 'emissive', x, y + height * 0.86, 0.02, 0.2, height * 0.2, 0.02, PALETTE.crystalCore, 'F', 0.5 * tone);
  }

  /** Three units of the far layer of one regional identity. */
  function farChunk(x, kind, mood) {
    const i = Math.round(x / 3);
    const r = (n) => hash(i, n, 61);
    const top = Y1 - 5 - 8 * r(1);
    const bottom = Y0 + 3 + 5 * r(2);
    const mid = (top + bottom) / 2;
    const span = top - bottom;
    const beam = bottom + span * (0.3 + 0.4 * r(3));
    put('far', 'plain', x + 1.5, (top + Y1) / 2, -0.6, 3, Y1 - top, 1.2, mood.mass, 'FTR');
    put('far', 'plain', x + 1.5, (BASE + bottom) / 2, -0.6, 3, bottom - BASE, 1.2, mood.mass, 'FT');
    if (kind === moodKind(MOODS.workshop)) {
      if (i % 4 === 0) put('far', 'plain', x + 0.8, mid, 0, 1.6, span, 0.8, mood.frame, 'FTR');
      else put('far', 'plain', x + 1.5, mid, -1, 3, span, 0.4, mood.wall, 'F');
      put('far', 'plain', x + 1.5, beam, -0.6, 3, 0.7, 0.5, mood.frame, 'FTR');
      if (r(4) < 0.3) put('far', 'emissive', x + 1.5, beam + 2.2, -0.95, 0.9, 1.3, 0.1, mood.accent, 'F', 0.45);
    } else if (kind === moodKind(MOODS.reservoir)) {
      put('far', 'plain', x + 1.5, mid, -1, 3, span, 0.4, mood.wall, 'F');
      put('far', 'plain', x + 1 + r(5), bottom + span * 0.2 * r(6), -0.5, 2.4, span * (0.2 + 0.3 * r(7)), 0.8, mood.frame, 'FTR');
      if (r(8) < 0.45) spire('far', x + 0.6 + 1.8 * r(9), bottom + 0.5, 1.6 + 1.6 * r(10), 0.6);
    } else if (kind === moodKind(MOODS.foundry)) {
      put('far', 'plain', x + 1.5, mid, -1, 3, span, 0.4, mood.wall, 'F');
      put('far', 'plain', x + 1.6, (Y0 + Y1) / 2 + 2, -0.5, 3.2, 0.6, 0.5, mood.frame, 'FTR');
      if (i % 5 === 0) {
        put('far', 'plain', x + 1.5, bottom + 4, -0.2, 3.4, 8, 1, mood.frame, 'FTR');
        put('far', 'plain', x + 1.5, bottom + 8.4, -0.2, 2.4, 0.8, 1, mood.frame, 'FTR');
      }
      if (i % 7 === 3) put('far', 'plain', x + 1.5, mid + 3, -0.3, 1.2, span * 0.7, 0.8, mood.frame, 'FTR');
      if (r(9) < 0.3) put('far', 'emissive', x + 1.5, (Y0 + Y1) / 2 + 0.6, -0.9, 0.6, 0.9, 0.1, mood.accent, 'F', 0.5);
    } else {
      put('far', 'plain', x + 1.5, mid, -1, 3, span, 0.4, mood.wall, 'F');
      put('far', 'plain', x + 0.4, mid, -0.4, 0.8, span, 0.8, mood.frame, 'FTR');
      for (let y = Y0 + 8; y < Y1 - 6; y += 8) put('far', 'plain', x + 1.5, y, -0.7, 3, 0.6, 0.5, mood.frame, 'FTR');
    }
  }

  /** Six units of the mid layer: one near feature per identity, sparse enough to leave the route alone. */
  function midChunk(x, kind, mood) {
    const i = Math.round(x / 6);
    const r = (n) => hash(i, n, 62);
    const low = LOW + 6;
    const high = HIGH - 6;
    const tone = 1.5;
    if (kind === moodKind(MOODS.workshop)) {
      if (i % 2 === 0) put('mid', 'plain', x + 1, (low + high) / 2, -0.4, 1, high - low, 0.7, mood.frame, 'FTR', tone);
      if (r(1) < 0.6) put('mid', 'plain', x + 4, high - 2.5, -0.3, 0.1, 5, 0.1, 0x1e2328, 'FTR');
    } else if (kind === moodKind(MOODS.reservoir)) {
      put('mid', 'plain', x + 2 + 2 * r(1), low + 1.5, -0.5, 3.5, 3 + 3 * r(2), 1, mood.frame, 'FTR', tone);
      if (r(3) < 0.6) spire('mid', x + 1 + 4 * r(4), low + 4.5, 2.4, 1.3);
    } else if (kind === moodKind(MOODS.foundry)) {
      put('mid', 'plain', x + 3, (LOW + HIGH) / 2 + 2, -0.4, 6.2, 0.5, 0.4, mood.frame, 'FTR', tone);
      if (i % 3 === 0) put('mid', 'plain', x + 3, low + 3.5, -0.2, 4, 7, 0.9, mood.frame, 'FTR', tone);
    } else {
      put('mid', 'plain', x + 0.5, (low + high) / 2, -0.3, 0.6, high - low, 0.6, mood.frame, 'FTR', tone);
    }
  }

  // Each chunk takes the identity of the region of the level it stands for.
  for (const [name, step, draw] of [['far', 3, farChunk], ['mid', 6, midChunk]]) {
    const k = LAYERS[name].kx;
    const [from, to] = spanX(k, 16);
    for (let x = Math.floor(from / step) * step; x < to; x += step) {
      const mood = moodOf(regionAt(ref.x + (x + step / 2 - ref.x) / k));
      draw(x, moodKind(mood), mood);
    }
  }

  // --- Conduits: one merged pipe for all of them, and per conduit a core that lights up and the halo around it ---
  const wiring = new THREE.Group();
  const wiringAt = depthOffset(LAYERS.wall.depth);
  wiring.position.set(wiringAt.x, wiringAt.y, wiringAt.z);
  const pipes = new VoxelBuilder();
  /** The parts of one conduit at the wall face; `points` are `[x, y]` pairs or `{ x, y }`, in absolute units. */
  function conduit(d) {
    const points = (d.points ?? []).map((point) => (Array.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y }));
    const view = { id: d.id, poweredBy: d.poweredBy ?? [], lit: false, flash: 0, halo: null, core: null };
    if (points.length < 2) return view;
    const run = (builder, thick, z, depth, color) => {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const end = points[i + 1];
        const dx = end.x - a.x;
        const dy = end.y - a.y;
        if (dx === 0 || dy === 0) {
          builder.box(a.x + dx / 2, a.y + dy / 2, z, Math.abs(dx) + thick, Math.abs(dy) + thick, depth, color, 'FTR');
        } else {
          const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (thick / 2));
          for (let k = 0; k <= steps; k++) builder.box(a.x + (dx * k) / steps, a.y + (dy * k) / steps, z, thick, thick, depth, color, 'FTR');
        }
      }
      for (const point of points) builder.box(point.x, point.y, z, thick * 1.7, thick * 1.7, depth, color, 'FTR');
    };
    run(pipes, 0.14, -0.01, 0.08, PALETTE.bronze);
    const core = new VoxelBuilder();
    run(core, 0.06, 0.035, 0.02, PALETTE.amber);
    view.core = mesh(core.build(), 'emissive');
    const glow = new VoxelBuilder();
    glow.alpha = 0.32;
    run(glow, 0.3, 0.045, 0.005, PALETTE.amber);
    view.halo = mesh(glow.build(), 'glow');
    view.halo.material = material('glow').clone();
    ownedMaterials.push(view.halo.material);
    view.halo.visible = false;
    return view;
  }

  // --- Decor of the level ---
  for (const d of level.decor ?? []) {
    const name = LAYER_OF[d.kind];
    if (name === undefined) continue; // unknown kinds are skipped
    const { x, y } = d;
    const seed = seedOf(x, y);
    const model = parts();
    switch (d.kind) {
      case 'sign': {
        const tokens = signTokens(d.text, touch);
        const width = Math.max(1.2, signLayout(tokens).width / SIGN_PX);
        model.box('plain', 0, 0, -0.06, width, SIGN_H, 0.12, PALETTE.backing, 'FTR');
        for (const sy of [-1, 1]) model.box('plain', 0, (sy * SIGN_H) / 2 - sy * 0.03, 0.002, width, 0.06, 0.012, PALETTE.bronze, 'F');
        for (const hx of [-width / 3, width / 3]) model.box('plain', hx, SIGN_H / 2 + 0.3, -0.04, 0.05, 0.6, 0.05, PALETTE.steelDark);
        const b = band(name, x, y);
        place(name, model.map, x, y);
        // Without a canvas the sign is the plain plate above.
        const map = signMap(tokens);
        if (map !== null) {
          const face = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.14, SIGN_H - 0.14), new THREE.MeshBasicMaterial({ map }));
          face.position.set(x - b.ax, y - b.ay, 0.012);
          b.group.add(face);
          ownedMaterials.push(face.material);
        }
        break;
      }
      case 'conduit':
        conduits.push(conduit(d));
        break;
      case 'cable': {
        const len = Math.max(0.5, d.len ?? 3);
        const bend = (hash(seed, 2, 5) - 0.5) * 0.8;
        const count = Math.ceil(len / 0.2);
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count;
          model.box('plain', bend * t * t, -len * t, -0.05, 0.09, len / count + 0.01, 0.09, i % 4 === 3 ? PALETTE.bronze : 0x1e2328, 'FTR');
        }
        model.box('plain', bend, -len - 0.07, -0.05, 0.16, 0.16, 0.16, PALETTE.steel, 'FTR');
        mover(name, model.map.get('plain'), 'plain', x, y, 0, 'sway', 0.9, 0.07);
        break;
      }
      case 'lightShaft':
        MODELS.lightShaft(model, d);
        place(name, model.map, x, y);
        for (let row = 0; row < Math.max(1, d.h ?? 4) / 0.5; row++) {
          model.box('emissive', 0.3 + 1.1 * hash(row, 3, seed) + row * 0.14, -row * 0.5 - 0.5 * hash(row, 4, seed), 0.01, 0.05, 0.05, 0.01, 0xfff6dc, 'F');
        }
        mover(name, model.map.get('emissive'), 'emissive', x, y, 0, 'fall', 0.22, 0.5);
        break;
      case 'waterfall':
        MODELS.waterfall(model, d);
        place(name, model.map, x, y);
        for (let row = 0; row < Math.max(2, d.h ?? 8) / 0.6; row++) {
          model.box('emissive', (hash(row, 5, seed) - 0.5) * 0.6, -row * 0.6 - 0.6 * hash(row, 6, seed), 0.01, 0.06, 0.3, 0.01, 0xe6fbff, 'F');
        }
        mover(name, model.map.get('emissive'), 'emissive', x, y, 0, 'fall', 2.4, 0.6);
        break;
      case 'machine':
        machine(model, d, (builder, dy, travel, motion) => mover(name, builder, 'plain', x, y, dy, motion, motion === 'spin' ? 0.8 : 1.1, travel));
        place(name, model.map, x, y);
        break;
      default:
        MODELS[d.kind](model, d, seed);
        place(name, model.map, x, y);
    }
  }
  for (const view of conduits) if (view.core !== null) wiring.add(view.core, view.halo);
  if (!pipes.empty) wiring.add(mesh(pipes.build(), 'plain'));
  root.add(wiring);

  for (const b of bands.values()) {
    for (const [kind, builder] of b.builders) {
      if (builder.empty) continue;
      if (kind === 'pool') {
        const pool = new THREE.Mesh(builder.build(), glazed);
        b.group.add(pool);
      } else {
        b.group.add(mesh(builder.build(), kind));
      }
    }
  }

  // --- The ruins of the terrace over the lift: a mesh per piece, on the near layer, so behind the actors ---
  if (level.ascent) {
    const ruins = new THREE.Group();
    ruins.name = 'ruins';
    const at = depthOffset(LAYERS.near.depth);
    ruins.position.set(at.x, at.y, at.z);
    for (const [name, dx, model] of TERRACE) {
      const builder = new VoxelBuilder();
      model(builder);
      const piece = mesh(builder.build(), 'rock');
      piece.name = `ruin:${name}`;
      piece.position.set(level.ascent.x + dx, bounds.y1, 0);
      ruins.add(piece);
    }
    root.add(ruins);
  }

  // --- Lights: a cool sky and a warm floor, one key light from the viewer's upper right, and the dawn ---
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  // Intensities are set so that a front face shows about its own color under Three.js (irradiance over pi near 1),
  // a top face a little more, a side face darker.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 3.0);
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(...[0, 1, 2].map((i) => (KEY.right * e[i] + KEY.sky * e[4 + i] + KEY.viewer * e[8 + i]) * 20));
  const dawnLight = new THREE.DirectionalLight(0xffcf94, 0);
  scene.add(hemi, key);
  let dawnGlow = null;
  let opening = null;
  const fading = []; // the meshes of the opening whose material takes the fade; the dawn glow multiplies by it
  if (level.ascent) {
    opening = new THREE.Group();
    opening.name = 'opening';
    const pale = new VoxelBuilder();
    for (const [sy, h, w] of FACE) pale.box(0, sy, -0.1, w, h, 0.1, 0xe9f1f8, 'F');
    // The pale face and the spill have materials of their own, so that both fade with the view.
    const paleFace = mesh(pale.build(), 'emissive');
    paleFace.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    ownedMaterials.push(paleFace.material);
    opening.add(paleFace);
    fading.push(paleFace);
    const spill = new VoxelBuilder();
    spill.quad([[-6.5, -4.5, 0.2], [6.5, -4.5, 0.2], [6.5, 4.5, 0.2], [-6.5, 4.5, 0.2]], [[0xcfe6f2, 0], [0xcfe6f2, 0], [0xdceaf4, 0.5], [0xdceaf4, 0.5]]);
    for (const sx of [-1, 1]) {
      spill.quad([[sx * 2 - 0.6, -1.6, 0.3], [sx * 2 + 0.6, -1.6, 0.3], [sx * 6.5, -12, 0.3], [sx * 4.5, -12, 0.3]],
        [[0xdceaf4, 0.2], [0xdceaf4, 0.2], [0xdceaf4, 0], [0xdceaf4, 0]]);
    }
    const spillFace = mesh(spill.build(), 'glow');
    spillFace.material = material('glow').clone();
    ownedMaterials.push(spillFace.material);
    opening.add(spillFace);
    fading.push(spillFace);
    const warm = new VoxelBuilder();
    warm.quad([[-6.5, -4.5, 0.6], [6.5, -4.5, 0.6], [6.5, 4.5, 0.6], [-6.5, 4.5, 0.6]], [[0xffc98a, 0.7], [0xffc98a, 0.7], [0xffc98a, 0.7], [0xffc98a, 0.7]]);
    dawnGlow = new THREE.Mesh(warm.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    dawnGlow.name = 'dawnGlow';
    dawnGlow.material.opacity = 0;
    ownedMaterials.push(dawnGlow.material);
    opening.add(dawnGlow);
    dawnLight.position.set(level.ascent.x + 1.5, bounds.y1 + 8, 3);
    dawnLight.target.position.set(level.ascent.x, bounds.y1, 0);
    scene.add(dawnLight, dawnLight.target);
    root.add(opening);
  }
  const first = moodOf(regionAt(level.spawn.x));
  hemi.color.setHex(first.sky);
  hemi.groundColor.setHex(first.ground);
  scene.background.setHex(first.backdrop);

  let time = 0;
  let reduced = false;
  let stage = null;
  let surfaceT = 0;
  let fade = 0; // how much of the pale opening shows, 0 to 1
  const sky = new THREE.Color();
  const ground = new THREE.Color();
  const backdrop = new THREE.Color();
  const warmSky = new THREE.Color(0x3a3028);

  /** `view` is the camera rig's view of the frame. Decorative motion uses `dt` only, so it stops while `dt` is 0. */
  function sync(world, dt, events, view) {
    time += dt;
    for (const b of bands.values()) {
      const { kx, ky } = b.layer;
      if (kx === 1) continue;
      b.group.position.set(b.ax + (1 - kx) * (view.x - b.ax) + b.shift.x, b.ay + (1 - ky) * (view.y - b.ay) + b.shift.y, b.shift.z);
    }
    // Over the chimney from the service platform, over the lift from the top platform, above the cabin through the rise.
    // West of the service platform the opening fades out of the view, every material of it.
    if (opening !== null) {
      const deck = world.ascent?.cabinY ?? level.ascent.y; // the floor of the cabin now
      const lift = world.mode === 'liftSequence' || world.mode === 'complete'; // on the ride the view starts below the cabin
      const inside = lift ? OPENING.inside.lift : OPENING.inside.play;
      // As far up as the view allows, and inside the free part of it, clear of the bands of the interface.
      const up = Math.max(view.y - inside, Math.min(view.y + inside, deck + OPENING.above));
      opening.position.set(
        level.ascent.x + OPENING.over + (1 - OPENING.kx) * (view.x - level.ascent.x) + OPENING.at.x,
        Math.max(view.free.y0 + OPENING.half + OPENING.clear, Math.min(view.free.y1 - OPENING.half - OPENING.clear, up)) + OPENING.at.y,
        OPENING.at.z,
      );
      fade = clamp((view.x - OPENING.fade[0]) / (OPENING.fade[1] - OPENING.fade[0]), 0, 1);
      opening.visible = fade > 0;
      for (const face of fading) face.material.opacity = fade;
    }
    for (const a of animated) {
      if (reduced || Math.hypot(a.x - view.x, a.y - view.y) > RANGE) continue; // suspended far from the camera
      const s = Math.sin(time * a.speed + a.phase);
      if (a.kind === 'fall') a.object.position.y = a.base - ((time * a.speed + a.phase) % a.travel);
      else if (a.kind === 'slide') a.object.position.y = a.base + a.travel * s;
      else if (a.kind === 'spin') a.object.rotation.z = time * a.speed + a.phase;
      else a.object.rotation.z = a.travel * (0.6 * s + 0.4 * Math.sin(time * 2.3 + a.phase));
    }
    for (const c of conduits) {
      if (c.core === null) continue;
      // Lit by anything that powers it, or by the reveal marker of a conduit while its reveal is showing.
      const lit = c.poweredBy.some((id) => powered(world, id)) || (world.reveals ?? []).some((r) => r.ref === c.id && r.revealedUntil > world.time);
      c.core.material = lit ? material('emissive') : dim;
      c.halo.visible = lit;
      if (lit && !c.lit) c.flash = 1;
      c.lit = lit;
      if (lit) c.halo.material.opacity = 0.55 + 0.45 * (c.flash = Math.max(0, c.flash - dt / 0.6));
    }
    // The identity of ILO's region; a new one fades in.
    const mood = moodOf(regionAt(world.player.x));
    const blend = 1 - Math.exp(-2 * dt);
    hemi.color.lerp(sky.setHex(mood.sky), blend);
    hemi.groundColor.lerp(ground.setHex(mood.ground), blend);
    // Warm dawn light comes in during the `surface` stage of the lift and stays for the terrace and the end.
    const now = world.mode === 'complete' ? 'terrace' : world.mode === 'liftSequence' ? (world.ascent?.stage ?? null) : null;
    if (now !== stage) {
      if (now === 'surface') surfaceT = 0;
      stage = now;
    }
    if (now === 'surface') surfaceT += dt;
    const dawn = now === null ? 0 : now === 'surface' ? smooth(Math.min(1, surfaceT / DAWN_TIME)) : 1;
    dawnLight.intensity = 5 * dawn;
    if (dawnGlow !== null) dawnGlow.material.opacity = dawn * fade;
    scene.background.lerp(backdrop.setHex(mood.backdrop).lerp(warmSky, dawn * 0.8), blend);
  }

  function dispose() {
    scene.remove(root, hemi, key, dawnLight, dawnLight.target);
    root.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      object.material.map?.dispose();
    });
    for (const own of ownedMaterials) own.dispose();
  }

  return {
    sync,
    /** With reduced motion nothing decorative moves. */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose,
  };
}
