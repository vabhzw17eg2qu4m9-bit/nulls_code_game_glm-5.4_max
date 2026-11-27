// Level builder (contract §4.1): turns authored region definitions into the LEVEL object of contract §4.2.
// Pure data in, validated data out. No imports.

const LETTERS = ['A', 'B', 'C'];               // relay and archive ids
const MAT = { '#': 'rock', M: 'metal' };
// Body w x h of the markers with a fixed body (§3.5, §3.10, §3.11).
const BODY = {
  cell: [1, 1.1], socket: [1.2, 1.5], skitter: [1.2, 0.7], drone: [1, 0.9], sentinel: [1.5, 2], ascent: [3.5, 0.6],
};
const ILO = [0.75, 1.5];                       // PLAYER.w, h
const CAMERA = [28, 16];                       // smallest camera zone
const BEAM = 0.5;                              // sentinel beam thickness; the beam leaves the core 1 unit above the anchor
// "Inside terrain": a fixed body overlaps terrain deeper than EMBED on both axes. Wall fixtures overhang their
// cell by up to 0.25, which does not count. Movers get FIT instead, so an even width fills an even gap and a
// press hangs flush under a ceiling.
const EMBED = 0.3;
const MOVERS = ['platform', 'shutter', 'lift', 'press'];
const FIT = 0.5;
const REVEALS = ['seam', 'alcove', 'conduit'];
// Parameters each marker kind needs besides its position. A missing one would resolve to NaN or undefined.
// `label` only names a socket or a switch for the tests; nothing in `src` reads it.
const PARAMS = {
  spawn: [], station: ['id'], relay: ['id', 'station', 'lookAt'], cell: ['id'],
  socket: ['id', 'label'], switch: ['id', 'label'], archive: ['id', 'title', 'text'], cache: ['id'],
  skitter: ['id', 'range'], drone: ['id', 'to'], sentinel: ['id', 'dir', 'length'],
  vent: ['id', 'h', 'period', 'warn', 'active', 'delay'],
  platform: ['id', 'to', 'w', 'speed', 'pauseA', 'pauseB'], shutter: ['id', 'w', 'h', 'open'],
  lift: ['id', 'to', 'w', 'speed'], press: ['id', 'travel', 'period', 'warn'],
  ascent: ['boarding'], reveal: ['id', 'reveal'],
};
const LISTS = ['solids', 'seams', 'stations', 'relays', 'cells', 'sockets', 'switches', 'archives', 'caches', 'vents',
  'reveals', 'platforms', 'shutters', 'lifts', 'presses', 'enemies', 'kill', 'camera', 'decor'];

export function defineRegion(def) {
  const { id, map, origin = { x: 0, y: 0 }, markers = {} } = def;
  if (typeof id !== 'string' || !id) throw new Error('a region needs a string id');
  const fail = (ch, kind, problem) => { throw new Error(`region '${id}': marker '${ch}' (${kind}) ${problem}`); };
  const width = map?.[0]?.length;
  if (!width) throw new Error(`region '${id}': the map is empty`);
  const odd = map.findIndex(line => line.length !== width);
  if (odd >= 0) {
    throw new Error(`region '${id}': map row ${odd} has ${map[odd].length} cells but row 0 has ${width}; `
      + 'rows must have equal length');
  }

  // ids: declared ids by name. refs: [who, field, target, list]; defineLevel checks them once every region is built.
  const region = {
    id, name: def.name ?? id, x0: origin.x, x1: origin.x + width, spawn: null, ascent: null, ids: new Map(), refs: [],
  };
  for (const list of LISTS) region[list] = [];

  // Terrain: row runs, merged downwards while the run below is equal.
  let open = new Map();                        // runs of the row above that can still grow, by material, column and length
  map.forEach((line, row) => {
    const grown = new Map();
    for (const run of line.matchAll(/([#M%])\1*/g)) {
      const key = `${run[1]}:${run.index}:${run[0].length}`;
      let rect = open.get(key);
      if (rect) {
        rect.y--;                              // reaches one row further down
        rect.h++;
      } else {
        rect = {
          x: origin.x + run.index, y: origin.y + map.length - 1 - row, w: run[0].length, h: 1,
          ...(run[1] === '%' ? { hidden: false } : { mat: MAT[run[1]] }),
        };
        region[run[1] === '%' ? 'seams' : 'solids'].push(rect);
      }
      grown.set(key, rect);
    }
    open = grown;
  });
  const named = (rects, tag) => rects.map((rect, n) => ({ id: `${id}-${tag}${n}`, ...rect, region: id }));
  region.solids = named(region.solids, 's');
  region.seams = named(region.seams, 'seam');

  const cells = [];                            // [col, row, char] of every marker cell
  map.forEach((line, row) => [...line].forEach((ch, col) => {
    if (!'. #M%'.includes(ch)) cells.push([col, row, ch]);
  }));
  for (const [ch, marker] of Object.entries(markers)) {
    const kind = marker?.kind;
    const hint = REVEALS.includes(kind) ? `; a reveal is declared as { kind: 'reveal', reveal: '${kind}' }` : '';
    if (!Object.hasOwn(PARAMS, kind)) throw new Error(`region '${id}': marker '${ch}' has unknown kind '${kind}'${hint}`);
    const times = cells.filter(cell => cell[2] === ch).length;
    if (times > 1) fail(ch, kind, `occurs ${times} times; a marker occurs exactly once`);
    if (times === 0) {
      fail(ch, kind, '. #M%'.includes(ch) ? 'is an empty or terrain character and cannot be a marker'
        : 'is declared but not in the map');
    }
  }
  for (const [col, row, ch] of cells) {
    if (!Object.hasOwn(markers, ch)) {
      throw new Error(`region '${id}': map character '${ch}' at [${col}, ${row}] is not declared in markers`);
    }
  }

  const terrain = [...region.solids, ...region.seams];
  for (const [col, row, ch] of cells) {
    const marker = markers[ch];
    const { kind } = marker;
    for (const p of PARAMS[kind]) if (marker[p] === undefined) fail(ch, kind, `has no \`${p}\``);
    if ((kind === 'relay' || kind === 'archive') && !LETTERS.includes(marker.id)) {
      fail(ch, kind, `has id '${marker.id}'; ${kind} ids are A, B and C`);
    }
    // Anchor: bottom center of the marker cell.
    const a = { x: origin.x + col + 0.5, y: origin.y + map.length - 1 - row };
    const body = footprint(kind, resolve(region, ch, marker, a), a);
    const limit = MOVERS.includes(kind) ? FIT : EMBED;
    if (body) {
      for (const t of terrain) {
        if (embedded(body, t, limit)) fail(ch, kind, `at [${col}, ${row}] is inside terrain (${t.mat ?? 'seam'} ${t.id})`);
      }
    }
  }

  for (const info of def.seamInfo ?? []) {
    const [col, row] = info.at;
    const x = origin.x + col, y = origin.y + map.length - 1 - row;
    const seam = region.seams.find(s => s.x <= x && x + 1 <= s.x + s.w && s.y <= y && y + 1 <= s.y + s.h);
    if (!seam) throw new Error(`region '${id}': seamInfo at [${col}, ${row}] is not a seam cell`);
    if (info.id !== undefined) seam.id = info.id;
    if (info.hidden !== undefined) seam.hidden = info.hidden;
  }
  for (const seam of region.seams) declare(region, seam.id, `seam '${seam.id}'`);

  region.kill = (def.kill ?? []).map((k, n) => ({
    id: `${id}-kill${n}`, x: k.x0, y: k.y0, w: k.x1 - k.x0, h: k.y1 - k.y0, kind: k.kind, region: id,
  }));
  region.camera = (def.camera ?? []).map((c, n) => {
    const size = `${c.x1 - c.x0} x ${c.y1 - c.y0}`;
    if (c.x1 - c.x0 < CAMERA[0] || c.y1 - c.y0 < CAMERA[1]) {
      throw new Error(`region '${id}': camera zone '${c.id ?? n}' is ${size}; camera zones are at least ${CAMERA.join(' x ')}`);
    }
    return { ...c, region: id };
  });
  region.decor = (def.decor ?? []).map(d => {
    const what = `decor ${d.kind}${d.id === undefined ? '' : ` '${d.id}'`}`;
    if (d.id !== undefined) declare(region, d.id, what);
    if (d.poweredBy) region.refs.push([what, 'poweredBy', d.poweredBy]);
    return { ...d, region: id };
  });

  // Stations get their order along this region; defineLevel numbers them again across the whole route.
  rank(region.stations);
  uniqueIds([region]);
  return region;
}

export function defineLevel({ name, regions }) {
  const built = regions.map(region => (region.map ? defineRegion(region) : region));   // definitions, or validated regions
  const ids = built.map(region => region.id);
  if (new Set(ids).size !== ids.length) throw new Error(`level '${name}': a region id occurs twice (${ids.join(', ')})`);
  uniqueIds(built);
  checkRefs(built);
  built.forEach((region, i) => {
    const before = built[i - 1];
    if (before && region.x0 !== before.x1) {
      throw new Error(`region '${region.id}' spans x ${region.x0} to ${region.x1} but must start where region '${before.id}'`
        + ` ends, at x ${before.x1}: region x ranges are contiguous and in order`);
    }
  });
  const spawns = built.filter(region => region.spawn);
  if (spawns.length !== 1) {
    throw new Error(`level '${name}': ${spawns.length} spawn markers (regions: ${ids.join(', ') || 'none'}); `
      + 'exactly one is required');
  }
  const letters = list => built.flatMap(region => region[list]).map(o => o.id).sort().join(', ');
  for (const [what, found] of [['relay', letters('relays')], ['archive', letters('archives')]]) {
    if (found !== LETTERS.join(', ')) {
      throw new Error(`level '${name}': ${what} ids must be exactly A, B, C but are ${found || 'none'} `
        + `(regions: ${ids.join(', ')})`);
    }
  }
  const boxes = built.flatMap(region => [...region.solids, ...region.seams]);
  if (!boxes.length) throw new Error(`level '${name}': no terrain in any region`);

  const level = {
    name, spawn: spawns[0].spawn,
    bounds: {
      x0: Math.min(...boxes.map(b => b.x)), y0: Math.min(...boxes.map(b => b.y)),
      x1: Math.max(...boxes.map(b => b.x + b.w)), y1: Math.max(...boxes.map(b => b.y + b.h)),
    },
    regions: built.map(({ id, name: regionName, x0, x1 }) => ({ id, name: regionName, x0, x1 })),
  };
  for (const list of LISTS) level[list] = built.flatMap(region => region[list]);
  level.ascent = built.find(region => region.ascent)?.ascent ?? null;
  // Stations count up along the whole route: regions in order, left to right inside a region.
  rank(level.stations);
  return level;
}

// Builds the object of one marker at anchor `a`. Returns it when it has a body, else null.
function resolve(region, ch, marker, a) {
  const { kind } = marker;
  const id = marker.id;
  const home = { x: a.x, y: a.y };
  const size = (w, h) => ({ x: a.x, y: a.y, w, h });                        // body w x h standing on the anchor
  const rect = (w, h) => ({ x: a.x - w / 2, y: a.y, w, h });                // the same body as a rect (§3.2)
  const put = (list, object) => {
    object.region = region.id;
    if (list === 'ascent') region.ascent = object; else region[list].push(object);
    // Relay and archive letters are checked as a set, never as unique ids.
    if (list !== 'relays' && list !== 'archives') {
      declare(region, object.id, `${object.kind ?? list.replace(/s$/, '')} '${object.id}' (marker '${ch}')`);
    }
    return object;
  };
  const use = (field, target, list) => region.refs.push([`marker '${ch}' (${kind})`, field, target, list]);
  // A mover at its `from` rect; `offset` is the authored `to` or `open`.
  const mover = (list, from, offset, rest) => {
    use('poweredBy', marker.poweredBy);
    return put(list, {
      id, kind, ...from, fx: from.x, fy: from.y, tx: from.x + offset[0], ty: from.y + offset[1],
      mode: 'loop', poweredBy: marker.poweredBy ?? [], ...rest,
      yields: kind !== 'press', crushes: kind === 'press', enabled: true,
    });
  };

  switch (kind) {
    case 'spawn':
      region.spawn = home;
      return null;
    case 'station':
      return put('stations', { id, x: a.x, y: a.y });
    case 'relay':
      use('station', marker.station, 'stations');
      use('socket', marker.socket, 'sockets');
      return put('relays', {
        id, x: a.x, y: a.y + 1.2, station: marker.station, socket: marker.socket ?? null,
        lookAt: { x: a.x + marker.lookAt[0], y: a.y + marker.lookAt[1] },
      });
    case 'cell':
      return put('cells', { id, ...size(...BODY.cell), home });
    case 'socket':
      use('powers', marker.powers);
      return put('sockets', { id, ...size(...BODY.socket), label: marker.label, powers: marker.powers ?? [] });
    case 'switch':
      use('targets', marker.targets);
      return put('switches', { id, x: a.x, y: a.y, label: marker.label, targets: marker.targets ?? [] });
    case 'archive':
      return put('archives', { id, x: a.x, y: a.y, title: marker.title, text: marker.text });
    case 'cache':
      return put('caches', { id, x: a.x, y: a.y });
    case 'skitter':
      return put('enemies', {
        id, kind, ...size(...BODY.skitter), home, range: { x0: a.x + marker.range[0], x1: a.x + marker.range[1] },
      });
    case 'drone':
      return put('enemies', {
        id, kind, ...size(...BODY.drone), home,
        route: { fx: a.x, fy: a.y, tx: a.x + marker.to[0], ty: a.y + marker.to[1] },
      });
    case 'sentinel':                           // the beam leaves the front face at the height of the core
      return put('enemies', {
        id, kind, ...size(...BODY.sentinel), home, dir: marker.dir,
        lane: {
          x: a.x + (marker.dir < 0 ? -BODY.sentinel[0] / 2 - marker.length : BODY.sentinel[0] / 2),
          y: a.y + 1 - BEAM / 2, w: marker.length, h: BEAM,
        },
      });
    case 'vent':
      return put('vents', {
        id, x: a.x, y: a.y, w: 1, h: marker.h, period: marker.period, warn: marker.warn, active: marker.active,
        delay: marker.delay,
      });
    case 'platform':
      return mover('platforms', rect(marker.w, 0.5), marker.to,
        { speed: marker.speed, pauseA: marker.pauseA, pauseB: marker.pauseB });
    case 'shutter':
      return mover('shutters', rect(marker.w, marker.h), marker.open, { mode: 'toggle' });
    case 'lift':
      return mover('lifts', rect(marker.w, 0.6), marker.to, { speed: marker.speed, mode: 'toggle' });
    case 'press':
      return mover('presses', rect(3, 1.5), [0, -marker.travel],
        { travel: marker.travel, period: marker.period, warn: marker.warn });
    case 'ascent':                             // x is the cabin center; boarding is a rect with its bottom-left x
      return put('ascent', {
        id: 'ascent', ...size(...BODY.ascent), console: home, boarding: rect(...marker.boarding),
      });
    default:                                  // reveal
      use('ref', marker.ref);
      return put('reveals', { id, x: a.x, y: a.y, kind: marker.reveal, ref: marker.ref ?? null });
  }
}

// The rect a marker must keep clear of terrain: ILO where ILO stands, else the body of the resolved object.
function footprint(kind, body, a) {
  if (kind === 'spawn' || kind === 'station' || kind === 'archive' || kind === 'cache') {
    return { x: a.x - ILO[0] / 2, y: a.y, w: ILO[0], h: ILO[1] };
  }
  if (body?.w === undefined || kind === 'vent') return null;                // no size in the contract; a vent's h is its jet
  return body.fx === undefined ? { x: body.x - body.w / 2, y: body.y, w: body.w, h: body.h } : body;
}

function embedded(r, t, limit) {
  return Math.min(r.x + r.w, t.x + t.w) - Math.max(r.x, t.x) > limit
    && Math.min(r.y + r.h, t.y + t.h) - Math.max(r.y, t.y) > limit;
}

// Every reference names an id declared anywhere in the level or a relay letter; `list` narrows it to one kind of object.
function checkRefs(regions) {
  const known = new Set([...LETTERS, ...regions.flatMap(region => [...region.ids.keys()])]);
  for (const { id, refs } of regions) {
    for (const [who, field, target, list] of refs) {
      for (const ref of [target ?? []].flat()) {
        const ok = list ? regions.some(region => region[list].some(o => o.id === ref)) : known.has(ref);
        if (!ok) {
          throw new Error(`region '${id}': ${who} \`${field}\` names '${ref}', which is not `
            + `${list ? `an id in ${list}` : 'a declared id'}`);
        }
      }
    }
  }
}

function declare(region, id, what) {
  region.ids.set(id, [...(region.ids.get(id) ?? []), what]);
}

// Numbers stations along a route: left to right, then bottom to top.
function rank(stations) {
  stations.sort((p, q) => p.x - q.x || p.y - q.y);
  stations.forEach((station, order) => { station.order = order; });
}

// Every id is declared once in the level. Each region lists its declarations under the id.
function uniqueIds(regions) {
  const seen = new Map();
  for (const region of regions) {
    for (const [id, whats] of region.ids) {
      for (const what of whats) {
        const first = seen.get(id);
        if (first) {
          throw new Error(`region '${region.id}': ${what} reuses id '${id}', `
            + `declared by ${first.what} in region '${first.region.id}'`);
        }
        seen.set(id, { what, region });
      }
    }
  }
}
