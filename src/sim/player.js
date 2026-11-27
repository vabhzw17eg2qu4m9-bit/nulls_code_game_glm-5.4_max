import { DAMAGE, DASH, DT, PLAYER, PULSE, RUN, SHIELD } from '../config.js';
import { emit } from './events.js';
import { bodyRect, dynamicSolids, groundBelow, moveX, moveY, wallBeside } from './collision.js';

const PROBE = 0.05;
const TOUCH = 1e-9;                          // feet within float noise of a surface stand on it; the 0.05 probe also covers the gap before a landing
const STEP_LENGTH = 0.8;

/** Fresh ILO standing at the bottom-center position `(x, y)`. */
export function createPlayer(x, y) {
  return {
    x, y, vx: 0, vy: 0, facing: 1, grounded: false, wall: 0, sliding: false,
    dashT: 0, dashCd: 0, dashAir: true, dashDir: 1,
    energy: PULSE.max, regenDelay: 0, pulseCd: 0,
    hp: RUN.integrity, immunity: 0, stunT: 0, carrying: null, squeezeT: 0, onMover: null,
    coyoteT: 0, jumpBuffer: 0, airT: 0, jumping: false, stepDist: 0,
  };
}

/**
 * Put ILO at `(x, y)` with full integrity and energy, zero velocity and cleared timers, then probe
 * the ground and walls. Used at creation and checkpoint recovery.
 */
export function placePlayer(world, x, y) {
  const p = world.player;
  const fresh = createPlayer(x, y);
  fresh.facing = p.facing;
  fresh.immunity = p.immunity;
  Object.assign(p, fresh);
  probe(world, p, bodyRect(p.x, p.y), dynamicSolids(world), false, 0);
}

function approach(value, target, step) {
  return value < target ? Math.min(value + step, target) : Math.max(value - step, target);
}

/** Static rock or metal: the only surfaces ILO slides on. Seams, movers and cells are not walls. */
function isWall(hit) {
  return hit !== undefined && (hit.mat === 'rock' || hit.mat === 'metal');
}

function startDash(world, p, held) {
  if (p.dashCd > 0 || p.dashT > 0 || p.carrying !== null || !(p.grounded || p.dashAir)) return;
  p.dashT = DASH.time;
  p.dashCd = DASH.cooldown;
  // A held direction wins over a facing that a stun still freezes: the dash never turns back into the wall or the hit.
  if (held !== 0) p.facing = held;
  p.dashDir = p.facing;
  p.sliding = false;
  if (!p.grounded) p.dashAir = false;
  emit(world, 'dash', { x: p.x, y: p.y, dir: p.dashDir });
}

function launch(world, p, wall) {
  p.vy = wall ? PLAYER.wallJumpY : PLAYER.jumpSpeed;
  p.grounded = false;
  p.onMover = null;
  p.coyoteT = 0;
  p.jumpBuffer = 0;
  p.airT = 0;
  p.jumping = true;
  if (wall) {
    p.vx = PLAYER.wallJumpX * -wall;
    p.stunT = PLAYER.wallJumpLock;
    p.dashAir = true;
    p.sliding = false;
  }
  emit(world, 'jump', { x: p.x, y: p.y, wall });
}

function breakSeam(world, seam, dyn) {
  seam.broken = true;
  dyn.splice(dyn.indexOf(seam), 1);
  emit(world, 'seamBreak', { id: seam.id, x: seam.x + seam.w / 2, y: seam.y + seam.h / 2 });
}

function dash(world, p, rect, dyn, held) {
  const slice = Math.min(p.dashT, DT);
  p.dashT -= slice;
  p.vx = DASH.speed * p.dashDir;
  p.vy = 0;
  const target = rect.x + p.vx * slice;
  let hit = moveX(rect, target - rect.x, world, dyn);
  while (hit && world.seams.includes(hit)) {
    breakSeam(world, hit, dyn);
    hit = moveX(rect, target - rect.x, world, dyn);
  }
  if (hit) {
    p.dashT = 0;
    p.vx = 0;
    emit(world, 'dashStop', { x: rect.x + PLAYER.w / 2, y: rect.y });
  } else if (p.dashT <= 0) {
    p.vx = DASH.exitSpeed * p.dashDir;
  }
  p.x = rect.x + PLAYER.w / 2;
  probe(world, p, rect, dyn, held, false, 0);
}

function walk(world, p, rect, dyn, input, steer, held) {
  // steer is null while control is locked (wall jump, knockback): ILO keeps its horizontal velocity.
  if (steer !== null) {
    const max = p.carrying !== null ? PLAYER.carrySpeed : PLAYER.maxSpeed;
    const rate = steer !== 0
      ? (p.grounded ? PLAYER.groundAccel : PLAYER.airAccel)
      : (p.grounded ? PLAYER.groundBrake : PLAYER.airBrake);
    p.vx = approach(p.vx, steer * max, rate * DT);
  }
  const wasTouching = groundBelow(world, rect, TOUCH, dyn) !== null;
  if (moveX(rect, p.vx * DT, world, dyn)) p.vx = 0;
  // A wall found by this sweep counts at once: a grabbed wall limits the fall in the same step.
  const grab = !p.grounded && held !== 0 && p.carrying === null ? wallBeside(world, rect, held, PROBE, dyn) : null;
  p.vy = Math.max(p.vy - PLAYER.gravity * DT, -PLAYER.fallSpeed);
  if (grab !== null && isWall(grab.hit)) p.vy = Math.max(p.vy, -PLAYER.wallSlideSpeed);
  if (p.jumping && p.airT >= PLAYER.jumpMinTime && !input.jump && p.vy > 0) {
    p.vy *= PLAYER.jumpCut;
    p.jumping = false;
  }
  let impact = 0;
  if (moveY(rect, p.vy * DT, world, dyn)) {
    if (p.vy < 0) impact = -p.vy;
    p.vy = 0;
  }
  p.x = rect.x + PLAYER.w / 2;
  p.y = rect.y;
  probe(world, p, rect, dyn, held, wasTouching, impact);
}

/**
 * Ground and wall contact for the position ILO now occupies; sets `grounded`, `onMover`, `wall`, `sliding`.
 * A downward sweep that just stopped (`impact > 0`) is a contact that refreshes the air dash; it is a landing
 * when the feet did not already stand on a surface.
 */
function probe(world, p, rect, dyn, held, wasTouching, impact) {
  const ground = groundBelow(world, rect, PROBE, dyn);
  p.grounded = ground !== null;
  p.onMover = ground !== null && ground.hit.kind !== undefined ? ground.hit.id : null;
  if (p.grounded && impact > 0) {
    p.dashAir = true;
    p.jumping = false;
    if (!wasTouching) emit(world, 'land', { x: p.x, y: p.y, speed: impact, surface: ground.surface });
  }
  const right = wallBeside(world, rect, 1, PROBE, dyn);
  const left = wallBeside(world, rect, -1, PROBE, dyn);
  const wallR = right !== null && isWall(right.hit);
  const wallL = left !== null && isWall(left.hit);
  p.wall = wallR && (held === 1 || !wallL) ? 1 : wallL ? -1 : 0;
  p.sliding = !p.grounded && p.wall !== 0 && held === p.wall && p.carrying === null;
  if (p.grounded && Math.abs(p.vx) > 1) {
    p.stepDist += Math.abs(p.vx) * DT;
    if (p.stepDist >= STEP_LENGTH) {
      p.stepDist -= STEP_LENGTH;
      emit(world, 'step', { x: p.x, y: p.y, surface: ground.surface });
    }
  } else {
    p.stepDist = 0;
  }
}

/**
 * One fixed step of ILO: timers, abilities, movement, the swept position update and the contact probe.
 * `input` holds the §3.1 fields; missing fields read as no input.
 */
export function updatePlayer(world, input) {
  const p = world.player;
  const rect = bodyRect(p.x, p.y);
  const held = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dyn = dynamicSolids(world);

  p.dashCd = Math.max(0, p.dashCd - DT);
  p.pulseCd = Math.max(0, p.pulseCd - DT);
  p.immunity = Math.max(0, p.immunity - DT);
  p.stunT = Math.max(0, p.stunT - DT);
  if (p.regenDelay > 0) p.regenDelay = Math.max(0, p.regenDelay - DT);
  else p.energy = Math.min(PULSE.max, p.energy + PULSE.regen * DT);

  // A fresh press fills the buffer; it counts down after the check so a press 0.14 s before landing still fires.
  if (input.jumpPressed) p.jumpBuffer = PLAYER.jumpBuffer;
  p.coyoteT = p.grounded ? PLAYER.coyote : Math.max(0, p.coyoteT - DT);

  if (p.dashT <= 0 && p.stunT <= 0 && held !== 0) p.facing = held;
  if (input.dashPressed) startDash(world, p, held);
  if (p.jumpBuffer > 0 && p.dashT <= 0) {
    if (p.grounded || p.coyoteT > 0) launch(world, p, 0);
    else if (p.wall !== 0 && p.carrying === null) launch(world, p, p.wall);
  }
  // The buffer waits out a dash: a jump pressed during one fires when the dash ends.
  if (p.dashT <= 0) p.jumpBuffer = Math.max(0, p.jumpBuffer - DT);

  const steer = p.dashT > 0 || p.stunT > 0 ? null : held;
  if (p.dashT > 0) dash(world, p, rect, dyn, held);
  else walk(world, p, rect, dyn, input, steer, held);
  p.airT += DT;
}

function endDash(p) {
  if (p.dashT <= 0) return;
  p.dashT = 0;
  p.vx = DASH.exitSpeed * p.dashDir;
}

/**
 * Resolve one hazard contact (§3.8): shield, or integrity loss with knockback.
 * Returns `'shield'`, `'damage'` or null when nothing happened; the caller starts the recovery at hp 0.
 */
export function hitPlayer(world, hazard) {
  const p = world.player;
  if (world.mode !== 'play' || p.immunity > 0) return null;
  endDash(p);
  if (p.energy >= SHIELD.cost) {
    p.energy -= SHIELD.cost;
    p.immunity = SHIELD.immunity;
    p.regenDelay = PULSE.regenDelay;
    emit(world, 'shield', { x: p.x, y: p.y });
    return 'shield';
  }
  p.hp -= 1;
  p.immunity = DAMAGE.immunity;
  p.regenDelay = PULSE.regenDelay;
  p.vx = DAMAGE.knockX * (Math.sign(p.x - hazard.sx) || -p.facing);
  p.vy = DAMAGE.knockY;
  p.stunT = DAMAGE.stun;
  emit(world, 'damage', { x: p.x, y: p.y, cause: hazard.kind });
  return 'damage';
}
