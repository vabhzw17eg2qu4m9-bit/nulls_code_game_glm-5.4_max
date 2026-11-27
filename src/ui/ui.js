// Player interface (contract §5.3): HUD, prompt, notifications, overlays, archive fragment and touch buttons.
// Every element is built with createElement, so the interface also runs on the small DOM of tests/fakes/dom.js.

import { PULSE, RUN, SHIELD } from '../config.js';

const IDS = ['A', 'B', 'C'];            // relay and archive ids of the expedition
const TOAST_MS = 2500;                  // longest time one notification line stays
const TOAST_LIMIT = 3;                  // most notification lines at once, the showing one included
const FLASH_MS = 400;                   // meter response to a pulse without energy
const RESTART = 'Restart Expedition';
const RESTART_CONFIRM = 'Press again to confirm restart';
const CONTROLS = [
  [['A', 'D', '←', '→'], 'Move'],
  [['Space', 'Z'], 'Jump'],
  [['Shift', 'X'], 'Dash'],
  [['Q'], 'Echo Pulse'],
  [['E'], 'Interact'],
  [['P', 'Esc'], 'Pause'],
  [['R'], 'Retry from Checkpoint'],
];
/** The same list for touch controls: the buttons by name, then what each does. Retry and restart are menu buttons. */
const TOUCH_CONTROLS = [
  [['Left', 'Right'], 'Move'],
  [['Jump'], 'Jump, hold for height'],
  [['Dash'], 'Dash'],
  [['Pulse'], 'Echo Pulse'],
  [['Use'], 'Interact'],
  [['Pause button'], 'Pause'],
];
const DISMISS = { keys: 'Press E or Enter, or click anywhere, to close', touch: 'Tap anywhere to close' };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value !== null && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

/** Minutes, seconds and tenths, as in `5:03.4`. */
function formatTime(seconds) {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, '0')}.${tenths % 10}`;
}

const shown = (seconds) => (seconds === null ? 'No record yet' : formatTime(seconds));

/** Write `text` when it differs from what `node` shows, so a frame that changes nothing writes nothing. */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** Show or hide `node`; what is hidden never keeps the focus. */
function show(node, visible) {
  node.hidden = !visible;
  if (!visible && node.contains(document.activeElement)) document.activeElement.blur();
}

/** True while the touch controls show (`html.is-touch`). */
const touchOn = () => document.documentElement.classList.contains('is-touch');

/** `actions` names the game transitions the buttons trigger: begin, resume, retry, restart, pause, mute, reducedMotion. */
export function createUI({ root, touchRoot, actions }) {
  const percent = (value) => `${(value / PULSE.max) * 100}%`;
  const label = (text) => el('span', { class: 'hud-label', text });

  // --- HUD ---
  const segments = [0, 1, 2].map(() => el('span', { class: 'segment' }));
  const integrity = el('div', {
    class: 'hud-row integrity', role: 'meter', 'aria-label': 'Integrity',
    'aria-valuemin': '0', 'aria-valuemax': String(RUN.integrity),
  }, label('Integrity'), ...segments);
  const meterFill = el('span', { class: 'meter-fill' });
  const meterValue = el('span', { class: 'meter-value' });
  // A tick on the meter where each ability becomes affordable.
  const tick = (name, cost) => {
    const node = el('span', { class: 'meter-cost', 'data-cost': name });
    node.style.left = percent(cost);
    return node;
  };
  const meter = el('span', { class: 'meter' }, meterFill, tick('pulse', PULSE.cost), tick('shield', SHIELD.cost));
  const resonance = el('div', {
    class: 'hud-row resonance', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(PULSE.max),
    'aria-label': `Resonance energy. Echo Pulse costs ${PULSE.cost}, Shield costs ${SHIELD.cost}.`,
  }, label('Resonance'), meter, meterValue);
  const relayChips = IDS.map((id) => {
    const state = el('span', { class: 'relay-state' });
    const chip = el('span', { class: 'relay', dataset: { relay: id } }, el('b', { class: 'relay-id', text: id }), state);
    return { id, chip, state };
  });
  const relays = el('div', { class: 'hud-row relays' }, label('Relays'), ...relayChips.map((relay) => relay.chip));
  const archiveText = el('span', { class: 'hud-value' });
  const clockText = el('span', { class: 'hud-value' });
  const ability = (id, name, glyph) => el('span', {
    class: 'ability', dataset: { ability: id, name }, role: 'img', 'aria-label': `${name}: ready`,
  }, el('span', { class: 'ability-glyph', 'aria-hidden': 'true', text: glyph }), el('span', { class: 'ability-name', text: name }));
  const abilities = { dash: ability('dash', 'Dash', '»'), pulse: ability('pulse', 'Pulse', '◎'), shield: ability('shield', 'Shield', '△') };
  const carryBadge = el('span', { class: 'carry', hidden: true },
    el('span', { class: 'cell-icon', 'aria-hidden': 'true' }), el('span', { text: 'Carrying cell' }));
  const muteButton = el('button', { type: 'button', class: 'hud-button mute', 'aria-label': 'Mute sound', 'aria-pressed': 'false' },
    el('span', { class: 'icon icon-sound', 'aria-hidden': 'true' }));
  const pauseButton = el('button', { type: 'button', class: 'hud-button pause', 'aria-label': 'Pause' },
    el('span', { class: 'icon icon-pause', 'aria-hidden': 'true' }));
  const toastLine = el('p', { class: 'toast-line', hidden: true });
  const hud = el('div', { id: 'hud', class: 'hud' },
    el('div', { class: 'hud-panel hud-status' }, integrity, resonance, relays),
    el('div', { class: 'hud-panel hud-run' },
      el('span', { class: 'hud-item' }, label('Archives'), archiveText),
      el('span', { class: 'hud-item hud-clock' }, label('Time'), clockText),
      ...Object.values(abilities), carryBadge),
    el('div', { class: 'hud-panel hud-buttons' }, muteButton, pauseButton),
    // The notification line sits under the bar, in the top middle, at the height the wrapped bar really has.
    el('div', { id: 'toast', class: 'toast', 'aria-live': 'polite' }, toastLine));

  // --- Prompt and overlays ---
  const promptKey = el('kbd', { class: 'keycap' });
  const promptText = el('span', { class: 'prompt-text' });
  // The box finds its place (the bottom center, or the middle of the touch band); the pill is what the player reads.
  // Assistive technology reads one plain sentence instead: a cap beside a word would reach it without a space between.
  const promptRead = el('span', { class: 'visually-hidden' });
  const promptBox = el('div', { id: 'prompt', class: 'prompt', role: 'status', hidden: true },
    el('div', { class: 'prompt-pill', 'aria-hidden': 'true' }, promptKey, el('span', { class: 'prompt-dash', text: '—' }), promptText),
    promptRead);

  const beginButton = el('button', { type: 'button', class: 'primary begin', text: 'Begin Expedition' });
  const titleRecord = el('p', { class: 'records-line' });
  const titleCard = el('section', { id: 'card-title', class: 'card card-title', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'title-heading', hidden: true },
    el('h1', { id: 'title-heading', text: 'DEEPWAKE' }),
    el('p', { class: 'lede', text: 'Restore three relays. Reach the ascent lift.' }),
    beginButton, titleRecord);

  const resumeButton = el('button', { type: 'button', class: 'primary resume', text: 'Resume' });
  const retryButton = el('button', { type: 'button', class: 'retry', text: 'Retry from Checkpoint' });
  const restartButton = el('button', { type: 'button', class: 'restart', text: RESTART });
  const archiveList = el('ul', { class: 'archive-list' });
  const pauseRecord = el('p', { class: 'records-line' });
  const soundToggle = el('input', { type: 'checkbox', class: 'setting-sound' });
  const motionToggle = el('input', { type: 'checkbox', class: 'setting-motion' });
  const controls = el('ul', { class: 'controls' });
  const pauseCard = el('section', { id: 'card-pause', class: 'card card-pause', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-heading', hidden: true },
    el('h2', { id: 'pause-heading', text: 'Expedition Paused' }),
    el('div', { class: 'actions' }, resumeButton, retryButton, restartButton),
    el('div', { class: 'card-body' },
      el('div', { class: 'card-block' }, el('h3', { text: 'Memory Archives' }), archiveList),
      el('div', { class: 'card-block' },
        el('h3', { text: 'Controls' }), controls, pauseRecord,
        el('div', { class: 'settings' },
          el('label', { class: 'setting' }, soundToggle, el('span', { text: 'Sound' })),
          el('label', { class: 'setting' }, motionToggle, el('span', { text: 'Reduced motion' }))))));

  const recoveryCard = el('section', { id: 'card-recovery', class: 'card card-recovery', role: 'dialog', 'aria-labelledby': 'recovery-heading', hidden: true },
    el('h2', { id: 'recovery-heading', text: 'Rebooting at Station' }),
    el('p', { class: 'lede', text: 'Automatic return after a brief transition.' }));

  const completeHeading = el('h2', { id: 'complete-heading' });
  const statsList = el('dl', { class: 'stats' });
  const recordsList = el('dl', { class: 'records' });
  const newButton = el('button', { type: 'button', class: 'primary new', text: 'New Expedition' });
  const completeCard = el('section', { id: 'card-complete', class: 'card card-complete', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'complete-heading', hidden: true },
    el('p', { class: 'card-kicker', text: 'Signal Restored' }), completeHeading,
    el('div', { class: 'card-body' },
      el('div', { class: 'card-block' }, el('h3', { text: 'Expedition' }), statsList),
      el('div', { class: 'card-block' }, el('h3', { text: 'Records' }), recordsList)),
    // The footnote reads under both lists, on the width of the card.
    el('p', { class: 'note', text: 'Fewest Recoveries shows its completion time. The full-archive time needs all three archives.' }),
    newButton);

  const cards = { title: titleCard, pause: pauseCard, recovery: recoveryCard, complete: completeCard };
  // The action each overlay leads with; it takes the focus when the overlay opens.
  const primary = { title: beginButton, pause: resumeButton, complete: newButton };
  const overlay = el('div', { id: 'overlay', class: 'overlay', hidden: true }, ...Object.values(cards));

  // --- Archive fragment ---
  const fragmentKicker = el('p', { class: 'card-kicker', text: 'Memory Archive' });
  const fragmentTitle = el('h2', { id: 'fragment-title' });
  const fragmentText = el('p', { class: 'fragment-text' });
  const fragmentDismiss = el('p', { class: 'fragment-dismiss' });
  const fragment = el('aside', {
    id: 'fragment', class: 'fragment', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fragment-title', tabindex: '-1',
  }, fragmentKicker, fragmentTitle, fragmentText, fragmentDismiss);
  const fragmentLayer = el('div', { id: 'fragment-layer', class: 'fragment-layer', hidden: true }, fragment);

  root.append(hud, promptBox, overlay, fragmentLayer);

  // --- Touch buttons carry their action in `data-act`; src/input.js listens on the root ---
  const touchButton = (act, text, glyph = text) => el('button', {
    type: 'button', class: `touch-${act}`, dataset: { act }, 'aria-label': text, tabindex: '-1', text: glyph,
  });
  const pulseButton = touchButton('pulse', 'Pulse');
  const useButton = touchButton('interact', 'Use');
  touchRoot.append(
    el('div', { class: 'touch-cluster touch-move' }, touchButton('left', 'Move left', '◀'), touchButton('right', 'Move right', '▶')),
    el('div', { class: 'touch-cluster touch-act' }, touchButton('jump', 'Jump'), touchButton('dash', 'Dash'), pulseButton, useButton));
  const touchCaps = { E: useButton, Q: pulseButton }; // the touch button a prompt key stands for
  // An overlay covers the game until the first sync, so the controls start covered.
  touchRoot.classList.add('covered');
  // The controls show on a coarse-pointer device, and on any device after its first touch.
  const showTouch = () => document.documentElement.classList.add('is-touch');
  if (window.matchMedia('(pointer: coarse)').matches) showTouch();
  window.addEventListener('touchstart', showTouch, { passive: true, once: true });

  // --- State ---
  let fragmentOpen = false;
  let fragmentShown = false;
  let view = null;          // overlay on screen: title, pause, recovery or complete
  let shownWorld = null;
  let shownResult = null;   // result the complete card was built from
  let listedArchives = null; // collected archive ids the archive panel lists
  let inputShown = null;  // what the controls list and the fragment line name: false the keys, true the touch buttons
  let restartArmed = false;
  let toastUntil = 0;       // clock at which the showing notification leaves
  let flashUntil = 0;       // clock at which the meter stops flashing
  const waiting = [];       // notifications waiting for their turn

  // --- Wiring ---
  /** `action` runs on click. After a pointer click the button drops its focus, so Space and Enter are game keys again. */
  const activate = (button, action) => button.addEventListener('click', (event) => {
    action();
    if (event.detail > 0) button.blur();
  });
  activate(beginButton, actions.begin);
  activate(newButton, actions.begin);
  activate(resumeButton, actions.resume);
  activate(retryButton, actions.retry);
  activate(restartButton, () => {
    if (restartArmed) actions.restart();
    else armRestart(true);
  });
  activate(pauseButton, actions.pause);
  activate(muteButton, actions.mute);
  soundToggle.addEventListener('change', () => actions.mute());
  motionToggle.addEventListener('change', () => actions.reducedMotion(motionToggle.checked));
  fragmentLayer.addEventListener('click', dismissFragment);

  followInput(touchOn());

  // --- Behavior ---
  /** The first press of Restart only arms it; leaving the pause menu disarms it. */
  function armRestart(armed) {
    restartArmed = armed;
    restartButton.classList.toggle('confirm', armed);
    restartButton.textContent = armed ? RESTART_CONFIRM : RESTART;
  }

  /** The controls list and the fragment line follow the input: the keys, or the buttons once the touch controls show. */
  function followInput(touch) {
    if (touch === inputShown) return;
    inputShown = touch;
    controls.replaceChildren(...(touch ? TOUCH_CONTROLS : CONTROLS).map(([caps, action]) => el('li', {},
      el('span', { class: 'keys' }, ...caps.map((cap) => el('kbd', { class: 'keycap', text: cap }))), el('span', { text: action }))));
    fragmentDismiss.textContent = touch ? DISMISS.touch : DISMISS.keys;
  }

  /** The fragment is on screen while it is open and no overlay is above it. */
  function placeFragment() {
    const visible = fragmentOpen && view === null;
    if (visible === fragmentShown) return;
    fragmentShown = visible;
    show(fragmentLayer, visible);
    // The focus goes into the dialog to read it, and leaves it together with the dialog.
    if (visible) fragment.focus();
  }

  function dismissFragment() {
    fragmentOpen = false;
    placeFragment();
  }

  /** Queue a notification line; a line past the limit is dropped, the ones waiting go first. */
  function notify(text) {
    if (waiting.length + (toastUntil === 0 ? 0 : 1) < TOAST_LIMIT) waiting.push(text);
  }

  function updateToast(now) {
    if (toastUntil !== 0 && now >= toastUntil) {
      toastUntil = 0;
      show(toastLine, false);
    }
    if (toastUntil === 0 && waiting.length > 0) {
      toastLine.textContent = waiting.shift();
      show(toastLine, true);
      toastUntil = now + TOAST_MS;
    }
  }

  /** One line with the records that exist, or that there are none. */
  function recordLine(records) {
    const parts = [];
    if (records.bestTime !== null) parts.push(`Best completion time ${formatTime(records.bestTime)}`);
    if (records.bestArchiveTime !== null) parts.push(`Best full-archive time ${formatTime(records.bestArchiveTime)}`);
    if (records.fewestRecoveries !== null) parts.push(`Fewest recoveries ${records.fewestRecoveries}`);
    return parts.length === 0 ? 'No records yet' : parts.join(' · ');
  }

  /** One row of a list: the label, and the value with the `New best` mark of a record this expedition set beside it. */
  function row(list, name, value, isNew = false) {
    list.append(el('dt', { text: name }),
      el('dd', {}, el('span', { text: value }), isNew ? el('span', { class: 'new-best', text: 'New best' }) : null));
  }

  /** Build the complete card once per expedition. */
  function showComplete(world, records, marks) {
    const result = world.result;
    if (result === null || result === shownResult) return;
    shownResult = result;
    completeHeading.textContent = result.archives >= IDS.length ? 'Full Archive Expedition' : 'Expedition Complete';
    statsList.replaceChildren();
    row(statsList, 'Expedition time', formatTime(result.time));
    row(statsList, 'Recoveries', String(result.recoveries));
    row(statsList, 'Archives', `${result.archives}/${IDS.length}`);
    row(statsList, 'Caches found', String(result.caches));
    row(statsList, 'Machines disabled', String(result.disabled));
    for (const id of IDS) row(statsList, `Relay ${id}`, result.relays?.includes(id) === true ? 'Online' : 'Offline');
    recordsList.replaceChildren();
    row(recordsList, 'Best Completion Time', shown(records.bestTime), marks.bestTime === true);
    row(recordsList, 'Best Full-Archive Time', shown(records.bestArchiveTime), marks.bestArchiveTime === true);
    const fewest = records.fewestRecoveries === null ? 'No record yet'
      : `${records.fewestRecoveries}${records.fewestRecoveriesTime === null ? '' : ` in ${formatTime(records.fewestRecoveriesTime)}`}`;
    row(recordsList, 'Fewest Recoveries', fewest, marks.fewestRecoveries === true);
  }

  /** Fill the archive panel when the collected archives change: three entries, found or undiscovered. */
  function showPause(world, records) {
    const collected = world.archives.filter((archive) => archive.collected);
    const key = collected.map((archive) => archive.id).join('');
    if (key !== listedArchives) {
      listedArchives = key;
      archiveList.replaceChildren(...IDS.map((id) => {
        const archive = collected.find((entry) => entry.id === id);
        return el('li', { class: `archive-entry ${archive === undefined ? 'undiscovered' : 'found'}` },
          el('strong', { text: archive === undefined ? `Archive ${id}` : archive.title }),
          el('p', { text: archive === undefined ? 'Undiscovered' : archive.text }));
      }));
    }
    setText(pauseRecord, recordLine(records));
  }

  /** Put the overlay `next` on screen (`null` hides it) with its action in the focus. */
  function setView(next) {
    if (view === 'pause' && next !== 'pause') armRestart(false);
    if (view !== null) show(cards[view], false);
    if (next === null) overlay.removeAttribute('data-view');
    else {
      overlay.dataset.view = next;
      show(cards[next], true);
    }
    show(overlay, next !== null);
    view = next;
    if (next !== null) primary[next]?.focus();
  }

  /** An ability icon is subdued while `reason` is set; the reason is what assistive technology reads. */
  function subdued(icon, reason) {
    icon.classList.toggle('off', reason !== null);
    setAttr(icon, 'aria-label', reason === null ? `${icon.dataset.name}: ready` : `${icon.dataset.name}: ${reason}`);
  }

  function sync(world, ctx) {
    const { records, flags } = ctx;
    const marks = flags ?? {};
    if (shownWorld !== null && shownWorld !== world) {
      // Another expedition: nothing transient of the previous one survives a restart or a new expedition.
      fragmentOpen = false;
      waiting.length = 0;
      toastUntil = 0;
      show(toastLine, false);
      flashUntil = 0;
    }
    shownWorld = world;
    const now = performance.now();
    const p = world.player;

    // HUD
    const energy = Math.round(Math.min(PULSE.max, Math.max(0, p.energy)));
    segments.forEach((node, index) => node.classList.toggle('off', index >= p.hp));
    setAttr(integrity, 'aria-valuenow', String(p.hp));
    meterFill.style.width = `${Math.min(PULSE.max, Math.max(0, p.energy))}%`;
    setText(meterValue, String(energy));
    setAttr(resonance, 'aria-valuenow', String(energy));
    resonance.classList.toggle('low', p.energy < PULSE.cost);
    resonance.classList.toggle('flash', now < flashUntil);
    for (const { id, chip, state } of relayChips) {
      const online = world.relays.some((relay) => relay.id === id && relay.active === true);
      chip.classList.toggle('active', online);
      setText(state, online ? 'Online' : 'Offline');
      setAttr(chip, 'aria-label', `Relay ${id} ${online ? 'online' : 'offline'}`);
    }
    setText(archiveText, `${world.archives.filter((archive) => archive.collected).length}/${IDS.length}`);
    setText(clockText, formatTime(world.clock));
    const carried = p.carrying !== null;
    show(carryBadge, carried);
    // An icon is subdued while its ability cannot be used.
    subdued(abilities.dash, carried ? 'unavailable while carrying'
      : p.dashCd > 0 ? 'cooling down' : !p.grounded && !p.dashAir ? 'spent in the air' : null);
    subdued(abilities.pulse, carried ? 'unavailable while carrying' : p.energy < PULSE.cost ? `needs ${PULSE.cost} resonance` : null);
    subdued(abilities.shield, p.energy < SHIELD.cost ? `needs ${SHIELD.cost} resonance` : null);
    updateToast(now);

    // The one overlay the state calls for
    let next = null;
    if (world.mode === 'title') next = 'title';
    else if (world.mode === 'complete') next = 'complete';
    else if (world.paused === true) next = 'pause';
    else if (world.mode === 'shutdown' || world.mode === 'reboot') next = 'recovery';
    if (next === 'title') setText(titleRecord, recordLine(records));
    else if (next === 'complete') showComplete(world, records, marks);
    else if (next === 'pause') showPause(world, records);
    if (next !== view) setView(next);
    // The recovery caption leaves the bar in place: the empty integrity it shows is the reason for the reboot.
    show(hud, (view === null || view === 'recovery') && world.mode !== 'liftSequence');
    // Pause exists in play, relay activation and the lift only; a recovery leaves the button inert, not dead-looking.
    pauseButton.disabled = view === 'recovery';
    setAttr(pauseButton, 'aria-disabled', String(pauseButton.disabled));

    // The prompt belongs to play: a stale one never outlives a pause, a recovery or a fragment.
    const prompt = world.mode === 'play' && world.paused !== true && !fragmentOpen ? world.prompt : null;
    show(promptBox, prompt !== null);
    if (prompt !== null) {
      // With touch controls a prompt names its button as the button is labeled, or drops a key no button has;
      // the class hands the placement to the stylesheet (the middle of the touch band).
      const touch = document.documentElement.classList.contains('is-touch');
      promptBox.classList.toggle('touch', touch);
      const cap = touch ? touchCaps[prompt.key]?.textContent ?? null : prompt.key ?? null;
      show(promptKey, cap !== null);
      const text = prompt.text ?? '';
      setText(promptKey, cap ?? '');
      setText(promptText, text);
      setText(promptRead, cap === null ? text : `${cap} ${text}`);
    }
    placeFragment();
    followInput(touchOn());
    // The touch controls yield to whatever covers the game: an overlay, or a fragment on top of it.
    touchRoot.classList.toggle('covered', view !== null || fragmentShown);
  }

  /** React to one simulation event of contract §3.14. */
  function handle(event) {
    switch (event.type) {
      case 'archive':
        fragmentKicker.textContent = typeof event.id === 'string' ? `Memory Archive ${event.id}` : 'Memory Archive';
        fragmentTitle.textContent = event.title ?? '';
        fragmentText.textContent = event.text ?? '';
        fragmentOpen = true;
        placeFragment();
        break;
      case 'station':
        notify('Station linked');
        break;
      case 'relay':
        notify(`Relay ${event.id} online`);
        break;
      case 'cache': {
        const gained = Math.round(event.gained);
        notify(gained > 0 ? `Cache found · Resonance +${gained}` : 'Cache found');
        break;
      }
      case 'pulseEmpty':
        // Insufficient energy answers on the meter only.
        flashUntil = performance.now() + FLASH_MS;
        break;
      default:
    }
  }

  function setMuted(on) {
    setAttr(muteButton, 'aria-pressed', String(on));
    soundToggle.checked = !on;
  }

  function setReducedMotion(on) {
    motionToggle.checked = on;
    root.classList.toggle('reduced-motion', on);
  }

  return {
    sync,
    handle,
    isFragmentOpen: () => fragmentOpen,
    dismissFragment,
    setMuted,
    setReducedMotion,
  };
}
