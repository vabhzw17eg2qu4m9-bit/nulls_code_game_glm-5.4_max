// Voxel toolkit of the renderer (contract §5.1): palette, box builder, cached materials, pixel textures.
import * as THREE from '../../vendor/three/three.module.js';

/** GOAL §4 color table as sRGB hex numbers, keyed by the part each color paints. */
export const PALETTE = Object.freeze({
  background: 0x101923, // deep background: blue-black
  rock: 0x384552, // foreground rock: cool slate
  edge: 0x93a7bb, // traversable edges: lighter blue-gray stone
  metalEdge: 0xc0cad2, // traversable edges: pale metal trim
  steel: 0x5a6672, // old machinery: oxidized steel
  steelDark: 0x343d46,
  bronze: 0x8f7448, // muted bronze
  rust: 0x9a5530,
  crystal: 0x6cc3d3, // resonance crystals: desaturated cyan
  crystalCore: 0xdcfaff, // their bright cores
  amber: 0xe3a23c, // active power connections, ILO's lens: warm amber
  teal: 0x6fdcc9, // safe stations, ILO's chest module: soft teal-cyan
  hazard: 0xff6a35, // armed hazards: orange-red
  ceramic: 0xe9ecef, // ILO's chassis: pale ceramic
  charcoal: 0x2a2f36, // ILO's joints and limbs: charcoal
  cape: 0xa8552a, // ILO's rust-orange utility cape
  text: 0xf2e9d8, // UI and signs: warm off-white
  backing: 0x1a2129, // UI and signs: restrained dark backing
});

/** Voxel sizes in world units: one terrain voxel is 1, one fine (ILO) voxel is `FINE`. */
export const VOXEL = Object.freeze({ FINE: 1 / 8 });

const TEXELS = 16; // texture texels per world unit
// Face of a box: key, normal, and its four corners as bit patterns (1 = x1, 2 = y1, 4 = z1), counter-clockwise from outside.
const FACES = [
  { key: 'F', n: [0, 0, 1], c: [4, 5, 7, 6], uv: 'xy' },
  { key: 'B', n: [0, 0, -1], c: [1, 0, 2, 3], uv: 'xy' },
  { key: 'T', n: [0, 1, 0], c: [6, 7, 3, 2], uv: 'xz' },
  { key: 'D', n: [0, -1, 0], c: [0, 1, 5, 4], uv: 'xz' },
  { key: 'R', n: [1, 0, 0], c: [5, 1, 3, 7], uv: 'zy' },
  { key: 'L', n: [-1, 0, 0], c: [0, 4, 6, 2], uv: 'zy' },
];
const ALL = 'FBTDRL';

/**
 * Deterministic 0..1 from integer coordinates and a seed: the variation of every procedural part.
 * Pass whole numbers (scale and round fractional positions first).
 */
export function hash(x, y = 0, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Collects boxes and quads and bakes them into one indexed `BufferGeometry`
 * (position, normal, uv, color). Coordinates are local units; `tone` (default 1) scales the color of
 * everything added from now on, `alpha` (default 1) is the opacity written to the color attribute.
 */
export class VoxelBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
    this.tone = 1;
    this.alpha = 1;
    this.hasAlpha = false;
    this.color = new THREE.Color();
  }

  /** True when nothing was added; skip the mesh then. */
  get empty() {
    return this.indices.length === 0;
  }

  /**
   * Axis-aligned box of size `sx × sy × sz` centered at `(x, y, z)`. `color` is an sRGB hex number or a
   * `THREE.Color`. `faces` selects the faces to emit out of `FBTDRL` (front +z, back, top, bottom, right +x, left).
   */
  box(x, y, z, sx, sy, sz, color, faces = ALL) {
    const b = [x - sx / 2, y - sy / 2, z - sz / 2, x + sx / 2, y + sy / 2, z + sz / 2];
    const colorAlpha = this.setColor(color);
    for (const face of FACES) {
      if (!faces.includes(face.key)) continue;
      const base = this.positions.length / 3;
      for (let i = 0; i < 4; i++) {
        const c = face.c[i];
        const px = b[c & 1 ? 3 : 0];
        const py = b[c & 2 ? 4 : 1];
        const pz = b[c & 4 ? 5 : 2];
        this.positions.push(px, py, pz);
        this.normals.push(...face.n);
        this.uvs.push(...(face.uv === 'xy' ? [px, py] : face.uv === 'xz' ? [px, pz] : [pz, py]).map((v) => v * TEXELS));
        this.colors.push(this.color.r, this.color.g, this.color.b, colorAlpha);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /**
   * One quad from four corner points `[x, y, z]` in cyclic order. It faces the viewer: a corner order whose normal
   * points away from the viewer is reversed. `colors` holds one entry per corner (sRGB hex, or `[hex, alpha]`).
   */
  quad(points, colors) {
    const [a, b, c] = points;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[1] * 0.25 + n[2] < 0) {
      points = [...points].reverse();
      colors = [...colors].reverse();
      n = n.map((value) => -value);
    }
    const length = Math.hypot(...n) || 1;
    const axis = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 'zy' : Math.abs(n[1]) > Math.abs(n[2]) ? 'xz' : 'xy';
    const base = this.positions.length / 3;
    points.forEach((p, i) => {
      const cornerAlpha = this.setColor(colors[i]);
      this.positions.push(...p);
      this.normals.push(n[0] / length, n[1] / length, n[2] / length);
      this.uvs.push(...(axis === 'xy' ? [p[0], p[1]] : axis === 'xz' ? [p[0], p[2]] : [p[2], p[1]]).map((q) => q * TEXELS));
      this.colors.push(this.color.r, this.color.g, this.color.b, cornerAlpha);
    });
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  /** Add every face of another builder: moved to `(x, y, z)`, turned `rotY` radians about the vertical axis, scaled about its own origin. */
  add(builder, x, y, z, rotY = 0, scaleX = 1, scaleY = scaleX) {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const base = this.positions.length / 3;
    for (let i = 0; i < builder.positions.length; i += 3) {
      const px = builder.positions[i];
      const py = builder.positions[i + 1];
      const pz = builder.positions[i + 2];
      this.positions.push(x + (px * cos + pz * sin) * scaleX, y + py * scaleY, z + (-px * sin + pz * cos) * scaleX);
      const nx = builder.normals[i];
      const nz = builder.normals[i + 2];
      this.normals.push(nx * cos + nz * sin, builder.normals[i + 1], -nx * sin + nz * cos);
    }
    for (let i = 0; i < builder.uvs.length; i++) this.uvs.push(builder.uvs[i]);
    for (let i = 0; i < builder.colors.length; i++) this.colors.push(builder.colors[i]);
    this.hasAlpha ||= builder.hasAlpha;
    for (const index of builder.indices) this.indices.push(base + index);
    return this;
  }

  /** Load `color` (hex, `[hex, alpha]` or `THREE.Color`) into the scratch color, times `tone`; returns the alpha to write. */
  setColor(color) {
    const [hex, alpha] = Array.isArray(color) ? color : [color, this.alpha];
    if (typeof hex === 'number') this.color.setHex(hex);
    else this.color.copy(hex);
    this.color.multiplyScalar(this.tone);
    this.hasAlpha ||= alpha < 1;
    return alpha;
  }

  /** The merged geometry; the color attribute has 4 components only when something is translucent. */
  build() {
    const count = this.positions.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.hasAlpha) {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 4));
    } else {
      const rgb = new Array(count * 3);
      for (let i = 0, j = 0; i < this.colors.length; i += 4, j += 3) {
        rgb[j] = this.colors[i];
        rgb[j + 1] = this.colors[i + 1];
        rgb[j + 2] = this.colors[i + 2];
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
    }
    geometry.setIndex(this.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

// --- Materials ---

// Texel of a texture kind as an sRGB gray 0..255 that multiplies the vertex color: worn stone, brushed plate with a seam.
const TEXEL = {
  rock(x, y) {
    const block = (hash(x >> 2, y >> 2, 12) - 0.5) * 12;
    const speck = hash(x, y, 11) < 0.06 ? -48 : 0;
    return 236 + Math.floor((hash(x, y, 13) - 0.5) * 22 + block + speck);
  },
  metal(x, y) {
    const seam = x === 0 || y === 0 ? -46 : 0;
    return 238 + Math.floor((hash(0, y, 14) - 0.5) * 12 + (hash(x, y, 15) - 0.5) * 6 + seam);
  },
};

/** A 16×16 `CanvasTexture` of one texel per 1/16 unit, nearest filtered and tiled; null without a 2D canvas (Node). */
function texture(kind) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXELS;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const image = ctx.createImageData(TEXELS, TEXELS);
  for (let y = 0; y < TEXELS; y++) {
    for (let x = 0; x < TEXELS; x++) {
      const gray = TEXEL[kind](x, y);
      image.data.set([gray, gray, gray, 255], (y * TEXELS + x) * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

const materials = new Map();

/** The cached material of a model kind: `rock`, `metal`, `plain` are lit vertex colors (the first two with their pixel texture); `emissive` is unlit vertex colors; `glow` is unlit, transparent and additive. */
export function material(kind) {
  let made = materials.get(kind);
  if (made === undefined) materials.set(kind, made = makeMaterial(kind));
  return made;
}

function makeMaterial(kind) {
  switch (kind) {
    case 'rock':
    case 'metal':
      return new THREE.MeshLambertMaterial({ vertexColors: true, map: texture(kind) });
    case 'plain':
      return new THREE.MeshLambertMaterial({ vertexColors: true });
    case 'emissive':
      return new THREE.MeshBasicMaterial({ vertexColors: true });
    case 'glow':
      return new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
    default:
      throw new RangeError(`unknown voxel material kind '${kind}'`);
  }
}

/**
 * A `THREE.Mesh` for `geometry` with the cached material of `kind`. Emissive and glow meshes get one shade
 * per face normal baked into their vertex colors (once per geometry), because no light shades them.
 */
export function mesh(geometry, kind) {
  const color = geometry.attributes.color;
  if ((kind === 'emissive' || kind === 'glow') && color !== undefined && !geometry.userData.shaded) {
    const normal = geometry.attributes.normal;
    for (let i = 0; i < color.count; i++) {
      const shade = Math.max(0.46, 0.66 + 0.34 * normal.getY(i) + 0.12 * normal.getX(i) + 0.16 * normal.getZ(i));
      color.setXYZ(i, color.getX(i) * shade, color.getY(i) * shade, color.getZ(i) * shade);
    }
    color.needsUpdate = true;
    geometry.userData.shaded = true;
  }
  return new THREE.Mesh(geometry, material(kind));
}

const shadows = new Map();
let shadowMaterial = null;

/**
 * A dark transparent quad for the ground under an actor: `width` units wide, 0.9 deep, lying at y 0 behind
 * z 0 with a soft edge. Put it at the actor's feet plus about 0.01; its material is shared.
 */
export function contactShadow(width) {
  let geometry = shadows.get(width);
  if (geometry === undefined) {
    geometry = new THREE.PlaneGeometry(width, 0.9, 2, 2).rotateX(-Math.PI / 2).translate(0, 0, -0.45);
    const position = geometry.attributes.position;
    const alpha = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const fade = 1 - Math.max(Math.abs(position.getX(i) / (width / 2)), Math.abs((position.getZ(i) + 0.45) / 0.45));
      alpha[i * 4 + 3] = Math.max(0, 0.6 * fade);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(alpha, 4));
    shadows.set(width, geometry);
  }
  shadowMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  return new THREE.Mesh(geometry, shadowMaterial);
}
