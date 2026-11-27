// Keyboard and touch input (contract §5.3). Produces the plain state object the simulation reads.

const KEYS = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', KeyZ: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyX: 'dash',
  KeyQ: 'pulse', KeyE: 'interact', KeyR: 'retry', KeyP: 'pause', Escape: 'pause', Enter: 'confirm',
};
const HELD = ['left', 'right', 'jump'];
// State field a fresh press sets; the held actions have none.
const PRESS = {
  jump: 'jumpPressed', dash: 'dashPressed', pulse: 'pulsePressed', interact: 'interactPressed',
  retry: 'retryPressed', pause: 'pausePressed', confirm: 'confirmPressed',
};
const GAMEPLAY_EDGES = ['jumpPressed', 'dashPressed', 'pulsePressed', 'interactPressed', 'retryPressed'];
const OVERLAY_EDGES = ['pausePressed', 'confirmPressed'];

const blank = () => ({
  left: false, right: false, jump: false, jumpPressed: false, dashPressed: false, pulsePressed: false,
  interactPressed: false, retryPressed: false, pausePressed: false, confirmPressed: false,
});

/** True when the game leaves `event` alone. */
function leftAlone(event) {
  // Browser shortcuts keep working, such as Ctrl+R or Cmd+R to reload.
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const tag = event.target?.tagName;
  // Space activates a focused button or field and Enter a focused button; every other key still belongs
  // to the game, so P, Escape or R work from a pause menu control as well.
  return tag === 'BUTTON' ? event.code === 'Space' || event.code === 'Enter' : tag === 'INPUT' && event.code === 'Space';
}

export function createInput() {
  const state = blank();
  const keys = new Map();     // KeyboardEvent.code -> action, for every key that is down
  const pointers = new Map(); // pointerId -> data-act of the touch button under that pointer
  const touch = document.querySelector('#touch');

  function refresh() {
    const actions = [...keys.values(), ...pointers.values()];
    for (const name of HELD) state[name] = actions.includes(name);
  }

  /** A fresh press of `action`: its edge waits for the next step; a held action stays down until release. */
  function press(action) {
    if (PRESS[action] !== undefined) state[PRESS[action]] = true;
    refresh();
  }

  function onKeyDown(event) {
    const action = KEYS[event.code];
    if (action === undefined || leftAlone(event)) return;
    // Also on a repeat: a handled key never scrolls.
    event.preventDefault();
    if (event.repeat) return;
    keys.set(event.code, action);
    press(action);
  }

  function onKeyUp(event) {
    const action = KEYS[event.code];
    if (action === undefined) return;
    if (!leftAlone(event)) event.preventDefault();
    keys.delete(event.code);
    refresh();
  }

  function onPointerDown(event) {
    const button = event.target.closest('[data-act]');
    if (button === null) return;
    event.preventDefault();
    pointers.set(event.pointerId, button.dataset.act);
    try {
      touch?.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail for a pointer that is already gone; the pointer is released on its own.
    }
    press(button.dataset.act);
  }

  /** `pointerup`: that pointer lets go of its button; every other key and pointer stays as it is. */
  function release(event) {
    pointers.delete(event.pointerId);
    refresh();
  }

  /**
   * A cancelled pointer or a lost capture cannot be trusted any more: every held input is released.
   * `lostpointercapture` also follows a normal `pointerup`; that one finds nothing left to release.
   */
  function abandon(event) {
    if (event.type === 'lostpointercapture' && !pointers.has(event.pointerId)) return;
    reset();
  }

  const clear = (...names) => names.forEach((name) => {
    state[name] = false;
  });
  const touchHandler = { pointerdown: onPointerDown, pointerup: release, pointercancel: abandon, lostpointercapture: abandon };

  /** Release every held key and pointer and drop every pending press. */
  function reset() {
    keys.clear();
    pointers.clear();
    Object.assign(state, blank());
  }

  function onVisibility() {
    if (document.hidden) reset();
  }

  const input = {
    state,
    /** After the first simulation step of a frame: every gameplay edge has now been used once. */
    afterStep() {
      clear(...GAMEPLAY_EDGES);
    },
    /** End of a frame. Overlay edges never survive a frame; gameplay edges wait for a frame that steps. */
    endFrame(stepsRun) {
      clear(...OVERLAY_EDGES);
      if (stepsRun > 0) clear(...GAMEPLAY_EDGES);
    },
    reset,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const [type, handler] of Object.entries(touchHandler)) touch?.removeEventListener(type, handler);
    },
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', onVisibility);
  for (const [type, handler] of Object.entries(touchHandler)) touch?.addEventListener(type, handler);
  return input;
}
