// Fake canvas for Node (contract §0 rule 12): lets THREE.WebGLRenderer construct and render without a GPU.
// The WebGL2 context is a Proxy: constants answer stable numbers, calls are recorded, and the few queries
// Three.js makes get typed answers. `canvas.gl.draws` counts draw calls. A 2D context records what is drawn
// to it and throws on members a real canvas does not have, so texture and sign code is checked in Node too.
// `canvas.gl.live` is `{ buffers, textures }`: how many the context holds, as `createBuffer` and `deleteBuffer`,
// `createTexture` and `deleteTexture` come in. `canvas.gl.viewportRect` is the rectangle of the last `viewport` call.

const CONSTANT = { // real WebGL values of the names that show up in readings
  NO_ERROR: 0, POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4,
  COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, VALIDATE_STATUS: 0x8b83, ACTIVE_UNIFORMS: 0x8b86, ACTIVE_ATTRIBUTES: 0x8b89,
  FRAMEBUFFER_COMPLETE: 0x8cd5, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406,
};
/** The calls that move a counter of `gl.live`: the name of the counter. */
const RESOURCE = { createBuffer: 'buffers', deleteBuffer: 'buffers', createTexture: 'textures', deleteTexture: 'textures' };
// Numbers as a real driver reports them; VERSION is the string the renderer parses for WebGL 2.
const PARAMETER = {
  MAX_TEXTURE_SIZE: 8192, MAX_CUBE_MAP_TEXTURE_SIZE: 8192, MAX_TEXTURE_IMAGE_UNITS: 16, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 4096,
  MAX_FRAGMENT_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30, MAX_SAMPLES: 4, SAMPLES: 4,
  VERSION: 'WebGL 2.0 (fake, Node)',
};
const READ_AS_CONSTANT = { IMPLEMENTATION_COLOR_READ_FORMAT: 'RGBA', IMPLEMENTATION_COLOR_READ_TYPE: 'UNSIGNED_BYTE' };
const CANVAS_2D = new Set([
  'createImageData', 'putImageData', 'getImageData', 'fillRect', 'clearRect', 'strokeRect', 'fillText', 'strokeText',
  'measureText', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform', 'beginPath',
  'closePath', 'moveTo', 'lineTo', 'rect', 'arc', 'arcTo', 'fill', 'stroke', 'clip', 'drawImage', 'createLinearGradient',
  'createRadialGradient', 'createPattern', 'setLineDash', 'fillStyle', 'strokeStyle', 'font', 'globalAlpha', 'textBaseline',
  'textAlign', 'lineWidth', 'imageSmoothingEnabled',
]);
const notACanvasMember = (name) => new TypeError(`${String(name)} is not a member of a canvas 2D context`);

/**
 * A canvas of `width × height` backing pixels (and the same client size). `webgl: false` is a browser without
 * WebGL 2: `getContext('webgl2')` answers null. `pixels` holds the last image a 2D context put, `text` its `fillText` calls.
 */
export function createCanvas({ width = 640, height = 360, webgl = true } = {}) {
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    pixels: null,
    text: [],
    gl: null,
    glAttributes: null,
    contexts: 0,
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    getContext(type, attributes) {
      if (type === 'webgl2') {
        if (canvas.gl === null && webgl) {
          canvas.gl = createGl(canvas);
          canvas.contexts += 1;
        }
        canvas.glAttributes = attributes;
        return canvas.gl;
      }
      if (type === '2d') return (canvas.context2d ??= createContext2d(canvas));
      return null;
    },
  };
  return canvas;
}

/** A `document` that answers only `createElement('canvas')`. */
export function createDocument() {
  return { createElement: (tag) => (tag === 'canvas' ? createCanvas() : null) };
}

function createGl(canvas) {
  const constants = new Map(); // constant name -> value
  const names = new Map(); // value -> name, for the queries that receive a constant
  const functions = new Map();
  const state = { canvas, draws: 0, calls: 0, live: { buffers: 0, textures: 0 } };
  const constant = (name) => {
    if (!constants.has(name)) {
      const value = CONSTANT[name] ?? 0x9000 + constants.size;
      constants.set(name, value);
      names.set(value, name);
    }
    return constants.get(name);
  };
  const answers = {
    getParameter: (pname) => {
      const name = names.get(pname);
      if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') return new Int32Array([0, 0, canvas.width, canvas.height]);
      return name in READ_AS_CONSTANT ? constant(READ_AS_CONSTANT[name]) : (PARAMETER[name] ?? 0);
    },
    getExtension: () => null,
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getProgramParameter: (_program, pname) => ({ LINK_STATUS: true, VALIDATE_STATUS: true })[names.get(pname)] ?? 0,
    getShaderParameter: () => true,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false }),
    getError: () => 0,
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    isContextLost: () => false,
  };
  return new Proxy(state, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(name)) return constant(name);
      if (name in answers) return answers[name];
      if (!functions.has(name)) {
        const counter = RESOURCE[name]; // absent for every other call
        const sign = name.startsWith('create') ? 1 : -1;
        functions.set(name, (...args) => {
          state.calls += 1;
          if (name === 'viewport') state.viewportRect = args;
          if (name.startsWith('draw')) state.draws += 1;
          if (counter !== undefined) state.live[counter] += sign;
        });
      }
      return functions.get(name);
    },
  });
}

function createContext2d(canvas) {
  const state = { canvas, font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000' };
  const acts = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image) => {
      canvas.pixels = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
    },
    fillText: (text, x, y) => { canvas.text.push({ text: String(text), x, y, font: state.font }); },
    measureText: (text) => ({ width: (Number(/([\d.]+)px/.exec(state.font)?.[1]) || 10) * 0.6 * String(text).length }),
  };
  return new Proxy(state, {
    get(target, name) {
      if (name in target) return target[name];
      if (!CANVAS_2D.has(name)) throw notACanvasMember(name);
      return acts[name] ?? (() => {});
    },
    set(target, name, value) {
      if (!(name in target) && !CANVAS_2D.has(name)) throw notACanvasMember(name);
      target[name] = value;
      return true;
    },
  });
}
