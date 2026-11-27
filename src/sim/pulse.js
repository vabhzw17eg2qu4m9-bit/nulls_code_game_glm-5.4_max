import { DT, PLAYER, PULSE } from '../config.js';
import { lineOfSight } from './collision.js';
import { emit } from './events.js';

/**
 * True when a press of Q emits a wave now: no cell carried, no cooldown, and the energy to pay for it. This is the
 * rule of `pressPulse` without its `pulseEmpty` report: what asks ILO for a pulse must agree with what emits one.
 */
export function pulseReady(player) {
  return player.carrying === null && player.pulseCd <= 0 && player.energy >= PULSE.cost;
}

/** Where a wave starts: the center of ILO's body. */
export function pulseOrigin(player) {
  return { x: player.x, y: player.y + PLAYER.h / 2 };
}

/** True when a wave from `(x, y)` grown to `r` reaches the point `(tx, ty)`: inside its radius and in sight. */
export function waveReaches(world, x, y, r, tx, ty) {
  return Math.hypot(tx - x, ty - y) <= r && lineOfSight(world, x, y, tx, ty);
}

/** Act on a fresh `pulsePressed` (§3.7): emit the wave, or report an empty meter. Nothing happens while carrying or on cooldown. */
export function pressPulse(world, input) {
  const p = world.player;
  if (!input.pulsePressed || p.carrying !== null || p.pulseCd > 0) return;
  if (p.energy < PULSE.cost) {
    emit(world, 'pulseEmpty');
    return;
  }
  p.energy -= PULSE.cost;
  p.pulseCd = PULSE.cooldown;
  p.regenDelay = PULSE.regenDelay;
  const { x, y } = pulseOrigin(p);
  world.pulse = { x, y, r: 0, age: 0, hit: new Set() };
  emit(world, 'pulse', { x, y });
}

/**
 * Advance the wave by one step. A target or enemy answers when the wave reaches it with a clear line of
 * sight, each at most once per pulse: `onPulse(world)` for a `PulseTarget`, `onEnemy(enemy)` for an enemy.
 */
export function expandPulse(world, onEnemy) {
  const wave = world.pulse;
  if (wave === null) return;
  wave.age += DT;
  wave.r = PULSE.radius * Math.min(1, wave.age / PULSE.expandTime);
  const reached = (x, y) => waveReaches(world, wave.x, wave.y, wave.r, x, y);
  for (const target of world.pulseTargets) {
    if (!wave.hit.has(target) && reached(target.ref.x, target.ref.y)) {
      wave.hit.add(target);
      target.onPulse(world);
    }
  }
  for (const enemy of world.enemies) {
    if (!wave.hit.has(enemy) && reached(enemy.x, enemy.y + enemy.h / 2)) {
      wave.hit.add(enemy);
      onEnemy(enemy);
    }
  }
  if (wave.age >= PULSE.expandTime) world.pulse = null;
}
