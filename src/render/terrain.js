// Static world of the renderer (contract §5.1): one merged mesh per region and material from `level.solids`,
// one mesh per seam that hides when the seam breaks, and one per `kill` rect. Actors draw in front of all of it.
import * as THREE from '../../vendor/three/three.module.js';
import { PALETTE, VoxelBuilder, hash, material, mesh } from './voxel.js';

const DEPTH = 4; // terrain spans z from -DEPTH to 0, so it never hides an actor at z 0 or above
const CORE = 0.14; // recess of the metal core behind the plates
const PLATE = 0.05; // recess of a plate front; its rivets reach z 0
const GAP = 0.05; // groove between metal plates
const TRIM = 0.14; // height of the lighter strip along every exposed top edge
const TOP_TRIM = 0.8; // depth of that strip from the front edge; the top surface behind it keeps the material's color
const GLOW_FADE = 0.5; // seconds a revealed fracture glow takes to fade out
const CRYSTAL = [0xe0a247, 0xc9862f, 0xf0bd5e]; // facet tones of a visible seam
const tint = (hex, other, mix, tone = 1) => new THREE.Color(hex).lerp(new THREE.Color(other), mix).multiplyScalar(tone);

/** One step of the fracture line of a seam: a thin face at depth `z` in front of the seam, from `(ax, ay)` to `(bx, by)`. */
function fracture(builder, ax, ay, bx, by, width, z, color) {
  builder.box((ax + bx) / 2, (ay + by) / 2, z, Math.abs(bx - ax) + width, Math.abs(by - ay) + width * 0.6, 0.01, color, 'F');
}

/**
 * The terrain of `level` as `{ sync(world, dt, events), dispose() }`. Its meshes are static: `sync` hides broken
 * seams and lights the fracture pattern of revealed ones.
 */
export function createTerrain(scene, level) {
  const cells = new Map(); // "cx,cy" -> { solid, mat, front } for every solid terrain cell
  for (const solid of level.solids ?? []) {
    for (let cx = Math.floor(solid.x); cx < Math.ceil(solid.x + solid.w); cx++) {
      for (let cy = Math.floor(solid.y); cy < Math.ceil(solid.y + solid.h); cy++) {
        const key = `${cx},${cy}`;
        if (!cells.has(key)) cells.set(key, { solid, mat: solid.mat, front: solid.mat === 'metal' ? -PLATE : 0 });
      }
    }
  }
  const cellAt = (cx, cy) => cells.get(`${cx},${cy}`) ?? null;
  // Rock relief: cells inside a face step back in patches of 2 × 2. Cells at an edge stay flush, so every
  // silhouette is exactly its collision rect.
  for (const [key, cell] of cells) {
    const [cx, cy] = key.split(',').map(Number);
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cellAt(cx + dx, cy + dy) === null);
    if (cell.mat !== 'metal' && !edge && hash(cx >> 1, cy >> 1, 31) >= 0.5) {
      cell.front = -(0.09 + 0.09 * hash(cx >> 1, cy >> 1, 32));
    }
  }

  const root = new THREE.Group();
  root.name = 'terrain';
  scene.add(root);
  const builders = new Map(); // "region|mat" -> merged geometry
  for (const [key, cell] of cells) {
    const [cx, cy] = key.split(',').map(Number);
    const { solid, mat, front } = cell;
    const builder = builders.get(`${solid.region}|${mat}`) ?? builders.set(`${solid.region}|${mat}`, new VoxelBuilder()).get(`${solid.region}|${mat}`);
    const x0 = Math.max(solid.x, cx);
    const x1 = Math.min(solid.x + solid.w, cx + 1);
    const y0 = Math.max(solid.y, cy);
    const y1 = Math.min(solid.y + solid.h, cy + 1);
    const left = cellAt(cx - 1, cy);
    const right = cellAt(cx + 1, cy);
    const above = cellAt(cx, cy + 1);
    const top = y1 === solid.y + solid.h && above === null; // an exposed top edge: traversable
    const strip = Math.min(TRIM, y1 - y0);
    const bodyTop = top ? y1 - strip : y1;
    const shows = (other) => other === null || other.front < front;
    if (bodyTop <= y0 && !top) continue;

    if (mat === 'metal') {
      const roomy = x1 - x0 > 2 * GAP;
      const px0 = x0 + (roomy && left !== null ? GAP : 0);
      const px1 = x1 - (roomy && right !== null ? GAP : 0);
      const py1 = bodyTop - (y1 - y0 > 2 * GAP && above !== null ? GAP : 0);
      builder.box((x0 + x1) / 2, (y0 + bodyTop) / 2, -(DEPTH + CORE) / 2, x1 - x0, bodyTop - y0, DEPTH - CORE, PALETTE.steelDark, 'F');
      builder.tone = 0.92 + 0.16 * hash(cx, cy, 21);
      builder.box((px0 + px1) / 2, (y0 + py1) / 2, -(DEPTH + PLATE) / 2, px1 - px0, py1 - y0, DEPTH - PLATE, PALETTE.steel,
        `F${above === null || above.front < -PLATE || py1 < bodyTop ? 'T' : ''}${right === null || right.front < -PLATE || px1 < x1 ? 'R' : ''}`);
      builder.tone = 0.85;
      for (const rx of [px0 + 0.17, px1 - 0.17]) {
        for (const ry of [y0 + 0.17, py1 - 0.17]) builder.box(rx, ry, -PLATE / 2, 0.1, 0.1, PLATE, PALETTE.metalEdge, 'F');
      }
    } else {
      builder.tone = 0.9 + 0.22 * hash(cx, cy, 21) - 0.05 * Math.min(8, solid.y + solid.h - y1);
      if (bodyTop > y0) builder.box((x0 + x1) / 2, (y0 + bodyTop) / 2, (front - DEPTH) / 2, x1 - x0, bodyTop - y0, DEPTH + front, PALETTE.rock,
        `F${shows(above) ? 'T' : ''}${shows(right) ? 'R' : ''}`);
    }
    if (top) {
      builder.tone = 1;
      builder.box((x0 + x1) / 2, y1 - strip / 2, -TOP_TRIM / 2, x1 - x0, strip, TOP_TRIM, mat === 'metal' ? PALETTE.metalEdge : PALETTE.edge,
        `FT${right === null || right.front < 0 ? 'R' : ''}`);
    }
  }
  for (const [key, builder] of builders) {
    if (!builder.empty) root.add(mesh(builder.build(), key.slice(key.lastIndexOf('|') + 1)));
  }

  // Seams: one group each, so a broken seam disappears as a whole.
  const cloned = [];
  const seamViews = (level.seams ?? []).map((seam) => {
    const { x, y, w, h } = seam;
    const seed = Math.round(x * 8) + Math.round(y * 8) * 977;
    const topOpen = cellAt(Math.floor(x + w / 2), Math.floor(y + h)) === null;
    const rightOpen = cellAt(Math.floor(x + w), Math.floor(y + h / 2)) === null;
    const exposed = `F${topOpen ? 'T' : ''}${rightOpen ? 'R' : ''}`;
    const lip = TRIM * 0.6;
    const base = new VoxelBuilder();
    const glow = new VoxelBuilder();
    if (seam.hidden) {
      // Looks like the rock around it with a faint amber tint.
      base.box(x + w / 2, y + h / 2, -DEPTH / 2, w, h, DEPTH, tint(PALETTE.rock, PALETTE.amber, 0.13), exposed);
    } else {
      base.box(x + w / 2, y + h / 2, -(DEPTH + 0.18) / 2, w, h, DEPTH - 0.18, CRYSTAL[1], exposed);
      const columns = Math.max(1, Math.round(w / 0.25));
      const columnWidth = w / columns;
      const recess = Array.from({ length: columns }, (_, i) => 0.06 + 0.06 * Math.floor(hash(i, 0, seed) * 3));
      recess.forEach((depth, i) => {
        const side = i === columns - 1 ? (rightOpen ? 'R' : '') : recess[i + 1] > depth ? 'R' : '';
        base.box(x + columnWidth * (i + 0.5), y + (h - lip) / 2, -(0.18 + depth) / 2, columnWidth, h - lip, 0.18 - depth,
          CRYSTAL[i % CRYSTAL.length], `F${topOpen ? 'T' : ''}${side}`);
      });
      base.box(x + w / 2, y + h - lip / 2, -DEPTH / 2, w, lip, DEPTH, 0xf6d48a, exposed);
    }
    // The fracture line: dark in the base, amber in the glow that a pulse reveals.
    const dark = seam.hidden ? tint(PALETTE.rock, PALETTE.amber, 0.05, 0.84) : 0x2a1a0a;
    const count = Math.max(2, Math.round(h / 0.45));
    const line = Array.from({ length: count + 1 }, (_, k) => [x + w / 2 + (hash(k, 1, seed) - 0.5) * w * 0.6, y + (h * k) / count]);
    glow.alpha = 0.85;
    for (let k = 0; k < count; k++) {
      const [ax, ay] = line[k];
      const [bx, by] = line[k + 1];
      fracture(base, ax, ay, bx, by, 0.07, 0.012, dark);
      fracture(glow, ax, ay, bx, by, 0.13, 0.03, PALETTE.amber);
      if (hash(k, 2, seed) < 0.5) {
        const reach = (hash(k, 3, seed) < 0.5 ? -1 : 1) * w * 0.3;
        fracture(base, bx, by, bx + reach, by - Math.abs(reach) * 0.5, 0.06, 0.012, dark);
        fracture(glow, bx, by, bx + reach, by - Math.abs(reach) * 0.5, 0.12, 0.03, PALETTE.amber);
      }
    }
    const group = new THREE.Group();
    const glowMesh = mesh(glow.build(), 'glow');
    glowMesh.material = material('glow').clone();
    glowMesh.visible = false;
    cloned.push(glowMesh.material);
    group.add(mesh(base.build(), seam.hidden ? 'rock' : 'plain'), glowMesh);
    root.add(group);
    return { id: seam.id, group, glow: glowMesh };
  });

  // Kill rects: deep water is a dark body with a pale surface line, a void is dark mist fading upward.
  const mist = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  for (const rect of level.kill ?? []) {
    const { x, y, w, h } = rect;
    const body = new VoxelBuilder();
    if (rect.kind === 'water') {
      body.quad([[x, y, -0.02], [x + w, y, -0.02], [x + w, y + h, -0.02], [x, y + h, -0.02]], [0x0a1721, 0x0a1721, 0x2a6f80, 0x2a6f80]);
      body.quad([[x, y + h, 0], [x + w, y + h, 0], [x + w, y + h, -DEPTH], [x, y + h, -DEPTH]], [0x1f5f70, 0x1f5f70, 0x16444f, 0x16444f]);
      root.add(mesh(body.build(), 'plain'));
      const surface = new VoxelBuilder();
      surface.box(x + w / 2, y + h - 0.03, -0.05, w, 0.06, 0.1, 0xb5eaf0, 'FT');
      root.add(mesh(surface.build(), 'emissive'));
    } else {
      body.quad([[x, y, -0.02], [x + w, y, -0.02], [x + w, y + h, -0.02], [x, y + h, -0.02]],
        [[0x04070b, 0.97], [0x04070b, 0.97], [0x04070b, 0], [0x04070b, 0]]);
      root.add(new THREE.Mesh(body.build(), mist));
    }
  }

  function sync(world) {
    const live = new Map((world.seams ?? []).map((seam) => [seam.id, seam]));
    for (const view of seamViews) {
      const seam = live.get(view.id);
      if (seam === undefined) continue;
      const left = seam.revealedUntil - world.time;
      view.group.visible = !seam.broken;
      view.glow.visible = left > 0;
      view.glow.material.opacity = Math.min(1, left / GLOW_FADE);
    }
  }

  function dispose() {
    scene.remove(root);
    root.traverse((object) => object.isMesh && object.geometry.dispose());
    for (const own of [...cloned, mist]) own.dispose();
  }

  return { sync, dispose };
}
