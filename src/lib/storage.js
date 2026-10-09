/**
 * Settings and cache, wrapped so the rest of the extension never touches
 * chrome.storage directly.
 *
 * Settings live in `sync` so a student's target and grouping fixes follow them
 * between machines. Caches live in `local` — per-device, disposable, and they
 * would otherwise burn through the much smaller sync quota.
 *
 * Cache keys are built here and only here. Three caches exist:
 *   semester:<courseHash>   -> semesterHash                (a course never changes semester)
 *   units:<semesterHash>    -> [{courseHash,name}]         (the subject list; stable for a term)
 *   subjects:<semesterHash> -> [{courseHash,name,held,attended}]  (the numbers)
 * Keying the numbers by *semester* rather than by the page's course is what
 * makes clicking between nine subject pages cost zero requests within the TTL.
 */

import { DEFAULT_SCHEDULE } from './schedule.js';

const SETTINGS_KEY = 'settings';
const CACHE_PREFIX = 'cache:';

/** How long the attendance numbers are trusted without asking the portal again.
 *  Long enough to make navigation feel instant, short enough that a class marked
 *  present this morning shows up the same day. */
export const CACHE_TTL_MS = 10 * 60 * 1000;

/** Past this, cached numbers are not shown at all. A week-old figure presented
 *  as current is worse than a blank card — it is what makes someone skip a class
 *  they could not afford. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The subject list and course→semester mapping change rarely; refetching them
 *  on every refresh was ~18% of all requests for data we already had. */
export const STRUCTURE_TTL_MS = 12 * 60 * 60 * 1000;

/** Valid range for the attendance target, in percent. One owner; options.js
 *  imports these rather than restating them. */
export const TARGET_BOUNDS = Object.freeze({ min: 1, max: 99 });

export const DEFAULT_SETTINGS = Object.freeze({
  /** Stored as a percentage (75) rather than a fraction — it is what the user
   *  types, and the options page round-trips it without conversion drift. */
  targetPercent: 75,
  /** course name -> group key, for pairings the name heuristic gets wrong. */
  overrides: {},
  /** The student's own timetable; see lib/schedule.js. */
  schedule: DEFAULT_SCHEDULE,
  /** Set once the student has either set up a term schedule or waved the
   *  prompt away. Onboarding that reappears after being dismissed is nagging,
   *  and this is the only thing the extension needs to remember to avoid it. */
  scheduleTipDismissed: false,
});

function area(name) {
  const store = globalThis.chrome?.storage?.[name];
  if (!store) throw new Error(`chrome.storage.${name} unavailable`);
  return store;
}

// --- settings ---------------------------------------------------------------

/**
 * Coerce whatever is in storage into a shape the rest of the code can trust.
 *
 * Used on both read and write. Read-time normalisation is not redundant with
 * write-time: settings live in sync storage, so another device on a different
 * build can write at any moment. Readers never carry clamping logic of their
 * own — a corrupted or out-of-range target would otherwise silently produce
 * nonsense advice.
 */
export function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  const pct = Number(settings.targetPercent);
  settings.targetPercent =
    Number.isFinite(pct) && pct >= TARGET_BOUNDS.min && pct <= TARGET_BOUNDS.max
      ? pct
      : DEFAULT_SETTINGS.targetPercent;
  if (!settings.overrides || typeof settings.overrides !== 'object') settings.overrides = {};
  settings.schedule = {
    ...DEFAULT_SCHEDULE,
    ...(settings.schedule && typeof settings.schedule === 'object' ? settings.schedule : {}),
  };
  if (!settings.schedule.perSubject || typeof settings.schedule.perSubject !== 'object') {
    settings.schedule.perSubject = {};
  }
  settings.scheduleTipDismissed = settings.scheduleTipDismissed === true;
  return settings;
}

export async function getSettings() {
  const stored = await area('sync').get(SETTINGS_KEY);
  return normalizeSettings(stored?.[SETTINGS_KEY]);
}

export async function saveSettings(patch) {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await area('sync').set({ [SETTINGS_KEY]: next });
  return next;
}

/** Target as the fraction the math module expects. */
export function targetFraction(settings) {
  return settings.targetPercent / 100;
}

/**
 * Call back when settings change in another context — typically the options
 * page — so an open portal tab re-renders against the new target instead of
 * showing advice the student has just overridden. Returns an unsubscribe.
 */
export function onSettingsChanged(handler) {
  const onChanged = globalThis.chrome?.storage?.onChanged;
  if (!onChanged) return () => {};
  const listener = (changes, areaName) => {
    if (areaName === 'sync' && SETTINGS_KEY in changes) handler();
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

// --- caches -----------------------------------------------------------------

export const semesterCacheKey = (courseHash) => `semester:${courseHash}`;
export const unitsCacheKey = (semesterHash) => `units:${semesterHash}`;
export const subjectsCacheKey = (semesterHash) => `subjects:${semesterHash}`;

/**
 * Read one cache entry.
 * @returns {Promise<null | { ts: number, data: any, stale: boolean }>}
 *   null when absent or older than `maxAgeMs`; `stale` when older than `ttlMs`.
 */
export async function readCache(key, { ttlMs = CACHE_TTL_MS, maxAgeMs = CACHE_MAX_AGE_MS } = {}) {
  const full = CACHE_PREFIX + key;
  const stored = await area('local').get(full);
  const entry = stored?.[full];
  if (!entry || typeof entry.ts !== 'number') return null;
  const age = Date.now() - entry.ts;
  if (age > maxAgeMs) return null;
  return { ...entry, stale: age > ttlMs };
}

export async function writeCache(key, data) {
  await area('local').set({ [CACHE_PREFIX + key]: { ts: Date.now(), data } });
}

/**
 * The most recently cached *numbers*, whichever semester they came from.
 *
 * The popup has no page context of its own, so it cannot know which course the
 * student was last looking at — it just shows the freshest attendance the
 * content script has stored.
 */
export async function readLatestCache() {
  const all = await area('local').get(null);
  const prefix = CACHE_PREFIX + 'subjects:';
  let best = null;
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith(prefix) || typeof entry?.ts !== 'number') continue;
    if (!best || entry.ts > best.ts) best = entry;
  }
  if (!best) return null;
  const age = Date.now() - best.ts;
  if (age > CACHE_MAX_AGE_MS) return null;
  return { ...best, stale: age > CACHE_TTL_MS };
}

/** Call back whenever any cache entry is written — the popup repaints on it. */
export function onCacheChanged(handler) {
  const onChanged = globalThis.chrome?.storage?.onChanged;
  if (!onChanged) return () => {};
  const listener = (changes, areaName) => {
    if (areaName === 'local' && Object.keys(changes).some((k) => k.startsWith(CACHE_PREFIX))) {
      handler();
    }
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

export async function clearCache() {
  const all = await area('local').get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await area('local').remove(keys);
}
