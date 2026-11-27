// Props (contract §5.1): the objects of GOAL §11 as voxel models: power cells, sockets, relays, stations, archives,
// caches, vents, switches, the movers, the ascent lift, and the outline of what E acts on now.

import * as THREE from '../../vendor/three/three.module.js';
import { LIFT, PLAYER } from '../config.js';
import { particleMesh, particlePool } from './effects.js';
import { PALETTE, VoxelBuilder, hash, material } from './voxel.js';

const Z = 0.12; // world z of the back face of a prop: in front of the terrain (z 0) and of wall-mounted scenery (z 0.1)
const DECK = -0.06; // world z of the back face of what ILO stands on (cells, movers), so that the top meets ILO's feet
const FRONT = 0.8; // world z of the interact outline: in front of every prop and of ILO
const HANDS = 0.16; // seconds a cell takes to reach ILO's hands, the ground or its socket
const BARRIER_OPEN = 0.5; // seconds the lift's barrier takes to open once the terrace stage begins
const CELL_Z = { loose: 0.2, socketed: Z + 0.27 }; // world z of the middle of a cell that is not carried
const RUST = 0x8a4a2c; // painted salvage steel
const DARK = 0x161b21; // the inside of a housing
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = (t) => t * t * (3 - 2 * t);
const rivet = (b, x, y, z) => b.box(x, y, z, 0.06, 0.06, 0.01, PALETTE.metalEdge, 'F');
const travelKey = (def) => [def.fx, def.fy, def.tx, def.ty, def.w, def.h].join(',');

/** Hazard stripes `w × h` on a front face at depth `z`: amber and charcoal in a stepped two-row pattern. */
function hazard(b, cx, cy, w, h, z) {
  const columns = Math.max(2, Math.round(w / 0.16));
  for (let i = 0; i < columns; i++) {
    for (let row = 0; row < 2; row++) {
      b.box(cx - w / 2 + ((i + 0.5) * w) / columns, cy - h / 4 + row * (h / 2), z, w / columns, h / 2, 0.01, (i + row) % 2 === 0 ? PALETTE.charcoal : PALETTE.amber, 'F');
    }
  }
}

/** Soft light: six nested diamonds, each a little brighter than the last, that add up to a glowing middle. */
function halo(b, cx, cy, rx, ry, z, color) {
  for (let i = 0; i < 6; i++) {
    const tint = [color, 0.05];
    const k = 1 - i * 0.15;
    b.quad([[cx - rx * k, cy, z], [cx, cy + ry * k, z], [cx + rx * k, cy, z], [cx, cy - ry * k, z]], [tint, tint, tint, tint]);
  }
}

// --- Cells and sockets ---

/** A power cell in the frame of its bottom center, z about its middle: a faceted amber block in a steel case with a grab bar. */
function cellCase() {
  const b = new VoxelBuilder();
  b.box(0, 0.03, 0, 0.8, 0.06, 0.46, PALETTE.steelDark);
  b.box(0, 0.08, 0, 0.94, 0.04, 0.52, PALETTE.steelDark);
  b.box(0, 0.52, 0, 0.84, 0.84, 0.38, 0xb07428);
  b.box(0, 0.52, 0, 0.52, 0.84, 0.5, 0xc98a30);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.41, 0.52, sz * 0.17, 0.06, 0.86, 0.06, PALETTE.bronze);
  b.box(0, 1.02, 0, 0.94, 0.16, 0.52, PALETTE.steel);
  b.box(0, 1.101, 0, 0.5, 0.006, 0.1, 0x1e2328, 'FT');
  b.box(0, 1.104, 0, 0.4, 0.006, 0.04, PALETTE.bronze, 'FT');
  b.box(0, 0.74, 0.3, 0.5, 0.07, 0.07, PALETTE.bronze, 'FTRL');
  for (const sx of [-1, 1]) b.box(sx * 0.22, 0.74, 0.27, 0.07, 0.07, 0.06, PALETTE.bronze);
  return b;
}

/** The windows of a cell: the amber charge that shows through its case. */
function cellLight() {
  const b = new VoxelBuilder();
  b.box(0, 0.52, 0.252, 0.36, 0.6, 0.008, 0xffb54a, 'F');
  b.box(0, 0.52, 0.258, 0.16, 0.44, 0.008, 0xffe2a8, 'F');
  b.box(0.422, 0.52, 0, 0.008, 0.3, 0.16, 0xffb54a, 'R');
  b.box(-0.422, 0.52, 0, 0.008, 0.3, 0.16, 0xffb54a, 'L');
  return b;
}

/** A socket housing in the frame of its bottom center: a steel frame around a dark cavity with contact rails. */
function socketCase() {
  const b = new VoxelBuilder();
  b.box(0, 0.75, 0.04, 1.2, 1.5, 0.08, PALETTE.steelDark);
  b.box(0, 0.66, 0.19, 0.96, 1.02, 0.22, DARK);
  b.box(0, 0.075, 0.22, 1.2, 0.15, 0.44, PALETTE.steel);
  b.box(0, 1.335, 0.22, 0.96, 0.33, 0.44, PALETTE.steel);
  b.box(0, 1.5, 0.24, 1.26, 0.06, 0.48, PALETTE.bronze);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.54, 0.75, 0.2, 0.12, 1.5, 0.4, PALETTE.steel);
    for (const y of [0.32, 1.18]) rivet(b, sx * 0.54, y, 0.405);
    b.box(sx * 0.3, 0.66, 0.315, 0.07, 0.9, 0.03, PALETTE.bronze);
    b.box(sx * 0.3, 1.53, 0.14, 0.1, 0.08, 0.1, PALETTE.bronze);
  }
  return b;
}

/** The status slot of a socket: lit while a cell powers it. */
function socketSlot() {
  const b = new VoxelBuilder();
  b.box(0, 1.3, 0.45, 0.62, 0.07, 0.02, PALETTE.amber, 'FTR');
  return b;
}

// --- Relays and stations ---

/** A relay tower in the frame of its node: a plinth and a mast that hold the crystal `y` above the ground (-1.2). */
function relayTower() {
  const b = new VoxelBuilder();
  b.box(0, -1.11, 0.25, 1.0, 0.18, 0.5, PALETTE.steelDark);
  b.box(0, -0.95, 0.22, 0.66, 0.14, 0.4, PALETTE.steel);
  b.box(0, -0.2, 0.12, 0.16, 1.36, 0.1, PALETTE.bronze);
  for (const y of [-0.72, -0.2, 0.4]) b.box(0, y, 0.12, 0.24, 0.06, 0.12, PALETTE.steelDark);
  b.box(0, 0, 0.24, 0.1, 0.1, 0.16, PALETTE.bronze);
  b.box(0, -0.44, 0.36, 0.36, 0.06, 0.3, PALETTE.bronze);
  b.box(-0.3, -0.02, 0.3, 0.14, 0.34, 0.14, PALETTE.crystal, 'FTR');
  b.box(0.27, 0.16, 0.3, 0.12, 0.26, 0.12, PALETTE.crystal, 'FTR');
  return b;
}

/** The resonance node: a crystal with a ring of sixteen voxels around it. */
function relayNode() {
  const b = new VoxelBuilder();
  b.box(0, 0.06, 0.38, 0.34, 0.36, 0.2, PALETTE.crystal);
  b.box(0, 0.06, 0.38, 0.2, 0.7, 0.14, PALETTE.crystal);
  b.box(0, 0.06, 0.485, 0.1, 0.46, 0.01, PALETTE.crystalCore, 'F');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.box(Math.cos(a) * 0.64, 0.06 + Math.sin(a) * 0.64, 0.38, 0.11, 0.11, 0.06, PALETTE.crystalCore);
  }
  return b;
}

/** The light of an active relay. */
function relayHalo() {
  const b = new VoxelBuilder();
  halo(b, 0, 0.06, 0.95, 0.95, 0.2, PALETTE.crystal);
  return b;
}

/** A station in the frame of its ground point: a docking column with arms. */
function stationBody() {
  const b = new VoxelBuilder();
  b.box(0, 0.03, 0.28, 1.0, 0.06, 0.56, PALETTE.steelDark);
  b.box(0, 0.9, 0.23, 0.4, 1.68, 0.22, PALETTE.steel);
  b.box(0, 1.8, 0.25, 0.5, 0.08, 0.26, PALETTE.bronze);
  for (const y of [0.5, 1.34]) b.box(0, y, 0.345, 0.44, 0.04, 0.01, PALETTE.bronze, 'FTR');
  for (const sx of [-1, 1]) {
    b.box(sx * 0.44, 1.22, 0.18, 0.48, 0.07, 0.12, PALETTE.bronze);
    b.box(sx * 0.66, 1.0, 0.18, 0.06, 0.44, 0.12, PALETTE.steelDark);
  }
  return b;
}

/** The teal light of a station: a bar on the column, a lamp in the cap and a strip on the floor. */
function stationLight() {
  const b = new VoxelBuilder();
  b.box(0, 1.05, 0.345, 0.1, 0.9, 0.01, PALETTE.teal, 'F');
  b.box(0, 1.765, 0.3, 0.3, 0.03, 0.16, PALETTE.teal, 'FT');
  b.box(0, 0.065, 0.5, 0.9, 0.012, 0.03, PALETTE.teal, 'FT');
  return b;
}

/** The soft light an active station casts. */
function stationHalo() {
  const b = new VoxelBuilder();
  halo(b, 0, 1.5, 0.75, 0.65, 0.36, PALETTE.teal);
  return b;
}

// --- Archives and caches ---

/** A pedestal in the frame of its ground point. */
function archivePedestal() {
  const b = new VoxelBuilder();
  b.box(0, 0.04, 0.22, 0.6, 0.08, 0.44, PALETTE.steelDark);
  b.box(0, 0.3, 0.2, 0.4, 0.44, 0.34, PALETTE.steel);
  b.box(0, 0.55, 0.22, 0.56, 0.06, 0.44, PALETTE.bronze);
  b.box(0, 0.62, 0.22, 0.4, 0.08, 0.3, PALETTE.steelDark);
  return b;
}

/** The memory shard on its pedestal and its faint teal glow. */
function archiveShard() {
  const b = new VoxelBuilder();
  b.box(0.02, 0.98, 0.24, 0.12, 0.6, 0.1, [PALETTE.crystalCore, 0.9]);
  b.box(0.02, 0.8, 0.24, 0.2, 0.26, 0.14, [PALETTE.crystal, 0.9]);
  b.box(-0.13, 0.74, 0.24, 0.1, 0.22, 0.1, [PALETTE.crystal, 0.85]);
  b.box(0.15, 0.72, 0.24, 0.08, 0.16, 0.09, [PALETTE.crystal, 0.85]);
  halo(b, 0.02, 0.9, 0.5, 0.75, 0.3, PALETTE.crystal);
  return b;
}

/** A salvage crate in the frame of its bottom center: `open` stands the lid up at the back and empties the crate. */
function cacheCrate(open) {
  const b = new VoxelBuilder();
  b.box(0, 0.28, 0.3, 0.9, 0.56, 0.6, RUST);
  b.box(0, 0.3, 0.3, 0.94, 0.05, 0.64, PALETTE.bronze);
  b.box(0, 0.52, 0.3, 0.94, 0.05, 0.64, PALETTE.bronze);
  const lid = open ? [6, 0.1, 0.05, -0.012] : [4, 0.12, 0.05, 0.05];
  for (let i = 0; i < lid[0]; i++) {
    b.box(0, 0.62 + i * lid[1], lid[2] + i * lid[3], 0.9, 0.1, 0.05, i % 2 === 0 ? PALETTE.steel : PALETTE.steelDark, 'FTRL');
  }
  if (open) {
    b.box(0, 0.565, 0.34, 0.84, 0.01, 0.52, 0x0d0a08, 'T');
  } else {
    b.box(-0.2, 0.64, 0.34, 0.16, 0.1, 0.14, PALETTE.steel);
    b.box(0.12, 0.66, 0.4, 0.12, 0.14, 0.12, PALETTE.bronze);
    b.box(0.28, 0.62, 0.26, 0.1, 0.08, 0.1, PALETTE.rust);
    b.box(-0.02, 0.67, 0.3, 0.08, 0.14, 0.08, PALETTE.crystal);
  }
  return b;
}

/** The glint on the scrap of a cache that is still there to take. */
function cacheGlint() {
  const b = new VoxelBuilder();
  b.box(-0.02, 0.745, 0.3, 0.05, 0.01, 0.05, PALETTE.amber, 'FT');
  b.box(0.12, 0.735, 0.4, 0.06, 0.01, 0.06, 0xffd890, 'FT');
  b.box(0.3, 0.665, 0.26, 0.05, 0.01, 0.05, PALETTE.amber, 'FT');
  return b;
}

// --- Vents and switches ---

/** A floor grate in the frame of the vent's base center: a curb with slats over a dark mouth. */
function ventGrate() {
  const b = new VoxelBuilder();
  b.box(0, 0.05, 0.4, 1.0, 0.1, 0.8, PALETTE.steelDark);
  b.box(0, 0.1, 0.4, 0.8, 0.012, 0.6, DARK, 'T');
  for (const x of [-0.24, -0.08, 0.08, 0.24]) b.box(x, 0.11, 0.4, 0.07, 0.02, 0.6, PALETTE.steel, 'FTR');
  b.box(0, 0.1, 0.765, 1.0, 0.014, 0.07, PALETTE.metalEdge, 'FT');
  hazard(b, 0, 0.05, 1.0, 0.07, 0.805);
  for (const x of [-0.44, 0.44]) for (const z of [0.06, 0.74]) b.box(x, 0.104, z, 0.07, 0.01, 0.07, PALETTE.metalEdge, 'T');
  return b;
}

/** A jet one unit tall and one unit wide in the frame of the jet rect's bottom center: scaled, it fills the rect. */
function ventJet() {
  const b = new VoxelBuilder();
  b.box(0, 0.5, 0.34, 1, 1, 0.36, [0xffa060, 0.2]);
  b.box(0, 0.5, 0.34, 0.62, 1, 0.34, [0xffc890, 0.26]);
  b.box(0, 0.5, 0.34, 0.24, 1, 0.3, [0xfff0d8, 0.45]);
  return b;
}

/** A wall lever in the frame of its plate's bottom center: the handle hangs left when it is off and stands right when it is on. */
function switchPlate(on) {
  const b = new VoxelBuilder();
  const k = on ? 1 : -1;
  b.box(0, 0.36, 0.04, 0.56, 0.72, 0.08, PALETTE.bronze);
  b.box(0, 0.36, 0.09, 0.48, 0.64, 0.02, PALETTE.steelDark);
  for (const sx of [-1, 1]) for (const y of [0.1, 0.62]) rivet(b, sx * 0.24, y, 0.1);
  b.box(0, 0.36, 0.13, 0.16, 0.16, 0.06, PALETTE.steel);
  for (let i = 1; i <= 4; i++) b.box(k * 0.05 * i, 0.36 + k * 0.045 * i, 0.16, 0.06, 0.06, 0.06, PALETTE.charcoal);
  b.box(k * 0.22, 0.36 + k * 0.2, 0.17, 0.13, 0.13, 0.11, on ? 0xffe2a8 : PALETTE.rust);
  b.box(0, 0.36, 0.105, 0.1, 0.1, 0.01, on ? PALETTE.amber : 0x3a1510, 'F');
  return b;
}

// --- Movers: platforms, shutters, lifts, presses ---

/** A service platform in the frame of its rect's corner (bottom left, back). */
function platformBody(w) {
  const b = new VoxelBuilder();
  b.box(w / 2, 0.44, 0.39, w, 0.12, 0.78, PALETTE.metalEdge);
  b.tone = 0.9;
  b.box(w / 2, 0.3, 0.36, w, 0.16, 0.66, PALETTE.steel);
  b.tone = 1;
  for (const x of [0.03, w - 0.03]) b.box(x, 0.26, 0.39, 0.06, 0.52, 0.8, PALETTE.bronze, 'FTRL');
  const teeth = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < teeth; i++) {
    const x = ((i + 0.5) * w) / teeth;
    b.box(x, 0.12, 0.36, Math.min(0.3, w / teeth - 0.1), 0.2, 0.56, PALETTE.steelDark, 'FTR');
    b.box(x, 0.0, 0.32, 0.14, 0.06, 0.46, PALETTE.steelDark, 'FTR');
  }
  for (let i = 0; i <= teeth; i++) rivet(b, 0.14 + ((w - 0.28) * i) / teeth, 0.3, 0.695);
  return b;
}

/** The edge lights of a platform: a stud at each end and a strip along its belly. */
function platformLight(w) {
  const b = new VoxelBuilder();
  for (const x of [0.12, w - 0.12]) b.box(x, 0.44, 0.785, 0.14, 0.06, 0.012, PALETTE.amber, 'F');
  b.box(w / 2, 0.215, 0.69, w - 0.3, 0.015, 0.012, PALETTE.amber, 'F');
  return b;
}

/** A guide rail between the two endpoints of a mover and a stop block at each: where it comes from and where it goes. */
function travelMarks(def) {
  const b = new VoxelBuilder();
  const { w, h } = def;
  const dx = def.tx - def.fx;
  const dy = def.ty - def.fy;
  const length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : 0;
  const uy = length > 0 ? dy / length : 0;
  b.box(def.fx + w / 2 + dx / 2, def.fy + h / 2 + dy / 2, 0.02, Math.abs(ux) * length + 0.05, Math.abs(uy) * length + 0.05, 0.04, PALETTE.bronze, 'F');
  const half = (Math.abs(ux) * w + Math.abs(uy) * h) / 2 + 0.1;
  for (const [ex, ey, sign] of [[def.fx + w / 2, def.fy + h / 2, -1], [def.tx + w / 2, def.ty + h / 2, 1]]) {
    const x = ex + ux * half * sign;
    const y = ey + uy * half * sign;
    b.box(x, y, 0.06, Math.abs(ux) * 0.14 + Math.abs(uy) * 0.36, Math.abs(ux) * 0.36 + Math.abs(uy) * 0.14, 0.12, PALETTE.steelDark, 'FTR');
    b.box(x, y, 0.125, Math.abs(ux) * 0.08 + Math.abs(uy) * 0.24, Math.abs(ux) * 0.24 + Math.abs(uy) * 0.08, 0.01, PALETTE.metalEdge, 'F');
  }
  return b;
}

/** A shutter plate in the frame of its rect's corner. */
function shutterPlate(w, h) {
  const b = new VoxelBuilder();
  b.box(w / 2, h / 2, 0.18, w, h, 0.36, PALETTE.steel);
  b.box(w / 2, h - 0.02, 0.18, w, 0.04, 0.36, PALETTE.metalEdge, 'FTR');
  b.box(w / 2, 0.03, 0.18, w, 0.06, 0.36, PALETTE.steelDark, 'FTR');
  const ribs = Math.max(1, Math.round(h / 0.9));
  for (let i = 0; i <= ribs; i++) b.box(w / 2, 0.4 + ((h - 0.8) * i) / ribs, 0.365, Math.max(0.1, w - 0.16), 0.06, 0.01, PALETTE.bronze, 'F');
  hazard(b, w / 2, 0.2, w - 0.04, 0.24, 0.368);
  return b;
}

/** The side rails a shutter runs in, from below its closed place to above its open one. */
function shutterRails(def) {
  const b = new VoxelBuilder();
  const low = Math.min(def.fy, def.ty) - 0.1;
  const high = Math.max(def.fy + def.h, def.ty + def.h) + 0.14;
  for (const x of [def.fx - 0.06, def.fx + def.w + 0.06]) {
    b.box(x, (low + high) / 2, 0.05, 0.08, high - low, 0.1, PALETTE.steelDark, 'FTR');
    b.box(x, high - 0.07, 0.105, 0.08, 0.14, 0.01, PALETTE.bronze, 'F');
  }
  return b;
}

/** A lift cabin in the frame of its rect's corner: a deck on a frame, a rail at the back. */
function liftBody(w) {
  const b = new VoxelBuilder();
  b.box(w / 2, 0.54, 0.42, w, 0.12, 0.96, PALETTE.metalEdge);
  b.tone = 0.9;
  b.box(w / 2, 0.3, 0.38, w, 0.36, 0.76, PALETTE.steel);
  b.tone = 1;
  for (let i = 0; i < 3; i++) b.box((w * (i + 0.5)) / 3, 0.06, 0.38, 0.14, 0.12, 0.66, PALETTE.bronze, 'FTR');
  for (const x of [0.06, w - 0.06]) b.box(x, 0.9, 0.04, 0.08, 0.6, 0.08, PALETTE.bronze, 'FTR');
  b.box(w / 2, 1.17, 0.04, w, 0.06, 0.06, PALETTE.bronze, 'FTR');
  b.box(w / 2, 0.9, 0.04, w, 0.05, 0.05, PALETTE.bronze, 'FTR');
  return b;
}

/** The light strip under the front edge of a cabin. */
function liftLight(w) {
  const b = new VoxelBuilder();
  b.box(w / 2, 0.47, 0.905, w - 0.2, 0.03, 0.012, PALETTE.teal, 'F');
  return b;
}

/** The guide rails a cabin runs on, with a stop at each end of its travel. */
function liftRails(def) {
  const b = new VoxelBuilder();
  const low = Math.min(def.fy, def.ty) - 0.14;
  const high = Math.max(def.fy, def.ty) + 1.6;
  for (const x of [def.fx - 0.1, def.fx + def.w + 0.1]) {
    b.box(x, (low + high) / 2, 0.04, 0.1, high - low, 0.08, PALETTE.steelDark, 'FTR');
    for (const y of [low + 0.07, high - 0.07]) b.box(x, y, 0.09, 0.14, 0.14, 0.02, PALETTE.metalEdge, 'F');
  }
  return b;
}

/** The head of a press in the frame of its rect's corner: an anvil under a banded block. */
function pressHead() {
  const b = new VoxelBuilder();
  b.box(1.5, 0.12, 0.36, 3, 0.24, 0.72, PALETTE.metalEdge);
  b.tone = 0.9;
  b.box(1.5, 0.87, 0.32, 2.8, 1.14, 0.6, PALETTE.steel);
  b.tone = 1;
  for (const y of [0.5, 1.1]) b.box(1.5, y, 0.33, 2.84, 0.14, 0.64, PALETTE.bronze, 'FTR');
  b.box(1.5, 1.46, 0.3, 3, 0.08, 0.56, PALETTE.steelDark);
  for (let i = 0; i < 12; i++) b.box(0.125 + i * 0.25, 0.12, 0.725, 0.25, 0.17, 0.01, i % 2 === 0 ? PALETTE.amber : PALETTE.charcoal, 'F');
  for (const x of [0.14, 2.86]) for (const y of [0.38, 1.26]) rivet(b, x, y, 0.625);
  return b;
}

/** The hazard lamps in the band of a press head. */
function pressLamps() {
  const b = new VoxelBuilder();
  for (const x of [0.75, 1.5, 2.25]) b.box(x, 0.8, 0.625, 0.24, 0.14, 0.012, PALETTE.hazard, 'F');
  return b;
}

/** The ram that joins the head of a press to its housing: one unit tall, stretched to the gap each frame. */
function pressRam() {
  const b = new VoxelBuilder();
  b.box(0, 0.5, 0, 0.22, 1, 0.22, PALETTE.steel);
  return b;
}

/** The hydraulic housing a press hangs from, in the frame of the top of its resting place. */
function pressHousing() {
  const b = new VoxelBuilder();
  b.box(0, 0.6, 0.26, 0.5, 1.2, 0.44, PALETTE.steelDark);
  for (const y of [0.03, 1.17]) b.box(0, y, 0.26, 0.64, 0.06, 0.56, PALETTE.bronze, 'FTR');
  b.box(0, 0.6, 0.485, 0.3, 0.7, 0.01, 0x1e2328, 'F');
  return b;
}

// --- Ascent lift ---

/** The cabin of the ascent lift in the frame of its floor, where ILO's feet stand: a deck under the floor, a cage of posts, rails. */
function ascentCabin(w) {
  const b = new VoxelBuilder();
  b.box(0, -0.33, 0.48, w, 0.42, 1.08, PALETTE.steel);
  b.box(0, -0.57, 0.48, w - 0.2, 0.06, 0.9, PALETTE.steelDark);
  b.box(0, -0.06, 0.48, w, 0.12, 1.08, PALETTE.metalEdge);
  for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) b.box(x, 1.2, 0.06, 0.14, 2.4, 0.12, PALETTE.steel, 'FTR');
  b.box(0, 2.4, 0.07, w, 0.16, 0.14, PALETTE.steel, 'F');
  b.box(0, 2.28, 0.06, w - 0.28, 0.05, 0.12, PALETTE.bronze, 'F');
  for (const y of [0.5, 1.7]) b.box(0, y, 0.05, w - 0.28, 0.06, 0.1, PALETTE.bronze, 'F');
  b.box(0, 1.2, 0.05, 0.1, 2.2, 0.1, PALETTE.bronze, 'F');
  return b;
}

/** The teal strips of the cabin: down both posts, under the beam, along the deck's front edge. */
function ascentLight(w) {
  const b = new VoxelBuilder();
  for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) b.box(x, 1.2, 0.125, 0.05, 1.9, 0.01, PALETTE.teal, 'F');
  b.box(0, 2.28, 0.125, w - 0.5, 0.02, 0.01, PALETTE.teal, 'F');
  b.box(0, -0.06, 1.025, w - 0.3, 0.03, 0.012, PALETTE.teal, 'F');
  return b;
}

/** The floor plate of the lift's console and the rails of its shaft, in the frame of the console's ground point; `dx` is the cabin's center. The plate is 0.06 units high: ILO stands on it, never in it. */
function ascentFixture(dx, rise) {
  const b = new VoxelBuilder();
  b.box(0, 0.03, 0.3, 1.1, 0.06, 0.7, PALETTE.steelDark);
  b.box(0, 0.065, 0.3, 0.9, 0.01, 0.5, PALETTE.steel, 'FT');
  for (const x of [dx - 2.1, dx + 2.1]) {
    b.box(x, rise / 2, 0.03, 0.12, rise, 0.06, PALETTE.steelDark, 'F');
    b.box(x, rise + 0.1, 0.04, 0.2, 0.16, 0.08, PALETTE.bronze, 'F');
  }
  return b;
}

/** The lit rim of the console's plate, with a cross where ILO stands: dark until every relay is active. */
function consoleLight() {
  const b = new VoxelBuilder();
  const y = 0.072;
  for (const [x, z, w, d] of [[0, 0.62, 1.02, 0.05], [0, -0.02, 1.02, 0.05], [-0.485, 0.3, 0.05, 0.69], [0.485, 0.3, 0.05, 0.69]]) b.box(x, y, z, w, 0.012, d, PALETTE.teal, 'FT');
  b.box(0, y, 0.3, 0.36, 0.012, 0.06, PALETTE.teal, 'FT');
  b.box(0, y, 0.3, 0.06, 0.012, 0.36, PALETTE.teal, 'FT');
  return b;
}

/** The boarding area painted on the floor in the frame of its corner: a line along its front edge and a tick at each end. */
function boardingMarks(w) {
  const b = new VoxelBuilder();
  b.box(w / 2, 0.006, 0.5, w, 0.012, 0.04, PALETTE.teal, 'FT');
  for (const x of [0, w]) b.box(x, 0.006, 0.25, 0.04, 0.012, 0.54, PALETTE.teal, 'FT');
  for (let x = 0.5; x < w; x += 1) b.box(x, 0.006, 0.2, 0.3, 0.012, 0.03, PALETTE.teal, 'FT');
  return b;
}

/** The protective barrier of the cabin in the frame of its floor: a frame of light with a film of light between. */
function ascentBarrier(w) {
  const b = new VoxelBuilder();
  const film = [PALETTE.teal, 0.14];
  b.quad([[-w / 2, 0, 1.0], [w / 2, 0, 1.0], [w / 2, 2.3, 1.0], [-w / 2, 2.3, 1.0]], [film, film, film, film]);
  for (const y of [0.02, 2.3]) b.box(0, y, 1.0, w, 0.05, 0.03, [PALETTE.crystalCore, 0.9], 'F');
  for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) b.box(x, 1.15, 1.0, 0.05, 2.3, 0.03, [PALETTE.crystalCore, 0.9], 'F');
  for (const y of [0.57, 1.15, 1.73]) b.box(0, y, 1.0, w - 0.08, 0.03, 0.02, [PALETTE.crystalCore, 0.5], 'F');
  return b;
}

/** The outline of a unit rect from (-0.5, 0) to (0.5, 1): four corner brackets. */
function outlineFrame() {
  const b = new VoxelBuilder();
  for (const sx of [-1, 1]) for (const sy of [0, 1]) {
    b.box(sx * 0.4, sy, 0, 0.2, 0.05, 0.02, PALETTE.text, 'F');
    b.box(sx * 0.5, sy === 0 ? 0.1 : 0.9, 0, 0.05, 0.2, 0.02, PALETTE.text, 'F');
  }
  return b;
}

/** How far into its warning a vent is, from 0 to 1: the simulation keeps only the stage. */
function warningPart(vent) {
  const phase = (vent.t - vent.delay) % vent.period;
  return clamp((phase - (vent.period - vent.warn - vent.active)) / vent.warn, 0, 1);
}

/** The rect `[x, y, w, h]` that E's target covers, or null when the world has no such object. */
function targetRect(world, target) {
  if (target.kind === 'lift') {
    const ascent = world.ascent;
    return ascent !== null && ascent !== undefined && ascent.id === target.id ? [ascent.console.x - 0.55, ascent.console.y, 1.1, 0.1] : null;
  }
  const list = { insert: world.sockets, place: world.cells, pickup: world.cells, remove: world.cells, switch: world.switches, cache: world.caches, archive: world.archives }[target.kind];
  const object = list?.find((item) => item.id === target.id);
  if (object === undefined) return null;
  return object.w === undefined ? [object.x - 0.5, object.y, 1, PLAYER.h] : [object.x - object.w / 2, object.y, object.w, object.h];
}

/**
 * The objects of `level` as `{ sync(world, dt, events), setReducedMotion(on), pools, dispose() }`. `ilo` is ILO's
 * actor: a carried cell sits at `ilo.carryAnchor()`. With reduced motion nothing flickers or trembles.
 */
export function createProps(scene, level, ilo) {
  const root = new THREE.Group();
  root.name = 'props';
  scene.add(root);
  const still = new THREE.Group(); // what never moves, in level coordinates
  still.position.z = Z;
  root.add(still);
  const geometries = new Set();
  const materials = new Set();
  const shapes = new Map();
  /** The geometry every prop of `key` shares, built once by `make`. */
  const shape = (key, make) => {
    let geometry = shapes.get(key);
    if (geometry === undefined) shapes.set(key, geometry = make().build());
    geometries.add(geometry);
    return geometry;
  };
  const lit = (geometry) => new THREE.Mesh(geometry, material('plain'));
  /** A glowing part with a material of its own, so `sync` can dim or brighten it; `additive` makes it translucent light. */
  const glowPart = (geometry, additive) => {
    const object = new THREE.Mesh(geometry, additive ? material('glow').clone() : new THREE.MeshBasicMaterial({ vertexColors: true }));
    materials.add(object.material);
    return object;
  };
  const unlit = (geometry) => new THREE.Mesh(geometry, material('emissive'));
  /** A named group for the object `kind:id` at the level's `(x, y)`. */
  const unit = (kind, id, x, y, z = Z) => {
    const group = new THREE.Group();
    group.name = `${kind}:${id}`;
    group.position.set(x, y, z);
    root.add(group);
    return group;
  };
  const byId = (items) => new Map((items ?? []).map((item) => [item.id, item]));

  // --- Cells: loose, carried, socketed ---
  const cellShape = shape('cell:case', cellCase);
  const cellGlass = shape('cell:light', cellLight);
  const cells = byId(level.cells ?? []);
  for (const [id, def] of cells) {
    const group = unit('cell', id, def.x, def.y, CELL_Z.loose);
    const glass = glowPart(cellGlass);
    glass.name = 'window';
    group.add(lit(cellShape), glass);
    cells.set(id, { group, glass, from: new THREE.Vector3(), goal: new THREE.Vector3(), blend: 1, state: 'loose' });
  }

  // --- Sockets ---
  const socketShape = shape('socket:case', socketCase);
  const socketSlotShape = shape('socket:slot', socketSlot);
  const sockets = new Map((level.sockets ?? []).map((def) => [def.id, glowPart(socketSlotShape)]));
  for (const slot of sockets.values()) slot.name = 'slot';
  for (const def of level.sockets ?? []) unit('socket', def.id, def.x, def.y).add(lit(socketShape), sockets.get(def.id));

  // --- Relays ---
  const relayShapes = { tower: shape('relay:tower', relayTower), node: shape('relay:node', relayNode), halo: shape('relay:halo', relayHalo) };
  const relays = new Map();
  for (const def of level.relays ?? []) {
    const group = unit('relay', def.id, def.x, def.y);
    const node = glowPart(relayShapes.node);
    node.name = 'node';
    const haloMesh = glowPart(relayShapes.halo, true);
    group.add(lit(relayShapes.tower), node, haloMesh);
    relays.set(def.id, { node, halo: haloMesh, phase: hash(Math.round(def.x * 8), Math.round(def.y * 8), 5) });
  }

  // --- Stations ---
  const stationShapes = { body: shape('station:body', stationBody), light: shape('station:light', stationLight), halo: shape('station:halo', stationHalo) };
  const stations = new Map();
  for (const def of level.stations ?? []) {
    const group = unit('station', def.id, def.x, def.y);
    const light = glowPart(stationShapes.light);
    light.name = 'light';
    const haloMesh = glowPart(stationShapes.halo, true);
    group.add(lit(stationShapes.body), light, haloMesh);
    stations.set(def.id, { light, halo: haloMesh });
  }

  // --- Archives ---
  const archiveShapes = { pedestal: shape('archive:pedestal', archivePedestal), shard: shape('archive:shard', archiveShard) };
  const archives = new Map();
  for (const def of level.archives ?? []) {
    const group = unit('archive', def.id, def.x, def.y);
    const shard = glowPart(archiveShapes.shard, true);
    group.add(lit(archiveShapes.pedestal), shard);
    archives.set(def.id, { group, shard, phase: hash(Math.round(def.x * 8), 1, 7) });
  }

  // --- Caches ---
  const cacheShapes = { full: shape('cache:full', () => cacheCrate(false)), open: shape('cache:open', () => cacheCrate(true)), glint: shape('cache:glint', cacheGlint) };
  const caches = new Map();
  for (const def of level.caches ?? []) {
    const group = unit('cache', def.id, def.x, def.y);
    const full = lit(cacheShapes.full);
    full.name = 'loot';
    const open = lit(cacheShapes.open);
    open.name = 'crate';
    const glint = unlit(cacheShapes.glint);
    glint.name = 'glint';
    group.add(full, open, glint);
    caches.set(def.id, { full, open, glint });
  }

  // --- Vents ---
  const ventShapes = { grate: shape('vent:grate', ventGrate), jet: shape('vent:jet', ventJet) };
  const vents = new Map();
  for (const def of level.vents ?? []) {
    const group = unit('vent', def.id, def.x, def.y);
    const jet = glowPart(ventShapes.jet, true);
    jet.name = 'jet';
    group.add(lit(ventShapes.grate), jet);
    vents.set(def.id, { jet, spark: 0, phase: hash(Math.round(def.x * 8), 3, 9) });
  }
  const sparks = particlePool(40);
  const glow = particleMesh([sparks], true);
  root.add(glow.object);

  // --- Switches ---
  const switchShapes = { off: shape('switch:off', () => switchPlate(false)), on: shape('switch:on', () => switchPlate(true)) };
  const switches = new Map();
  for (const def of level.switches ?? []) {
    const off = lit(switchShapes.off);
    off.name = 'off';
    const on = lit(switchShapes.on);
    on.name = 'on';
    unit('switch', def.id, def.x, def.y).add(off, on);
    switches.set(def.id, { off, on });
  }

  // --- Movers ---
  const movers = new Map();
  for (const def of level.platforms ?? []) {
    const group = unit('platform', def.id, def.x, def.y, DECK);
    const light = glowPart(shape(`platform:light:${def.w}`, () => platformLight(def.w)));
    light.name = 'light';
    group.add(lit(shape(`platform:${def.w}`, () => platformBody(def.w))), light);
    still.add(lit(shape(`travel:${travelKey(def)}`, () => travelMarks(def))));
    movers.set(def.id, { kind: 'platform', group, light });
  }
  for (const def of level.shutters ?? []) {
    const group = unit('shutter', def.id, def.x, def.y);
    group.add(lit(shape(`shutter:${def.w}x${def.h}`, () => shutterPlate(def.w, def.h))));
    still.add(lit(shape(`shutter:rails:${travelKey(def)}`, () => shutterRails(def))));
    movers.set(def.id, { kind: 'shutter', group });
  }
  for (const def of level.lifts ?? []) {
    const group = unit('lift', def.id, def.x, def.y, DECK);
    const light = glowPart(shape(`lift:light:${def.w}`, () => liftLight(def.w)));
    group.add(lit(shape(`lift:${def.w}`, () => liftBody(def.w))), light);
    still.add(lit(shape(`lift:rails:${travelKey(def)}`, () => liftRails(def))));
    movers.set(def.id, { kind: 'lift', group, light });
  }
  for (const def of level.presses ?? []) {
    const group = unit('press', def.id, def.x, def.y);
    const lamps = glowPart(shape('press:lamps', pressLamps));
    lamps.name = 'lamps';
    const ram = lit(shape('press:ram', pressRam));
    group.add(lit(shape('press:head', pressHead)), lamps, ram);
    const housing = new THREE.Group();
    housing.position.set(def.fx + def.w / 2, def.fy + def.h, 0);
    housing.add(lit(shape('press:housing', pressHousing)));
    still.add(housing);
    movers.set(def.id, { kind: 'press', group, lamps, ram, rest: { x: def.fx + def.w / 2, y: def.fy + def.h } });
  }

  // --- Ascent lift ---
  const ascentDef = level.ascent ?? null;
  let ascent = null;
  if (ascentDef !== null) {
    const w = ascentDef.w;
    const cabin = unit('ascent', ascentDef.id, ascentDef.x, ascentDef.y, DECK);
    const light = glowPart(shape('ascent:light', () => ascentLight(w)));
    const barrier = glowPart(shape('ascent:barrier', () => ascentBarrier(w)), true);
    barrier.name = 'barrier';
    const deck = lit(shape('ascent:cabin', () => ascentCabin(w)));
    deck.name = 'cabinDeck';
    cabin.add(deck, light, barrier);
    const fixture = new THREE.Group();
    const rim = glowPart(shape('ascent:rim', consoleLight));
    rim.name = 'consoleRim';
    const plate = lit(shape('ascent:fixture', () => ascentFixture(ascentDef.x - ascentDef.console.x, level.bounds.y1 - ascentDef.y)));
    plate.name = 'consolePlate';
    fixture.position.set(ascentDef.console.x, ascentDef.console.y, 0);
    fixture.add(plate, rim);
    const marks = glowPart(shape('ascent:marks', () => boardingMarks(ascentDef.boarding.w)));
    marks.position.set(ascentDef.boarding.x, ascentDef.boarding.y, 0);
    still.add(fixture, marks);
    ascent = { cabin, light, barrier, rim, marks, stage: null, since: 0 };
  }

  // --- The outline of what E acts on now ---
  const outline = glowPart(shape('outline', outlineFrame), true);
  outline.name = 'interactOutline';
  outline.visible = false;
  root.add(outline);

  let time = 0;
  let roll = 0;
  let reduced = false;
  const rnd = (salt) => hash(roll++, salt, 97);

  /** Cells: loose at their position, carried at `carryAnchor()`, socketed inside the housing; a change of place takes `HANDS` seconds. */
  function cellsSync(world, dt) {
    for (const cell of world.cells ?? []) {
      const view = cells.get(cell.id);
      if (view === undefined) continue;
      const carried = cell.state === 'carried';
      const spot = carried ? ilo.carryAnchor() : { x: cell.x, y: cell.y, z: CELL_Z[cell.state] ?? CELL_Z.loose };
      if (cell.state !== view.state) {
        view.from.copy(view.group.position);
        view.blend = 0;
        view.state = cell.state;
      }
      view.goal.set(spot.x, spot.y, spot.z);
      view.blend = Math.min(1, view.blend + dt / HANDS);
      if (view.blend >= 1) view.group.position.copy(view.goal);
      else view.group.position.lerpVectors(view.from, view.goal, smooth(view.blend));
      view.glass.material.color.setScalar(carried ? 1.15 + (reduced ? 0 : 0.15 * Math.sin(time * 6)) : cell.state === 'socketed' ? 1 : 0.8);
    }
  }

  /** Vents: dormant and dark; a small jet grows and sparks rise during the warning; the jet fills its rect while active. */
  function ventsSync(world, dt) {
    for (const vent of world.vents ?? []) {
      const view = vents.get(vent.id);
      if (view === undefined) continue;
      const active = vent.stage === 'active';
      view.jet.visible = active || vent.stage === 'warning';
      if (!view.jet.visible) continue;
      const part = active ? 1 : warningPart(vent);
      const flicker = reduced ? 1 : 0.85 + 0.15 * Math.sin(time * 37 + view.phase);
      view.jet.scale.set(vent.w, active ? vent.h : Math.min(vent.h, 0.35 + 0.85 * part), 1);
      view.jet.material.opacity = (active ? 1 : 0.3 + 0.5 * part) * flicker;
      view.spark += dt * (active ? (reduced ? 9 : 18) : part * (reduced ? 7 : 14));
      while (view.spark >= 1) {
        view.spark -= 1;
        const streak = active ? 0.3 : 0.06;
        const y = vent.y + (active ? rnd(1) * (vent.h - streak - 0.1) + 0.05 : 0.05);
        sparks.spawn({
          x: vent.x + (rnd(2) - 0.5) * 0.5, y, z: Z + 0.34, w: 0.05 + 0.03 * rnd(3), h: streak, d: 0.05,
          vy: active ? 3.2 : 1 + rnd(4), color: active ? 0xfff0d8 : 0xffc890, a: active ? 0.55 : 0.85, life: active ? (vent.y + vent.h - y) / 3.2 : 0.3,
        });
      }
    }
  }

  /** Movers: platforms, shutters, lift cabins and press heads stand at their rect; a press shivers and glows before it drops. */
  function moversSync(world) {
    for (const m of world.movers ?? []) {
      const view = movers.get(m.id);
      if (view === undefined) continue;
      view.group.position.x = m.x;
      view.group.position.y = m.y;
      if (view.kind === 'platform') view.light.material.color.setScalar(m.powered ? 1.25 : 0.25);
      else if (view.kind === 'lift') view.light.material.color.setScalar(m.powered ? 1.25 : 0.35);
      else if (view.kind === 'press') {
        const warn = m.stage === 'warn';
        view.lamps.material.color.setScalar(warn ? (reduced ? 2 : 1.2 + 1.2 * Math.sin(time * 75)) : m.stage === 'drop' ? 2.2 : m.stage === 'rise' ? 0.9 : 0.22);
        if (warn && !reduced) {
          view.group.position.x += 0.025 * Math.sin(time * 95);
          view.group.position.y += 0.02 * Math.sin(time * 77);
        }
        view.ram.position.set(view.rest.x - m.x, m.h, 0.26);
        view.ram.scale.y = Math.max(0.001, view.rest.y - (m.y + m.h) + 0.1);
      }
    }
  }

  /**
   * The ascent lift: its cabin rides `cabinY`; the barrier closes over the `barrier` stage and opens again at the
   * start of the terrace. Its stages are timed here by `dt`: `modeTime` restarts when the run is `complete`.
   */
  function ascentSync(world, dt) {
    const running = world.mode === 'liftSequence' || world.mode === 'complete';
    const ready = (world.relays ?? []).filter((relay) => relay.active).length === 3;
    const asked = world.interactTarget?.kind === 'lift';
    const stage = world.ascent.stage ?? null;
    ascent.since = stage === ascent.stage ? ascent.since + dt : 0;
    ascent.stage = stage;
    const shut = stage === 'barrier' ? smooth(clamp(ascent.since / LIFT.barrier, 0, 1)) : stage === 'rise' || stage === 'surface' ? 1 : stage === 'terrace' ? 1 - smooth(clamp(ascent.since / BARRIER_OPEN, 0, 1)) : 0;
    ascent.cabin.position.y = world.ascent.cabinY ?? ascentDef.y;
    ascent.light.material.color.setScalar(running ? 1.4 : ready ? 1.25 : 0.25);
    ascent.rim.material.color.setScalar(running ? 1.3 : ready ? (asked ? 2 : 1.3) : 0.2);
    ascent.marks.material.color.setScalar(running ? 0.5 : asked ? 2 : ready ? 1.2 : 0.22);
    ascent.barrier.visible = shut > 0.001;
    ascent.barrier.position.y = -2.6 * (1 - shut);
    ascent.barrier.material.opacity = shut;
  }

  /** Show every object as it is in `world` now. Nothing moves while `dt` is 0. */
  function sync(world, dt) {
    time += dt;
    cellsSync(world, dt);
    for (const socket of world.sockets ?? []) sockets.get(socket.id)?.material.color.setScalar(socket.powered || socket.cell !== null ? 1.3 : 0.22);
    for (const relay of world.relays ?? []) {
      const view = relays.get(relay.id);
      if (view === undefined) continue;
      // A relay glows while it is active, and pulses while the camera looks at what it opened.
      const look = world.camera?.lookAt;
      const pulse = relay.active && world.mode === 'relayActivation' && look?.x === relay.lookAt.x && look?.y === relay.lookAt.y;
      const wave = pulse ? (reduced ? 1 : 0.5 + 0.5 * Math.sin(world.modeTime * 10)) : 0;
      view.node.material.color.setScalar(relay.active ? 1.5 + wave : 0.28);
      view.node.scale.setScalar(relay.active ? 1 + 0.12 * wave + (reduced ? 0 : 0.04 * Math.sin(time * 4 + view.phase)) : 1);
      view.halo.visible = relay.active;
      view.halo.material.opacity = pulse ? 0.7 + 0.3 * wave : 0.55 + (reduced ? 0 : 0.15 * Math.sin(time * 2.5 + view.phase));
    }
    for (const station of world.stations ?? []) {
      const view = stations.get(station.id);
      if (view === undefined) continue;
      view.light.material.color.setScalar(station.active ? 1.3 : 0.3);
      view.halo.visible = station.active;
    }
    for (const archive of world.archives ?? []) {
      const view = archives.get(archive.id);
      if (view === undefined) continue;
      view.group.visible = !archive.collected;
      view.shard.material.opacity = reduced ? 0.9 : 0.82 + 0.16 * Math.sin(time * 2.2 + view.phase);
    }
    for (const cache of world.caches ?? []) {
      const view = caches.get(cache.id);
      if (view === undefined) continue;
      view.full.visible = !cache.collected;
      view.glint.visible = !cache.collected;
      view.open.visible = cache.collected;
    }
    for (const latch of world.switches ?? []) {
      const view = switches.get(latch.id);
      if (view === undefined) continue;
      view.on.visible = latch.on;
      view.off.visible = !latch.on;
    }
    ventsSync(world, dt);
    moversSync(world);
    if (ascent !== null && world.ascent !== null && world.ascent !== undefined) ascentSync(world, dt);
    // The outline sits on what E acts on now and pulses, restrained.
    const target = world.interactTarget ?? null;
    const rect = target === null ? null : targetRect(world, target);
    outline.visible = rect !== null;
    if (rect !== null) {
      const hand = target.kind === 'place' ? cells.get(target.id)?.group.position : null;
      outline.position.set(hand ? hand.x : rect[0] + rect[2] / 2, (hand ? hand.y : rect[1]) - 0.1, FRONT);
      outline.scale.set(rect[2] + 0.2, rect[3] + 0.2, 1);
      outline.material.opacity = reduced ? 0.75 : 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(time * 5));
    }
    sparks.step(dt);
    glow.draw();
  }

  return {
    sync,
    pools: { vent: sparks },
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      scene.remove(root);
      for (const geometry of geometries) geometry.dispose();
      for (const own of materials) own.dispose();
      glow.dispose();
    },
  };
}
