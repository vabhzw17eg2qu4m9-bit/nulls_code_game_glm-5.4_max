import test from 'node:test';
import assert from 'node:assert/strict';
import { defineLevel, defineRegion } from '../src/level/build.js';

const byId = (list, id) => list.find(o => o.id === id);
const boxes = rects => rects.map(r => [r.x, r.y, r.w, r.h]);

// The smallest valid level: three contiguous regions with one relay and one archive each. The first holds the spawn.
function trio(letter, x, spawn = false) {
  return {
    id: letter.toLowerCase(), name: `Region ${letter}`, origin: { x, y: 0 },
    map: [`${spawn ? 'P' : '.'}.S.R.A...`, '##########'],
    markers: {
      ...(spawn ? { P: { kind: 'spawn' } } : {}),
      S: { kind: 'station', id: `st-${letter}` },
      R: { kind: 'relay', id: letter, station: `st-${letter}`, lookAt: [0, 0] },
      A: { kind: 'archive', id: letter, title: 'Title', text: 'Text' },
    },
  };
}
const validLevel = () => ({ name: 'Test', regions: [trio('A', 0, true), trio('B', 10), trio('C', 20)] });

// Writes a marker character into the top row of a trio region and declares it when `marker` is given.
function place(region, col, ch, marker) {
  region.map[0] = region.map[0].slice(0, col) + ch + region.map[0].slice(col + 1);
  if (marker) region.markers[ch] = marker;
}

test('terrain: an L shape gives two rectangles, a 3 x 3 block gives one', () => {
  const solids = map => defineRegion({ id: 'r', map }).solids;
  assert.deepEqual(boxes(solids(['#.', '##'])), [[0, 1, 1, 1], [0, 0, 2, 1]]);
  assert.deepEqual(boxes(solids(['###', '###', '###'])), [[0, 0, 3, 3]]);
  // equal runs merge downwards; a wider run below starts a new rectangle
  assert.deepEqual(boxes(solids(['##.', '##.', '###', '###', '##.', '##.'])), [[0, 4, 2, 2], [0, 2, 3, 2], [0, 0, 2, 2]]);
  assert.deepEqual(solids(['#M']), [
    { id: 'r-s0', x: 0, y: 0, w: 1, h: 1, mat: 'rock', region: 'r' },
    { id: 'r-s1', x: 1, y: 0, w: 1, h: 1, mat: 'metal', region: 'r' },
  ]);
  assert.deepEqual(defineRegion({ id: 'r', map: ['%%.', '%%.', '%..'] }).seams, [
    { id: 'r-seam0', x: 0, y: 1, w: 2, h: 2, hidden: false, region: 'r' },
    { id: 'r-seam1', x: 0, y: 0, w: 1, h: 1, hidden: false, region: 'r' },
  ]);
});

test('a marker anchors at the bottom center of its cell, counted from the region origin', () => {
  const region = defineRegion({
    id: 'r', origin: { x: 10, y: 100 }, map: ['.S..', '....', '..C.', '####'],
    markers: { S: { kind: 'station', id: 'st' }, C: { kind: 'cache', id: 'k1' } },
  });
  // Four rows, so the bottom cells sit at y 100. Station: column 1, row 0. Cache: column 2, row 2.
  assert.deepEqual(region.stations, [{ id: 'st', x: 11.5, y: 103, order: 0, region: 'r' }]);
  assert.deepEqual(region.caches, [{ id: 'k1', x: 12.5, y: 101, region: 'r' }]);
  assert.deepEqual([region.x0, region.x1], [10, 14]);
});

test('every marker kind resolves to the shape and position of the marker table', () => {
  const region = defineRegion({
    id: 'r', map: [
      '........................',
      '..p.......l.......r.....',
      '..v...n.......s.......e.',
      '.P.S.R.c.o.w.A.C.k.d...t',
      '########################',
    ],
    markers: {
      P: { kind: 'spawn' },
      S: { kind: 'station', id: 'st' },
      R: { kind: 'relay', id: 'A', station: 'st', socket: 'sx', lookAt: [2, 1] },
      c: { kind: 'cell', id: 'c1' },
      o: { kind: 'socket', id: 'sx', label: 'Lift', powers: ['sh', 'lf'] },
      w: { kind: 'switch', id: 'sw', label: 'Bridge', targets: ['pf'] },
      A: { kind: 'archive', id: 'A', title: 'Note', text: 'Text' },
      C: { kind: 'cache', id: 'k1' },
      k: { kind: 'skitter', id: 'e1', range: [-2, 2] },
      d: { kind: 'drone', id: 'e2', to: [0, 3] },
      n: { kind: 'sentinel', id: 'e3', dir: -1, length: 4 },
      v: { kind: 'vent', id: 'v1', h: 3, period: 4, warn: 0.8, active: 1.2, delay: 0.5 },
      p: { kind: 'platform', id: 'pf', to: [4, -1], w: 3, speed: 2, pauseA: 0.5, pauseB: 1 },
      t: { kind: 'shutter', id: 'sh', w: 1, h: 2, open: [0, 2], poweredBy: ['sx', 'sw'] },
      l: { kind: 'lift', id: 'lf', to: [0, 4], w: 3, speed: 1.5, poweredBy: ['sx'] },
      r: { kind: 'press', id: 'pr', travel: 2, period: 4, warn: 0.6 },
      s: { kind: 'ascent', boarding: [3, 2] },
      e: { kind: 'reveal', id: 'rv', reveal: 'alcove', ref: 'A' },
    },
  });
  // Row 3 markers stand on the floor at y 1; row 2 is y 2 and row 1 is y 3.
  assert.deepEqual(region.spawn, { x: 1.5, y: 1 });
  assert.deepEqual(region.stations, [{ id: 'st', x: 3.5, y: 1, order: 0, region: 'r' }]);
  assert.deepEqual(region.relays, [{
    id: 'A', x: 5.5, y: 2.2, station: 'st', socket: 'sx', lookAt: { x: 7.5, y: 2 }, region: 'r',
  }]);
  assert.deepEqual(region.cells, [{ id: 'c1', x: 7.5, y: 1, w: 1, h: 1.1, home: { x: 7.5, y: 1 }, region: 'r' }]);
  assert.deepEqual(region.sockets, [{ id: 'sx', x: 9.5, y: 1, w: 1.2, h: 1.5, label: 'Lift', powers: ['sh', 'lf'], region: 'r' }]);
  assert.deepEqual(region.switches, [{ id: 'sw', x: 11.5, y: 1, label: 'Bridge', targets: ['pf'], region: 'r' }]);
  assert.deepEqual(region.archives, [{ id: 'A', x: 13.5, y: 1, title: 'Note', text: 'Text', region: 'r' }]);
  assert.deepEqual(region.caches, [{ id: 'k1', x: 15.5, y: 1, region: 'r' }]);
  assert.deepEqual(region.vents, [{
    id: 'v1', x: 2.5, y: 2, w: 1, h: 3, period: 4, warn: 0.8, active: 1.2, delay: 0.5, region: 'r',
  }]);
  assert.deepEqual(region.reveals, [{ id: 'rv', x: 22.5, y: 2, kind: 'alcove', ref: 'A', region: 'r' }]);
  // Enemies come in map scan order: the sentinel is one row above the skitter and the drone.
  assert.deepEqual(region.enemies, [
    {
      id: 'e3', kind: 'sentinel', x: 6.5, y: 2, w: 1.5, h: 2, home: { x: 6.5, y: 2 }, dir: -1,
      lane: { x: 1.75, y: 2.75, w: 4, h: 0.5 }, region: 'r',
    },
    {
      id: 'e1', kind: 'skitter', x: 17.5, y: 1, w: 1.2, h: 0.7, home: { x: 17.5, y: 1 },
      range: { x0: 15.5, x1: 19.5 }, region: 'r',
    },
    {
      id: 'e2', kind: 'drone', x: 19.5, y: 1, w: 1, h: 0.9, home: { x: 19.5, y: 1 },
      route: { fx: 19.5, fy: 1, tx: 19.5, ty: 4 }, region: 'r',
    },
  ]);
  const mover = { fx: 0, fy: 0, tx: 0, ty: 0, yields: true, crushes: false, enabled: true };
  assert.deepEqual(region.platforms, [{
    id: 'pf', kind: 'platform', x: 1, y: 3, w: 3, h: 0.5, ...mover, fx: 1, fy: 3, tx: 5, ty: 2,
    mode: 'loop', poweredBy: [], speed: 2, pauseA: 0.5, pauseB: 1, region: 'r',
  }]);
  assert.deepEqual(region.shutters, [{
    id: 'sh', kind: 'shutter', x: 23, y: 1, w: 1, h: 2, ...mover, fx: 23, fy: 1, tx: 23, ty: 3,
    mode: 'toggle', poweredBy: ['sx', 'sw'], region: 'r',
  }]);
  assert.deepEqual(region.lifts, [{
    id: 'lf', kind: 'lift', x: 9, y: 3, w: 3, h: 0.6, ...mover, fx: 9, fy: 3, tx: 9, ty: 7,
    mode: 'toggle', poweredBy: ['sx'], speed: 1.5, region: 'r',
  }]);
  assert.deepEqual(region.presses, [{
    id: 'pr', kind: 'press', x: 17, y: 3, w: 3, h: 1.5, ...mover, fx: 17, fy: 3, tx: 17, ty: 1,
    yields: false, crushes: true, mode: 'loop', poweredBy: [], travel: 2, period: 4, warn: 0.6, region: 'r',
  }]);
  assert.deepEqual(region.ascent, {
    id: 'ascent', x: 14.5, y: 2, w: 3.5, h: 0.6, console: { x: 14.5, y: 2 },
    boarding: { x: 13, y: 2, w: 3, h: 2 }, region: 'r',
  });
});

test('`to` and `open` are offsets from the anchor rect', () => {
  const region = defineRegion({
    id: 'r', origin: { x: 100, y: 50 }, map: ['.d..r.', '.p....', '.lt...', '######'],
    markers: {
      p: { kind: 'platform', id: 'p', to: [3, -2], w: 2, speed: 2, pauseA: 0, pauseB: 1 },
      l: { kind: 'lift', id: 'l', to: [0, 4], w: 1, speed: 1 },
      t: { kind: 'shutter', id: 't', w: 2, h: 1, open: [1, 2] },
      d: { kind: 'drone', id: 'd', to: [-2, 1] },
      r: { kind: 'press', id: 'r', travel: 2.5, period: 4, warn: 0.6 },
    },
  });
  // The floor cells span y 50 to 51. Platform: row 1, y 52. Lift and shutter: row 2, y 51. Drone and press: row 0, y 53.
  const ends = o => [o.fx, o.fy, o.tx, o.ty];
  assert.deepEqual(ends(region.platforms[0]), [100.5, 52, 103.5, 50]);
  assert.deepEqual(ends(region.lifts[0]), [101, 51, 101, 55]);
  assert.deepEqual(ends(region.shutters[0]), [101.5, 51, 102.5, 53]);
  assert.deepEqual(ends(region.presses[0]), [103, 53, 103, 50.5]);
  assert.deepEqual(region.enemies[0].route, { fx: 101.5, fy: 53, tx: 99.5, ty: 54 });
});

test('seamInfo overrides the id and the hidden flag of the seam rect that holds the cell', () => {
  const region = defineRegion({
    id: 'r', map: ['%%.#', '%..#'],
    seamInfo: [{ at: [1, 0], id: 'wsTrain', hidden: true }, { at: [0, 1], hidden: true }],
  });
  assert.deepEqual(region.seams, [
    { id: 'wsTrain', x: 0, y: 1, w: 2, h: 1, hidden: true, region: 'r' },   // [1, 0] lies in this rect
    { id: 'r-seam1', x: 0, y: 0, w: 1, h: 1, hidden: true, region: 'r' },   // no id given: keeps its auto id
  ]);
});

const cases = [
  ['unknown marker kind', /region 'a': marker 'S' has unknown kind 'teleport'/, r => { r[0].markers.S.kind = 'teleport'; }],
  ['undeclared marker', /region 'a': map character 'Z' at \[7, 0\] is not declared/, r => place(r[0], 7, 'Z')],
  ['declared marker that occurs twice', /region 'a': marker 'S' \(station\) occurs 2 times/, r => place(r[0], 8, 'S')],
  ['declared marker that never occurs', /region 'a': marker 'S' \(station\) is declared but not in the map/, r => place(r[0], 2, '.')],
  ['missing parameter', /region 'a': marker 'R' \(relay\) has no `lookAt`/, r => { delete r[0].markers.R.lookAt; }],
  ['relay id outside A, B, C', /region 'a': marker 'R' \(relay\) has id 'D'/, r => { r[0].markers.R.id = 'D'; }],
  ['archive id outside A, B, C', /region 'a': marker 'A' \(archive\) has id 'D'/, r => { r[0].markers.A.id = 'D'; }],
  ['marker inside terrain', /region 'a': marker 'P' \(spawn\) at \[0, 1\] is inside terrain/,
    r => r[0].map.unshift('#####.....')],
  ['duplicate id in a region', /region 'a': cache 'st-A' \(marker 'C'\) reuses id 'st-A', declared by station 'st-A' \(marker 'S'\) in region 'a'/,
    r => place(r[0], 7, 'C', { kind: 'cache', id: 'st-A' })],
  ['duplicate id across regions', /region 'b': station 'st-A' \(marker 'S'\) reuses id 'st-A'.*in region 'a'/,
    r => { r[1].markers.S.id = 'st-A'; r[1].markers.R.station = 'st-A'; }],
  ['unknown reference in `station`', /region 'a': marker 'R' \(relay\) `station` names 'nope', which is not an id in stations/,
    r => { r[0].markers.R.station = 'nope'; }],
  ['unknown reference in `socket`', /region 'a': marker 'R' \(relay\) `socket` names 'nope', which is not an id in sockets/,
    r => { r[0].markers.R.socket = 'nope'; }],
  ['unknown reference in `powers`', /region 'a': marker 'o' \(socket\) `powers` names 'nope', which is not a declared id/,
    r => place(r[0], 7, 'o', { kind: 'socket', id: 'sx', label: 'L', powers: ['nope'] })],
  ['unknown reference in `targets`', /region 'a': marker 'w' \(switch\) `targets` names 'nope'/,
    r => place(r[0], 7, 'w', { kind: 'switch', id: 'sw', label: 'S', targets: ['nope'] })],
  ['unknown reference in `poweredBy`', /region 'a': marker 't' \(shutter\) `poweredBy` names 'nope'/,
    r => place(r[0], 7, 't', { kind: 'shutter', id: 'sh', w: 1, h: 1, open: [0, 1], poweredBy: ['nope'] })],
  ['unknown reference in `ref`', /region 'a': marker 'e' \(reveal\) `ref` names 'nope'/,
    r => place(r[0], 7, 'e', { kind: 'reveal', id: 'rv', reveal: 'seam', ref: 'nope' })],
  ['seamInfo outside a seam', /region 'a': seamInfo at \[1, 1\] is not a seam cell/, r => { r[0].seamInfo = [{ at: [1, 1], id: 'x' }]; }],
  ['camera zone smaller than 28 x 16', /region 'a': camera zone 'cam' is 27 x 16; camera zones are at least 28 x 16/,
    r => { r[0].camera = [{ id: 'cam', x0: 0, y0: 0, x1: 27, y1: 16 }]; }],
  ['map rows of different length', /region 'a': map row 1 has 10 cells but row 0 has 9/, r => { r[0].map[0] = 'P.S.R.A..'; }],
  ['missing spawn', /level 'Test': 0 spawn markers \(regions: a, b, c\)/, r => { place(r[0], 0, '.'); delete r[0].markers.P; }],
  ['two spawns', /level 'Test': 2 spawn markers/, r => place(r[1], 0, 'P', { kind: 'spawn' })],
  ['relay ids not exactly A, B, C', /relay ids must be exactly A, B, C but are A, B \(regions: a, b, c\)/,
    r => { place(r[2], 4, '.'); delete r[2].markers.R; }],
  ['archive ids not exactly A, B, C', /archive ids must be exactly A, B, C but are A, C/,
    r => { place(r[1], 6, '.'); delete r[1].markers.A; }],
  ['region ranges that are not contiguous', /region 'b' spans x 12 to 22 but must start where region 'a' ends, at x 10/,
    r => { r[1].origin.x = 12; }],
];

for (const [name, message, breakIt] of cases) {
  test(`invalid data throws: ${name}`, () => {
    const level = validLevel();
    breakIt(level.regions);
    assert.throws(() => defineLevel(level), error => error instanceof Error && message.test(error.message));
  });
}

test('a mover may sit half a unit deep in terrain; deeper is a marker inside terrain', () => {
  const build = (ch, marker, row) => defineRegion({ id: 'r', map: ['#####', row, '#####'], markers: { [ch]: marker } });
  // An even shutter in an even gap reaches 0.5 into each wall. A press flush under the ceiling reaches 0.5 into it.
  const shutter = build('t', { kind: 'shutter', id: 't', w: 2, h: 1, open: [0, 1] }, '##t##');
  const press = build('r', { kind: 'press', id: 'r', travel: 1, period: 4, warn: 0.6 }, '.r...');
  assert.deepEqual(boxes(shutter.shutters), [[1.5, 1, 2, 1]]);
  assert.deepEqual(boxes(press.presses), [[0, 1, 3, 1.5]]);
  // ILO has no such margin: a spawn under a one unit ceiling does not fit.
  assert.throws(() => build('P', { kind: 'spawn' }, '#P###'), /marker 'P' \(spawn\) at \[1, 1\] is inside terrain/);
  assert.throws(() => build('t', { kind: 'shutter', id: 't', w: 4, h: 1, open: [0, 1] }, '##t##'),
    /marker 't' \(shutter\) at \[2, 1\] is inside terrain/);
});

test('a reveal kind used as marker kind points at the reveal declaration', () => {
  const level = validLevel();
  level.regions[0].markers.A = { kind: 'alcove', id: 'x' };
  assert.throws(() => defineLevel(level),
    /region 'a': marker 'A' has unknown kind 'alcove'; a reveal is declared as \{ kind: 'reveal', reveal: 'alcove' \}/);
});

test('defineRegion alone reports invalid data with its region id', () => {
  assert.throws(() => defineRegion({ id: 'lonely', map: ['#'], markers: { x: { kind: 'warp' } } }),
    /region 'lonely': marker 'x' has unknown kind 'warp'/);
  // A terrain character can never be a marker.
  assert.throws(() => defineRegion({ id: 'lonely', map: ['#M'], markers: { M: { kind: 'cell', id: 'c' } } }),
    /region 'lonely': marker 'M' \(cell\) is an empty or terrain character and cannot be a marker/);
  // A region on its own needs neither a spawn nor the full relay set.
  assert.deepEqual(defineRegion({ id: 'lonely', map: ['#'] }).solids,
    [{ id: 'lonely-s0', x: 0, y: 0, w: 1, h: 1, mat: 'rock', region: 'lonely' }]);
});

test('defineLevel: bounds hold every solid and seam, region ranges are contiguous and in order', () => {
  const level = defineLevel(validLevel());
  assert.deepEqual(level.regions, [
    { id: 'a', name: 'Region A', x0: 0, x1: 10 }, { id: 'b', name: 'Region B', x0: 10, x1: 20 }, { id: 'c', name: 'Region C', x0: 20, x1: 30 },
  ]);
  assert.deepEqual(level.bounds, { x0: 0, y0: 0, x1: 30, y1: 1 });
  assert.deepEqual(level.spawn, { x: 0.5, y: 1 });
  assert.deepEqual(level.solids.map(s => s.id), ['a-s0', 'b-s0', 'c-s0']);
  assert.equal(level.ascent, null);
  for (const list of ['seams', 'cells', 'kill', 'camera', 'decor']) assert.deepEqual(level[list], []);

  // Terrain alone sets the bounds: region b has a metal block, region c sits 3 units higher with a seam on top.
  const a = trio('A', 0, true), b = trio('B', 10), c = trio('C', 20);
  a.kill = [{ x0: 1, y0: -2, x1: 3, y1: 0, kind: 'void' }];
  a.camera = [{ id: 'hall', x0: 0, y0: 0, x1: 30, y1: 16 }];
  a.decor = [{ kind: 'lamp', x: 2.5, y: 2, tone: 'warm' }];
  b.map = ['M.S.R.A...', '##########'];
  c.origin.y = 3;
  c.map = ['%.S.R.A...', '##########'];
  const built = defineLevel({ name: 'Test', regions: [a, b, c] });
  assert.deepEqual(built.bounds, { x0: 0, y0: 0, x1: 30, y1: 5 });
  assert.deepEqual(built.kill, [{ id: 'a-kill0', x: 1, y: -2, w: 2, h: 2, kind: 'void', region: 'a' }]);
  assert.deepEqual(built.camera, [{ id: 'hall', x0: 0, y0: 0, x1: 30, y1: 16, region: 'a' }]);
  assert.deepEqual(built.decor, [{ kind: 'lamp', x: 2.5, y: 2, tone: 'warm', region: 'a' }]);
  assert.deepEqual(built.stations, [
    { id: 'st-A', x: 2.5, y: 1, region: 'a', order: 0 }, { id: 'st-B', x: 12.5, y: 1, region: 'b', order: 1 },
    { id: 'st-C', x: 22.5, y: 4, region: 'c', order: 2 },
  ]);
  // Regions that defineRegion validated already are accepted as they are.
  assert.deepEqual(defineLevel({ name: 'Test', regions: [a, b, c].map(defineRegion) }), built);
});

test('stations take their order from x, not from the map scan', () => {
  const a = trio('A', 0, true);
  a.map.unshift('.s........');
  a.markers.s = { kind: 'station', id: 'st-A2' };
  const level = defineLevel({ name: 'Test', regions: [a, trio('B', 10), trio('C', 20)] });
  assert.deepEqual(level.stations.map(s => [s.id, s.order]), [['st-A2', 0], ['st-A', 1], ['st-B', 2], ['st-C', 3]]);
});

test('a reference may name an id of any region', () => {
  const level = validLevel();
  level.regions[1].markers.R.station = 'st-A';             // Relay B commits its checkpoint at the workshop station
  assert.equal(byId(defineLevel(level).relays, 'B').station, 'st-A');
});

// A pattern for level designers: two self-contained regions placed side by side. The real level gives every
// relay its own region; this pattern keeps it to two, so the reservoir holds Relay B and Relay C.
// Rows run top to bottom, one character is one unit, and markers stand in the cell above their ground.
const workshop = {
  id: 'workshop', name: 'Buried Workshop', origin: { x: 0, y: 0 },
  map: [
    '########################################',
    '#.......#............................#..',
    '#.......#............................#..',
    '#.......#............####............#..',
    '#.......#............%..#............#..',
    '#.......#.........##.%..#...............',
    '#.P.S...%...k.....##e%.A#..c.o.s.R.C.t..',
    '########################################',
  ],
  markers: {
    P: { kind: 'spawn' },
    S: { kind: 'station', id: 'wsStart' },
    k: { kind: 'skitter', id: 'wsSkitter', range: [-1.5, 1.5] },
    e: { kind: 'reveal', id: 'wsHint', reveal: 'seam', ref: 'wsAlcove' },
    A: { kind: 'archive', id: 'A', title: 'Maintenance Roster', text: 'Night shift sealed the alcove after the last surge.' },
    c: { kind: 'cell', id: 'wsCell' },
    o: { kind: 'socket', id: 'wsSocket', label: 'Door', powers: ['wsDoor'] },
    s: { kind: 'station', id: 'wsRelay' },
    R: { kind: 'relay', id: 'A', station: 'wsRelay', lookAt: [4, 1] },
    C: { kind: 'cache', id: 'wsCache' },
    t: { kind: 'shutter', id: 'wsDoor', w: 1, h: 2, open: [0, 2], poweredBy: ['wsSocket'] },
  },
  seamInfo: [{ at: [21, 4], id: 'wsAlcove', hidden: true }],
  camera: [{ id: 'wsHall', x0: 0, y0: 0, x1: 40, y1: 16 }],
  decor: [
    { kind: 'lamp', x: 3.5, y: 3, tone: 'warm' },
    { kind: 'sign', x: 5.5, y: 1, text: '{dash} through cracked seams' },
    { kind: 'bench', x: 14.5, y: 1 },
    { kind: 'conduit', id: 'wsConduit', points: [[33.5, 2.2], [37.5, 2.2]], poweredBy: ['A'] },
  ],
};

// The reservoir starts where the workshop ends (x 40) and sits one unit lower (origin.y -1).
const reservoir = {
  id: 'reservoir', name: 'Crystal Reservoir', origin: { x: 40, y: -1 },
  map: [
    '############################################',
    '...........................................#',
    '..........................d................#',
    '............................B..............#',
    '............................##.............#',
    '.......w...p.......v..S.R...##.b.s.r..U....#',
    '##########........##########################',
    '############################################',
  ],
  markers: {
    w: { kind: 'switch', id: 'rsSwitch', label: 'Bridge', targets: ['rsPlatform'] },
    p: { kind: 'platform', id: 'rsPlatform', to: [6, 0], w: 3, speed: 2, pauseA: 1, pauseB: 1, poweredBy: ['rsSwitch'] },
    v: { kind: 'vent', id: 'rsVent', h: 3, period: 4, warn: 0.8, active: 1.2, delay: 0.5 },
    S: { kind: 'station', id: 'rsRelayB' },
    R: { kind: 'relay', id: 'B', station: 'rsRelayB', lookAt: [12, 1] },
    d: { kind: 'drone', id: 'rsDrone', to: [-3, 0] },
    B: { kind: 'archive', id: 'B', title: 'Survey Note', text: 'The shelf held before the flood; it will hold again.' },
    b: { kind: 'archive', id: 'C', title: 'Pump Log', text: 'Relay C last ran hot. Keep the vent clear.' },
    s: { kind: 'station', id: 'rsRelayC' },
    r: { kind: 'relay', id: 'C', station: 'rsRelayC', lookAt: [3, 0] },
    U: { kind: 'ascent', boarding: [4, 2] },
  },
  kill: [{ x0: 50, y0: -1, x1: 58, y1: 0.9, kind: 'water' }],
  camera: [{ id: 'rsBank', x0: 40, y0: -1, x1: 84, y1: 15 }],
  decor: [
    { kind: 'crystal', x: 46.5, y: 1, size: 2 },
    { kind: 'waterfall', x: 61.5, y: -1, h: 6 },
    { kind: 'lamp', x: 63.5, y: 4, tone: 'teal' },
    { kind: 'conduit', id: 'rsConduit', points: [[64.5, 2.4], [78.5, 2.4]], poweredBy: ['B'] },
  ],
};

test('pattern level: two regions a designer can copy', () => {
  const level = defineLevel({ name: 'DEEPWAKE pattern', regions: [workshop, reservoir] });
  assert.deepEqual(level.regions, [
    { id: 'workshop', name: 'Buried Workshop', x0: 0, x1: 40 }, { id: 'reservoir', name: 'Crystal Reservoir', x0: 40, x1: 84 },
  ]);
  assert.deepEqual(level.spawn, { x: 2.5, y: 1 });
  assert.deepEqual(level.bounds, { x0: 0, y0: -1, x1: 84, y1: 8 });
  assert.deepEqual(level.stations.map(s => [s.id, s.order]), [['wsStart', 0], ['wsRelay', 1], ['rsRelayB', 2], ['rsRelayC', 3]]);
  assert.deepEqual(level.relays.map(r => [r.id, r.region]), [['A', 'workshop'], ['B', 'reservoir'], ['C', 'reservoir']]);
  assert.deepEqual(level.archives.map(a => [a.id, a.region]), [['A', 'workshop'], ['B', 'reservoir'], ['C', 'reservoir']]);
  assert.deepEqual(level.ascent.boarding, { x: 76.5, y: 1, w: 4, h: 2 });
  assert.deepEqual(byId(level.seams, 'wsAlcove'), { id: 'wsAlcove', x: 21, y: 1, w: 1, h: 3, hidden: true, region: 'workshop' });
  assert.deepEqual(level.kill, [{ id: 'reservoir-kill0', x: 50, y: -1, w: 8, h: 1.9, kind: 'water', region: 'reservoir' }]);
  assert.deepEqual(level.platforms[0].poweredBy, ['rsSwitch']);
  for (const list of ['stations', 'relays', 'cells', 'sockets', 'switches', 'archives', 'caches', 'vents', 'reveals',
    'platforms', 'shutters', 'enemies', 'kill', 'camera', 'decor', 'solids', 'seams']) {
    assert.ok(level[list].length > 0, list);
    for (const o of level[list]) assert.equal(typeof o.region, 'string', list);
  }
});
