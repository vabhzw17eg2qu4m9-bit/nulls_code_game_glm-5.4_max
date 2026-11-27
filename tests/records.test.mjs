import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from './fakes/dom.js';
import { loadRecords, loadSettings, saveRecords, saveSettings, submitResult } from '../src/ui/records.js';

const KEY = 'deepwake.records.v1';
const SETTINGS_KEY = 'deepwake.settings.v1';
const empty = { version: 1, bestTime: null, bestArchiveTime: null, fewestRecoveries: null, fewestRecoveriesTime: null };
const none = { bestTime: false, bestArchiveTime: false, fewestRecoveries: false };
/** The result of a finished expedition: every relay active. */
const finished = (fields = {}) => ({
  time: 300, recoveries: 2, archives: 1, caches: 0, disabled: 0, relays: ['A', 'B', 'C'], fullArchive: false, ...fields,
});
const store = (data) => {
  const storage = createStorage();
  storage.setItem(KEY, typeof data === 'string' ? data : JSON.stringify(data));
  return storage;
};

test('Records: empty and unavailable storage give empty records', () => {
  assert.deepEqual(loadRecords(createStorage()), empty);
  assert.deepEqual(loadRecords(null), empty);
  assert.deepEqual(loadRecords(undefined), empty);
  const blocked = createStorage();
  blocked.fail = true;
  assert.deepEqual(loadRecords(blocked), empty);
});

test('Records: a first finished expedition sets every record it qualifies for, without changing the input', () => {
  const input = { ...empty };
  const outcome = submitResult(input, finished({ archives: 3 }));
  assert.deepEqual(outcome.records, { version: 1, bestTime: 300, bestArchiveTime: 300, fewestRecoveries: 2, fewestRecoveriesTime: 300 });
  assert.deepEqual(outcome.flags, { bestTime: true, bestArchiveTime: true, fewestRecoveries: true });
  assert.deepEqual(input, empty);
});

test('Records: only a faster time replaces a best completion time', () => {
  const first = submitResult(empty, finished()).records;
  assert.equal(submitResult(first, finished({ time: 320, recoveries: 5 })).flags.bestTime, false);
  assert.equal(submitResult(first, finished({ time: 300, recoveries: 5 })).flags.bestTime, false);
  const faster = submitResult(first, finished({ time: 280.5, recoveries: 5 }));
  assert.equal(faster.records.bestTime, 280.5);
  assert.equal(faster.flags.bestTime, true);
  assert.equal(first.bestTime, 300);
});

test('Records: the full-archive time needs all three archives', () => {
  const first = submitResult(empty, finished()).records;
  assert.equal(first.bestArchiveTime, null);
  const flaggedOnly = submitResult(first, finished({ time: 100, archives: 1, fullArchive: true }));
  assert.equal(flaggedOnly.records.bestArchiveTime, null);
  assert.equal(flaggedOnly.flags.bestArchiveTime, false);
  const two = submitResult(first, finished({ time: 100, archives: 2 }));
  assert.equal(two.records.bestArchiveTime, null);
  const full = submitResult(two.records, finished({ time: 250, archives: 3 }));
  assert.equal(full.records.bestArchiveTime, 250);
  assert.equal(full.flags.bestArchiveTime, true);
  const slowerFull = submitResult(full.records, finished({ time: 260, archives: 3, fullArchive: true }));
  assert.equal(slowerFull.records.bestArchiveTime, 250);
  const fasterFull = submitResult(slowerFull.records, finished({ time: 240, archives: 3 }));
  assert.equal(fasterFull.records.bestArchiveTime, 240);
});

test('Records: fewer recoveries wins; the completion time only breaks a tie', () => {
  const base = submitResult(empty, finished({ recoveries: 2, time: 300 })).records;
  const moreButFaster = submitResult(base, finished({ recoveries: 3, time: 10 }));
  assert.equal(moreButFaster.records.fewestRecoveries, 2);
  assert.equal(moreButFaster.records.fewestRecoveriesTime, 300);
  assert.equal(moreButFaster.flags.fewestRecoveries, false);
  const fewer = submitResult(base, finished({ recoveries: 1, time: 500 }));
  assert.equal(fewer.records.fewestRecoveries, 1);
  assert.equal(fewer.records.fewestRecoveriesTime, 500);
  assert.equal(fewer.flags.fewestRecoveries, true);
  const tiedSlower = submitResult(fewer.records, finished({ recoveries: 1, time: 600 }));
  assert.equal(tiedSlower.records.fewestRecoveriesTime, 500);
  assert.equal(tiedSlower.flags.fewestRecoveries, false);
  const tiedFaster = submitResult(tiedSlower.records, finished({ recoveries: 1, time: 400 }));
  assert.equal(tiedFaster.records.fewestRecoveriesTime, 400);
  assert.equal(tiedFaster.flags.fewestRecoveries, true);
  const flawless = submitResult(tiedFaster.records, finished({ recoveries: 0, time: 900 }));
  assert.deepEqual([flawless.records.fewestRecoveries, flawless.records.fewestRecoveriesTime], [0, 900]);
});

test('Records: only a finished expedition qualifies', () => {
  const records = { ...empty, bestTime: 50, fewestRecoveries: 0, fewestRecoveriesTime: 50 };
  const rejected = [
    null, undefined, {},
    finished({ relays: ['A', 'B'] }), finished({ relays: [] }), finished({ relays: undefined }),
    finished({ time: NaN }), finished({ time: -1 }), finished({ time: '300' }), finished({ time: Infinity }),
    finished({ recoveries: -1 }), finished({ recoveries: 1.5 }), finished({ recoveries: '2' }), finished({ recoveries: undefined }),
  ];
  for (const result of rejected) {
    const outcome = submitResult(records, result);
    assert.deepEqual(outcome.records, records, JSON.stringify(result));
    assert.deepEqual(outcome.flags, none);
  }
  // Zero is a valid time and a valid count.
  assert.deepEqual(submitResult(empty, finished({ time: 0, recoveries: 0 })).flags, { bestTime: true, bestArchiveTime: false, fewestRecoveries: true });
  assert.equal(submitResult(empty, finished({ time: 0, recoveries: 0 })).records.bestTime, 0);
});

test('Records: records handed in without a version or with bad values come back whole', () => {
  const bare = { bestTime: 'fast', bestArchiveTime: null, fewestRecoveries: null, fewestRecoveriesTime: 99 };
  const outcome = submitResult(bare, finished());
  assert.equal(outcome.records.version, 1);
  assert.deepEqual(outcome.records, { version: 1, bestTime: 300, bestArchiveTime: null, fewestRecoveries: 2, fewestRecoveriesTime: 300 });
});

test('Records: save and reload round trip', () => {
  const storage = createStorage();
  const { records } = submitResult(empty, finished({ archives: 3, recoveries: 0 }));
  assert.equal(saveRecords(records, storage), true);
  assert.deepEqual(loadRecords(storage), records);
});

test('Records: corrupt or incompatible stored data is ignored', () => {
  for (const value of ['not json', '[]', '"fast"', 'null', '5', 'true', '']) {
    assert.deepEqual(loadRecords(store(value)), empty, value);
  }
  for (const data of [
    { ...empty, version: 2 }, { ...empty, version: undefined }, { ...empty, version: '1' }, {},
    { bestTime: 300, fewestRecoveries: 1 },
  ]) {
    assert.deepEqual(loadRecords(store(data)), empty, JSON.stringify(data));
  }
  assert.deepEqual(loadRecords(store({ ...empty, bestTime: '300' })), empty);
  assert.deepEqual(loadRecords(store({ ...empty, bestTime: -5 })), empty);
  assert.deepEqual(loadRecords(store('{"version":1,"bestTime":1e999,"bestArchiveTime":200}')), { ...empty, bestArchiveTime: 200 });
  assert.deepEqual(loadRecords(store({ ...empty, bestArchiveTime: true, fewestRecoveries: 1.5, fewestRecoveriesTime: 400 })), empty);
  // A recovery count without a valid time, or a time without the count, reads as never set.
  assert.deepEqual(loadRecords(store({ ...empty, fewestRecoveries: null, fewestRecoveriesTime: 400 })), empty);
  assert.deepEqual(loadRecords(store({ ...empty, fewestRecoveries: 2, fewestRecoveriesTime: 'fast' })), { ...empty, fewestRecoveries: 2 });
  assert.deepEqual(loadRecords(store({ ...empty, fewestRecoveries: -1, fewestRecoveriesTime: 400 })), empty);
  const valid = { version: 1, bestTime: 120.5, bestArchiveTime: null, fewestRecoveries: 0, fewestRecoveriesTime: 0 };
  assert.deepEqual(loadRecords(store(valid)), valid);
  assert.deepEqual(loadRecords(store({ ...valid, extra: 'ignored' })), valid);
});

test('Records: full or throwing storage never stops play', () => {
  const storage = createStorage();
  storage.full = true;
  assert.equal(saveRecords({ ...empty, bestTime: 1 }, storage), false);
  assert.deepEqual(loadRecords(storage), empty);
  storage.fail = true;
  assert.equal(saveRecords({ ...empty, bestTime: 1 }, storage), false);
  assert.deepEqual(loadRecords(storage), empty);
  // A browser that forbids storage throws already on access.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError');
    },
  });
  try {
    assert.deepEqual(loadRecords(), empty);
    assert.equal(saveRecords(empty), false);
    assert.deepEqual(loadSettings(), { muted: false, reducedMotion: false });
    assert.equal(saveSettings({ muted: true }), false);
  } finally {
    delete globalThis.localStorage;
  }
  assert.deepEqual(loadRecords(), empty);
});

test('Settings: a round trip; anything but true reads as off; failing storage is harmless', () => {
  const storage = createStorage();
  assert.deepEqual(loadSettings(storage), { muted: false, reducedMotion: false });
  assert.equal(saveSettings({ muted: true, reducedMotion: false, extra: 1 }, storage), true);
  assert.deepEqual(loadSettings(storage), { muted: true, reducedMotion: false });
  assert.deepEqual(JSON.parse(storage.getItem(SETTINGS_KEY)), { muted: true, reducedMotion: false });
  saveSettings({ muted: false }, storage); // what a save leaves out stays as stored
  assert.deepEqual(JSON.parse(storage.getItem(SETTINGS_KEY)), { muted: false, reducedMotion: false });
  storage.setItem(SETTINGS_KEY, '{"muted":"yes","reducedMotion":1}');
  assert.deepEqual(loadSettings(storage), { muted: false, reducedMotion: false });
  storage.setItem(SETTINGS_KEY, '{broken');
  assert.deepEqual(loadSettings(storage), { muted: false, reducedMotion: false });
  storage.full = true;
  assert.equal(saveSettings({ muted: true, reducedMotion: true }, storage), false);
});

test('Settings: reduced motion follows the system for as long as the player sets none; a stored setting wins', () => {
  /** The `matchMedia` of a system that asks for reduced motion when `reduce`, and for nothing else. */
  const system = (reduce) => (query) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)', media: query });
  const storage = createStorage();
  assert.deepEqual(loadSettings(storage, system(true)), { muted: false, reducedMotion: true });
  assert.deepEqual(loadSettings(storage, system(false)), { muted: false, reducedMotion: false });

  for (const stored of [false, true]) {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ muted: true, reducedMotion: stored }));
    assert.deepEqual(loadSettings(storage, system(!stored)), { muted: true, reducedMotion: stored });
  }
  storage.setItem(SETTINGS_KEY, '{"muted":true,"reducedMotion":"yes"}'); // an invalid value is no setting
  assert.deepEqual(loadSettings(storage, system(true)), { muted: true, reducedMotion: true });

  storage.setItem(SETTINGS_KEY, '{"muted":true}');
  saveSettings({ muted: false }, storage); // a mute toggle leaves reduced motion to the system
  assert.deepEqual(loadSettings(storage, system(true)), { muted: false, reducedMotion: true });
});
