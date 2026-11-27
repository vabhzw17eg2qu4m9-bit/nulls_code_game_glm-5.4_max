// Scripted play through real inputs only (contract §3.1): every primitive steps `stepWorld` with held keys and
// fresh presses, and fails with ILO's position and state when its condition does not come in time.

import { DT, PLAYER } from '../src/config.js';
import { bodyRect, overlaps } from '../src/sim/collision.js';
import { stepWorld } from '../src/sim/world.js';

/** No key at all. */
export const IDLE = Object.freeze({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false,
  pulsePressed: false, interactPressed: false, retryPressed: false,
});
const EDGE = { jump: 'jumpPressed', dash: 'dashPressed', pulse: 'pulsePressed', interact: 'interactPressed', retry: 'retryPressed' };
const f = (n) => Number(n.toFixed(2));
const seconds = (steps) => f(steps * DT);

/** The mover or static solid whose top carries ILO's feet at `(x, y)`, or null. */
function support(world, x, y, onMover) {
  const mover = world.movers.find((m) => m.id === onMover);
  if (mover !== undefined) return mover;
  const top = (s) => s.y + s.h;
  return world.solids.find((s) => top(s) <= y + 0.01 && top(s) >= y - 0.06 && overlaps(bodyRect(x, y), s, 0.06)) ?? null;
}

export class Driver {
  constructor(world) {
    this.world = world;
    this.keys = { ...IDLE };
    this.steps = 0;
    this.events = [];
    this.jumps = [];        // every jump that starts from the ground: where it took off and where it landed
    this.stands = [];       // every still stand: where, how long, which hazards met ILO
    this.sections = [];     // one entry per `section` call: the route time it took and the inputs it used
    this.sectionId = 'start';
    this.watchers = [];     // `watch(driver)` after every step
  }

  get p() {
    return this.world.player;
  }

  /** ILO's position and state, for failure messages. */
  where() {
    const p = this.p;
    return `ILO at x ${f(p.x)} y ${f(p.y)} vx ${f(p.vx)} vy ${f(p.vy)}, grounded ${p.grounded}, wall ${p.wall}, dashT ${f(p.dashT)}, `
      + `carrying ${p.carrying}, hp ${p.hp}, energy ${f(p.energy)}, mode ${this.world.mode}, clock ${f(this.world.clock)} s`;
  }

  fail(what) {
    throw new Error(`${what} did not happen in time: ${this.where()}`);
  }

  /** One fixed step with the current keys; a fresh press lasts this step. Events and ground jumps are kept. */
  step() {
    const p = this.p;
    const was = { x: p.x, y: p.y, grounded: p.grounded, onMover: p.onMover };
    stepWorld(this.world, this.keys);
    this.steps += 1;
    for (const event of this.world.events) {
      this.events.push(event);
      if (event.type === 'jump' && event.wall === 0) {
        const on = support(this.world, was.x, was.y, was.onMover);
        this.jumps.push({ x0: was.x, y0: was.y, from: on?.id ?? null, x1: null, y1: null, to: null });
      } else if (event.type === 'land' && this.jumps.length > 0 && this.jumps.at(-1).x1 === null) {
        const jump = this.jumps.at(-1);
        const on = support(this.world, p.x, p.y, p.onMover);
        Object.assign(jump, { x1: p.x, y1: p.y, to: on?.id ?? null });
      }
    }
    this.world.events.length = 0;
    for (const edge of Object.values(EDGE)) this.keys[edge] = false;
    for (const watch of this.watchers) watch(this);
  }

  /** Step until `done(driver)` holds; `done` sets the keys of each step it asks for. */
  until(done, { timeout = 5, what = 'the condition' } = {}) {
    const end = this.steps + Math.round(timeout / DT);
    while (!done(this)) {
      if (this.steps >= end) this.fail(what);
      this.step();
    }
    return this;
  }

  /** Step `time` seconds with the keys as they are. */
  wait(time) {
    const end = this.steps + Math.round(time / DT);
    return this.until((d) => d.steps >= end, { timeout: time + 1, what: `waiting ${time} s` });
  }

  /** Let go of every key. */
  release() {
    Object.assign(this.keys, IDLE);
    return this;
  }

  /** Hold toward `dir` (1 east, -1 west, 0 neither). */
  steer(dir) {
    this.keys.left = dir < 0;
    this.keys.right = dir > 0;
    return this;
  }

  /** Press `key` (`jump`, `dash`, `pulse`, `interact`, `retry`): held from the next step until it is released. */
  press(key) {
    this.keys[key] = true;
    this.keys[EDGE[key]] = true;
    return this;
  }

  /** Press `key` for one step. */
  tap(key) {
    this.press(key);
    this.step();
    this.keys[key] = false;
    return this;
  }

  /** Note an input in the open section, for the route report. */
  note(text) {
    const open = this.sections.find((s) => s.id === this.sectionId && s.end === null);
    if (open !== undefined) open.inputs.push(text);
    return this;
  }

  /** Run `body` as one route section: its route time and its inputs land in `sections`. */
  section(id, body) {
    this.sectionId = id;
    const entry = { id, start: this.world.clock, end: null, inputs: [] };
    this.sections.push(entry);
    const result = body(this);
    entry.end = this.world.clock;
    return result;
  }

  /** Stand still: brake to a stop, then keep every key up for `time` seconds more. Lists each hazard that met ILO. */
  stand(time = 0, { timeout = 8, what = 'standing still' } = {}) {
    const hazards = new Set();
    let still = 0;
    const need = Math.round(time / DT);
    this.release();
    if (time > 0) this.note(`stand ${f(time)} s`);
    return this.until((d) => {
      const p = d.p;
      const body = bodyRect(p.x, p.y);
      for (const hazard of d.world.hazards) if (overlaps(body, hazard)) hazards.add(hazard.kind);
      still = p.grounded && Math.abs(p.vx) < 0.01 ? still + 1 : 0;
      if (still > need) {
        d.stands.push({ x: f(p.x), y: p.y, time: seconds(still), hazards: [...hazards] });
        return true;
      }
      return false;
    }, { timeout, what });
  }

  /** Walk on the ground to `x` and stop there. In the air the keys steer toward `x` until ILO lands. */
  walkTo(x, { tol = 0.05, timeout = 10, what = `walking to x ${x}` } = {}) {
    this.note(`walk→${f(x)}`);
    return this.until((d) => {
      const p = d.p;
      const far = x - p.x;
      if (p.grounded && Math.abs(far) <= tol && Math.abs(p.vx) < 0.5) {
        d.release();
        return true;
      }
      if (!p.grounded) {
        d.steer(Math.abs(far) > tol ? Math.sign(far) : 0);
        return false;
      }
      // The speed that still brakes to a stop at the near edge of the tolerance band around x.
      const want = Math.sign(far) * Math.min(PLAYER.maxSpeed, Math.sqrt(2 * PLAYER.groundBrake * Math.max(0, Math.abs(far) - tol)));
      d.steer(p.vx < want - 0.05 ? 1 : p.vx > want + 0.05 ? -1 : 0);
      return false;
    }, { timeout, what });
  }

  /** In the air: run toward `x`, or brake, so that the free flight ends near it when ILO is back at `floor`. */
  airSteer(x, floor) {
    const p = this.p;
    const discriminant = p.vy * p.vy + 64 * (p.y - floor);
    const time = discriminant >= 0 ? (p.vy + Math.sqrt(discriminant)) / 32 : 0.3;
    const landing = p.x + p.vx * time;
    this.steer(landing < x - 0.1 ? 1 : landing > x + 0.1 ? -1 : 0);
    return this;
  }

  /**
   * Jump toward `x`: from a standstill, or after a run-up that leaves the ground at `takeoff`. `hold` is how long
   * the jump key stays down (0: a tap, 'full': until landing); `floor` is the height of the expected landing.
   */
  leap(x, { takeoff = null, hold = 0, floor = null, timeout = 4, what = `jumping toward x ${x}` } = {}) {
    const dir = Math.sign(x - this.p.x) || this.p.facing;
    this.note(`jump ${hold === 'full' ? 'held' : hold > 0 ? `held ${hold} s` : 'tapped'}→${f(x)}`);
    let run = takeoff !== null;
    let airborne = false;
    let held = hold === 'full' ? Infinity : Math.max(1, Math.round(hold / DT));
    return this.until((d) => {
      const p = d.p;
      if (run) {
        d.steer(dir);
        if (p.grounded && dir * (p.x - takeoff) >= 0) run = false;
        else return false;
      }
      if (!airborne) {
        if (!p.grounded) return false;
        floor ??= p.y;
        d.keys.jump = true;
        d.keys.jumpPressed = true;
        airborne = true;
        return false;
      }
      if (held > 0) {
        held -= 1;
        if (held === 0) d.keys.jump = false;
      }
      if (p.grounded) {
        d.release();
        return true;
      }
      d.airSteer(x, floor);
      return false;
    }, { timeout, what });
  }

  /** Dash toward `dir` and come to a stop. */
  dash(dir = this.p.facing, { timeout = 3, what = 'the dash' } = {}) {
    this.note(`dash ${dir > 0 ? 'east' : 'west'}`);
    this.steer(dir);
    this.press('dash');
    const dashes = this.seen('dash').length;
    this.step();
    this.release();
    if (this.seen('dash').length === dashes) this.fail(what);
    return this.until((d) => d.p.grounded && d.p.dashT <= 0 && Math.abs(d.p.vx) < 0.5, { timeout, what });
  }

  /**
   * Wall-jump climb: hold toward the wall ahead, jump at each wall contact, alternate walls. Once ILO touches
   * `exit.wall` (-1 west, 1 east) with the feet at `exit.y` or higher, the jump goes toward `exit.x` and lands
   * on `exit.floor`. `first` is the wall the first jump from the ground flies to (default: `exit.wall`).
   * `rise`: the first jump from the ground goes straight up until ILO has risen that far (a wall that starts
   * above the floor).
   */
  climb({ exit, first = exit.wall, rise = 0, timeout = 25, what = 'the climb' } = {}) {
    this.note(`climb, leave ${exit.wall < 0 ? 'east' : 'west'} at y ${exit.y}→(${f(exit.x)}, ${exit.floor})`);
    let target = first;
    let leaving = false;
    let base = null;
    let risen = rise <= 0;
    return this.until((d) => {
      d.keys.jump = true;
      const p = d.p;
      if (leaving) {
        if (p.grounded) {
          d.release();
          return true;
        }
        d.airSteer(exit.x, exit.floor);
        return false;
      }
      if (p.grounded) {
        base = p.y;
        risen = rise <= 0;
        d.steer(risen ? target : 0);
        d.keys.jumpPressed = true;
        return false;
      }
      if (!risen) {
        // The first jump goes straight up; the wall ahead starts above the floor.
        risen = p.y - base >= rise;
        if (!risen) {
          d.steer(0);
          return false;
        }
      }
      if (p.wall !== 0 && p.jumpBuffer <= 0 && p.stunT <= 0) {
        d.keys.jumpPressed = true;
        target = -p.wall;
        if (p.wall === exit.wall && p.y >= exit.y) leaving = true;
      }
      d.steer(target);
      return false;
    }, { timeout, what });
  }

  /** Press E once, on a target of `kind` (any target when omitted), once ILO stands still. */
  interact(kind = null, { what = kind === null ? 'something to interact with' : `the target ${kind}` } = {}) {
    this.note(kind === null ? 'E' : `E ${kind}`);
    this.until((d) => {
      const found = d.world.interactTarget;
      return d.world.mode === 'play' && found !== null && (kind === null || found.kind === kind)
        && d.p.grounded && Math.abs(d.p.vx) < 0.5;
    }, { what });
    this.release();
    return this.tap('interact');
  }

  /** Press Q once. */
  pulse({ what = 'a pulse' } = {}) {
    this.note('Q');
    this.until((d) => d.p.pulseCd <= 0 && d.p.energy >= 35, { what });
    return this.tap('pulse');
  }

  /** Press R once; back when ILO plays again at the checkpoint. */
  retry({ what = 'the retry' } = {}) {
    this.note('R');
    this.tap('retry');
    return this.until((d) => d.world.mode === 'play' && d.p.grounded, { timeout: 5, what });
  }

  /** Step with no key until `done(driver)` holds (a hazard window, a platform, a state). */
  idle(done, { timeout = 20, what = 'the wait' } = {}) {
    this.release();
    return this.until(done, { timeout, what });
  }

  /** Events of one type. */
  seen(type) {
    return this.events.filter((event) => event.type === type);
  }
}
