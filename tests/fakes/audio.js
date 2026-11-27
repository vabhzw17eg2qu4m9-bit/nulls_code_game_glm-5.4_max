// A hand-written fake of the Web Audio surface DEEPWAKE uses (contract §0 rule 12). It makes no sound.
// Every call is recorded with the context time it was made at. `tick(seconds)` advances the clock and fires
// `onended` for the sources whose stop time passed.

const SOURCES = new Set(['oscillator', 'bufferSource']);
const clocks = new WeakMap(); // an AudioParam -> its AudioContext, the only holder of the clock
const log = (node, name, args) => {
  node.calls.push({ name, args, time: (node.context ?? clocks.get(node) ?? node).currentTime });
};
const param = (context, value) => {
  const node = new AudioParam(value);
  clocks.set(node, context);
  return node;
};

class AudioParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }

  setValueAtTime(value, startTime) {
    log(this, 'setValueAtTime', [value, startTime]);
    return this;
  }

  linearRampToValueAtTime(value, endTime) {
    log(this, 'linearRampToValueAtTime', [value, endTime]);
    return this;
  }

  exponentialRampToValueAtTime(value, endTime) {
    if (!(value > 0)) throw new RangeError('An exponential ramp needs a positive and finite target');
    log(this, 'exponentialRampToValueAtTime', [value, endTime]);
    return this;
  }

  setTargetAtTime(value, startTime, timeConstant) {
    log(this, 'setTargetAtTime', [value, startTime, timeConstant]);
    return this;
  }

  cancelScheduledValues(cancelTime) {
    log(this, 'cancelScheduledValues', [cancelTime]);
    return this;
  }

  cancelAndHoldAtTime(cancelTime) {
    log(this, 'cancelAndHoldAtTime', [cancelTime]);
    return this;
  }
}

class AudioNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.calls = [];
    this.inputs = [];
    this.outputs = [];
    context.nodes.push(this);
  }

  connect(destination) {
    if (destination === undefined) throw new TypeError('connect needs a destination node');
    this.outputs.push(destination);
    destination.inputs.push(this);
    log(this, 'connect', [destination]);
    return destination;
  }

  disconnect(destination) {
    const cut = (node) => {
      this.outputs.splice(this.outputs.indexOf(node), 1);
      node.inputs.splice(node.inputs.indexOf(this), 1);
    };
    if (destination === undefined) this.outputs.slice().forEach(cut);
    else if (this.outputs.includes(destination)) cut(destination);
    else throw new DOMException('The node is not connected to that destination', 'InvalidAccessError');
    log(this, 'disconnect', destination === undefined ? [] : [destination]);
  }
}

class AudioScheduledSourceNode extends AudioNode {
  constructor(context, kind) {
    super(context, kind);
    this.startTime = null;
    this.stopTime = null;
    this.ended = false;
    this.onended = null;
  }

  start(when = this.context.currentTime) {
    if (this.startTime !== null) throw new DOMException('A source starts only once', 'InvalidStateError');
    this.startTime = when;
    log(this, 'start', [when]);
  }

  stop(when = this.context.currentTime) {
    if (this.startTime === null || this.stopTime !== null) throw new DOMException('A source stops only once, after it starts', 'InvalidStateError');
    this.stopTime = when;
    log(this, 'stop', [when]);
  }
}

class AudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channelIndex) {
    return this.channels[channelIndex];
  }
}

class AudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.sampleRate = 44100;
    this.calls = [];
    this.nodes = [];
    this.destination = new AudioNode(this, 'destination');
    contexts.push(this);
  }

  resume() {
    this.state = 'running';
    log(this, 'resume', []);
    return Promise.resolve();
  }

  close() {
    if (this.state === 'closed') return Promise.reject(new DOMException('The context is closed already', 'InvalidStateError'));
    this.state = 'closed';
    log(this, 'close', []);
    return Promise.resolve();
  }

  createGain() {
    const node = new AudioNode(this, 'gain');
    node.gain = param(this, 1);
    return node;
  }

  createOscillator() {
    const node = new AudioScheduledSourceNode(this, 'oscillator');
    node.type = 'sine';
    node.frequency = param(this, 440);
    node.detune = param(this, 0);
    return node;
  }

  createBiquadFilter() {
    const node = new AudioNode(this, 'biquad');
    node.type = 'lowpass';
    node.frequency = param(this, 350);
    node.Q = param(this, 1);
    node.gain = param(this, 0);
    return node;
  }

  createBufferSource() {
    const node = new AudioScheduledSourceNode(this, 'bufferSource');
    node.buffer = null;
    node.loop = false;
    node.playbackRate = param(this, 1);
    return node;
  }

  createStereoPanner() {
    const node = new AudioNode(this, 'panner');
    node.pan = param(this, 0);
    return node;
  }

  createDynamicsCompressor() {
    const node = new AudioNode(this, 'compressor');
    node.threshold = param(this, -24);
    node.knee = param(this, 30);
    node.ratio = param(this, 12);
    node.attack = param(this, 0.003);
    node.release = param(this, 0.25);
    node.reduction = param(this, 0);
    return node;
  }

  createBuffer(numberOfChannels, length, sampleRate) {
    return new AudioBuffer(numberOfChannels, length, sampleRate);
  }
}

let contexts = [];

/** Put the fake `AudioContext` on `globalThis` until `uninstall()`. `tick(seconds)` advances every context. */
export function install() {
  const own = contexts = []; // contexts created from now on register here
  const before = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  globalThis.AudioContext = AudioContext;
  return {
    /** The fake class, to subclass in failure tests. */
    AudioContext,
    /** Every context created so far; each lists its `nodes` with their recorded calls. */
    contexts: own,
    /** Advance every context clock and end the sources whose stop time passed. */
    tick(seconds) {
      for (const ctx of own) {
        ctx.currentTime += seconds;
        const due = ctx.nodes
          .filter((node) => SOURCES.has(node.kind) && !node.ended && node.stopTime !== null && node.stopTime <= ctx.currentTime)
          .sort((x, y) => x.stopTime - y.stopTime);
        for (const source of due) {
          source.ended = true;
          source.onended?.();
        }
      }
    },
    uninstall() {
      if (before === undefined) delete globalThis.AudioContext;
      else Object.defineProperty(globalThis, 'AudioContext', before);
    },
  };
}
