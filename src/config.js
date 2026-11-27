export const DT = 1 / 120;

export const PLAYER = Object.freeze({
  w: 0.75,
  h: 1.5,
  maxSpeed: 6.5,
  carrySpeed: 4.5,
  groundAccel: 42,
  airAccel: 28,
  groundBrake: 38,
  airBrake: 8,
  gravity: 32,
  jumpSpeed: 13,
  fallSpeed: 24,
  coyote: 0.11,
  jumpBuffer: 0.14,
  jumpMinTime: 0.10,
  jumpCut: 0.40,
  wallSlideSpeed: 3,
  wallJumpX: 7,
  wallJumpY: 12.5,
  wallJumpLock: 0.10,
  interactReach: 1.3,
});

export const DASH = Object.freeze({ speed: 15, time: 0.16, cooldown: 0.45, exitSpeed: 6.5 });

export const PULSE = Object.freeze({
  max: 100,
  cost: 35,
  cooldown: 0.7,
  regenDelay: 1.5,
  regen: 20,
  radius: 6,
  expandTime: 0.35,
  revealTime: 5,
});

export const SHIELD = Object.freeze({ cost: 50, immunity: 0.8 });

export const DAMAGE = Object.freeze({ immunity: 1.2, knockX: 5, knockY: 7, stun: 0.2 });

export const RUN = Object.freeze({
  integrity: 3,
  crushTime: 0.30,
  relayTime: 1.8,
  shutdownTime: 1.2,
  retryTime: 0.5,
  rebootTime: 0.9,
  rebootImmunity: 1.5,
});

export const LIFT = Object.freeze({ board: 0.8, barrier: 0.8, rise: 5.0, surface: 2.5, terrace: 3.0 });

export const CACHE = Object.freeze({ energy: 25 });

export const CELL = Object.freeze({ w: 1.0, h: 1.1 });
