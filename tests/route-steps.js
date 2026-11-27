// The route script of tests/route.test.mjs and tools/browser-check.mjs: one entry per line of the ROUTE block at the
// top of src/level/level.js. Every step drives a Driver (tests/route-driver.js) through real inputs only: it teleports
// nowhere, writes no field after the start and sets no debug flag. The module loads in a browser as well as in Node,
// so it imports nothing from `node:`.

export const byId = (list, id) => list.find((item) => item.id === id);
const atRest = (m, t) => Math.abs(m.t - t) < 1e-9 && !m.moving;

/** Seconds before the jet of vent `v` starts (at least its warning while it is dormant; negative while active). */
function ventLead(v) {
  const phase = (((v.t - v.delay) % v.period) + v.period) % v.period;
  return v.period - v.active - phase;
}

// --- The script: one entry per line of the ROUTE block at the top of src/level/level.js ---
const dormant = (id) => (d) => ventLead(byId(d.world.vents, id)) >= 0.8;
const ontoStepBlock = (d) => { d.walkTo(10.5); d.leap(12.3); d.walkTo(12.7); };
const throughTrench = (d) => { d.leap(19.8, { takeoff: 16.6 }); };
const climbShaft2 = (d) => { d.walkTo(138.5); d.climb({ exit: { wall: -1, y: 20, x: 143, floor: 22 }, first: 1 }); };
/** From the floor east of crate B into the 1-unit slot, up onto crate B (the gallery wall starts above the floor). */
export const climbSlot = (d) => { d.walkTo(46.5); d.climb({ exit: { wall: 1, y: 7.6, x: 45.3, floor: 10 }, first: 1, rise: 1.6 }); };

/** From the observation spot (106.5, 13): jump 2 up onto the cover block, pulsing the moment the reservoir drone aims. */
export const mountBlock = (d) => {
  const drone = byId(d.world.enemies, 'resDrone');
  let airborne = false;
  d.steer(1);
  d.keys.jump = true;
  d.keys.jumpPressed = true;
  d.until((d) => {                                // jump 2 up onto the block; pulse the moment the drone aims
    const p = d.p;
    if (!airborne) {
      airborne = !p.grounded;
      return false;
    }
    if (drone.state === 'aim' && p.pulseCd <= 0 && d.world.pulse === null) d.keys.pulsePressed = true;
    if (p.grounded) {
      d.release();
      return true;
    }
    d.airSteer(108.4, 15);
    return false;
  }, { what: 'mounting the cover block' });
};

/** On the block (216.9, 56), in sight of the ascent drone: pulse the moment it aims, and wait until it is stunned. */
export const stunAscentDrone = (d) => {
  const drone = byId(d.world.enemies, 'ascDrone');
  d.idle((d) => drone.state === 'aim', { timeout: 2, what: 'the ascent drone aiming' });
  d.pulse();
  d.idle((d) => drone.state === 'stunned', { timeout: 1, what: 'the ascent drone stunned' });
};

export const ROUTE = {
  M01: (d) => { d.walkTo(7.5); d.stand(0.6); },
  M02a: ontoStepBlock,
  M02b: throughTrench,
  M02: (d) => { ontoStepBlock(d); throughTrench(d); },
  M03: (d) => { d.leap(27.5, { takeoff: 22.25, hold: 'full' }); },
  M04: (d) => { d.walkTo(29.5); d.dash(1); },
  M05: (d) => { d.walkTo(34.5); d.stand(3); d.pulse(); },   // the sign: the observation spot before the skitter
  M06: (d) => { d.walkTo(41.2); },
  M07: (d) => { d.leap(43.4, { takeoff: 41.0, hold: 'full' }); d.walkTo(43.55); d.leap(45.3, { hold: 'full' }); },
  M08: (d) => { d.walkTo(47.5); },
  M09: (d) => { d.interact('pickup'); d.walkTo(50.5); d.interact('insert'); },
  M10: (d) => { d.walkTo(56.0); },
  M11: (d) => { d.walkTo(57.5); d.pulse(); d.idle((d) => d.world.mode === 'play'); d.walkTo(59.5); d.stand(0.3); },
  M12: (d) => { d.walkTo(70.5); },
  M13: (d) => {
    d.leap(78, { takeoff: 72.6, hold: 'full' });
    d.walkTo(79.5);
    d.leap(84, { takeoff: 79.5, hold: 'full' });
    d.walkTo(85.5);
    d.leap(90.5, { takeoff: 85.5, hold: 'full' });
  },
  M14: (d) => { d.walkTo(92.5); d.climb({ exit: { wall: -1, y: 11.5, x: 96, floor: 13 } }); },
  M15: (d) => { d.walkTo(99); },
  M16: (d) => { d.walkTo(102); d.climb({ exit: { wall: -1, y: 19.5, x: 106, floor: 21 } }); },
  M17: (d) => { d.walkTo(107.2); d.interact('switch'); },
  M18: (d) => { d.walkTo(103.3); d.walkTo(106.5); },
  M19: (d) => {
    const drone = byId(d.world.enemies, 'resDrone');
    d.stand(3);                                     // the observation spot: hidden behind the cover block
    mountBlock(d);
    d.idle((d) => drone.state === 'stunned', { timeout: 1, what: 'the drone stunned' });
    d.walkTo(109.2);                                // the block's east edge: the dash reaches the drone wherever it patrols
    d.dash(1);
    d.idle((d) => drone.state === 'disabled' && d.p.grounded, { timeout: 2, what: 'the drone disabled' });
  },
  M20: (d) => {
    const bridge = byId(d.world.movers, 'resBridge');
    d.walkTo(118.6);
    d.idle((d) => atRest(bridge, 0) && bridge.wait > 0.7, { timeout: 14, what: 'the bridge at its west end' });
    d.leap(120.2);
    d.idle((d) => atRest(bridge, 1), { timeout: 7, what: 'the bridge at its east end' });
    d.walkTo(132.5);
  },
  M21: (d) => { d.pulse(); d.idle((d) => d.world.mode === 'play'); d.walkTo(134.5); d.stand(0.3); },
  M22: climbShaft2,
  M23: (d) => {
    const sentinel = byId(d.world.enemies, 'fndSentinel');
    d.walkTo(144.5);
    d.stand(3);                                     // the observation spot, out of the beam's reach
    d.walkTo(149.5);
    d.idle((d) => sentinel.state === 'venting', { timeout: 6, what: 'the sentinel venting' });
    d.leap(152.5);
    d.walkTo(155.0);
  },
  M24: (d) => { d.leap(164, { takeoff: 158.2, hold: 'full' }); },
  M25: (d) => {
    for (const [vent, spot] of [['fndVent1', 162.5], ['fndVent2', 165.5], ['fndVent3', 168.5]]) {
      d.walkTo(spot);                               // the observation spot before the vent
      d.stand(3);
      d.idle(dormant(vent), { timeout: 6, what: `${vent} dormant` });
    }
    d.walkTo(172.5);
  },
  M26: (d) => { d.walkTo(173.5); d.interact('pickup'); d.walkTo(175.5); d.leap(177.8, { takeoff: 175.5 }); d.walkTo(178.9); d.interact('insert'); },
  M27: (d) => {
    const lift = byId(d.world.movers, 'fndLift');
    d.idle((d) => atRest(lift, 1), { timeout: 6, what: 'the cabin at the top' });
    d.walkTo(179.0);
    d.leap(182.3);
  },
  M28: (d) => { d.walkTo(184.5); d.interact('switch'); },
  M29: (d) => { d.walkTo(180.2); },
  M30: (d) => { d.interact('remove'); d.walkTo(186.5); d.interact('insert'); },
  M31: (d) => { d.walkTo(188.5); d.pulse(); d.idle((d) => d.world.mode === 'play'); d.walkTo(191.5); d.stand(0.3); },
  M32: (d) => { d.walkTo(198.5); d.climb({ exit: { wall: -1, y: 34.5, x: 202.5, floor: 36 } }); },
  M33: (d) => {
    const platform = byId(d.world.movers, 'ascPlatform');
    d.idle((d) => atRest(platform, 0) && platform.wait > 0.9, { timeout: 20, what: 'the platform at the bottom' });
    d.walkTo(205.5);
    d.idle((d) => atRest(platform, 1), { timeout: 10, what: 'the platform at the top' });
    d.leap(208.5, { takeoff: 206.2 });
  },
  M34: (d) => {
    d.walkTo(209);
    d.stand(3);                                     // the observation spot before the vent and the drone
    d.idle(dormant('ascVent1'), { timeout: 6, what: 'the ascent vent dormant' });
    d.walkTo(214.5);
    d.leap(216.9, { takeoff: 215.5, hold: 'full' });
  },
  M35: (d) => {
    const drone = byId(d.world.enemies, 'ascDrone');
    stunAscentDrone(d);
    d.walkTo(217.3);
    d.dash(1);
    d.idle((d) => drone.state === 'disabled' && d.p.grounded, { timeout: 2, what: 'the ascent drone disabled' });
    d.walkTo(223.5);
  },
  M36: (d) => { d.climb({ exit: { wall: -1, y: 64.5, x: 228, floor: 66 } }); },
  M37: (d) => { d.walkTo(229.5); d.interact('lift'); d.idle((d) => d.world.mode === 'complete', { timeout: 20, what: 'completion' }); },

  // Detours. Each one starts and ends where the main line stands at that point.
  D1: (d) => {
    d.walkTo(13.2);
    d.pulse();                                      // 65 energy: the cache is collected below 75
    d.leap(16.5, { takeoff: 13.2, hold: 'full', floor: 9 });
    d.interact('cache');
    d.walkTo(13.2);
  },
  D2: (d) => { d.walkTo(45.5); d.pulse(); d.dash(1); d.walkTo(52.5); d.interact('archive'); d.walkTo(46.5); },
  D3: (d) => {
    d.leap(135, { takeoff: 140.75, hold: 'full', floor: 24 });
    d.walkTo(134.5);
    d.interact('archive');
    d.walkTo(139);
    climbShaft2(d);
  },
  D4: (d) => {
    d.walkTo(158.6);
    d.walkTo(159.5);
    d.pulse();
    d.dash(1);
    d.walkTo(167.5);
    d.interact('archive');
    d.walkTo(162.4);
    d.leap(159, { floor: 18 });                     // back west through the opening, into the pit
    d.leap(157, { hold: 'full' });                  // onto the step
    d.leap(156.5, { hold: 'full' });                // up to the foundry floor
  },
  D5: (d) => {
    const press = byId(d.world.movers, 'fndPress1');
    const raised = (d) => atRest(press, 0) && press.wait > 1.3;
    d.walkTo(186.9);
    d.idle(raised, { timeout: 6, what: 'the press raised' });
    d.walkTo(192.5);
    d.interact('cache');
    d.idle(raised, { timeout: 6, what: 'the press raised' });
    d.walkTo(180.2);
  },
  D6: (d) => {
    d.walkTo(111.2);
    d.walkTo(110.3);                                 // west off the ledge, down into the basin: the prompt asks for a pulse
    d.pulse();                                       // shows the hidden seam and its marker
    d.idle((d) => byId(d.world.seams, 'resPassage').revealedUntil > d.world.time, { timeout: 1, what: 'the seam shown' });
    d.dash(-1);                                      // through the seam; the corridor floor stops the dash over the opening
    d.walkTo(105.5);
    d.interact('cache');
    d.walkTo(108.4);                                 // back into the opening: the room is too low to jump in
    d.leap(110.3, { floor: 11 });                    // a tap east onto the basin floor, one unit up
    d.leap(112.2, { hold: 'full', floor: 13 });      // 2 up east onto the ledge
    d.walkTo(118.6);
  },
};

export const MAIN = Array.from({ length: 37 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
export const until = (id) => MAIN.slice(0, MAIN.indexOf(id) + 1);
export const from = (id) => MAIN.slice(MAIN.indexOf(id));

const STOP = Symbol('cut');

/** Route step `id` stopped right after its `n`-th call of Driver method `method`: a moment of the route, as it stands. */
export const cut = (id, method, n = 1) => (d) => {
  const own = Object.hasOwn(d, method);
  const original = d[method];
  let calls = 0;
  d[method] = function (...args) {
    const out = original.apply(this, args);
    if (++calls === n) throw STOP;
    return out;
  };
  try {
    ROUTE[id](d);
  } catch (error) {
    if (error !== STOP) throw error;
  } finally {
    if (own) d[method] = original;
    else delete d[method];
  }
  d.release();
};
