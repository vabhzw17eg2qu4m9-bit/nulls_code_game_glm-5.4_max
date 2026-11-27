// Plain LEVEL in the shape of contract §4.2: one flat test range with every core situation, left to right.
// x grows right, y grows up, the walkable floor top is y = 0.

const rock = (id, x, y, w, h) => ({ id, x, y, w, h, mat: 'rock', region: 'workshop' });

export const LEVEL = {
  name: 'Core Test Range',
  spawn: { x: 2.5, y: 0 },
  bounds: { x0: 0, y0: -6, x1: 80, y1: 14 },
  regions: [{ id: 'workshop', name: 'Buried Workshop', x0: 0, x1: 80 }],
  solids: [
    rock('floorW', 0, -4, 26, 4),
    rock('floorE', 28, -4, 52, 4),
    rock('pitFloor', 26, -6, 2, 2),
    rock('wallW', -1, 0, 1, 10),
    rock('wallE', 80, 0, 1, 10),
    { id: 'ceiling', x: 9, y: 2, w: 4, h: 1, mat: 'metal', region: 'workshop' },
    rock('ledge1', 14, 0, 4, 1),
    rock('ledge2', 18, 0, 4, 2),
    rock('shaftL', 32, 0, 1, 6),
    rock('shaftR', 37, 0, 1, 6),
    { id: 'thin', x: 50, y: 0, w: 0.5, h: 3, mat: 'metal', region: 'workshop' },
    rock('rack', 55.5, 5, 2.5, 1),
    rock('housing', 63.5, 3, 1.5, 2),
  ],
  seams: [{ id: 'seam1', x: 44, y: 0, w: 0.5, h: 3, region: 'workshop', hidden: false }],
  stations: [{ id: 'st0', x: 1.5, y: 0, order: 0, active: false, inRange: false }],
  relays: [],
  cells: [],
  sockets: [],
  switches: [{ id: 'sw1', x: 62, y: 1, label: 'Door', on: false, targets: ['shut1'] }],
  archives: [],
  caches: [],
  vents: [],
  reveals: [],
  platforms: [{
    id: 'plat', x: 56, y: 1, w: 3, h: 0.5, fx: 56, fy: 1, tx: 56, ty: 5,
    mode: 'loop', yields: true, crushes: false, enabled: true, poweredBy: [],
    speed: 2, pauseA: 0.5, pauseB: 0.5,
  }],
  shutters: [{
    id: 'shut1', x: 64, y: 0, w: 0.5, h: 3, fx: 64, fy: 0, tx: 64, ty: 3,
    mode: 'toggle', yields: true, crushes: false, enabled: true, poweredBy: ['sw1'],
  }],
  lifts: [],
  presses: [{
    id: 'press1', x: 70, y: 3.5, w: 3, h: 1.5, fx: 70, fy: 3.5, tx: 70, ty: 1,
    mode: 'loop', yields: false, crushes: true, enabled: true, poweredBy: [],
    travel: 2.5, period: 4, warn: 1,
  }],
  enemies: [],
  ascent: {
    id: 'ascent', x: 76, y: 10, w: 3.5, h: 0.6, console: { x: 76, y: 10 },
    boarding: { x: 74.5, y: 0, w: 3, h: 3 }, idle: true, stage: null, cabinY: 10,
  },
  kill: [{ id: 'pit', x: 26, y: -6, w: 2, h: 6, kind: 'void' }],
  camera: [{ id: 'cam', x0: 0, y0: -6, x1: 80, y1: 14 }],
  decor: [],
};

// Where each test situation starts: [x, y] of ILO's feet.
export const SPOTS = {
  floor: [5, 0],
  underCeiling: [11, 0],
  beforeLedge1: [12, 0],
  onLedge2: [20, 2],
  beforePit: [25, 0],
  beyondLedge2: [23, 0],
  shaft: [35, 0],
  shaftAir: [36.4, 4],
  eastFloor: [41, 0],
  beforeSeam: [41.5, 0],
  beforeThinWall: [48, 0],
  atThinWall: [48.5, 0],
  atWestWall: [0.375, 0],
  beforeSeamSight: [42.5, 0],
  beforeShutter: [62.5, 0],
  inDoorway: [64.25, 0],
  onPlatform: [57.5, 1.5],
  underPress: [71.5, 0],
};
