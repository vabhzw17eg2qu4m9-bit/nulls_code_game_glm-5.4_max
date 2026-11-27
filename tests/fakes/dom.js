// A small DOM for Node: the part of the real interface that src/ui, src/input.js and the glue read.
// No layout, no styles, no capture phase. `installDom()` builds a page and makes it the globals.

const NO_BUBBLE = new Set(['blur', 'focus']);
const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

let page = null; // { window, document } of the page installed last

class Target {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  /** Fire `type` here; `init` holds the properties of the event. False when a listener called `preventDefault()`.
   *  A disabled control takes no click, as in a browser. */
  dispatch(type, init = {}) {
    if (type === 'click' && this.disabled) return true;
    const event = {
      type, target: this, defaultPrevented: false, bubbles: init.bubbles ?? !NO_BUBBLE.has(type), ...init,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const node of event.bubbles ? this.path() : [this]) {
      event.currentTarget = node;
      for (const handler of node.listeners.get(type) ?? []) handler.call(node, event);
    }
    return !event.defaultPrevented;
  }
}

/** Selectors without combinators: `tag`, `.class`, `#id`, `[attr]`, `[attr="value"]`, joined by commas. */
function matches(node, selector) {
  if (!(node instanceof Element)) return false;
  return selector.split(',').some((part) => {
    const simple = part.trim();
    const tag = simple.match(/^[a-z][\w-]*/i)?.[0] ?? '';
    if (tag !== '' && node.tagName !== tag.toUpperCase()) return false;
    const tokens = simple.slice(tag.length).match(/[.#]?[-\w]+|\[[^\]]*\]/g) ?? [];
    return tokens.every((token) => {
      if (token[0] === '.') return node.classList.contains(token.slice(1));
      if (token[0] === '#') return node.id === token.slice(1);
      const [, name, value] = token.match(/^\[\s*([\w-]+)(?:\s*=\s*"([^"]*)")?\s*\]$/);
      const attribute = node.getAttribute(name);
      return value === undefined ? attribute !== null : attribute === value;
    });
  });
}

function classList(node) {
  const read = () => new Set((node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
  const write = (names) => node.setAttribute('class', [...names].join(' '));
  return {
    add: (...names) => write(new Set([...read(), ...names])),
    remove: (...names) => {
      const next = read();
      for (const name of names) next.delete(name);
      write(next);
    },
    toggle: (name, force) => {
      const next = read();
      const on = force === undefined ? !next.has(name) : force;
      if (on) next.add(name);
      else next.delete(name);
      write(next);
      return on;
    },
    contains: (name) => read().has(name),
  };
}

class Element extends Target {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.style = {};
    this.parentElement = null;
    this.children = [];
    this.checked = false;
    this.captures = new Set();
    this.classList = classList(this);
    this.text = null; // set through textContent while the element has no children
    this.data = {};
    // `dataset` mirrors the `data-*` attributes, as in a browser.
    this.dataset = new Proxy(this.data, {
      set: (data, key, value) => {
        data[key] = String(value);
        this.setAttribute(`data-${String(key)}`, value);
        return true;
      },
    });
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.data[camel(name.slice(5))] = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) delete this.data[camel(name.slice(5))];
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get id() {
    return this.getAttribute('id') ?? '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get hidden() {
    return this.attributes.has('hidden');
  }

  set hidden(value) {
    if (value) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  get disabled() {
    return this.attributes.has('disabled');
  }

  set disabled(value) {
    if (value) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get isConnected() {
    return this.path().includes(page.document);
  }

  /**
   * The box a test gave the element in `rect` (CSS pixels: `left`, `top`, `width`, `height`): what
   * `getBoundingClientRect()` returns for a laid-out element. Without one, and for a hidden element, an empty box at
   * the origin, as in a browser.
   */
  getBoundingClientRect() {
    const { left = 0, top = 0, width = 0, height = 0 } = this.hidden ? {} : (this.rect ?? {});
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
  }

  /** The element and those above it an event bubbles through, up to the window of a connected element. */
  path() {
    const path = [this];
    for (let node = this; node.parentElement !== null; node = node.parentElement) path.push(node.parentElement);
    if (path.at(-1) === page.document.documentElement) path.push(page.document, page.window);
    return path;
  }

  contains(node) {
    for (let current = node; current !== null && current !== undefined; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    return matches(this, selector);
  }

  closest(selector) {
    for (let node = this; node instanceof Element; node = node.parentElement) {
      if (matches(node, selector)) return node;
    }
    return null;
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  get textContent() {
    return this.text ?? this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.replaceChildren();
    this.text = String(value);
  }

  /** Add `nodes` at the end, or at the start for `prepend`; null and undefined are skipped. */
  insert(nodes, at) {
    const added = nodes.filter((node) => node !== null && node !== undefined);
    if (added.length === 0) return;
    for (const node of added) {
      node.remove?.();
      node.parentElement = this;
    }
    this.children.splice(at ?? this.children.length, 0, ...added);
    this.text = null;
  }

  append(...nodes) {
    this.insert(nodes, null);
  }

  prepend(...nodes) {
    this.insert(nodes, 0);
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.text = null;
    this.append(...nodes);
  }

  remove() {
    const parent = this.parentElement;
    if (parent === null) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }

  /** Takes the focus when connected and shown; the element that had it hears `blur` first. */
  focus() {
    for (let node = this; node instanceof Element; node = node.parentElement) {
      if (node.hidden) return;
    }
    if (!this.isConnected) return;
    const active = page.document.activeElement;
    page.document.activeElement = this;
    if (active !== null && active !== this) active.dispatch('blur');
    this.dispatch('focus');
  }

  blur() {
    if (page.document.activeElement !== this) return;
    page.document.activeElement = page.document.body;
    this.dispatch('blur');
  }

  setPointerCapture(pointerId) {
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captures.delete(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.captures.has(pointerId);
  }
}

class Document extends Target {
  constructor() {
    super();
    this.hidden = false;
    this.documentElement = new Element('html');
    this.body = new Element('body');
    this.documentElement.append(this.body);
    this.activeElement = this.body;
  }

  /** `'visible'` or `'hidden'`, as a browser derives it from `document.hidden`; setting one sets the other. */
  get visibilityState() {
    return this.hidden ? 'hidden' : 'visible';
  }

  set visibilityState(state) {
    this.hidden = state === 'hidden';
  }

  createElement(tagName) {
    return new Element(tagName);
  }

  createTextNode(text) {
    return { nodeType: 3, textContent: String(text), parentElement: null };
  }

  querySelectorAll(selector) {
    return [this.documentElement, ...this.documentElement.querySelectorAll(selector)].filter((node) => matches(node, selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  path() {
    return [this, page.window];
  }
}

class Window extends Target {
  constructor(coarse, reduce) {
    super();
    this.coarse = coarse;
    this.reduce = reduce;
  }

  /**
   * `(pointer: coarse)` matches when the page was installed with `coarse`, `(prefers-reduced-motion: reduce)` when
   * with `reduce`; nothing else does.
   */
  matchMedia(query) {
    return { matches: (this.coarse && query.includes('coarse')) || (this.reduce && query.includes('reduced-motion')), media: query };
  }

  path() {
    return [this];
  }
}

/** Memory storage with the `localStorage` interface. `fail` makes every call throw; `full` refuses writes. */
export function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    fail: false,
    full: false,
    getItem(key) {
      if (this.fail) throw new Error('Storage is blocked');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.fail) throw new Error('Storage is blocked');
      if (this.full) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

/** A fresh page (`html` > `body`) as the globals `window`, `document`, `matchMedia` and `localStorage`; returns them. */
export function installDom({ coarse = false, reduce = false, storage = createStorage() } = {}) {
  const window = new Window(coarse, reduce);
  const document = new Document();
  page = { window, document };
  Object.assign(globalThis, { window, document, localStorage: storage, matchMedia: window.matchMedia.bind(window) });
  return { window, document, storage };
}
