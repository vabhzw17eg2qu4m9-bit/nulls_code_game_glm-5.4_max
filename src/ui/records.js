// Persistent records and settings (contract §5.3). Unavailable or corrupt storage never stops play.

const RECORDS_KEY = 'deepwake.records.v1';
const SETTINGS_KEY = 'deepwake.settings.v1';
const RELAYS = ['A', 'B', 'C'];
const ARCHIVE_TOTAL = 3;

const emptyRecords = () => ({
  version: 1, bestTime: null, bestArchiveTime: null, fewestRecoveries: null, fewestRecoveriesTime: null,
});

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Parsed object stored under `key`, or null when storage is unavailable or the value is not an object. */
function read(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? 'null');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Store `value` under `key`; false when storage is unavailable or full. */
function write(storage, key, value) {
  if (storage === null || storage === undefined) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * The records of `data` with every invalid value read as never set.
 * Null when the version is not ours: such data is corrupt or from another version and is ignored as a whole.
 */
function validated(data) {
  if (data === null || data.version !== 1) return null;
  const fewest = isCount(data.fewestRecoveries) ? data.fewestRecoveries : null;
  return {
    version: 1,
    bestTime: isTime(data.bestTime) ? data.bestTime : null,
    bestArchiveTime: isTime(data.bestArchiveTime) ? data.bestArchiveTime : null,
    fewestRecoveries: fewest,
    fewestRecoveriesTime: fewest !== null && isTime(data.fewestRecoveriesTime) ? data.fewestRecoveriesTime : null,
  };
}

/** Best completion times and fewest recoveries of finished expeditions; invalid entries read as never set. */
export function loadRecords(storage = defaultStorage()) {
  return validated(read(storage, RECORDS_KEY)) ?? emptyRecords();
}

/**
 * Fold one completed expedition into the records without changing the input.
 * `flags` marks the records this expedition set. Only a finished expedition counts: every relay active,
 * a finite time and a whole number of recoveries. The full-archive time needs all three archives;
 * fewer recoveries wins that record, with the completion time as the tie-breaker.
 */
export function submitResult(records, result) {
  const flags = { bestTime: false, bestArchiveTime: false, fewestRecoveries: false };
  const { time, recoveries, archives, relays } = result ?? {};
  const finished = isTime(time) && isCount(recoveries) && Array.isArray(relays) && RELAYS.every((id) => relays.includes(id));
  if (!finished) return { records, flags };
  const current = validated(records) ?? emptyRecords();
  const next = { ...current };
  const faster = (name) => !isTime(current[name]) || time < current[name];
  if (faster('bestTime')) {
    next.bestTime = time;
    flags.bestTime = true;
  }
  if (isCount(archives) && archives >= ARCHIVE_TOTAL && faster('bestArchiveTime')) {
    next.bestArchiveTime = time;
    flags.bestArchiveTime = true;
  }
  const tie = recoveries === current.fewestRecoveries
    && (!isTime(current.fewestRecoveriesTime) || time < current.fewestRecoveriesTime);
  if (!isCount(current.fewestRecoveries) || recoveries < current.fewestRecoveries || tie) {
    next.fewestRecoveries = recoveries;
    next.fewestRecoveriesTime = time;
    flags.fewestRecoveries = true;
  }
  return { records: next, flags };
}

/** Store the records; false when storage is unavailable or full (the in-memory records stay valid). */
export function saveRecords(records, storage = defaultStorage()) {
  return write(storage, RECORDS_KEY, records);
}

/** The `matchMedia` of the page; where there is none, nothing matches. */
const media = (query) => globalThis.matchMedia?.(query) ?? { matches: false };

/**
 * The settings in force: `{ muted, reducedMotion }`. What the player stored wins; where nothing is stored, reduced
 * motion follows the system preference.
 */
export function loadSettings(storage = defaultStorage(), matchMedia = media) {
  const data = read(storage, SETTINGS_KEY);
  return {
    muted: data?.muted === true,
    reducedMotion: typeof data?.reducedMotion === 'boolean' ? data.reducedMotion
      : matchMedia('(prefers-reduced-motion: reduce)').matches === true,
  };
}

/**
 * Store the settings that `settings` names over what is stored already: one the player never set stays unset, so
 * reduced motion keeps following the system. False when storage is unavailable or full.
 */
export function saveSettings(settings, storage = defaultStorage()) {
  const data = { ...read(storage, SETTINGS_KEY) };
  for (const name of ['muted', 'reducedMotion']) if (name in settings) data[name] = settings[name] === true;
  return write(storage, SETTINGS_KEY, data);
}
