// Plain LEVEL objects in the shape of contract §4.2, one small range per gameplay situation.
// x grows right, y grows up; the walkable floor top is y = 0 unless a spot says otherwise.

import { CELL } from '../../src/config.js';
import { LEVEL as COURSE } from '../../src/level/level.js';

const LISTS = ['seams', 'stations', 'relays', 'cells', 'sockets', 'switches', 'archives', 'caches', 'vents', 'reveals',
  'platforms', 'shutters', 'lifts', 'presses', 'enemies', 'kill', 'decor'];

const rock = (region, id, x, y, w, h) => ({ id, x, y, w, h, mat: 'rock', region });
const cell = (region, id, x, y = 0) => ({ id, x, y, w: CELL.w, h: CELL.h, home: { x, y }, region });
const socket = (region, id, x, powers, label) => ({ id, x, y: 0, w: 1.2, h: 1.5, label, powers, region });
const station = (region, id, x, order, y = 0) => ({ id, x, y, order, region });
/** Relay `id` whose node floats 1.2 units above the ground at `x`. */
const relay = (region, id, x, stationId, socketId, lookAt) => ({ id, x, y: 1.2, station: stationId, socket: socketId, lookAt, region });
const archive = (region, id, x) => ({ id, x, y: 0, title: `${id} title`, text: `${id} text`, region });
const cache = (region, id, x) => ({ id, x, y: 0, region });
const vent = (region, id, x, period, warn, active, delay, h = 3) => ({ id, x, y: 0, w: 1, h, period, warn, active, delay, region });
/** A mover at rest at `(x, y)` that travels by `to`. */
const mover = (region, kind, id, x, y, w, h, to, extra = {}) => ({
  id, kind, x, y, w, h, fx: x, fy: y, tx: x + to[0], ty: y + to[1], mode: 'loop', poweredBy: [], yields: true,
  crushes: false, enabled: true, region, ...extra,
});
const shutter = (region, id, x, poweredBy, y = 0) => mover(region, 'shutter', id, x, y, 0.5, 3, [0, 3], { mode: 'toggle', poweredBy });
const platform = (region, id, x, y, to, poweredBy = []) => mover(region, 'platform', id, x, y, 3, 0.5, to, { poweredBy, speed: 2, pauseA: 1, pauseB: 1 });
const press = (region, id, x, travel, period, warn) => mover(region, 'press', id, x, 3.5, 3, 1.5, [0, -travel], { travel, period, warn, yields: false, crushes: true });

/**
 * A level of one region `id` from x = 0 to `x1`: side walls `wall` units high, a floor of pieces `[x, width]` whose
 * top is y = 0, and `parts`. `bounds` is measured from the terrain, as the level builder does.
 */
function range(id, x1, { spawnX, spawnY = 0, wall = 14, floor = [[0, x1]], solids: extra = [], ...parts }) {
  const solids = [rock(id, 'wallW', -1, 0, 1, wall), rock(id, 'wallE', x1, 0, 1, wall),
    ...floor.map(([x, w], n) => rock(id, `floor${n}`, x, -4, w, 4)), ...extra];
  return {
    name: id,
    spawn: { x: spawnX, y: spawnY },
    bounds: {
      x0: Math.min(...solids.map((s) => s.x)), y0: Math.min(...solids.map((s) => s.y)),
      x1: Math.max(...solids.map((s) => s.x + s.w)), y1: Math.max(...solids.map((s) => s.y + s.h)),
    },
    regions: [{ id, name: id, x0: 0, x1 }],
    ...Object.fromEntries(LISTS.map((name) => [name, []])),
    ...parts,
    solids,
    camera: [{ id: 'cam', x0: 0, y0: -6, x1, y1: wall }],
  };
}

// The workshop circuit of GOAL §11: a cell carried along safe ground opens the shutter in front of Relay A.
// Behind the relay station: a seam, a second cell, an archive and a cache, all changed after the relay commit.
const WORKSHOP = range('workshop', 44, {
  spawnX: 2.5,
  stations: [station('workshop', 'st0', 2.5, 0), station('workshop', 'stA', 27.5, 1)],
  relays: [relay('workshop', 'A', 23.5, 'stA', null, { x: 18.25, y: 1.5 })],
  cells: [cell('workshop', 'c1', 10.5), cell('workshop', 'c2', 33.5)],
  sockets: [socket('workshop', 'sA', 14.5, ['shA'], 'Circuit')],
  shutters: [shutter('workshop', 'shA', 18, ['sA'])],
  seams: [{ id: 'seamA', x: 31, y: 0, w: 0.5, h: 3, region: 'workshop', hidden: false }],
  archives: [archive('workshop', 'A', 6.5), archive('workshop', 'B', 36.5)],
  caches: [cache('workshop', 'k1', 38.5)],
});

// The reservoir bridge of GOAL §11: a wall-jump shaft up to a switch that starts the platform over the water,
// then Relay B. The route along the ground passes under the shaft walls and the switch ledge.
const RESERVOIR = range('reservoir', 56, {
  spawnX: 2.5,
  floor: [[0, 32], [44, 12]],
  solids: [rock('reservoir', 'shaftL', 11, 2, 1, 7), rock('reservoir', 'shaftR', 16, 2, 1, 5), rock('reservoir', 'ledge', 17, 6, 8, 1)],
  kill: [{ id: 'water', x: 32, y: -6, w: 12, h: 6, kind: 'water', region: 'reservoir' }],
  stations: [station('reservoir', 'st0', 2.5, 0), station('reservoir', 'stB', 52.5, 1)],
  switches: [{ id: 'swB', x: 21.5, y: 7, label: 'Bridge', targets: ['pB'], region: 'reservoir' }],
  platforms: [platform('reservoir', 'pB', 32, -0.5, [9, 0], ['swB'])],
  relays: [relay('reservoir', 'B', 49.5, 'stB', null, { x: 36.5, y: 1 })],
});

// The foundry counterweight of GOAL §11: a cell in the socket beside the cabin lifts it to the upper switch that
// latches the upper shutter. The way to the relay socket runs along the ground under the upper walkway.
const FOUNDRY = range('foundry', 52, {
  spawnX: 1.5,
  spawnY: 0.6,
  solids: [rock('foundry', 'dock', 0, 0, 8, 0.6), rock('foundry', 'walkway', 11.6, 3, 18.6, 1.6)],
  stations: [station('foundry', 'st0', 1.5, 0, 0.6), station('foundry', 'stC', 46.5, 1)],
  cells: [cell('foundry', 'c1', 3.5, 0.6)],
  sockets: [socket('foundry', 'sLift', 11.6, ['cab'], 'Counterweight'), socket('foundry', 'sRelay', 38.6, [], 'Relay')],
  switches: [{ id: 'swU', x: 16, y: 4.6, label: 'Route', targets: ['shU'], region: 'foundry' }],
  lifts: [mover('foundry', 'lift', 'cab', 8, 0, 3, 0.6, [0, 4], { mode: 'toggle', poweredBy: ['sLift'], speed: 2.5 })],
  shutters: [shutter('foundry', 'shU', 24, ['swU'], 4.6)],
  relays: [relay('foundry', 'C', 42.5, 'stC', 'sRelay', { x: 24.25, y: 6 })],
});

// Stations and relays along one road: the checkpoint rules, a relay behind a socket, a platform, a vent and a pit.
// A hidden seam above the road and an alcove marker hang within reach of a pulse from the spawn.
const STATIONS = range('stations', 84, {
  spawnX: 2.5,
  floor: [[0, 64], [68, 16]],
  solids: [rock('stations', 'wallNook', 77.5, 0, 2, 5)],
  kill: [{ id: 'pit', x: 64, y: -6, w: 4, h: 6, kind: 'void', region: 'stations' }],
  seams: [{ id: 'seamS', x: 6, y: 2.5, w: 0.5, h: 3, region: 'stations', hidden: true }],
  reveals: [{ id: 'rev1', x: 8, y: 1, kind: 'alcove', ref: null, region: 'stations' }],
  stations: [station('stations', 'st0', 2.5, 0), station('stations', 'st1', 20.5, 1), station('stations', 'st2', 44.5, 2),
    station('stations', 'st3', 76.5, 3)],
  cells: [cell('stations', 'c1', 10.5), cell('stations', 'c2', 72.5)],
  sockets: [socket('stations', 'sB', 37.6, [], 'Relay')],
  relays: [relay('stations', 'B', 40.5, 'st2', 'sB', { x: 37.6, y: 1 })],
  platforms: [platform('stations', 'p1', 50, 0.2, [4, 0])],
  vents: [vent('stations', 'v1', 58, 4, 1, 1, 1)],
});

// Two vents and a press: v1 for the cycle (the shortest warning allowed) and the hazard rect, v2 short enough to
// spend the shield twice, then hurt.
const VENTS = range('vents', 60, {
  spawnX: 2.5,
  stations: [station('vents', 'st0', 2.5, 0)],
  vents: [vent('vents', 'v1', 14, 4, 0.6, 1, 1.5, 4), vent('vents', 'v2', 24, 2.4, 1, 0.6, 1, 4)],
  presses: [press('vents', 'pr1', 30, 2.5, 4, 1)],
});

// Cell placement: a wall with a pit behind (`wallPit`), a wall in front (`wallFront`), a pit in front with free
// ground behind (`pitFront`), a pit in front with a wall behind (`overPit`), a vent between walls (`jet`), and the
// sockets: s1 empty, s2 filled in the test with c2, c3 beside it.
const CELLS = range('cells', 48, {
  spawnX: 1.5,
  floor: [[0, 8], [10.6, 9.4], [22.6, 25.4]],
  solids: [rock('cells', 'wallA', 12, 0, 2, 5), rock('cells', 'wallC', 18.6, 0, 1, 5), rock('cells', 'wallB', 25, 0, 1, 5)],
  kill: [{ id: 'pitW', x: 8, y: -6, w: 2.6, h: 6, kind: 'void', region: 'cells' },
    { id: 'pitE', x: 20, y: -6, w: 2.6, h: 6, kind: 'void', region: 'cells' }],
  cells: [cell('cells', 'c1', 3.5), cell('cells', 'c4', 6), cell('cells', 'c2', 33), cell('cells', 'c3', 37)],
  vents: [vent('cells', 'v1', 27.5, 3, 1, 1, 0.5)],
  sockets: [socket('cells', 's1', 31.6, [], 'One'), socket('cells', 's2', 35.6, [], 'Two')],
});

// The ascent lift of §3.13 with the three relays in reach of a pulse; the terrace is the highest ground.
// pA hangs above the road: it runs only while Relay A is active.
const ASCENT = range('ascent', 40, {
  spawnX: 2.5,
  wall: 10,
  solids: [rock('ascent', 'terrace', 31.75, 9, 8.25, 1)],
  stations: [station('ascent', 'st0', 2.5, 0)],
  relays: [relay('ascent', 'A', 8.5, 'st0', null, { x: 8.5, y: 1.2 }), relay('ascent', 'B', 12.5, 'st0', null, { x: 12.5, y: 1.2 }),
    relay('ascent', 'C', 16.5, 'st0', null, { x: 16.5, y: 1.2 })],
  cells: [cell('ascent', 'c1', 34, 10)],
  archives: [archive('ascent', 'A', 5.5), archive('ascent', 'B', 6.5), archive('ascent', 'C', 7.5)],
  caches: [cache('ascent', 'k1', 20.5)],
  platforms: [platform('ascent', 'pA', 10, 3, [0, 3], ['A'])],
  ascent: {
    id: 'ascent', x: 30, y: 0, w: 3.5, h: 0.6, console: { x: 30, y: 0 }, boarding: { x: 28.5, y: 0, w: 3, h: 3 },
    idle: true, stage: null, cabinY: 0, region: 'ascent',
  },
});

// `course` is the real course of src/level/level.js: for the checks the audit made on the authored level itself.
export const LEVELS = { workshop: WORKSHOP, reservoir: RESERVOIR, foundry: FOUNDRY, stations: STATIONS, vents: VENTS, cells: CELLS, ascent: ASCENT, course: COURSE };

/** Where each situation starts: `[x, y]` of ILO's feet. */
export const SPOTS = {
  workshop: { start: [2.5, 0] },
  reservoir: { start: [2.5, 0], inShaft: [13.2, 0], bank: [31.2, 0] },
  foundry: { start: [1.5, 0.6], nook: [11.6, 0], east: [34, 0], relay: [41, 0] },
  stations: { start: [2.5, 0], west: [16, 0], pitEdge: [63.2, 0], east: [69.5, 0] },
  vents: { start: [2.5, 0], besideV1: [12.2, 0], inV2: [24, 0], underPress: [31.5, 0] },
  cells: {
    far: [0.375, 0], near: [4.6, 0], between: [5, 0], free: [15.5, 0], wallFront: [14.6, 0], wallPit: [11, 0],
    overPit: [20.2, 0],
    pitFront: [23, 0], jet: [26.6, 0], atS1: [30.9, 0], atS2: [34.4, 0], besideS2: [36.1, 0],
  },
  ascent: { start: [2.5, 0], console: [30, 0], beside: [27, 0], cell: [32.9, 10], atC: [17.6, 0] },
  course: { start: [COURSE.spawn.x, COURSE.spawn.y] },
};
