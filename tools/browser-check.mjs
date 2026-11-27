#!/usr/bin/env node
// DEEPWAKE in a real browser: headless Chromium with software WebGL (SwiftShader) loads the game from server.mjs on a
// free port and plays it with real keys, real clicks and CDP touch events. The game is read through window.DEEPWAKE
// only (inspect, warp, world); the route of the Node route test (tests/route-steps.js) plays inside the page, on the
// game's own world. Every frame is drawn on the CPU. The limits of M guard against a gross regression on software
// WebGL: a mean frame time of at most 26 ms, a 95th percentile of at most 34 ms, and at most 5 percent of the frames
// over 50 ms. Nothing here says how the game sounds.
//
//   npm run check:browser        Playwright: a local install, else the global folder `npm root -g` prints
//
// One line per check, PASS or FAIL with what was measured; exit code 1 when one check fails.
// Images go to dev/BrowserCheck/.

import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYER } from '../src/config.js';
import { LEVEL } from '../src/level/level.js';
import { createWorld } from '../src/sim/world.js';
import { Driver } from '../tests/route-driver.js';
import { MAIN, ROUTE, from, until } from '../tests/route-steps.js';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dev', 'BrowserCheck');
const KEYS = { records: 'deepwake.records.v1', settings: 'deepwake.settings.v1' };
const PHONE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const LAYOUTS = {
  portrait: { ...PHONE, viewport: { width: 390, height: 844 } },
  landscape: { ...PHONE, viewport: { width: 844, height: 390 } },
  desktop: { viewport: { width: 1280, height: 720 } },
};
/** Where ILO must stand clear of a phone's interface: the ascent ledge, the drone block, the ascent entrance, the bank
 *  before shaft 1, a relay station, the sentinel's recess, the relay socket. */
const CLEAR_SPOTS = [[208, 54], [216, 56], [196, 22], [88, 3], [134.5, 13], [150, 22], [186.5, 22]];
const BODY = { w: PLAYER.w, h: PLAYER.h };
const MB = 1024 * 1024;
/** The limits of M: frame times in milliseconds, and the largest share of frames that may be slower than `slow`. */
const FRAMES = { mean: 26, p95: 34, slow: 50, share: 0.05 };

const need = (condition, message) => {
  if (!condition) throw new Error(message);
};
const steps = (ids) => ids.map((id) => [id]);
/** The main line from step `first` to step `last`, both included. */
const between = (first, last) => MAIN.slice(MAIN.indexOf(first), MAIN.indexOf(last) + 1);
/** Route steps, the last one cut right after its `n`-th call of Driver method `method`. */
const cut = (ids, id, method, n) => [...steps(ids), [id, ['call', method, n]]];
/** Route steps, the last one cut as soon as it takes the world out of mode `play`: a relay look, the lift. */
const leaves = (ids, id) => [...steps(ids), [id, 'leavesPlay']];
/** The rest of a cut step (`skip` counts the calls it made before the cut), then more steps. */
const resume = (id, skip, ids = []) => [[id, undefined, skip], ...steps(ids)];

/**
 * The main route in four segments. A segment ends where the world leaves `play`: at a relay node once its relay is
 * active, or at the lift console. The relay look and the lift hold the clock, so the page may step and draw between
 * segments without costing time.
 */
const EXACT = [
  leaves(until('M10'), 'M11'),
  [...resume('M11', { walkTo: 1, pulse: 1 }, between('M12', 'M20')), ['M21', 'leavesPlay']],
  [...resume('M21', { pulse: 1 }, between('M22', 'M30')), ['M31', 'leavesPlay']],
  [...resume('M31', { pulse: 1 }, between('M32', 'M36')), ['M37', 'leavesPlay']],
];
/**
 * The route again, with the page running between its segments, for the images of play. Each segment ends where ILO
 * stands, so the page's own steps change nothing. `key`: a real key pressed there first; `ride`: milliseconds to let
 * the page play on before the image.
 */
const PICTURE = [
  { segments: cut(until('M10'), 'M11', 'walkTo', 1), key: 'q', image: 'relay-a' },
  { segments: [...resume('M11', { walkTo: 1, pulse: 1 }, between('M12', 'M19')), ['M20', ['leap', 1]]], ride: 3000, image: 'bridge-ride' },
  { segments: [...resume('M20', { walkTo: 1, idle: 1, leap: 1 }, between('M21', 'M22')), ['M23', ['stand', 1]]], image: 'sentinel-lane' },
  { segments: [...resume('M23', { walkTo: 1, stand: 1 }, between('M24', 'M25')), ['M26', ['walkTo', 3]]], image: 'cell-carry' },
  { segments: resume('M26', { walkTo: 3, interact: 1, leap: 1 }, from('M27')) },
];
/** The three archive detours of the route test and the cache behind the side passage, in one expedition; the archives
 *  are each kept through a recovery at the station that commits them. */
const ARCHIVES = [
  { segments: steps([...until('M07'), 'D2']), archive: 'A', image: 'fragment' },
  { segments: steps(from('M08').slice(0, 4)), retry: ['st2', 1] },
  { segments: steps([...between('M12', 'M19'), 'D6']), cache: 'cache2' },
  { segments: steps([...between('M20', 'M22'), 'D3']), archive: 'B', image: 'fragment-b' },
  { segments: steps(['M23', 'D4']), archive: 'C', image: 'fragment-c' },
  { segments: steps(from('M24').slice(0, 8)), retry: ['st4', 3] },
  { segments: steps(from('M32')) },
];

/** The clock of the main route played in Node, the way tests/route.test.mjs plays it. */
function nodeRouteClock() {
  const world = createWorld(LEVEL);
  world.mode = 'play';
  const driver = new Driver(world);
  for (const id of MAIN) driver.section(id, ROUTE[id]);
  return world.clock;
}

// --- Browser, server, pages ---

/** Playwright: a local install, else the global folder `npm root -g` prints. */
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const global = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return require(require.resolve('playwright', { paths: [global] }));
  }
}

/** A port nobody listens on, on 127.0.0.1. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** The static server of the project (server.mjs) on a free port, until `stop()` runs. */
async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve); // "DEEPWAKE is served at ...": it listens
    child.once('exit', (code) => reject(new Error(`server.mjs left with code ${code}`)));
    child.once('error', reject);
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => child.kill() };
}

/** A fresh context with one page that keeps every page error and console error. `prepare` runs before the page loads. */
async function open(browser, options, prepare = null) {
  const context = await browser.newContext(options);
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console error: ${message.text()}`);
  });
  if (prepare !== null) await prepare(context);
  return { context, page, errors, close: () => context.close() };
}

const inspect = (page) => page.evaluate(() => window.DEEPWAKE.inspect());
const press = (page, code) => page.keyboard.press(code);
const stored = (page, key) => page.evaluate((name) => JSON.parse(localStorage.getItem(name)), key);
/** `test` in the page until it holds (`arg` is passed in). */
const waitFor = (page, test, arg = null, options = {}) => page.waitForFunction(test, arg, options);
/** One more frame of the page (the game asked for its frame first, so it drew before this resolves). */
const frame = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
/** The page after one more frame, as `<name>.png` in dev/BrowserCheck; its bytes. */
async function shot(page, name) {
  await frame(page);
  return page.screenshot({ path: join(OUT, `${name}.png`) });
}

/** Load the game and wait for its inspection API (10 s at most): the seconds the boot took. */
async function boot(page, url) {
  const started = Date.now();
  await page.goto(url);
  await waitFor(page, () => window.DEEPWAKE !== undefined, null, { timeout: 10000 });
  return (Date.now() - started) / 1000;
}

/** Enter on the title begins an expedition. */
async function begin(page) {
  await press(page, 'Enter');
  await waitFor(page, () => window.DEEPWAKE.inspect().mode === 'play');
}

/** Keep the current world on the page as `window[name]`, to tell it from the next one. */
const mark = (page, name) => page.evaluate((key) => { window[key] = window.DEEPWAKE.world; }, name);

// --- Run in the page ---

/** The route of the Node route test on the page's own world, through a Driver. `window.__route` runs it in segments. */
async function installRoute(page) {
  await page.evaluate(async () => {
    const [{ ROUTE }, { Driver }] = await Promise.all([import('/tests/route-steps.js'), import('/tests/route-driver.js')]);
    const driver = new Driver(window.DEEPWAKE.world);
    const END = Symbol('end of segment');
    let seen = 0; // route events already looked at

    /**
     * Route step `id`. It ends right after its `n`-th call of Driver method `method` when `[method, n]` is given, or
     * with the first step that takes the world out of mode `play` when `leavesPlay` is; and the first `skip[method]`
     * calls of each method are left out. So a step cut in two runs on, the second time, from where its first part
     * ended.
     */
    function step(id, stopAfter, skip) {
      const calls = {};
      const [method, n] = stopAfter === 'leavesPlay' ? [] : stopAfter;
      const takeStep = driver.step;
      if (stopAfter === 'leavesPlay') {
        driver.step = function () {
          const out = takeStep.call(driver);
          if (driver.world.mode !== 'play') throw END;
          return out;
        };
      }
      const originals = new Map([...Object.keys(skip), ...(method === undefined ? [] : [method])]
        .map((name) => [name, driver[name]]));
      for (const name of originals.keys()) {
        driver[name] = (...args) => {
          calls[name] = (calls[name] ?? 0) + 1;
          if (calls[name] > (skip[name] ?? 0)) {
            const out = originals.get(name).apply(driver, args);
            if (name === method && calls[name] === n) throw END;
            return out;
          }
          return driver;
        };
      }
      try {
        driver.section(id, ROUTE[id]);
      } catch (error) {
        if (error !== END) throw error;
      } finally {
        for (const [name, original] of originals) driver[name] = original;
        delete driver.step;
      }
    }

    window.__route = {
      /** `segments` (`[id]`, `[id, stopAfter]` or `[id, stopAfter, skip]`): the clock before and after, the mode, ILO. */
      run(segments) {
        const before = window.DEEPWAKE.inspect().clock;
        driver.release(); // a cut step may have stopped with keys down
        for (const [id, stopAfter, skip] of segments) step(id, stopAfter ?? [], skip ?? {});
        const { clock, mode, player } = window.DEEPWAKE.inspect();
        return { before, clock, mode, x: player.x, y: player.y };
      },
      /** The route's events of type `type` since the last call, put into the world's queue for the page: how many. */
      handOver(type) {
        const fresh = driver.events.slice(seen).filter((event) => event.type === type);
        seen = driver.events.length;
        window.DEEPWAKE.world.events.push(...fresh);
        return fresh.length;
      },
    };
  });
}

/** Run in the page. ILO's body in CSS pixels, from the world rectangle of the view and its position, and the interface
 *  boxes it meets. `gap`: the least free space above or below it; `onScreen`: wholly on screen. */
function clearance(body) {
  const { view, player } = window.DEEPWAKE.inspect();
  const width = innerWidth;
  const height = innerHeight;
  const left = ((player.x - body.w / 2 - view.x0) * width) / (view.x1 - view.x0);
  const right = ((player.x + body.w / 2 - view.x0) * width) / (view.x1 - view.x0);
  const top = height - ((player.y + body.h - view.y0) * height) / (view.y1 - view.y0);
  const bottom = height - ((player.y - view.y0) * height) / (view.y1 - view.y0);
  const hits = [];
  let above = top;
  let below = height - bottom;
  for (const element of document.querySelectorAll('#hud, #hud *, #touch button')) {
    const r = element.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const name = element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '');
    const overX = Math.min(right, r.right) - Math.max(left, r.left);
    const overY = Math.min(bottom, r.bottom) - Math.max(top, r.top);
    if (overX > 0.5 && overY > 0.5) hits.push(name);
    if (overX > 0 && r.bottom <= top + 0.5) above = Math.min(above, top - r.bottom);
    if (overX > 0 && r.top >= bottom - 0.5) below = Math.min(below, r.top - bottom);
  }
  const onScreen = left >= 0 && top >= 0 && right <= width && bottom <= height;
  return { box: [left, top, right, bottom].map((n) => Math.round(n)), hits, gap: Math.round(Math.min(above, below)), onScreen };
}

/** ILO's box once the view came to rest after a warp: its top left corner stopped moving. */
async function settled(page) {
  let last = null;
  const since = Date.now();
  while (Date.now() - since < 6000) {
    const now = await page.evaluate(clearance, BODY);
    if (last !== null && Math.abs(now.box[0] - last.box[0]) < 0.05 && Math.abs(now.box[1] - last.box[1]) < 0.05) return now;
    last = now;
    await frame(page);
  }
  throw new Error('the view did not come to rest after the warp');
}

/** Run in the page. Every element and text run under `#ui` and `#touch` that has a box, cut back to what a clipping
 *  ancestor leaves, against the viewport. */
function layout() {
  const width = innerWidth;
  const height = innerHeight;
  const outside = [];
  let count = 0;
  const show = (rect) => [rect.left, rect.top, rect.right, rect.bottom].map((n) => Math.round(n)).join(',');
  const name = (node) => node.tagName.toLowerCase() + (node.id ? `#${node.id}` : '')
    + (typeof node.className === 'string' && node.className !== '' ? `.${node.className.trim().split(/\s+/).join('.')}` : '');
  /** `rect` as the ancestors from `start` up to `root` leave it where they clip. */
  const clipped = (rect, start, root) => {
    for (let node = start; node !== null && node !== root.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      const x = style.overflowX !== 'visible';
      const y = style.overflowY !== 'visible';
      if (!x && !y) continue;
      const box = node.getBoundingClientRect();
      rect = {
        left: x ? Math.max(rect.left, box.left) : rect.left, right: x ? Math.min(rect.right, box.right) : rect.right,
        top: y ? Math.max(rect.top, box.top) : rect.top, bottom: y ? Math.min(rect.bottom, box.bottom) : rect.bottom,
      };
    }
    return rect;
  };
  const note = (what, rect, start, root) => {
    const kept = clipped(rect, start, root);
    if (kept.right - kept.left <= 0.5 || kept.bottom - kept.top <= 0.5) return;
    count += 1;
    if (kept.left < -0.5 || kept.top < -0.5 || kept.right > width + 0.5 || kept.bottom > height + 0.5) {
      outside.push(`${what} [${show(kept)}]`);
    }
  };
  for (const root of [document.querySelector('#ui'), document.querySelector('#touch')]) {
    for (const element of [root, ...root.querySelectorAll('*')]) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) note(name(element), rect, element.parentElement, root);
      for (const child of element.childNodes) {
        if (child.nodeType !== 3 || child.textContent.trim() === '') continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const run of range.getClientRects()) note(`text of ${name(element)}`, run, element, root);
      }
    }
  }
  return { width, height, count, outside };
}

/** A page without WebGL 2: `getContext` answers null for every WebGL type. */
const NO_WEBGL = () => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return typeof type === 'string' && type.startsWith('webgl') ? null : getContext.call(this, type, ...rest);
  };
};

// --- The checks ---

const results = [];

/** One line: PASS or FAIL, the letter, the name, what was measured (or why it failed). */
async function check(letter, name, body) {
  try {
    console.log(`PASS ${letter} ${name}: ${await body()}`);
    results.push(true);
  } catch (error) {
    console.log(`FAIL ${letter} ${name}: ${String(error.message).split('\n')[0]}`);
    results.push(false);
  }
}

const server = await startServer();
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const url = server.url;
await mkdir(OUT, { recursive: true });
for (const file of await readdir(OUT)) if (file.endsWith('.png')) await rm(join(OUT, file));
console.log(`DEEPWAKE in ${browser.version()} with software WebGL (SwiftShader), served at ${url}`);

try {
  await check('A', 'boot', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      const seconds = await boot(page, url);
      await frame(page);
      const title = await page.evaluate(() => {
        /** Text of `selector` when it is on screen, else null. */
        const shown = (selector) => {
          const node = document.querySelector(selector);
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
            ? node.textContent : null;
        };
        return { document: document.title, heading: shown('#card-title h1'), begin: shown('#card-title .begin') };
      });
      need(title.document === 'DEEPWAKE' && title.heading === 'DEEPWAKE' && title.begin === 'Begin Expedition',
        `the title shows ${JSON.stringify(title)}`);
      const image = await shot(page, 'title-desktop');
      need(image.length > 30 * 1024, `title-desktop.png is ${Math.round(image.length / 1024)} KB`);
      await page.waitForTimeout(400);
      need(!image.equals(await page.screenshot()), 'the image is the same 400 ms later');
      need(errors.length === 0, errors.join('; '));
      return `DEEPWAKE in ${seconds.toFixed(2)} s, title-desktop.png ${Math.round(image.length / 1024)} KB and changing`
        + ' 400 ms later, no error';
    } finally {
      await context.close();
    }
  });

  await check('B', 'keyboard', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      // West wall first: nothing hangs above ILO there, so the jump rises its full height, and the dash has flat floor
      // ahead. The walk east comes last: under load a key goes up late, and ILO coasts on past the distance the walk
      // measured, up to the step block at x 11.
      await page.keyboard.down('a');
      await waitFor(page, () => {
        const p = window.DEEPWAKE.inspect().player;
        return p.x < 1.5 && Math.abs(p.vx) < 0.01;
      });
      await page.keyboard.up('a');
      // The height of the jump is the peak of ILO's y over the first 0.6 s on the clock after the key goes down (a
      // held jump peaks at 0.41 s), sampled in the page before any image: under load an image can take longer than
      // ILO stays in the air. The baseline is read first: the page may run a frame between the key and the sampler.
      const floor = await inspect(page);
      const jump = page.evaluate((from) => new Promise((resolve) => {
        let peak = from.y;
        (function sample() {
          const s = window.DEEPWAKE.inspect();
          peak = Math.max(peak, s.player.y);
          if (s.clock >= from.clock + 0.6) return resolve(peak - from.y);
          requestAnimationFrame(sample);
        })();
      }), { y: floor.player.y, clock: floor.clock });
      await page.keyboard.down('Space');
      const rose = await jump;
      await shot(page, 'play-jump');
      await page.keyboard.up('Space');
      need(rose > 0, `Space: ILO rose ${rose.toFixed(2)} units`);
      await waitFor(page, () => {
        const p = window.DEEPWAKE.inspect().player;
        return p.grounded && Math.abs(p.vx) < 0.01;
      });
      // The dash goes where ILO faces, and the walk to the wall made it face west: a touch of d turns it east.
      await page.keyboard.down('d');
      await waitFor(page, () => window.DEEPWAKE.inspect().player.facing === 1);
      await page.keyboard.up('d');
      await waitFor(page, () => Math.abs(window.DEEPWAKE.inspect().player.vx) < 0.01);
      // Read at the end of the dash: after it ILO slides on (exit speed 6.5) until the brake stops it. The time is
      // the clock's, which load does not stretch; where ILO stood is read before the key goes down (see the jump).
      const stood = await inspect(page);
      const dash = page.evaluate((from) => new Promise((resolve) => {
        let dashing = false;
        (function sample() {
          const s = window.DEEPWAKE.inspect();
          if (s.player.dashT > 0) dashing = true;
          if (dashing && s.player.dashT <= 0) return resolve({ dx: s.player.x - from.x, seconds: s.clock - from.clock });
          requestAnimationFrame(sample);
        })();
      }), { x: stood.player.x, clock: stood.clock });
      await press(page, 'ShiftLeft');
      const { dx, seconds } = await dash;
      need(Math.abs(dx - 2.4) <= 0.4 && seconds <= 0.3, `ShiftLeft: ${dx.toFixed(2)} units in ${seconds.toFixed(2)} s`);
      const { player: { x: x0 }, clock } = await inspect(page);
      await page.keyboard.down('d');
      // 0.8 s of the game's clock: under load the page steps slower than time passes.
      await waitFor(page, (from) => window.DEEPWAKE.inspect().clock >= from + 0.8, clock);
      const walked = (await inspect(page)).player.x - x0;
      await page.keyboard.up('d');
      need(walked >= 3, `d held 0.8 s moved ILO ${walked.toFixed(2)} units`);
      const energy = (await inspect(page)).player.energy;
      await press(page, 'q');
      // The meter is read once the wave has cost its energy, before the image: the refill starts 1.5 s after.
      await waitFor(page, (before) => window.DEEPWAKE.inspect().player.energy < before, energy);
      const spent = energy - (await inspect(page)).player.energy;
      await shot(page, 'play-pulse');
      need(Math.abs(spent - 35) < 1e-6, `q: energy fell by ${spent}`);
      need(errors.length === 0, errors.join('; '));
      return `d +${walked.toFixed(2)} units in 0.8 s, Space +${rose.toFixed(2)} up, ShiftLeft +${dx.toFixed(2)} units in`
        + ` ${seconds.toFixed(2)} s, q energy -${spent}, no error`;
    } finally {
      await context.close();
    }
  });

  await check('C', 'pause', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      await press(page, 'p');
      await waitFor(page, () => window.DEEPWAKE.inspect().paused === true);
      const before = (await inspect(page)).clock;
      await page.waitForTimeout(700);
      const still = (await inspect(page)).clock;
      need(still === before, `the clock moved ${(still - before).toFixed(3)} s in 0.7 s of pause`);
      const card = await page.evaluate(() => {
        const node = document.querySelector('#card-pause h2');
        const r = node.getBoundingClientRect();
        return { text: node.textContent, shown: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight };
      });
      need(card.shown && card.text === 'Expedition Paused', `the pause menu shows ${JSON.stringify(card)}`);
      await shot(page, 'pause-desktop');
      await press(page, 'Enter');
      await waitFor(page, (clock) => {
        const s = window.DEEPWAKE.inspect();
        return s.paused === false && s.clock > clock;
      }, before);
      need(errors.length === 0, errors.join('; '));
      return `paused at clock ${before.toFixed(2)} s, the clock still for 0.7 s, resumed by Enter, no error`;
    } finally {
      await context.close();
    }
  });

  await check('D', 'retry and restart', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      const recoveries = (await inspect(page)).recoveries;
      await press(page, 'r');
      await waitFor(page, (n) => {
        const s = window.DEEPWAKE.inspect();
        return s.mode === 'play' && s.recoveries === n + 1 && s.player.grounded;
      }, recoveries);
      // Relay A on, so that the restart has a relay to clear.
      await page.evaluate(() => window.DEEPWAKE.warp(57.5, 6));
      await waitFor(page, () => window.DEEPWAKE.inspect().player.grounded);
      await press(page, 'q');
      await waitFor(page, () => {
        const state = window.DEEPWAKE.inspect();
        return state.mode === 'play' && state.relays[0].active === true;
      });
      // Some play after the relay, so that the restart has a clock to clear: half a second of it, on the clock.
      const played = (await inspect(page)).clock;
      await page.keyboard.down('d');
      await waitFor(page, (from) => window.DEEPWAKE.inspect().clock >= from + 0.5, played);
      await page.keyboard.up('d');
      const before = await inspect(page);
      need(before.recoveries === recoveries + 1 && before.clock > 0.4, `before the restart: ${before.recoveries} recoveries, clock ${before.clock}`);
      await press(page, 'p');
      await waitFor(page, () => window.DEEPWAKE.inspect().paused === true);
      const restart = page.locator('#card-pause .restart');
      await restart.click(); // the first press only arms it
      need((await restart.textContent()) === 'Press again to confirm restart', 'the first press restarted at once');
      await restart.click();
      const after = await inspect(page);
      need(after.mode === 'play' && after.paused === false, `mode ${after.mode}, paused ${after.paused}`);
      need(after.clock < 0.1, `clock ${after.clock.toFixed(3)} s`);
      need(after.recoveries === 0, `${after.recoveries} recoveries`);
      need(after.relays.every((relay) => relay.active === false), 'a relay is still active');
      need(errors.length === 0, errors.join('; '));
      return `r: ${recoveries} → ${recoveries + 1} recoveries and back in play; Restart Expedition from clock`
        + ` ${before.clock.toFixed(2)} s: clock ${after.clock.toFixed(3)} s, 0 recoveries, no relay active, no error`;
    } finally {
      await context.close();
    }
  });

  await check('E', 'settings', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      const mute = page.locator('#hud .mute');
      need(await mute.getAttribute('aria-pressed') === 'false', 'sound starts muted');
      await mute.click();
      need(await mute.getAttribute('aria-pressed') === 'true', 'the mute button did not toggle');
      await press(page, 'p');
      await waitFor(page, () => window.DEEPWAKE.inspect().paused === true);
      const motion = page.locator('#card-pause .setting-motion');
      need(!(await motion.isChecked()), 'reduced motion starts on');
      await motion.click();
      need(await motion.isChecked(), 'the reduced-motion button did not toggle');
      const saved = JSON.stringify({ muted: true, reducedMotion: true });
      need(JSON.stringify(await stored(page, KEYS.settings)) === saved, 'the settings were not saved');
      await page.reload();
      await waitFor(page, () => window.DEEPWAKE !== undefined, null, { timeout: 10000 });
      need(await page.locator('#hud .mute').getAttribute('aria-pressed') === 'true', 'mute did not survive the reload');
      need(await page.locator('#card-pause .setting-motion').isChecked(), 'reduced motion did not survive the reload');
      need(await page.locator('#ui').evaluate((node) => node.classList.contains('reduced-motion')), 'reduced motion is not applied after the reload');
      need(JSON.stringify(await stored(page, KEYS.settings)) === saved, 'the settings changed in the reload');
      need(errors.length === 0, errors.join('; '));
      return 'mute and reduced motion toggle, save, and are on after a reload, no error';
    } finally {
      await context.close();
    }
  });

  await check('F', 'layouts', async () => {
    const opened = [];
    try {
      let count = 0;
      /** Every box and text run of the interface inside the viewport, in the view named. */
      const measure = async (page, name, view) => {
        const measured = await page.evaluate(layout);
        count += measured.count;
        need(measured.outside.length === 0, `${name} ${view} ${measured.width}×${measured.height}: ${measured.outside.slice(0, 3).join('; ')}`);
      };
      for (const [name, options] of Object.entries(LAYOUTS)) {
        const { context, page, errors } = await open(browser, options);
        opened.push(context);
        await boot(page, url);
        for (const view of ['title', 'play', 'pause']) {
          if (view === 'play') await begin(page);
          if (view === 'pause') {
            await press(page, 'p');
            await waitFor(page, () => window.DEEPWAKE.inspect().paused === true);
          }
          await measure(page, name, view);
          if (name !== 'desktop') await shot(page, `${view}-${name}`);
        }
        // An archive fragment and the results, reached as in play: the route replay takes the detour D2, which opens
        // the fragment of archive A, and then runs the main route to its end.
        await press(page, 'p');
        await waitFor(page, () => window.DEEPWAKE.inspect().paused === false);
        await installRoute(page);
        await page.evaluate((s) => window.__route.run(s), steps([...until('M07'), 'D2']));
        need(await page.evaluate(() => window.__route.handOver('archive')) === 1, 'the detour D2 gave no archive event');
        await waitFor(page, () => !document.querySelector('#fragment-layer').hidden);
        await page.waitForTimeout(300); // the card rises for 0.2 s
        await measure(page, name, 'fragment');
        await shot(page, `fragment-${name}`);
        await press(page, 'Enter');
        await waitFor(page, () => document.querySelector('#fragment-layer').hidden);
        await page.evaluate((s) => window.__route.run(s), steps(from('M08')));
        await waitFor(page, () => window.DEEPWAKE.inspect().mode === 'complete');
        await measure(page, name, 'complete');
        await shot(page, `complete-${name}`);
        need(errors.length === 0, errors.join('; '));
      }
      return `${count} boxes and text runs inside the viewport in 3 layouts × title, play, pause, an archive fragment`
        + ` and the results, no error`;
    } finally {
      for (const context of opened) await context.close();
    }
  });

  await check('G', 'ILO clear of the interface', async () => {
    const opened = [];
    try {
      let least = Infinity;
      let count = 0;
      for (const layout of ['portrait', 'landscape']) {
        const { context, page, errors } = await open(browser, LAYOUTS[layout]);
        opened.push(context);
        await boot(page, url);
        await begin(page);
        for (const [x, y] of CLEAR_SPOTS) {
          await page.evaluate(([x, y]) => window.DEEPWAKE.warp(x, y), [x, y]);
          await page.waitForTimeout(800);
          const clear = await settled(page);
          need(clear.onScreen, `${layout} (${x}, ${y}): ILO is off screen, box [${clear.box}]`);
          need(clear.hits.length === 0, `${layout} (${x}, ${y}): ILO [${clear.box}] meets ${clear.hits.slice(0, 3).join(', ')}`);
          least = Math.min(least, clear.gap);
          count += 1;
          if (x === 208) await shot(page, `clear-ascent-ledge-${layout}`);
          if (x === 88) await shot(page, `clear-shaft-1-${layout}`);
        }
        need(errors.length === 0, errors.join('; '));
      }
      return `${count} spots on two phones, ILO on screen and at least ${least} px from every HUD box and touch button, no error`;
    } finally {
      for (const context of opened) await context.close();
    }
  });

  await check('H', 'touch input', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.landscape);
    try {
      await boot(page, url);
      await begin(page);
      const cdp = await context.newCDPSession(page);
      const centre = (selector) => page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, selector);
      const right = await centre('.touch-right');
      const jump = await centre('.touch-jump');
      /** Fingers on the screen: `[id, point]` per finger down. */
      const touch = (type, fingers) => cdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: fingers.map(([id, { x, y }]) => ({ x, y, id })),
      });
      const x0 = (await inspect(page)).player.x;
      await touch('touchStart', [[1, right]]);
      await waitFor(page, (x) => window.DEEPWAKE.inspect().player.x > x + 0.5, x0);
      await touch('touchStart', [[1, right], [2, jump]]); // the second finger, the first stays down
      await waitFor(page, () => window.DEEPWAKE.inspect().player.grounded === false);
      const air = await inspect(page);
      await touch('touchEnd', [[1, right]]); // the jump finger lifts
      await waitFor(page, (x) => window.DEEPWAKE.inspect().player.x > x + 0.5, air.player.x);
      const kept = (await inspect(page)).player;
      await touch('touchEnd', []);
      need(air.player.x > x0 && air.player.grounded === false, `Right held: x ${x0.toFixed(2)} → ${air.player.x.toFixed(2)}, grounded ${air.player.grounded}`);
      need(kept.x > air.player.x, `ILO stopped when the jump finger lifted: x ${kept.x.toFixed(2)}`);
      // No station has a prompt (a station docks as ILO enters), and on foot the first prompt is the pulse prompt at
      // the ECHO PULSE sign (check N): the prompt of the first cell needs a warp to it.
      await page.evaluate(() => window.DEEPWAKE.warp(48.5, 6));
      await waitFor(page, () => window.DEEPWAKE.inspect().prompt !== null);
      const prompt = await page.evaluate(() => ({
        cap: document.querySelector('#prompt .keycap').textContent,
        text: document.querySelector('#prompt .prompt-text').textContent,
        caps: document.querySelectorAll('#prompt .keycap').length,
      }));
      need(prompt.cap === 'Use' && prompt.text === 'Pick Up Cell', `the prompt reads ${JSON.stringify(prompt)}`);
      await settled(page);
      await shot(page, 'touch-prompt');
      need(errors.length === 0, errors.join('; '));
      return `Right held and Jump tapped: x ${x0.toFixed(2)} → ${air.player.x.toFixed(2)} and off the ground; at the first`
        + ` cell the prompt reads "${prompt.cap} — ${prompt.text}", no error`;
    } finally {
      await context.close();
    }
  });

  await check('I', 'route', async () => {
    const opened = [];
    try {
      const node = nodeRouteClock();
      // The run that counts: between its segments the page is only in a mode that holds the clock.
      const first = await open(browser, LAYOUTS.desktop);
      opened.push(first.context);
      const { page, errors } = first;
      await boot(page, url);
      await begin(page);
      await installRoute(page);
      let end = null;
      let pageTime = 0;
      for (const [i, segments] of EXACT.entries()) {
        const state = await page.evaluate((s) => window.__route.run(s), segments);
        if (end !== null) pageTime += state.before - end.clock;
        end = state;
        if (i < EXACT.length - 1) {
          need(state.mode === 'relayActivation', `segment ${i + 1} ended in mode ${state.mode}`);
          need((await inspect(page)).mode === 'relayActivation', 'the page left the relay look before the next segment');
        }
      }
      // The lift runs in the page, in real time.
      for (const [stage, wait] of [['rise', 2000], ['surface', 800], ['terrace', 1500]]) {
        await waitFor(page, (s) => window.DEEPWAKE.world.ascent.stage === s, stage, { timeout: 20000 });
        await page.waitForTimeout(wait);
        await shot(page, `lift-${stage}`);
      }
      await waitFor(page, () => window.DEEPWAKE.inspect().mode === 'complete', null, { timeout: 20000 });
      const final = await inspect(page);
      const overlay = await page.evaluate(() => ({
        kicker: document.querySelector('#card-complete .card-kicker').textContent,
        shown: !document.querySelector('#overlay').hidden && document.querySelector('#overlay').dataset.view === 'complete',
      }));
      const records = await stored(page, KEYS.records);
      await shot(page, 'complete-route'); // `complete-<layout>.png` belongs to the results of check F
      need(final.mode === 'complete' && overlay.shown && overlay.kicker === 'Signal Restored', `mode ${final.mode}, overlay ${JSON.stringify(overlay)}`);
      need(Math.abs(final.result.time - node) <= 0.02, `complete at ${final.result.time.toFixed(3)} s, Node at ${node.toFixed(3)} s`);
      need(Math.abs(pageTime) < 1e-9, `the page added ${pageTime.toFixed(3)} s to the clock between segments`);
      need(final.recoveries === 0 && final.result.recoveries === 0, `${final.recoveries} recoveries`);
      need(final.archives.every((archive) => archive.collected === false), `${final.archives.filter((a) => a.collected).length} archives`);
      need(final.relays.length === 3 && final.relays.every((relay) => relay.active), 'not every relay is active');
      need(records.bestTime === final.result.time && records.fewestRecoveries === 0 && records.fewestRecoveriesTime === final.result.time,
        `storage holds ${JSON.stringify(records)}`);
      // The route once more with the page running between segments, for the images of play.
      const second = await open(browser, LAYOUTS.desktop);
      opened.push(second.context);
      const live = second.page;
      await boot(live, url);
      await begin(live);
      await installRoute(live);
      let last = null;
      for (const { segments, key, ride, image } of PICTURE) {
        last = await live.evaluate((s) => window.__route.run(s), segments);
        if (image !== undefined) {
          // The view is still where the last drawn frame had it: it travels to ILO first.
          if (ride === undefined) await settled(live);
          else await live.waitForTimeout(ride); // the bridge carries ILO into the channel
          if (key !== undefined) await press(live, key);
          await shot(live, image);
        }
      }
      need(last.mode === 'complete', `the replay with the page running ended in mode ${last.mode}`);
      need(errors.length === 0 && second.errors.length === 0, [...errors, ...second.errors].join('; '));
      return `complete at ${final.result.time.toFixed(2)} s (Node ${node.toFixed(2)} s, the page added`
        + ` ${pageTime.toFixed(3)} s between segments), 0 recoveries, archives 0/3, relays A B C, record stored;`
        + ` a second replay with the page running also completes; no error`;
    } finally {
      for (const context of opened) await context.close();
    }
  });

  await check('J', 'archives', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      await installRoute(page);
      // A finished expedition, for its `New Expedition` button.
      await page.evaluate((s) => window.__route.run(s), steps(MAIN));
      await waitFor(page, () => window.DEEPWAKE.inspect().mode === 'complete');
      await mark(page, '__finished');
      await page.locator('#card-complete .new').click();
      await waitFor(page, () => window.DEEPWAKE.world !== window.__finished && window.DEEPWAKE.inspect().mode === 'play');
      await mark(page, '__begun');
      await press(page, 'Enter');
      await page.waitForTimeout(200);
      need(await page.evaluate(() => window.DEEPWAKE.world === window.__begun && window.DEEPWAKE.inspect().mode === 'play'),
        'Enter after the click began another expedition');
      await installRoute(page);
      const collected = async () => (await inspect(page)).archives.filter((archive) => archive.collected).length;
      for (const { segments, archive, cache, image, retry } of ARCHIVES) {
        await page.evaluate((s) => window.__route.run(s), segments);
        if (cache !== undefined) {
          need(await page.evaluate(() => window.__route.handOver('cache')) === 1, `the detour of ${cache} gave no cache event`);
        }
        if (archive !== undefined) {
          // The Driver took the route's events; the page's interface gets the archive's.
          need(await page.evaluate(() => window.__route.handOver('archive')) === 1, `detour ${archive}: no archive event`);
          await waitFor(page, () => !document.querySelector('#fragment-layer').hidden);
          const title = await page.evaluate(() => document.querySelector('#fragment-title').textContent);
          need(title === LEVEL.archives.find((entry) => entry.id === archive).title, `the fragment shows "${title}"`);
          await page.waitForTimeout(300); // the card rises for 0.2 s
          await shot(page, image);
          await press(page, 'Enter');
          await waitFor(page, () => document.querySelector('#fragment-layer').hidden);
        }
        if (retry !== undefined) {
          const [station, count] = retry;
          need((await inspect(page)).checkpoint === station, `checkpoint ${(await inspect(page)).checkpoint}, not ${station}`);
          const recoveries = (await inspect(page)).recoveries;
          await press(page, 'r');
          await waitFor(page, (n) => {
            const s = window.DEEPWAKE.inspect();
            return s.mode === 'play' && s.recoveries === n + 1 && s.player.grounded;
          }, recoveries);
          need(await collected() === count, `the recovery left ${await collected()} of ${count} archives`);
        }
      }
      const final = await inspect(page);
      const heading = await page.evaluate(() => document.querySelector('#complete-heading').textContent);
      const records = await stored(page, KEYS.records);
      await shot(page, 'complete-full-archive');
      need(final.mode === 'complete' && final.result.archives === 3 && await collected() === 3,
        `mode ${final.mode}, ${await collected()} archives`);
      need(final.result.caches === 1, `${final.result.caches} caches collected, not cache2 alone`);
      need(heading === 'Full Archive Expedition', `the results say "${heading}"`);
      need(records.bestArchiveTime === final.result.time, `storage holds ${JSON.stringify(records)}`);
      need(errors.length === 0, errors.join('; '));
      return `3 of 3 archives, each fragment shown and closed by Enter, and cache2 (D6) through the side passage, kept`
        + ` through ${final.result.recoveries} recoveries, complete at ${final.result.time.toFixed(2)} s,`
        + ` full-archive record ${records.bestArchiveTime.toFixed(2)} s, no error`;
    } finally {
      await context.close();
    }
  });

  await check('K', 'failures', async () => {
    const read = (page) => page.evaluate(() => ({
      text: document.querySelector('#fatal, body > .fatal')?.textContent ?? null,
      ui: document.querySelector('#ui').children.length,
      touch: document.querySelector('#touch').children.length,
      game: typeof window.DEEPWAKE,
    }));
    const noWebGL = await open(browser, LAYOUTS.desktop, (context) => context.addInitScript(NO_WEBGL));
    let first;
    try {
      await noWebGL.page.goto(url);
      await noWebGL.page.waitForFunction(() => document.querySelector('#fatal') !== null, null, { timeout: 10000 });
      await frame(noWebGL.page);
      first = await read(noWebGL.page);
      await shot(noWebGL.page, 'no-webgl');
    } finally {
      await noWebGL.context.close();
    }
    need(first.text !== null && first.text.startsWith('DEEPWAKE needs WebGL') && first.ui === 1 && first.touch === 0
      && first.game === 'undefined', `without WebGL the page shows ${JSON.stringify(first)}`);
    // The program file is missing, as when the folder is served without src/main.js.
    const noMain = await open(browser, LAYOUTS.desktop, (context) => context.route('**/src/main.js',
      (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })));
    let second;
    try {
      await noMain.page.goto(url);
      await noMain.page.waitForFunction(() => document.body.querySelector('.fatal') !== null, null, { timeout: 10000 });
      await frame(noMain.page);
      second = await read(noMain.page);
      await shot(noMain.page, 'load-failure');
    } finally {
      await noMain.context.close();
    }
    need(second.text !== null && second.text.startsWith('DEEPWAKE could not load its program files') && second.ui === 0
      && second.game === 'undefined', `without src/main.js the page shows ${JSON.stringify(second)}`);
    return `without WebGL: "${first.text}" and nothing else; without src/main.js: "${second.text}"`;
  });

  await check('L', 'soak', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      const cdp = await context.newCDPSession(page);
      /** Live bytes of the page's JavaScript heap. */
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize;
      };
      const cycle = async () => {
        const recoveries = (await inspect(page)).recoveries;
        await page.keyboard.down('d');
        await page.waitForTimeout(1100);
        await page.keyboard.up('d');
        await press(page, 'q');
        await press(page, 'r');
        // A retry pressed during a reboot is ignored (src/sim/world.js): wait until this one has played out.
        await waitFor(page, (n) => {
          const s = window.DEEPWAKE.inspect();
          return s.recoveries === n + 1 && s.mode === 'play' && s.player.grounded;
        }, recoveries);
      };
      await cycle(); // every path of the cycle has run once before the first measure
      const start = await heap();
      for (let i = 0; i < 20; i++) {
        const at = Date.now();
        await cycle();
        await page.waitForTimeout(Math.max(0, 3000 - (Date.now() - at)));
      }
      const end = await heap();
      const state = await inspect(page);
      const events = await page.evaluate(() => window.DEEPWAKE.world.events.length);
      const growth = end - start;
      need(errors.length === 0, errors.join('; '));
      need(state.recoveries === 21, `${state.recoveries} recoveries for the warm-up and 20 retries`);
      need(state.bolts.length <= 6, `${state.bolts.length} bolts`);
      need(events < 200, `${events} events wait in the world`);
      need(growth < 3 * MB, `the JavaScript heap grew ${(growth / MB).toFixed(2)} MB`);
      return `20 cycles in 60 s (${state.recoveries} recoveries), ${(start / MB).toFixed(1)} → ${(end / MB).toFixed(1)} MB`
        + ` (+${(growth / MB).toFixed(2)} MB), ${state.bolts.length} bolts, ${events} events waiting, no error`;
    } finally {
      await context.close();
    }
  });

  await check('M', 'frame time', async () => {
    const { context, page } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      const gaps = page.evaluate(() => new Promise((resolve) => {
        const gaps = [];
        const started = performance.now();
        let last = started;
        (function sample(now) {
          gaps.push(now - last);
          last = now;
          if (now - started >= 10000) return resolve(gaps.slice(1));
          requestAnimationFrame(sample);
        })(started);
      }));
      for (let i = 0; i < 20; i++) { // ILO runs back and forth in the first hall
        const key = i % 2 === 0 ? 'd' : 'a';
        await page.keyboard.down(key);
        await page.waitForTimeout(500);
        await page.keyboard.up(key);
      }
      const times = (await gaps).sort((a, b) => a - b);
      const renderer = await page.evaluate(() => {
        const gl = document.querySelector('#game').getContext('webgl2');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        return String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
      });
      const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
      const p95 = times[Math.floor(times.length * 0.95)];
      const slow = times.filter((t) => t > FRAMES.slow).length;
      need(mean <= FRAMES.mean, `${mean.toFixed(1)} ms mean frame time, above the limit of ${FRAMES.mean} ms`);
      need(p95 <= FRAMES.p95, `${p95.toFixed(1)} ms at the 95th percentile, above the limit of ${FRAMES.p95} ms`);
      need(slow <= FRAMES.share * times.length,
        `${slow} of ${times.length} frames over ${FRAMES.slow} ms, above the limit of ${Math.round(FRAMES.share * 100)} percent`);
      return `${mean.toFixed(1)} ms mean, ${p95.toFixed(1)} ms 95th percentile, ${slow} of ${times.length} frames over`
        + ` ${FRAMES.slow} ms in 10 s of play, inside the limits of ${FRAMES.mean} ms, ${FRAMES.p95} ms and`
        + ` ${Math.round(FRAMES.share * 100)} percent; renderer: ${renderer}`;
    } finally {
      await context.close();
    }
  });

  await check('N', 'pulse prompt', async () => {
    const { context, page, errors } = await open(browser, LAYOUTS.desktop);
    try {
      await boot(page, url);
      await begin(page);
      await installRoute(page);
      // The replay stops between two steps of the route: M09 ends with the cell in the first socket, M10 with ILO in
      // the relay chamber, where a pulse would reach the node of Relay A, and M11 is that pulse.
      await page.evaluate((s) => window.__route.run(s), steps(until('M10')));
      // The view is still where the last drawn frame had it, near the start: it travels to ILO before anything is read.
      const view = await settled(page);
      need(view.onScreen, `ILO is off screen, box [${view.box}]`);
      const prompt = await page.evaluate(() => {
        const state = window.DEEPWAKE.inspect();
        return {
          shown: !document.querySelector('#prompt').hidden,
          cap: document.querySelector('#prompt .keycap').textContent,
          text: document.querySelector('#prompt .prompt-text').textContent,
          world: state.prompt,
          socket: state.sockets.find((socket) => socket.id === 'wsSocket').cell,
          relay: state.relays.find((relay) => relay.id === 'A').active,
        };
      });
      need(prompt.socket === 'wsCell' && prompt.relay === false, `the cell does not wait in its socket: ${JSON.stringify(prompt)}`);
      need(prompt.shown && prompt.cap === 'Q' && prompt.text === 'Echo Pulse', `the prompt reads ${JSON.stringify(prompt)}`);
      need(prompt.world?.key === 'Q' && prompt.world.text === 'Echo Pulse', `the world asks for ${JSON.stringify(prompt.world)}`);
      await shot(page, 'prompt-pulse');
      await page.evaluate((s) => window.__route.run(s), steps(from('M11'))); // the replay goes on from where it stopped
      await waitFor(page, () => window.DEEPWAKE.inspect().mode === 'complete');
      need(errors.length === 0, errors.join('; '));
      return `with the cell in the first socket and before the pulse of Relay A (after M10): "Q — Echo Pulse"; the replay`
        + ` goes on to complete, no error`;
    } finally {
      await context.close();
    }
  });
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((passed) => !passed).length;
const images = (await readdir(OUT)).filter((file) => file.endsWith('.png')).length;
console.log(`${results.length - failed} of ${results.length} checks passed; ${images} images in dev/BrowserCheck/`);
process.exit(failed === 0 ? 0 : 1);
