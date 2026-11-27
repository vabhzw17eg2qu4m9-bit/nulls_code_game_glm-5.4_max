// Plain LEVEL objects in the shape of contract §4.2 (see core.js), one per enemy kind.
// x grows right, y grows up, the walkable floor top is y = 0. Each spot is more than 24 units from every
// enemy it is not meant to wake.

const rock = (id, x, y, w, h) => ({ id, x, y, w, h, mat: 'rock', region: 'workshop' });

/** A flat 70-or-more-unit range with a start station and none of the other objects. */
const range = (name, x1, solids) => ({
  name, spawn: { x: 2.5, y: 0 }, bounds: { x0: 0, y0: -4, x1, y1: 14 },
  regions: [{ id: 'workshop', name: 'Buried Workshop', x0: 0, x1 }],
  solids: [rock('floor', 0, -4, x1, 4), ...solids],
  seams: [],
  stations: [{ id: 'st0', x: 1.5, y: 0, order: 0, active: false, inRange: false }],
  relays: [], cells: [], sockets: [], switches: [], archives: [], caches: [], vents: [], reveals: [],
  platforms: [], shutters: [], lifts: [], presses: [], kill: [], camera: [], decor: [], ascent: null,
});

/** Flat ground with `sk1`, a wall that blocks its sight, and `sk2` on a ledge whose ends have no floor. */
export const SKITTER = {
  ...range('Skitter Test Range', 80, [rock('wall', 18, 0, 1, 3), rock('ledge', 40, 0, 6, 2)]),
  enemies: [
    {
      id: 'sk1', kind: 'skitter', x: 14, y: 0, w: 1.2, h: 0.7, home: { x: 14, y: 0 },
      range: { x0: 12, x1: 15.5 }, region: 'workshop',
    },
    {
      id: 'sk2', kind: 'skitter', x: 43, y: 2, w: 1.2, h: 0.7, home: { x: 43, y: 2 },
      range: { x0: 39.5, x1: 46.5 }, region: 'workshop',
    },
  ],
};

/** Flat ground with `d1` on a low route, a column top above it, and a platform and a loose cell in its fire line. */
export const DRONE = {
  ...range('Drone Test Range', 70, [rock('column', 27, 0, 2, 3)]),
  // A platform resting in the air on the line of a bolt aimed at ILO at x 26; the flatter bolt aimed at ILO
  // at x 23 passes under it.
  platforms: [{
    id: 'shelf', x: 24, y: 0.95, w: 1, h: 0.5, fx: 24, fy: 0.95, tx: 24, ty: 0.95,
    mode: 'loop', yields: true, crushes: false, enabled: true, poweredBy: [], speed: 2, pauseA: 0, pauseB: 0,
  }],
  // A loose cell on the ground just before ILO at x 15, both within one pulse of d1: the bolt aimed there ends on it.
  cells: [{ id: 'c1', x: 16, y: 0, w: 1, h: 1.1, home: { x: 16, y: 0 }, region: 'workshop' }],
  enemies: [{
    id: 'd1', kind: 'drone', x: 20, y: 1, w: 1, h: 0.9, home: { x: 20, y: 1 },
    route: { fx: 20, fy: 1, tx: 24, ty: 1 }, region: 'workshop',
  }],
};

/** `sg1` fires an open lane to the right; `sg2` fires to the left at a platform that covers its lane. */
export const SENTINEL = {
  ...range('Sentinel Test Range', 70, []),
  // A tall platform bobbing below the lane: a cover that never rests.
  platforms: [{
    id: 'cover', x: 45, y: 0, w: 1, h: 3, fx: 45, fy: 0, tx: 45, ty: 0.5,
    mode: 'loop', yields: true, crushes: false, enabled: true, poweredBy: [], speed: 2, pauseA: 0.5, pauseB: 0.5,
  }],
  enemies: [
    {
      id: 'sg1', kind: 'sentinel', x: 6, y: 0, w: 1.5, h: 2, home: { x: 6, y: 0 }, dir: 1,
      lane: { x: 6.75, y: 0.75, w: 8, h: 0.5 }, region: 'workshop',
    },
    {
      id: 'sg2', kind: 'sentinel', x: 50, y: 0, w: 1.5, h: 2, home: { x: 50, y: 0 }, dir: -1,
      lane: { x: 39.25, y: 0.75, w: 10, h: 0.5 }, region: 'workshop',
    },
  ],
};

// Where each test situation starts: [x, y] of ILO's feet.
export const SPOTS = {
  inSight: [SKITTER, 9.1, 0],             // 4.9 from sk1 at home: at the edge of its sight
  outOfSight: [SKITTER, 8.9, 0],          // 5.1 from sk1 at home: just outside its sight
  // Skitter range
  open: [SKITTER, 10.5, 0],               // in sight of sk1, on its free side
  wallSide: [SKITTER, 20, 0],             // within 5 of sk1, the wall in between
  watch: [SKITTER, 5, 0],                 // awake to sk1, too far to be seen
  watchLedge: [SKITTER, 52, 0],           // awake to sk2 on its ledge, too far to be seen
  ledgeEnd: [SKITTER, 45.4, 2],           // on the ledge, beside sk2 at home
  far: [SKITTER, 72, 0],                  // asleep to both skitters
  // Drone range
  droneFar: [DRONE, 2.5, 0],              // awake to d1, outside its sight
  droneNear: [DRONE, 23, 0],              // in sight of d1 at home, a dash away
  columnTop: [DRONE, 28, 3],              // above d1, seen once d1 has patrolled to x 22.5: its bolt climbs into open air
  atPlatform: [DRONE, 26, 0],             // 6.04 from d1 at home, seen after 5 steps of patrol: its bolt ends on the resting platform
  atCell: [DRONE, 15, 0],                 // seen by d1 at home: its bolt ends on the loose cell
  // Sentinel range
  beside: [SENTINEL, 4.5, 0],             // touching nothing: outside the lane of sg1
  inLane: [SENTINEL, 10, 0],              // inside the open lane of sg1
  inside: [SENTINEL, 6, 0],               // inside the body of sg1
  coverFront: [SENTINEL, 47.5, 0],        // in the lane of sg2, in front of the cover
  coverBehind: [SENTINEL, 42, 0],         // in the lane of sg2, behind the cover
};
