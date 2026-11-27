// ILO (GOAL §5): the voxel model of the player's robot at 1/8-unit voxels and the poses the simulation drives.
import * as THREE from '../../vendor/three/three.module.js';
import { DAMAGE, PLAYER, RUN } from '../config.js';
import { staticHits } from '../sim/collision.js';
import { PALETTE, VOXEL, VoxelBuilder, contactShadow, material } from './voxel.js';

const FINE = VOXEL.FINE;
const BODY_TURN = 0.62; // radians: ILO faces the viewer, turned toward the way it faces or goes
const HEAD_TURN = 0.2; // radians: the head leads the body
const LENS_OFFSET = 0.9; // fine voxels between the lens and the middle of the face panel
// The gait: a step is `L` units long, `speed / L` steps a second; a foot stands planted for `DUTY` of its cycle and
// swings from as far behind its hip as `REACH` to `0.6 × L` ahead of it (within reach) in the rest.
const STRIDE = { per: 0.2, min: 0.5, max: 0.9 }; // step length L = clamp(per × speed) units
const DUTY = 0.6;
const REACH = 0.42; // units: the leg is 0.5 long, so this is as far as it stretches at touch-down and lift-off
const BOB = { walk: 0.07, run: 0.03 }; // units the hips rise from touch-down to mid-stance; the run adds the second
const GAIT_RATE = 14; // per second: how fast the legs take to the gait, and back to the pose
const LEG = 2; // thigh and shin length in fine voxels
const HIP = { x: 0.95, y: 4.5, z: 2.4 }; // a hip joint in the body's frame, in fine voxels (x mirrored per side)
const ANKLE = 0.5; // fine voxels between the ankle pivot and the sole
const POSE_TIME = { jump: 0.12, wallJump: 0.2, land: 0.18, pulse: 0.3, socket: 0.5, damage: 0.3 }; // seconds each pose lasts
const COLLAPSE = 0.45; // seconds the shutdown collapse takes
const SHADOW_DROP = 10; // units of fall below which ILO still casts its contact shadow
const FACE = 0x14171b; // the dark face panel
const CARRY_Y = 11.5 * VOXEL.FINE; // units above the feet where a carried cell rests on the raised hands
const BODY_Z = 0.07; // units in front of the terrain's front face (z 0) where ILO stands, turned this way and that
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = (t) => t * t * (3 - 2 * t);

/** A charcoal limb segment hanging from its pivot (the origin), with a steel knuckle at the pivot. */
function limb(width, length, depth, knuckle) {
  const b = new VoxelBuilder();
  b.box(0, -length / 2, 0, width, length, depth, PALETTE.charcoal);
  b.box(0, -0.25, 0, knuckle, 0.5, knuckle, PALETTE.steel);
  return b;
}

/** A forearm with its ceramic hand, in the frame of the elbow. */
function forearmHand() {
  const b = limb(0.7, 1.5, 0.7, 0.95);
  b.box(0, -2, 0, 1, 0.95, 1, PALETTE.ceramic);
  return b;
}

/** The torso in the frame of the chest (origin at the waist, z 0 at the back). */
function torsoShell() {
  const b = new VoxelBuilder();
  b.box(0, 1.5, 1.5, 4, 3, 3, PALETTE.ceramic);
  b.box(0, 0.25, 1.5, 4.04, 0.5, 3.04, PALETTE.charcoal, 'FTRL');
  b.box(0, 1.8, 3.04, 3.2, 1.4, 0.08, PALETTE.ceramic, 'FTR');
  b.box(0, 1.9, 3.1, 1.5, 1.5, 0.08, PALETTE.charcoal, 'FTR');
  b.box(0, 3.25, 1.2, 1, 0.5, 1, PALETTE.ceramic, 'FTRL');
  for (const sx of [-1, 1]) {
    b.box(sx * 2, 2.95, 1.5, 1.1, 0.5, 1.9, PALETTE.charcoal, 'FTRL');
    for (const y of [0.95, 1.45, 1.95]) b.box(sx * 2.01, y, 1.5, 0.04, 0.2, 1.4, PALETTE.charcoal, sx > 0 ? 'R' : 'L');
  }
  return b;
}

/** The cyan resonance module of the chest, in the frame of the chest. */
function chestModule() {
  const b = new VoxelBuilder();
  b.box(0, 1.9, 3.2, 1.1, 1.1, 0.12, PALETTE.teal, 'FTRL');
  b.box(0, 1.9, 3.27, 0.5, 0.5, 0.06, PALETTE.crystalCore, 'FTRL');
  return b;
}

/** The chamfered ceramic head in the frame of the neck (origin at the neck joint, z 0 at the head's back). */
function headShell() {
  const b = new VoxelBuilder();
  const slab = (xa, xb, y0, y1, z0, z1) => b.box((xa + xb) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(xb - xa), y1 - y0, z1 - z0, PALETTE.ceramic);
  // Chamfered plan: a wide middle, then a narrower slab and a narrow one on each side.
  slab(-1.5, 1.5, 0.6, 3.1, -1.4, 2.4);
  slab(-1.3, 1.3, 3.1, 3.4, -1.1, 2.1);
  for (const sx of [-1, 1]) {
    slab(sx * 1.5, sx * 2, 0.6, 3.1, -1.2, 2.2);
    slab(sx * 2, sx * 2.3, 0.6, 3.1, -0.8, 1.8);
    slab(sx * 1.3, sx * 1.6, 3.1, 3.4, -0.9, 1.9);
    b.box(sx * 2.35, 2, 0.7, 0.1, 1, 1, PALETTE.charcoal);
  }
  slab(-0.5, 0.5, 0, 0.6, -0.5, 0.5);
  b.box(0, 2.2, 2.44, 3, 1.7, 0.08, FACE, 'FTR');
  b.box(0, 1.55, 2.5, 2.6, 0.2, 0.04, 0x2a3139, 'F');
  return b;
}

/** The lens in its housing, in the frame of the neck; it slides toward the way ILO looks. */
function lensPart() {
  const b = new VoxelBuilder();
  b.box(0, 2.3, 2.54, 1.3, 1.3, 0.12, PALETTE.charcoal, 'FTRL');
  b.box(0, 2.3, 2.68, 0.9, 0.9, 0.16, PALETTE.amber, 'FTRL');
  return b;
}

/** The short antenna, in the frame of its base. */
function antennaPart() {
  const b = new VoxelBuilder();
  b.box(0, 0.2, 0, 0.2, 0.4, 0.2, PALETTE.charcoal);
  b.box(0, 0.5, 0, 0.26, 0.2, 0.26, PALETTE.teal, 'FTRL');
  return b;
}

/** The cape in the frame of its shoulder clasp: it hangs toward -y and spreads toward +x. */
function capeCloth() {
  const b = new VoxelBuilder();
  b.box(1.4, -2.2, 0, 3.0, 4.4, 0.24, PALETTE.cape); // falls to mid-thigh
  b.box(3.5, -1.3, 0, 1.8, 2.6, 0.24, PALETTE.cape); // sweeps past the right shoulder, inside the width of the body
  b.box(0.4, -4.8, 0, 1.2, 0.8, 0.24, PALETTE.cape);
  b.tone = 0.78;
  b.box(1.4, -4.1, 0, 3.0, 0.4, 0.26, PALETTE.cape); // a fold along the hem
  b.box(2.9, -1.5, 0, 0.2, 3.0, 0.26, PALETTE.cape);
  b.tone = 1;
  b.box(0.25, -0.15, 0.1, 0.5, 0.4, 0.3, PALETTE.bronze);
  return b;
}

/** The pelvis in the frame of the body. */
function pelvisShell() {
  const b = new VoxelBuilder();
  b.box(0, 4.75, 2.4, 3.2, 0.7, 2.2, PALETTE.charcoal);
  for (const sx of [-1, 1]) b.box(sx * 0.95, 4.5, 2.4, 1.3, 0.6, 1.3, PALETTE.steel);
  return b;
}

/** An oversized foot in the frame of its ankle: sole, body and a stepped toe, the toe toward the viewer. */
function footPart() {
  const b = new VoxelBuilder();
  b.box(0, -0.42, 0.2, 1.7, 0.16, 2.8, PALETTE.steelDark);
  b.box(0, -0.24, 0.2, 1.7, 0.2, 2.8, PALETTE.charcoal);
  b.box(0, -0.07, 0.05, 1.7, 0.14, 2.5, PALETTE.ceramic, 'FTRL');
  b.box(0, -0.42, 1.61, 1.3, 0.1, 0.02, PALETTE.steel, 'F');
  return b;
}

/** A mesh for one rigid part: its geometry is in fine voxels in the frame of its pivot, inside a body scaled by `FINE`. */
function litPart(geometry) {
  return new THREE.Mesh(geometry, material('plain'));
}

/** A glowing part (lens, chest module) with a material of its own, so `sync` can light it. */
function glowPart(geometry) {
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

/**
 * ILO as `{ group, sync(world, dt, events), dispose(), carryAnchor() }`. `group` sits at the center of ILO's feet
 * (the collision position) and a pose never moves it. Model frame: x right, y up, z toward the viewer; the standing
 * model fits in 0.75 by 1.5 units and stands just in front of the terrain, which ends at z 0.
 */
export function createIlo(scene) {
  const group = new THREE.Group();
  group.name = 'ilo';
  scene.add(group);
  const geometries = new Set();
  const built = (builder) => {
    const geometry = builder.build();
    geometries.add(geometry);
    return geometry;
  };
  const pivot = (parent, x, y, z) => {
    const node = new THREE.Group();
    node.position.set(x, y, z);
    parent.add(node);
    return node;
  };
  const thigh = built(limb(1, LEG, 1.1, 1.3));
  const shin = built(limb(0.85, LEG, 0.95, 1.1));
  const foot = built(footPart());
  const upperArm = built(limb(0.8, 1.9, 0.8, 1.05));
  const forearm = built(forearmHand());

  const body = new THREE.Group();
  body.name = 'body';
  body.scale.setScalar(FINE); // everything inside the body is placed in fine voxels
  group.add(body);
  body.add(litPart(built(pelvisShell())));
  const chest = new THREE.Group();
  chest.name = 'chest';
  chest.position.set(0, 5, 1.2);
  body.add(chest);
  chest.add(litPart(built(torsoShell())));
  const module = glowPart(built(chestModule()));
  chest.add(module);

  const leg = (sx) => {
    const side = sx < 0 ? 'L' : 'R';
    const hip = pivot(body, sx * HIP.x, HIP.y, HIP.z);
    hip.name = `hip${side}`;
    hip.add(litPart(thigh));
    const knee = pivot(hip, 0, -LEG, 0);
    knee.name = `knee${side}`;
    knee.add(litPart(shin));
    const ankle = pivot(knee, 0, -LEG, 0);
    ankle.name = `ankle${side}`;
    ankle.add(litPart(foot));
    return { hip, knee, ankle };
  };
  const arm = (sx) => {
    const side = sx < 0 ? 'L' : 'R';
    const shoulder = pivot(chest, sx * 2.45, 2.65, 1.5);
    shoulder.name = `shoulder${side}`;
    shoulder.add(litPart(upperArm));
    const elbow = pivot(shoulder, 0, -1.9, 0);
    elbow.name = `elbow${side}`;
    elbow.add(litPart(forearm));
    return { shoulder, elbow };
  };
  const legs = { L: leg(-1), R: leg(1) };
  const arms = { L: arm(-1), R: arm(1) };
  const head = pivot(chest, 0, 3, 1.2);
  head.add(litPart(built(headShell())));
  const lens = glowPart(built(lensPart()));
  head.add(lens);
  const antenna = pivot(head, -1.2, 3.4, -0.4);
  antenna.add(litPart(built(antennaPart())));
  const cape = pivot(chest, -1.7, 2.9, -0.12);
  cape.add(litPart(built(capeCloth())));
  const shadow = contactShadow(0.9);
  scene.add(shadow);

  // --- Poses ---
  const timers = { jump: 9, land: 9, pulse: 9, socket: 9, damage: 9 }; // seconds since each event
  const notes = { wall: 0, landSpeed: 0 }; // what the last jump and the last landing were like
  // How fast each pose channel approaches its target, per second.
  const RATE = { hipY: 34, hipL: 26, hipR: 26, kneeL: 30, kneeR: 30, ankleL: 30, ankleR: 30, turn: 11, headYaw: 7, headPitch: 14, cape: 9, capeLift: 7, glow: 30, lensGlow: 30 };
  let channel = null; // the pose on screen now
  let time = 0;
  // The gait: a foot stands in the world where it was put down until it lifts, so a foot that carries weight does
  // not move, and the legs follow the feet. `phase` is the left foot's cycle (the right foot's is half a cycle on);
  // it advances with the distance travelled, so a change of speed never jumps it. `w` blends the legs between the
  // pose and the gait. A foot's `x` is its place in the world and `y` its height above the ground.
  const gait = { on: false, live: false, w: 0, phase: 0, dir: 1, L: STRIDE.min, lead: 0, height: 0.5, arm: 0, elbow: 0,
    feet: { L: { stance: true, x: 0, y: 0, from: 0 }, R: { stance: true, x: 0, y: 0, from: 0 } }, swing: { L: 0, R: 0 }, legs: null };
  let reduced = false;
  const sides = ['L', 'R'];

  /** The world x of the hip joint of `side` when the body is turned `turn` radians. */
  const hipX = (p, side, turn) => p.x + (side === 'R' ? HIP.x : -HIP.x) * Math.cos(turn) * FINE;

  /** One step of the gait: the phase, where each foot stands or swings to, and how high the hips may be. */
  function stepGait(world, dt, turn) {
    const p = world.player;
    const speed = Math.abs(p.vx);
    gait.on = world.mode === 'play' && p.grounded && p.dashT <= 0 && speed > 0.4;
    gait.w += ((gait.on ? 1 : 0) - gait.w) * (1 - Math.exp(-GAIT_RATE * dt));
    if (!gait.on) {
      gait.live = false;
      return;
    }
    gait.dir = Math.sign(p.vx);
    const L = gait.L += (clamp(STRIDE.per * speed, STRIDE.min, STRIDE.max) - gait.L) * (1 - Math.exp(-12 * dt)); // eased, so the step rate changes smoothly
    const lead = gait.lead = Math.min(DUTY * L, REACH);
    const both = 2 * DUTY - 1; // the part of a cycle in which both feet stand
    const length = 2 * LEG * FINE;
    const lift = (0.4 + speed / PLAYER.maxSpeed) * FINE; // how high a foot swings
    if (!gait.live) { // the gait begins under ILO: both feet stand where they are
      for (const side of sides) Object.assign(gait.feet[side], { x: hipX(p, side, turn), y: 0, stance: true });
      gait.live = true;
    }
    gait.phase = (gait.phase + (dt * speed) / (2 * L)) % 1;
    let low = Infinity; // the highest the hips may be for a planted foot to stay within reach
    for (const side of sides) {
      const foot = gait.feet[side];
      const hip = hipX(p, side, turn);
      const own = (gait.phase + (side === 'R' ? 0.5 : 0)) % 1;
      if (own < DUTY) {
        if (foot.stance === false) { // touch-down: the foot stands where its swing ends, a place fixed in the world
          foot.stance = true;
          foot.x = hip + gait.dir * (lead - 2 * L * own); // the swing ended this far into the frame
        } else {
          foot.slide = Math.abs(foot.x - hip) > REACH; // out of reach behind ILO: it skids along until it lifts
          foot.x = hip + clamp(foot.x - hip, -REACH, REACH);
        }
        foot.y = 0;
        low = Math.min(low, Math.sqrt(length * length - Math.min(Math.abs(foot.x - hip), length) ** 2));
      } else {
        const s = (own - DUTY) / (1 - DUTY); // the swing, from 0 to 1
        if (foot.stance) Object.assign(foot, { stance: false, from: hip + clamp(foot.x - hip, -REACH, REACH) }); // lift-off
        // A Hermite curve from where the foot stood to where it lands when the swing ends: a place fixed in the world,
        // as far ahead of its hip as it stood behind, reached at rest. A skidding foot keeps its speed as it lifts.
        const cubic = s * s * s;
        const swing = (1 - DUTY) * 2 * L; // how far ILO travels during the swing
        foot.x = foot.from * (2 * cubic - 3 * s * s + 1) + (hip + gait.dir * (swing * (1 - s) + lead)) * (-2 * cubic + 3 * s * s) + gait.dir * (foot.slide ? swing : 0) * (cubic - 2 * s * s + s);
        foot.y = lift * Math.sin(Math.PI * s);
        foot.slide = false;
      }
      gait.swing[side] = clamp((foot.x - hip) * gait.dir, -lead, lead) / lead; // -1: as far back as it gets, 1: as far ahead
    }
    // The hips are lowest at touch-down and lift-off, where a leg stretches furthest, and rise through mid-stance.
    const u = gait.phase % 0.5;
    const rise = u < both / 2 ? 0 : Math.sin((Math.PI * (u - both / 2)) / (0.5 - both / 2)) ** 2;
    gait.height = Math.min(low, Math.sqrt(length * length - lead * lead) + (BOB.walk + BOB.run * speed / PLAYER.maxSpeed) * rise);
  }

  /**
   * The angles that put both ankles at the feet of the gait: a rigid thigh and shin from the hip, the knee bent
   * toward the way ILO goes. `P.hipY` is the height of the hips; `level` then keeps the feet flat.
   */
  function followFeet(world, P, turn) {
    const length = 2 * LEG * FINE;
    for (const side of sides) {
      const foot = gait.feet[side];
      const dx = foot.x - hipX(world.player, side, turn);
      const dy = (ANKLE - HIP.y - P.hipY) * FINE + foot.y; // from the hip joint down to the lifted ankle pivot
      const line = Math.atan2(dx, -dy); // the hip-to-ankle line, from straight down toward +x
      const bend = Math.acos(clamp(Math.hypot(dx, dy), 0.01, length - 0.0001) / length); // between the thigh and that line
      P[`hip${side}`] = line + gait.dir * bend;
      P[`knee${side}`] = -gait.dir * 2 * bend;
    }
    level(P);
    gait.legs = { hipL: P.hipL, hipR: P.hipR, kneeL: P.kneeL, kneeR: P.kneeR, ankleL: P.ankleL, ankleR: P.ankleR, hipY: P.hipY };
  }

  /** A crouch of `a` radians toward `dir` with level feet: the hip drops by what the legs fold. */
  function crouch(P, dir, a) {
    for (const side of sides) {
      P[`hip${side}`] = dir * a;
      P[`knee${side}`] = -dir * 2 * a;
    }
    P.hipY = -4 * (1 - Math.cos(a));
  }

  /** Level feet whatever the legs do. */
  function level(P) {
    P.ankleL = -P.hipL - P.kneeL;
    P.ankleR = -P.hipR - P.kneeR;
  }

  /** The pose ILO reaches for now: one number per channel, signed in world terms (positive x: to the right). */
  function pose(world) {
    const p = world.player;
    const m = world.modeTime;
    const speed = Math.abs(p.vx);
    const run = clamp(speed / PLAYER.maxSpeed, 0, 1);
    const dir = speed > 0.4 ? Math.sign(p.vx) : p.facing;
    const P = { turn: 0, headYaw: 0, headPitch: 0, lean: 0, pitch: 0, hipY: 0, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0,
      ankleL: 0, ankleR: 0, shL: -0.06, shR: 0.06, elbL: 0, elbR: 0, fwdL: 0, fwdR: 0, lens: 0, cape: 0, capeLift: 0,
      antenna: 0, glow: 1, lensGlow: 1 };
    /** Turn toward `dir`: the body, the head a little more, the lens to its side of the face. */
    const face = (turn = BODY_TURN) => {
      P.turn = dir * turn;
      P.headYaw = dir * (turn + HEAD_TURN);
      P.lens = dir * LENS_OFFSET;
    };
    const mix = (key, value, w) => {
      P[key] += (value - P[key]) * w;
    };
    // Idle: a breathing bob while the head scans and the lens blinks now and then.
    const idle = () => {
      face();
      P.hipY = 0.12 * Math.sin(time * 2.6) - 0.06;
      P.headYaw = dir * 0.2 + 0.4 * Math.sin(time * 0.9);
      P.headPitch = 0.1 * Math.sin(time * 0.53 + 1.2);
      P.pitch = 0.03;
      P.antenna = 0.1 * Math.sin(time * 1.7);
      P.lensGlow = Math.sin(time * 1.7) > 0.995 ? 0.25 : 1;
    };

    if (world.mode === 'shutdown') {
      // Shutdown: ILO slumps into a crouch and its lights go out.
      const s = smooth(clamp(m / COLLAPSE, 0, 1));
      crouch(P, dir, s);
      P.pitch = 0.8 * s;
      P.headPitch = 0.6 * s;
      P.lean = dir * 0.2 * s;
      P.shL = -0.06 - 0.3 * s;
      P.shR = 0.06 + 0.3 * s;
      P.elbL = 0.2 * s;
      P.elbR = -0.2 * s;
      P.capeLift = 0.3 * s;
      P.glow = 1 - s;
      P.lensGlow = 1 - s;
    } else if (world.mode === 'reboot') {
      // Reboot: ILO rises while the lens flickers back on and the chest module flashes.
      const r = smooth(clamp((m - 0.15) / 0.6, 0, 1));
      crouch(P, dir, 1 - r);
      P.pitch = 0.8 - 0.9 * r;
      P.headPitch = 0.6 - 0.75 * r;
      P.shL = -0.06 - 0.5 * r;
      P.shR = 0.06 + 0.5 * r;
      P.lensGlow = m < 0.45 && Math.sin(m * 70) < -0.3 ? 0.1 : 1;
      P.glow = r * (m < 0.8 ? 1 + Math.abs(Math.sin(m * 30)) : 1);
    } else if (world.mode === 'relayActivation') {
      // Relay activation: chest forward, arms open, the module ringing; the arms open and close again.
      const k = Math.min(smooth(clamp(m / 0.3, 0, 1)), smooth(clamp((RUN.relayTime - m) / 0.3, 0, 1)));
      face();
      P.hipY = -0.3 * k + (reduced ? 0 : 0.05 * Math.sin(m * 40));
      P.pitch = -0.12 * k;
      P.headPitch = -0.35 * k;
      P.shL = -0.06 - 1.05 * k;
      P.shR = 0.06 + 1.05 * k;
      P.elbL = 0.9 * k;
      P.elbR = -0.9 * k;
      P.capeLift = 0.4 * k;
      P.glow = 1 + 1.6 * k * (0.6 + 0.4 * Math.sin(m * 18));
      P.lensGlow = 1 + 1.2 * k;
    } else if (world.mode === 'liftSequence') {
      // Lift arrival: upright with a hand on the rail, looking up the shaft, then out at the dawn; a step on and off.
      const stage = world.ascent?.stage;
      face(0.3);
      P.hipY = 0.1;
      P.fwdR = -1;
      P.elbR = -0.4;
      P.headPitch = stage === 'rise' ? -0.35 : stage === 'surface' ? -0.1 : 0.05;
      const step = 1 - clamp(m / 0.5, 0, 1);
      P.hipR = dir * (0.2 + 0.2 * step);
      P.kneeR = -dir * 0.25 * step;
      P.glow = 1.3;
    } else if (world.mode === 'title' || world.mode === 'complete') {
      idle();
      if (world.mode === 'complete') P.headPitch = -0.1;
    } else if (p.sliding) {
      // Wall slide: the near hand on the wall, knees bent, looking up along the wall.
      const wall = p.wall;
      const near = wall > 0 ? 'R' : 'L';
      const far = near === 'R' ? 'L' : 'R';
      P.turn = wall;
      P.headYaw = wall * 0.35;
      P.headPitch = -0.2;
      P.lens = wall * LENS_OFFSET;
      P.lean = wall * 0.12;
      crouch(P, wall, 0.3);
      P[`sh${near}`] = wall * 1.75;
      P[`elb${near}`] = -wall * 0.3;
      P[`sh${far}`] = wall * 0.5;
      P[`elb${far}`] = wall * 1.2;
      P.capeLift = 0.7;
      P.antenna = -wall * 0.3;
    } else if (p.dashT > 0) {
      // Dash: a hard lean into the dash, legs and arms swept behind.
      const d = p.dashDir;
      P.turn = d * 0.9;
      P.headYaw = d * 1.1;
      P.lens = d * LENS_OFFSET;
      P.lean = d * 0.42;
      P.pitch = 0.1;
      P.hipL = -d * 0.55;
      P.hipR = -d * 0.2;
      P.kneeL = -d * 0.5;
      P.kneeR = -d * 0.35;
      P.hipY = 0.2;
      P.shL = -0.06 - d * 0.9;
      P.shR = 0.06 - d * 0.9;
      P.elbL = 0.3;
      P.elbR = -0.3;
      P.antenna = -d * 0.5;
      P.cape = -d * 0.8;
      P.capeLift = 0.3;
    } else if (!p.grounded) {
      // Airborne: rising tucks the legs and lifts the arms, falling spreads them; the cape streams up.
      const tuck = clamp(p.vy / 9, -1, 1) * 0.5 + 0.5;
      face();
      P.hipL = dir * (0.5 - 0.7 * tuck);
      P.hipR = dir * (0.1 * tuck - 0.45);
      P.kneeL = -dir * (0.55 + 0.15 * tuck);
      P.kneeR = -dir * (0.25 + 0.75 * tuck);
      const out = 0.55 + 0.6 * tuck;
      const bend = 0.25 + 0.45 * tuck;
      P.shL = -out;
      P.shR = out;
      P.elbL = bend;
      P.elbR = -bend;
      P.pitch = 0.12 - 0.2 * tuck;
      P.headPitch = 0.2 - 0.35 * tuck;
      P.capeLift = 1 - tuck;
      P.antenna = -dir * 0.3 * run;
    } else if (gait.on) {
      // Walking and running: `stepGait` places the feet and `followFeet` the legs. The run is the walk with a longer
      // step, more lean, a wider arm swing and a deeper bob. The arms counter-swing with the feet of their side;
      // that swing joins the arm channels in `sync`, so it does not lag behind the feet.
      face();
      P.lean = dir * (0.04 + 0.12 * run);
      P.pitch = 0.05 + 0.2 * run;
      P.headYaw = dir * (0.25 + 0.1 * run);
      P.headPitch = 0.06 * run;
      P.shL = -0.06;
      P.shR = 0.06;
      gait.arm = dir * (0.15 + 0.45 * run);
      gait.elbow = dir * (0.25 + 0.9 * run);
      P.cape = -dir * (0.15 + 0.55 * run);
      P.antenna = -dir * (0.08 + 0.35 * run) + (reduced ? 0 : 0.06 * run * Math.sin(time * 22));
      P.hipY = gait.height / FINE - HIP.y + ANKLE;
    } else {
      idle();
    }

    // Poses that follow an event: they blend over the base pose and fade with their timer.
    const fade = (name) => 1 - timers[name] / POSE_TIME[name];
    if (world.mode === 'play') {
      if (timers.jump < POSE_TIME.jump && notes.wall === 0) {
        // Takeoff: the legs push down and split, the arms throw up.
        const w = fade('jump');
        mix('hipL', -dir * 0.3, w);
        mix('hipR', dir * 0.25, w);
        mix('kneeL', dir * 0.05, w);
        mix('kneeR', -dir * 0.05, w);
        mix('hipY', 0.3, w);
        mix('pitch', -0.15, w);
        mix('headPitch', -0.2, w);
        mix('shL', -1.5, w);
        mix('shR', 1.5, w);
        mix('elbL', 0.9, w);
        mix('elbR', -0.9, w);
      }
      if (timers.jump < POSE_TIME.wallJump && notes.wall !== 0) {
        // Wall jump: the legs thrust away from the wall, the free arm swings up.
        const wall = notes.wall;
        const away = -wall;
        const near = wall > 0 ? 'R' : 'L';
        const far = near === 'R' ? 'L' : 'R';
        const w = 1 - timers.jump / POSE_TIME.wallJump;
        mix('hipL', away * 0.75, w);
        mix('hipR', away * 0.6, w);
        mix('kneeL', -away * 0.2, w);
        mix('kneeR', -away * 0.2, w);
        mix('turn', away * 0.4, w);
        mix('lean', away * 0.25, w);
        mix('headYaw', away * 0.3, w);
        mix('lens', away * LENS_OFFSET, w);
        mix(`sh${near}`, wall * 0.2, w);
        mix(`sh${far}`, -wall * 1.4, w);
        mix(`elb${near}`, 0.3, w);
        mix(`elb${far}`, -0.3, w);
      }
      if (timers.land < POSE_TIME.land && p.grounded) {
        // Landing compression: the knees take the fall.
        const w = fade('land');
        crouch(P, dir, (0.3 + 0.45 * clamp(notes.landSpeed / 14, 0, 1)) * w);
        mix('shL', -0.5, w);
        mix('shR', 0.5, w);
        mix('pitch', 0.15, w);
        mix('headPitch', 0.2, w);
      }
      if (timers.pulse < POSE_TIME.pulse) {
        // Pulse emission: the chest module flares and ILO rocks back a little.
        const w = fade('pulse');
        P.glow = 1 + 2.5 * w;
        P.lensGlow = 1 + 1.5 * w;
        mix('hipY', -0.35, w);
        mix('shL', -0.5, w);
        mix('shR', 0.5, w);
        mix('pitch', -0.12, w);
        mix('headPitch', -0.15, w);
        mix('capeLift', 0.5, w);
      }
      if (timers.socket < POSE_TIME.socket) {
        // Socket interaction: a reach toward the socket and back.
        const w = Math.sin((Math.PI * timers.socket) / POSE_TIME.socket);
        mix('fwdR', -1.3, w);
        mix('shR', 0.15, w);
        mix('elbR', 0.2, w);
        mix('pitch', 0.25, w);
        mix('headPitch', 0.3, w);
        mix('hipY', -0.4, w);
      }
      if (timers.damage < POSE_TIME.damage) {
        // Damage recoil: thrown back with the arms out; the lens stutters.
        const w = fade('damage');
        mix('lean', -dir * 0.4, w);
        mix('pitch', -0.3, w);
        mix('headPitch', -0.4, w);
        mix('shL', -1.2, w);
        mix('shR', 1.2, w);
        mix('elbL', 0.5, w);
        mix('elbR', -0.5, w);
        mix('hipY', -0.6, w);
        P.lensGlow = 0.3 + 0.7 * Math.abs(Math.sin(time * 40));
        P.glow = 0.5;
      }
      if (p.carrying !== null) {
        // Carrying: both hands hold the cell above the head, so the lens and the chest module stay in view.
        P.shL = -2.75;
        P.shR = 2.75;
        P.elbL = 0.3;
        P.elbR = -0.3;
        P.fwdL = 0;
        P.fwdR = 0;
        P.pitch -= 0.08;
        P.hipY -= 0.15;
      }
    }
    return P;
  }

  /** Pose ILO for the state of `world`; `events` are this frame's simulation events. Nothing moves while `dt` is 0. */
  function sync(world, dt, events) {
    const p = world.player;
    time += dt;
    for (const name in timers) timers[name] += dt;
    for (const e of events) {
      switch (e.type) {
        case 'jump':
          timers.jump = 0;
          notes.wall = e.wall ?? 0;
          break;
        case 'land':
          timers.land = 0;
          notes.landSpeed = e.speed ?? 0;
          break;
        case 'pulse':
          timers.pulse = 0;
          break;
        case 'cellInsert':
        case 'cellRemove':
        case 'switch':
          timers.socket = 0;
          break;
        case 'damage':
        case 'crush':
          timers.damage = 0;
          break;
      }
    }
    stepGait(world, dt, channel?.turn ?? p.facing * BODY_TURN);
    const P = pose(world);
    if (gait.on) followFeet(world, P, channel?.turn ?? P.turn); // after the pose, so a landing dips the hips over the feet
    level(P);
    channel ??= { ...P };
    for (const name in P) channel[name] += (P[name] - channel[name]) * (1 - Math.exp(-(RATE[name] ?? 20) * dt));
    const c = channel;
    // In the gait the legs are where the feet put them (`gait.legs`, kept while the gait fades) and the pose's
    // channels blend in with `1 - w`. The hips turn against the body's turn, so each leg swings along the way ILO
    // goes; the ankles turn back, so the feet keep pointing with the body.
    const w = gait.w;
    const yaw = c.turn * w;
    const leg = (name) => (gait.legs === null ? c[name] : c[name] + (gait.legs[name] - c[name]) * w);
    group.position.set(p.x, p.y, BODY_Z);
    body.rotation.y = c.turn;
    body.position.set(-HIP.z * FINE * Math.sin(c.turn), leg('hipY') * FINE, HIP.z * FINE); // turns about its middle plane, over the feet
    chest.rotation.set(c.pitch, 0, -c.lean);
    head.rotation.set(c.headPitch, c.headYaw, 0);
    for (const side of sides) {
      legs[side].hip.rotation.set(0, -yaw, leg(`hip${side}`));
      legs[side].knee.rotation.z = leg(`knee${side}`);
      legs[side].ankle.rotation.set(0, yaw, leg(`ankle${side}`));
      arms[side].shoulder.rotation.set(c[`fwd${side}`], 0, c[`sh${side}`] - w * gait.arm * gait.swing[side]);
      arms[side].elbow.rotation.z = c[`elb${side}`] + w * gait.elbow * Math.max(0, -gait.swing[side]);
    }
    antenna.rotation.z = c.antenna;
    cape.rotation.set(c.capeLift, 0, c.cape);
    lens.position.x = c.lens;
    lens.material.color.setScalar(c.lensGlow);
    module.material.color.setScalar(c.glow);
    // After a hit ILO blinks in play for as long as the hit's immunity lasts; a shutdown shows the body in every frame.
    body.visible = reduced || world.mode !== 'play' || timers.damage >= DAMAGE.immunity || Math.floor(time * 16) % 2 === 0;

    // The contact shadow lies on the ground under ILO, smaller the higher ILO is above it.
    const probe = { x: p.x - 0.3, y: p.y - SHADOW_DROP, w: 0.6, h: SHADOW_DROP + 0.02 };
    let ground = -Infinity;
    for (const solid of staticHits(world, probe)) if (solid.y + solid.h <= p.y + 0.02) ground = Math.max(ground, solid.y + solid.h);
    const height = p.y - ground;
    shadow.visible = height < SHADOW_DROP;
    if (shadow.visible) {
      shadow.position.set(p.x, ground + 0.012, -0.1); // on the top of the ground, behind its front edge
      shadow.scale.setScalar(clamp(1 - height / SHADOW_DROP, 0.35, 1));
    }
  }

  return {
    group,
    sync,
    /** Where a carried cell sits: the middle of its bottom face, in world units. */
    carryAnchor() {
      const c = channel ?? { turn: 0 };
      return { x: group.position.x, y: group.position.y + body.position.y + CARRY_Y, z: group.position.z + (HIP.z + 1.5 * Math.cos(c.turn)) * FINE };
    },
    /** With reduced motion ILO keeps still: no blink, no tremble, no flutter. */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      scene.remove(group, shadow);
      for (const geometry of geometries) geometry.dispose();
      lens.material.dispose();
      module.material.dispose();
    },
  };
}
