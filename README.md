# DEEPWAKE

DEEPWAKE is an atmospheric, movement-focused platformer set inside a buried industrial sanctuary, with its world and characters built as voxel models in Three.js on a two-dimensional plane inside a three-dimensional scene. You control ILO, a small maintenance robot waking beneath a collapsed underground research station: the station's only ascent lift has no power, and ILO must reactivate three resonance relays, reconnect the lift, and escape to the surface. The loop is: observe a chamber, reveal or understand its mechanism, traverse hazards, activate a relay, open the next route.

`GOAL.md` in this folder is the product specification. `FEATURE_AUDIT.md` maps it to files and checks.

## Run

Play it online: **https://vabhzw17eg2qu4m9-bit.github.io/nulls_code_game_glm-5.4_max/**. GitHub Pages serves the root of the `main` branch of the repository; each push to `main` updates the page in a minute or two.

Or serve the files of this folder:

```sh
npm start
```

The server prints `DEEPWAKE is served at http://localhost:8080`. Open that address in a browser. `PORT=9000 npm start` uses another port.

- Node.js 24 runs the server and the checks. Version v24.22.3 was used for everything in this file.
- No build step, no install, no network. `package.json` lists no dependencies. Three.js 0.187.0 is in `vendor/three/`. Models, textures and sounds are made in code.
- The browser needs JavaScript and WebGL 2. Web Audio and local storage are optional: without Web Audio the game is silent, and without storage the records last for the session.
- Serve the folder from a web server. Opened from the disk, a browser may refuse the program files, and the page shows the third message below. That message points here: run `npm start` and open the address it prints.

| Situation | What the page shows |
| --- | --- |
| JavaScript is off | `DEEPWAKE needs JavaScript to run.` |
| WebGL 2 is missing | `DEEPWAKE needs WebGL, which this browser does not provide.` Nothing else starts. |
| A program file is missing or fails before the page has loaded | `DEEPWAKE could not load its program files. Serve its folder with a local web server; README.md tells how.` |
| An exception inside a running frame | `DEEPWAKE stopped: ` followed by the error. The game loop stops. |

## Controls

Keyboard. The pause menu lists the same keys.

| Key | During play | In a menu |
| --- | --- | --- |
| `A` / `D` or `←` / `→` | Move left and right. | |
| `Space` or `Z` | Jump. Hold for a higher jump. Near a wall in the air, jump away from it. | Presses a focused button. |
| `Shift` or `X` | Dash toward where ILO faces. A left or right key held at the press decides the side. A jump pressed during a dash on the ground fires when the dash ends. | |
| `Q` | Echo Pulse. | |
| `E` | Interact: pick up, place, insert or remove a cell; use a switch, an archive, a cache or the lift console. | Closes an archive fragment. |
| `P` or `Esc` | Pause. | Resumes from the pause menu. |
| `R` | Retry from Checkpoint. Costs one recovery. | Retry from Checkpoint in the pause menu. |
| `Enter` | | Title: begin. Pause menu: resume. Results: new expedition. Closes an archive fragment. |

Touch. The buttons come with the first touch, or at once on a device with a coarse pointer.

- Left cluster: **◀** and **▶** to move.
- Right cluster: **Jump** (hold for height), **Dash**, **Pulse** (the Echo Pulse) and **Use** (interact).
- Several fingers work at once. ILO moves while another finger jumps or dashes.
- The prompt names the button, for example `Use — Pick Up Cell`.
- **Pause** and the mute button sit at the top of the screen.
- The buttons hide under every overlay and while an archive fragment is open. A fragment closes on a tap anywhere.

Prompts.

- `E` prompts: `Pick Up Cell`, `Place Cell`, `Insert Cell`, `Remove Cell`, `Activate Switch`, `Salvage Cache`, `Read Archive`, `Activate Lift`.
- `Q — Echo Pulse` shows only where a wave would do something now: wake an offline relay whose socket is fed, or reach a hidden seam or a reveal marker that is dark and not spent. The seam or the marker must lie within 4 units, and the wave must reach it around rock. An enemy alone never asks.
- Nothing asks for a pulse while ILO cannot emit one: a cell in hand, energy below 35, the cooldown running. Where `E` has a target, its prompt wins.
- At the lift console with relays still offline: `Lift offline · n/3 relays`.

Menus.

- **Title** (`DEEPWAKE`): one line, `Restore three relays. Reach the ascent lift.`, the records so far, and `Begin Expedition`.
- **Pause** (`Expedition Paused`): `Resume`, `Retry from Checkpoint`, `Restart Expedition`, the control list (the keys, or the button names once touch controls are in use), the `Memory Archives` panel with the fragments found so far, `Sound`, `Reduced motion`, and the records so far. `Restart Expedition` needs a second press (`Press again to confirm restart`).
- **Recovery** (`Rebooting at Station`): automatic. The pause button does nothing until it ends.
- **Results** (`Signal Restored`, or `Full Archive Expedition` with all three archives): expedition time, recoveries, archives, caches found, machines disabled, the three relays, the records, and `New Expedition`.
- `Reduced motion` and `Sound` are stored. Where the player stored no reduced-motion setting, the game follows the system setting.

## Checkpoints

- Four stations stand in the course: at the start, beside Relay A, beside Relay B, and beside Relay C. The last one is also the station before the final ascent.
- Entering a station repairs ILO to 3 integrity, refills the energy to 100 and commits a snapshot. The station arms again once ILO is 2.5 units away.
- The activation of a relay commits the same kind of snapshot at the station beside that relay.
- A snapshot holds the active relays and stations, every socket with its cell, the switches, every cell with its state and place, the archives and caches found, the lift being idle, the disabled enemies and the broken seams.
- A recovery starts at zero integrity, in the deep water or below the course, under a press, or on `R`. It adds one to the recoveries. The clock does not rewind.
- A recovery lasts 1.2 s, or 0.5 s for `R`. A reboot follows for 0.9 s. Then ILO stands at the station with full integrity and energy, and 1.5 s of immunity.
- After a reboot everything is as committed. Movers, vents, hazards, bolts and pulses are reset. A cell carried at the commit, or lying where ILO reboots, rests 1.2 units beside the station.
- `Retry from Checkpoint` in the pause menu also works during the camera look after a relay and on the lift.
- `Restart Expedition` and `New Expedition` build a new world from the start, with the clock at 0 and no recovery. Records and settings stay.

## Course

- Four regions, west to east: Buried Workshop (x 0 to 62), Crystal Reservoir (62 to 142), Silent Foundry (142 to 193) and Ascent Shaft (193 to 238). `LEVEL.bounds` spans x 0 to 238 and y −2 to 84. ILO spawns at (4.5, 6); the lift console stands at (229.5, 66).
- Each of the first three regions ends in a relay: A in the Workshop, B in the Reservoir, C in the Foundry. A pulse that reaches a node switches its relay on. Relay C also needs a cell in its socket, `fndRelaySocket`; Relays A and B have no socket.
- The ascent opens when Relay C is active. The lift answers its console only with three relays active, ILO inside the boarding area and hands free.
- Three Memory Archives, one per main region, and three Salvage Caches lie off the main route. Each hidden seam guards one of them: `wsAlcove` guards archive A, `resPassage` guards `cache2` and `fndServiceSeam` guards archive C. A pulse lights a seam, a dash breaks it.
- `src/level/level.js` opens with the ROUTE notes: every step from the spawn to the lift, with coordinates. `tests/route-steps.js` holds the same route as a script, one entry per line of the notes.

## Project structure

```
index.html                 The page: the canvas, the touch root, the UI root, and the message of a failed load
server.mjs                 The local static server
package.json               The three commands; no dependencies
.nojekyll                  An empty file. GitHub Pages then publishes the folder as it is; its default build leaves `vendor/` out
GOAL.md                    The product specification
README.md                  This file
FEATURE_AUDIT.md           Every section of GOAL.md with its files, its checks and its status
src/
  config.js                Every tunable: the step, ILO, dash, pulse, shield, damage, run and lift values
  input.js                 Keyboard and touch buttons; makes the plain input object the simulation reads
  main.js                  Entry point and glue: the frame loop, overlay keys, pause, retry, restart,
                           settings, records, and window.DEEPWAKE
  style.css                Layout and look of the interface
  level/
    build.js               Turns region maps and markers into the checked LEVEL object
    level.js               The course: four regions, the ROUTE notes, markers, seams, water, camera zones, decor
  sim/
    world.js               The world, stepWorld, modes, movers, checkpoints, hazards, kill bounds, inspect
    player.js              ILO: run, jump, wall contact, dash, damage
    pulse.js               The echo pulse and its expanding wave
    collision.js           Rectangles, the solid grid, swept movement, ground and wall probes, line of sight
    objects.js             Cells, sockets, switches, power, vents, presses, stations, relays, archives, caches,
                           reveal markers, prompts, E actions, the relay look and the lift sequence
    enemies.js             The three machines and their bolts
    events.js              emit: one event onto world.events
  render/
    renderer.js            The stage (scene graph, camera rig, actors) and the WebGL renderer
    camera.js              The camera rig: follow, look-ahead, zones, relay look, lift framing, shake, interface bands
    voxel.js               Palette, box builder, cached materials, pixel textures, contact shadows
    terrain.js             Rock and metal meshes, seams, water
    scenery.js             Lights, parallax layers, decor, signs, conduits, the pale opening, the terrace ruins
    ilo.js                 ILO's model, gait and poses
    machines.js            The models of the three machines and their bolts
    props.js               Models of cells, sockets, relays, stations, archives, caches, vents, switches,
                           movers, the lift, and the outline of the interact target
    effects.js             Transient effects, each a pool of fixed size
  audio/
    audio.js               Synthesized effects and music in Web Audio
  ui/
    ui.js                  HUD, prompt, notifications, overlays, archive fragment, touch buttons
    records.js             Records and settings in local storage, validated
tests/
  sim-core.test.mjs        54 tests: movement, walls, dash, pulse, damage, platforms, crush, world, determinism
  objects.test.mjs         39 tests: cells, the three puzzles, stations, checkpoints, exploration, vents,
                           presses, the pulse prompt, the ascent, the clock
  enemies.test.mjs         29 tests: skitter, drone, sentinel, bolts, general rules
  route.test.mjs           29 tests: the scripted course, the route rules, the three archives, three caches,
                           14 softlock checks
  course.test.mjs          2 tests: a fall into each deep water rect of the course
  bypass.test.mjs          1 test: the course from spawn to complete with no machine disabled and no hit
  route-steps.js           The route script, one entry per line of the ROUTE notes; loads in the page as well
  route-driver.js          Driver: play through real inputs until a condition holds
  level.test.mjs           36 tests: the level builder
  records.test.mjs         12 tests: records and settings
  ui.test.mjs              41 tests: HUD, prompt, overlays, buttons, notifications, touch, input, page, styles
  audio.test.mjs           25 tests: the audio graph and its timing
  render.test.mjs          14 tests: renderer budgets, pixel ratio, textures, palette, lights, camera rig
  render-actors.test.mjs   29 tests: machines, props, ILO (model, gait, poses), particles, effects
  render-scene.test.mjs    8 tests: scenery, the pale opening, parallax, the lift console, the terrace
  boot.test.mjs            33 tests: the whole game on the fakes: title, pause, recovery, restart, the ending,
                           settings, retry from pause, a missing WebGL, the interface bands
  entry.test.mjs           4 tests: index.html
  fixtures/                Small LEVEL objects for the tests: core.js, objects.js, enemies.js
  fakes/                   dom.js, gl.js, audio.js: a DOM without layout, a WebGL context that draws
                           nothing, an AudioContext that makes no sound
tools/
  browser-check.mjs        The game in headless Chromium: checks A to N
  preview.mjs              One frame as a PNG from a small software rasterizer
vendor/three/              Three.js 0.187.0, unmodified: three.module.js, three.core.js, VERSION, LICENSE
dev/                       Scratch space. The browser check writes its images to dev/BrowserCheck/.
```

Layering rule.

- `src/sim/` and `src/level/` hold the simulation. They import `src/config.js` and each other, nothing else: no DOM, no `window`, no Three.js, no random numbers, no clock, no timers.
- `src/render/`, `src/audio/`, `src/ui/` and the records read the state of the simulation and its events. They never write the world.
- `src/main.js` is the only glue. It steps the world and hands the events to the view, the sound and the interface.
- The same level and the same input sequence give the same `inspect(world)`.

## How the simulation is built

Fixed step. `DT = 1 / 120` s (`src/config.js`). `stepWorld(world, input)` in `src/sim/world.js` runs exactly one step. `input` is a plain object: `left`, `right`, `jump` are held keys; `jumpPressed`, `dashPressed`, `pulsePressed`, `interactPressed` and `retryPressed` are fresh presses that last one step. A missing field reads as no key.

Order of one step.

1. `step` and `time` advance by one step. Last step's hazards are dropped.
2. The mode machine runs. In `play` it reads `R`.
3. Unless the mode is scripted (`title`, `reboot`, `liftSequence`, `complete`): the movers, the player and a pressed pulse. The keys reach the player in `play` only.
4. In `play` only: the dash contacts, the enemies, the objects (cells, sockets, switches, stations, vents, presses, relays, archives, caches, reveal markers, the ascent), then the hazards and the kill bounds, the pulse wave, the interactions (target, prompt, the `E` action) and the clock. A relay that activates inside the objects skips the rest of them.
5. `regionId` is updated.

Modes. `paused` is a flag on the world, not a mode.

| Mode | Entered by | What steps | Leaves after |
| --- | --- | --- | --- |
| `title` | creation | nothing; the view keeps its ambient motion | Enter or `Begin Expedition` sets `play` |
| `play` | | the full step | a relay, a hit, a kill bound, `R`, the lift console |
| `relayActivation` | a relay activates | movers and the player with no key; the wave finishes; the camera looks at the route | 1.8 s, back to `play` |
| `shutdown` | zero integrity, a kill bound, a crush, `R` | movers and the player with no key, no damage; recoveries + 1 at entry | 0.5 s for `R`, else 1.2 s, then `reboot` |
| `reboot` | after `shutdown` | nothing; the snapshot is restored at entry | 0.9 s, then `play` with 1.5 s of immunity |
| `liftSequence` | the lift console | only the staged lift: `board`, `barrier`, `rise`, `surface`, `terrace` | 12.1 s in total, then `complete` |
| `complete` | the end of the lift | nothing; the result is saved once | Enter or `New Expedition` builds a new world in `play` |

Only `play` advances the clock.

Snapshot. `inspect(world)` in `src/sim/world.js` returns plain data: `step`, `time`, `clock`, `mode`, `modeTime`, `paused`, `cause`, `regionId`, `recoveries`, `checkpoint` (the station id), `player`, `pulse`, `prompt`, `interactTarget`, `camera`, `result`, and short lists of `seams`, `movers`, `cells`, `sockets`, `switches`, `relays`, `stations`, `archives`, `caches`, `vents`, `enemies`, `bolts` and `hazards`.

Inspection API on the page. `src/main.js` sets `window.DEEPWAKE`. Nothing of it shows in the player interface.

- `inspect()`: the snapshot plus `view`, the part of the gameplay plane on screen.
- `advance(seconds, input)`: steps the world with one input object and drops the events.
- `warp(x, y)`: puts ILO's feet at `(x, y)` with no velocity.
- `world`: the live world.

Frame loop. `src/main.js` does this per animation frame.

1. Takes the time since the last frame, at most 0.1 s.
2. Handles the keys of the overlays between frames: Enter on the title and the results; `P`, `Esc`, Enter and `R` in the pause menu; Enter or `E` on an archive fragment.
3. While the game runs (not on the title or the results, not paused, no fragment open), it steps at most 8 times and drops the time beyond them. The pressed keys count for the first step only.
4. Hands the events of the steps to the view, the sound and the interface. They stand still while the game is paused, a fragment is open or the page is hidden.
5. Releases every held key when a recovery begins. A hidden page pauses the game.

A test drives a run like this:

```js
import { LEVEL } from '../src/level/level.js';
import { createWorld, inspect, stepWorld } from '../src/sim/world.js';

const world = createWorld(LEVEL);
world.mode = 'play';                                  // a title world does not step
stepWorld(world, { right: true, jumpPressed: true }); // a fresh press lasts one step
stepWorld(world, { right: true });
console.log(inspect(world).player);                   // plain data: x, y, vx, vy, grounded ...
```

For a whole route, `Driver` in `tests/route-driver.js` plays through real keys only: `walkTo`, `leap`, `climb`, `dash`, `pulse`, `interact`, `stand`, `retry`. It fails with ILO's position and state when a condition does not come in time. `tests/route-steps.js` holds the script of the course.

## Validation

| Command | What it proves | What it needs | Time |
| --- | --- | --- | --- |
| `npm test` | 356 deterministic tests in 15 files. They run the real simulation and level builder, and the interface, audio and rendering on fakes. | Node.js 24 | 2.7 s |
| `npm run check:browser` | 14 checks (A to N) in a real headless Chromium with software WebGL. | Node.js 24 and the package `playwright` with a Chromium it can launch | about 2 min 20 s |
| `node --test --test-reporter=spec tests/<file>` | One test file, with every check name and its result. | Node.js 24 | 0.04 s to 2 s, by file |
| `node tools/preview.mjs <x> <y> <out.png>` | One frame of a stage as a PNG. Evidence of composition only: no textures, one key light. Its options set poses, object states and effects; see its header. | Node.js 24; writes the PNG you name | 0.3 s at 960 × 540 |

`npm test` proves only what its assertions say. The fakes have no layout, draw nothing and make no sound. Pixels, sound and layout are in the browser check and in the images.

The browser check:

- Loads `playwright` from a local install, or else from the folder `npm root -g` prints.
- Needs the Chromium that belongs to that Playwright. Playwright looks in its default cache, or in the folder `PLAYWRIGHT_BROWSERS_PATH` names. On the machine of this folder it finds Chromium 159.0.8154.6 through `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`; the default cache does not exist there.
- Starts `server.mjs` itself on a free port. One line per check, `PASS` or `FAIL`, with what was measured. Exit code 1 when a check fails.
- Deletes the PNGs in `dev/BrowserCheck/` and writes new ones: 36 in the last recorded run.
- Draws every frame on the CPU (SwiftShader). It says nothing about a graphics card or about sound.
- The time comes from the last recorded run: 2 min 21 s from its first image to its last line. The soak (L) plays 60 s and the frame time (M) 10 s.

| Letter | Name | What it asserts |
| --- | --- | --- |
| A | boot | The title shows `DEEPWAKE` and `Begin Expedition`. The first image is over 30 KB and differs 400 ms later. No page error. |
| B | keyboard | `d` held 0.8 s of the game clock moves ILO at least 3 units. `Space` lifts ILO off the floor. `ShiftLeft` moves ILO 2.4 ± 0.4 units in at most 0.3 s. `q` spends exactly 35 energy. |
| C | pause | `p` pauses: the clock is still for 0.7 s and the card reads `Expedition Paused`. `Enter` resumes and the clock moves on. |
| D | retry and restart | `r` adds one recovery and returns to play. `Restart Expedition` needs two presses and gives a clock under 0.1 s, 0 recoveries and no active relay. |
| E | settings | The mute button and the reduced-motion control toggle, are stored, and are still on after a reload. |
| F | layouts | In 1280 × 720, 390 × 844 and 844 × 390, every box and text run of the interface lies inside the viewport in the title, play, pause, archive fragment and results views. |
| G | ILO clear of the interface | At 7 places of the course on two phone layouts, ILO is on screen and no HUD box and no touch button overlaps ILO. The prompt box is not counted. |
| H | touch input | Touch events on the landscape phone: with Right held, a second finger on Jump makes ILO leave the ground. ILO moves on after that finger lifts. At the first cell the prompt reads `Use — Pick Up Cell`. |
| I | route | The route script plays in the page. Its time equals the Node clock within 0.02 s, with 0 recoveries, no archive and relays A, B, C active. The results read `Signal Restored`. The records are stored. A second replay with the page running between its parts completes as well. |
| J | archives | One expedition takes the three archive detours and `cache2` through the side passage. Each fragment shows its title and closes by `Enter`. The archives survive two recoveries. The results read `Full Archive Expedition`, and the full-archive record is stored. |
| K | failures | Without WebGL the page shows the WebGL message and nothing else. Without `src/main.js` it shows the program-files message and nothing else. |
| L | soak | 20 cycles of walking, a pulse and a retry in 60 s, 21 recoveries with the warm-up: the JavaScript heap grows by under 3 MB, at most 6 bolts remain and under 200 events wait. |
| M | frame time | 10 s at 1280 × 720 while ILO runs in the first hall: mean frame time at most 26 ms, 95th percentile at most 34 ms, and at most 5 % of the frames over 50 ms. It prints the renderer. |
| N | pulse prompt | With the cell in the first socket and before the pulse of Relay A, the prompt reads `Q — Echo Pulse` in the page and the world asks for it. The replay goes on to complete. |

## Measurements

| Measurement | Value | How it was taken |
| --- | --- | --- |
| Clock of the scripted clean run | 119.82 s | `tests/route.test.mjs` plays the course by real keys, with no discovery, no damage and no recovery, and prints `main route: complete at clock 119.82 s`. The clock counts mode `play` only. Browser check I played the same script in the page: 119.82 s. |
| Clock of the run that passes every machine without a hit | 119.69 s | `tests/bypass.test.mjs` prints `bypass run: complete at clock 119.69 s`. |
| Clock of the run with all three archives and `cache2` | 137.27 s | Browser check J, last recorded run. |
| Draw calls and triangles with every actor lit | at most 82 calls and 22188 triangles in one frame | "Renderer: LEVEL with every actor lit stays inside 150 calls and 300000 triangles" prints it: ILO at every object of the course with every actor lit, 960 × 540, the fake WebGL of `tests/fakes/gl.js`. The test fails above 150 calls or 300000 triangles. |
| Draw calls and triangles along the scripted run | at most 71 calls and 20284 triangles in 8239 frames | A one-off Node command for this document, kept in no file: the main route played by `Driver`, one frame drawn every two steps through `view.sync` and `view.stats()`, on the same fake WebGL. 960 × 540 and 1280 × 720 give the same numbers. Both maxima are in the foundry. No test keeps this value. |
| Frame time | mean 17.1 ms, 95th percentile 16.7 ms, 2 of 584 frames over 50 ms in 10 s | Browser check M, last recorded run. It was measured with software WebGL (SwiftShader) in headless Chromium at 1280 × 720. These are the gaps between animation frames while ILO runs in the first hall. They are not the numbers of a graphics card. |

The browser check values come from its last recorded run. They vary from run to run; run the command for current values.

## Known limitations and untested areas

`FEATURE_AUDIT.md` has the complete list. In short:

- Nobody has played the game by hand, and no person has judged its images. The checks drive it by script, by keys and by emulated touch. How it looks, sounds and feels to a player is not measured.
- Audio output was heard by no one. Every audio check records calls on a fake AudioContext.
- Touch ran on emulated touch events in headless Chromium, never on a physical device.
- The frame time was measured on a software renderer only, and only at 1280 × 720. No graphics card and no phone layout was measured.
- The duration of a first playthrough is unknown. The script needs 119.82 s without discoveries and 137.27 s with all of them.
- Only Chromium was used. No other browser and no screen reader was run, though the names of the buttons are asserted.
- Memory was measured over 60 s and 21 recoveries only.
- No check asserts where the prompt box stands relative to a landing zone, the framing of the camera look after a relay, or that decorative animation far from the camera is suspended.
- The rock and the structures are merged into one mesh per region and material; they are not drawn by instancing.
- Some values have no check of their own. Gravity 32 and the jump launch speed 13 are held only through the jump heights. The immunities of 0.8 s and 1.2 s are compared with the constants of `src/config.js`, never with the numbers of the specification. Shutdown, reboot and retry are held as lower bounds only. The lengths of the lift stages `rise`, `surface` and `terrace` are not asserted.
- The walked path of the main route is longer than §10 of the specification asks, and a few names differ from it. See "Deliberate deviations" in `FEATURE_AUDIT.md`.
