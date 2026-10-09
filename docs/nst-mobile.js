/* NST Attendance — mobile bookmarklet, v0.2.0
 * https://github.com/yats0x7/nst-attendance
 *
 * Built from the extension's own source by scripts/build-mobile.mjs. Runs only
 * on a my.newtonschool.co page, reads only that page's session, sends nothing
 * anywhere. MIT licensed.
 */
(function () {
'use strict';
var __nstDev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
if (!/(^|\.)my\.newtonschool\.co$/.test(location.hostname) && !__nstDev) {
  alert('Open a course page on my.newtonschool.co first, then tap this again.');
  return;
}

  /**
   * chrome.storage stand-in, backed by this origin's localStorage.
   *
   * Only the surface storage.js uses is implemented: get(key | null), set and
   * remove, all promise-returning. Keys live under one prefix so clearing the
   * sheet's data never touches the portal's own storage.
   */
  var __nstPrefix = 'nst-attendance:store:';
  var __nstArea = function (area) {
    var full = function (key) { return __nstPrefix + area + ':' + key; };
    var readAll = function () {
      var all = {};
      var prefix = __nstPrefix + area + ':';
      for (var i = 0; i < localStorage.length; i += 1) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) {
          try { all[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
        }
      }
      return all;
    };
    return {
      get: function (key) {
        try {
          if (key === null || key === undefined) return Promise.resolve(readAll());
          var keys = Array.isArray(key) ? key : [key];
          var out = {};
          keys.forEach(function (k) {
            var raw = localStorage.getItem(full(k));
            if (raw !== null) { try { out[k] = JSON.parse(raw); } catch (e) {} }
          });
          return Promise.resolve(out);
        } catch (e) { return Promise.resolve({}); }
      },
      set: function (items) {
        try {
          Object.keys(items).forEach(function (k) {
            localStorage.setItem(full(k), JSON.stringify(items[k]));
          });
        } catch (e) {}
        return Promise.resolve();
      },
      remove: function (keys) {
        try {
          (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
            localStorage.removeItem(full(k));
          });
        } catch (e) {}
        return Promise.resolve();
      },
    };
  };
  var __nstChrome = {
    storage: {
      sync: __nstArea('sync'),
      local: __nstArea('local'),
      onChanged: { addListener: function () {}, removeListener: function () {} },
    },
  };

// ---- src/lib/math.js -----------------------------------------------
/**
 * Attendance arithmetic.
 *
 * Every function here is pure and dependency-free so it can be unit-tested under
 * `node --test` without a browser. Nothing in this file touches the DOM, the
 * network, or chrome.* APIs.
 *
 * Targets are expressed as a fraction in (0, 1) — 0.75 for the usual 75% rule.
 */

const DEFAULT_TARGET = 0.75;

// Percentages coming off a portal are rationals like 15/0.75 that can land a
// hair below an integer in binary floating point. Nudging by an epsilon before
// flooring/ceiling keeps "exactly at target" from reading as "just under".
const EPS = 1e-9;

/** @typedef {{ courseHash?: string, name?: string, held: number, attended: number }} Unit */

function assertTarget(target) {
  if (typeof target !== 'number' || !(target > 0) || !(target < 1)) {
    throw new RangeError(`target must be a fraction in (0, 1), got ${target}`);
  }
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Roll a subject's units (theory + lab + …) into a single attended/held pair.
 *
 * This sums raw class counts rather than averaging the units' percentages. The
 * two only agree when every unit has held the same number of classes, and a
 * subject with 30 lectures and 8 labs is the normal case, not the exception.
 *
 * @param {Unit[]} units
 * @returns {{ attended: number, held: number }}
 */
function combine(units) {
  let attended = 0;
  let held = 0;
  for (const unit of units ?? []) {
    const unitHeld = toCount(unit?.held);
    // Attendance can never exceed the classes actually held; a portal glitch
    // that reported otherwise would silently inflate the roll-up.
    attended += Math.min(toCount(unit?.attended), unitHeld);
    held += unitHeld;
  }
  return { attended, held };
}

/**
 * Attendance as a fraction, or null when no classes have been held yet.
 * Null rather than 0 — "no data" and "attended nothing" are different states
 * and the UI must not show 0% for a subject that hasn't started.
 *
 * @returns {number | null}
 */
function percentage(attended, held) {
  if (held <= 0) return null;
  return attended / held;
}

/**
 * How many classes can be missed from here and still finish at or above target.
 *
 *   attended / (held + k) >= target  <=>  held + k <= attended / target
 *
 * @returns {number} a non-negative integer
 */
function skipsAffordable(attended, held, target = DEFAULT_TARGET) {
  assertTarget(target);
  if (held <= 0) return 0;
  return Math.max(0, Math.floor(attended / target + EPS) - held);
}

/**
 * How many classes must be attended consecutively to climb back to target.
 *
 *   (attended + k) / (held + k) >= target  <=>  k * (1 - target) >= target * held - attended
 *
 * Returns 0 when already at or above target.
 *
 * @returns {number} a non-negative integer
 */
function classesToRecover(attended, held, target = DEFAULT_TARGET) {
  assertTarget(target);
  if (held <= 0) return 0;
  const deficit = target * held - attended;
  if (deficit <= EPS) return 0;
  return Math.ceil(deficit / (1 - target) - EPS);
}

/**
 * Fold the classes still on the timetable into the picture.
 *
 * `bestReachable` assumes perfect attendance from here. When that still falls
 * short of target, the target is arithmetically out of reach for the term and
 * the UI should say so instead of printing an encouraging recovery number the
 * student cannot actually act on.
 *
 * `skipsLeft` is the number that matters day to day: of the `remaining` classes
 * still scheduled, how many can be skipped and still land at target.
 *
 *   (attended + remaining - m) / (held + remaining) >= target
 *
 * @param {number} remaining classes still scheduled this term
 */
function projectTerm(attended, held, remaining, target = DEFAULT_TARGET) {
  assertTarget(target);
  const r = toCount(remaining);
  const finalHeld = held + r;
  if (finalHeld <= 0) {
    return { remaining: r, bestReachable: null, reachable: true, skipsLeft: 0 };
  }
  const bestReachable = (attended + r) / finalHeld;
  const skipsLeft = Math.min(
    r,
    Math.max(0, Math.floor(attended + r - target * finalHeld + EPS))
  );
  return {
    remaining: r,
    bestReachable,
    reachable: bestReachable >= target - EPS,
    skipsLeft,
  };
}

/**
 * The complete per-subject verdict the UI renders.
 *
 * `headline` names which number to lead with, so the panel does not have to
 * re-derive the subject's situation from the raw fields:
 *   'no-data'     — nothing held yet
 *   'unreachable' — target cannot be met even with perfect attendance
 *   'recover'     — below target, but still recoverable
 *   'skips'       — at or above target
 *
 * @param {Unit[]} units
 * @param {{ target?: number, remaining?: number|null }} [options]
 */
function summarize(units, { target = DEFAULT_TARGET, remaining = null } = {}) {
  assertTarget(target);
  const { attended, held } = combine(units);
  const pct = percentage(attended, held);
  const hasSchedule = remaining !== null && remaining !== undefined;
  const projection = hasSchedule
    ? projectTerm(attended, held, remaining, target)
    : null;

  const meetsTarget = pct !== null && pct >= target - EPS;
  let headline;
  if (pct === null) headline = 'no-data';
  else if (projection && !projection.reachable) headline = 'unreachable';
  else if (meetsTarget) headline = 'skips';
  else headline = 'recover';

  return {
    attended,
    held,
    percentage: pct,
    target,
    meetsTarget,
    headline,
    // Consecutive-miss budget, valid with or without schedule data.
    skipsAffordable: skipsAffordable(attended, held, target),
    classesToRecover: classesToRecover(attended, held, target),
    projection,
  };
}

// ---- src/lib/grouping.js -------------------------------------------
/**
 * Pairing a subject with its practical component.
 *
 * The portal lists theory and lab as separate courses — "ADA - B" alongside
 * "ADA Lab 2 - B" — so a combined attendance figure only exists once those are
 * recognised as one subject. This module does that purely from the course
 * names, with a user-supplied override map as the escape hatch.
 *
 * Different batches name the practical component differently ("Lab",
 * "Practical", "Tutorial", …), so the marker list is broad. Breadth alone would
 * be dangerous — a genuine standalone subject called "AI Studio" must not be
 * swallowed into a subject called "AI" — so stripping a marker is only allowed
 * when the resulting base actually matches another course in the same
 * semester. See `groupUnits`.
 *
 * Pure and dependency-free, so it runs under `node --test`.
 */

// "…  - B", "… – B2", "… - 1". The section token is alphanumeric, which is what
// stops a subject like "Data Structures - Advanced - B" from splitting on the
// first hyphen instead of the last.
const SECTION_RE = /^(.*?)\s*[-–—]\s*([A-Za-z0-9]+)\s*$/;

// Names for a subject's practical component, anchored to the end of the name so
// a subject that merely contains the word (e.g. "Lab Techniques") is not
// mistaken for one. An optional trailing number covers "Lab 2".
const PRACTICAL_RE =
  /^(.*?)\s*[-–—:]?\s*\b(Labs?|Practicals?|Pracs?|Tutorials?|Tuts?|Workshops?|Recitations?|Seminars?|Studios?|Discussions?)\b\s*(\d*)\s*$/i;

/**
 * @typedef {object} ParsedName
 * @property {string} base        subject with marker and section removed, e.g. "ADA"
 * @property {string} key         join key for `base`
 * @property {string} plainBase   subject with only the section removed, e.g. "ADA Lab 2"
 * @property {string} plainKey    join key for `plainBase`
 * @property {string|null} section
 * @property {boolean} isPractical whether a practical marker was found at the end
 * @property {string|null} marker  the marker word as written, e.g. "Lab"
 * @property {number|null} index   the marker's number, e.g. 2
 */

/**
 * Split a portal course name into subject, section and practical parts.
 *
 * "ADA Lab 2 - B" -> base "ADA",       plainBase "ADA Lab 2", isPractical true
 * "Maths III - B" -> base "Maths III", plainBase "Maths III", isPractical false
 *
 * Note this reports only what the *name* looks like. Whether the marker is
 * actually stripped is decided by `groupUnits`, which can see the other courses.
 *
 * @param {string} name
 * @returns {ParsedName}
 */
function parseCourseName(name) {
  const raw = String(name ?? '').trim();

  let plainBase = raw;
  let section = null;
  const sectionMatch = raw.match(SECTION_RE);
  if (sectionMatch) {
    plainBase = sectionMatch[1].trim();
    section = sectionMatch[2];
  }

  let base = plainBase;
  let isPractical = false;
  let marker = null;
  let index = null;
  const practicalMatch = plainBase.match(PRACTICAL_RE);
  // A name that is *only* a marker ("Lab 2 - B") has no subject to key on, so
  // leave it alone rather than collapsing it to an empty key.
  if (practicalMatch && practicalMatch[1].trim()) {
    base = practicalMatch[1].trim();
    isPractical = true;
    marker = practicalMatch[2];
    index = practicalMatch[3] ? Number(practicalMatch[3]) : null;
  }

  return {
    base,
    key: normalizeKey(base),
    plainBase,
    plainKey: normalizeKey(plainBase),
    section,
    isPractical,
    marker,
    index,
  };
}

/** Case- and whitespace-insensitive join key. */
function normalizeKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group portal courses into subjects.
 *
 * A practical marker is stripped only when doing so lands on something that
 * exists elsewhere in the same semester — either a course with that exact name
 * ("ADA - B" for "ADA Lab 2 - B"), or another practical that reduces to the
 * same base ("ADA Lab 1" and "ADA Lab 2" with no plain "ADA"). Anything else
 * keeps its full name and stands as its own subject, so a course that merely
 * ends in a marker-like word is never absorbed into an unrelated one.
 *
 * A subject with no practical component is simply a group of one.
 *
 * Overrides win over all of it, so a naming scheme this cannot infer can be
 * corrected by hand rather than silently producing a misleading percentage.
 *
 * @param {Array<{ name: string, courseHash?: string, held: number, attended: number }>} units
 * @param {Record<string, string>} [overrides] course name -> group key
 * @returns {Array<{ key: string, label: string, units: object[] }>} stable order: first appearance
 */
function groupUnits(units, overrides = {}) {
  const list = (units ?? []).filter((unit) => normalizeKey(unit?.name));
  const parsed = list.map((unit) => parseCourseName(unit.name));

  const normalizedOverrides = new Map(
    Object.entries(overrides ?? {}).map(([name, key]) => [
      normalizeKey(name),
      normalizeKey(key),
    ])
  );

  // What a stripped marker could legitimately attach to.
  const plainKeys = new Set(parsed.map((p) => p.plainKey));
  const strippedCounts = new Map();
  for (const p of parsed) {
    if (!p.isPractical) continue;
    strippedCounts.set(p.key, (strippedCounts.get(p.key) ?? 0) + 1);
  }

  const groups = new Map();

  list.forEach((unit, i) => {
    const p = parsed[i];
    const stripIsSafe =
      p.isPractical &&
      (plainKeys.has(p.key) || (strippedCounts.get(p.key) ?? 0) > 1);

    const override = normalizedOverrides.get(normalizeKey(unit.name));
    const key = override || (stripIsSafe ? p.key : p.plainKey);
    if (!key) return;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: stripIsSafe ? p.base : p.plainBase,
        units: [],
      });
    }
    const group = groups.get(key);
    // Prefer a non-practical course's name as the subject label — it is the one
    // without the "Lab 2" noise.
    if (!p.isPractical && p.plainBase) group.label = p.plainBase;
    group.units.push({ ...unit, parsed: p });
  });

  return [...groups.values()];
}

/**
 * Which component of a subject a unit is: "Lecture" for the theory course, or
 * the practical marker as the portal wrote it ("Lab", "Tutorial", …).
 * @param {{ parsed?: ParsedName }} unit
 */
function componentLabel(unit) {
  const parsed = unit?.parsed;
  if (!parsed) return 'Class';
  if (!parsed.isPractical) return 'Lecture';
  const word = parsed.marker || 'Lab';
  // Title-case the marker so "lab" and "LAB" both read as "Lab".
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// ---- src/lib/schedule.js -------------------------------------------
/**
 * How many classes a subject still has coming.
 *
 * The portal cannot answer this — its calendar only publishes about a week of
 * slots against a term that runs for months (see docs/portal-api.md). But a
 * student knows their own timetable: so many weeks, so many classes a week. That
 * is a fact they can state, not a number this extension should guess, which is
 * why nothing here estimates a cadence from observed attendance.
 *
 * With it, the panel can answer "how many of my remaining classes can I miss",
 * which is the question worth asking. Without it, the panel falls back to the
 * consecutive-miss figure, which needs no schedule and can never overstate.
 *
 * Pure and dependency-free, so it runs under `node --test`.
 */

/**
 * The term most students on this portal are actually on, offered as a starting
 * point rather than applied silently. Every surface that offers it states these
 * numbers in the control itself, so clicking it is the student confirming their
 * own timetable — not the extension guessing one. A wrong projection would cost
 * someone a class they could not afford, which is why nothing enables this for
 * them.
 */
const SCHEDULE_PRESET = Object.freeze({
  label: 'the standard NST term',
  weeks: 12,
  perWeek: 4,
});

const DEFAULT_SCHEDULE = Object.freeze({
  /** Off until the student fills in their own timetable. */
  enabled: false,
  weeks: SCHEDULE_PRESET.weeks,
  /** Classes per week for the whole subject — lectures and labs together. */
  perWeek: SCHEDULE_PRESET.perWeek,
  /** key -> { weeks?, perWeek? }, for subjects that run differently. */
  perSubject: {},
});

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Total classes this subject holds over the whole term, or null if unknown.
 * @param {string} key subject key, as produced by grouping
 */
function totalClasses(key, schedule = DEFAULT_SCHEDULE) {
  if (!schedule?.enabled) return null;
  const override = schedule.perSubject?.[key] ?? {};
  const weeks = positive(override.weeks) ?? positive(schedule.weeks);
  const perWeek = positive(override.perWeek) ?? positive(schedule.perWeek);
  if (weeks === null || perWeek === null) return null;
  return Math.round(weeks * perWeek);
}

/**
 * Classes still to come: the term total minus what has already been held.
 *
 * Returns null when the schedule is unknown, so callers can tell "no schedule"
 * apart from "no classes left" — they lead to different advice.
 *
 * Clamped at zero because a term can overrun its planned length; when it does,
 * "0 remaining" is the honest answer rather than a negative budget.
 *
 * @param {string} key subject key
 * @param {number} held classes already held for the subject
 */
function remainingClasses(key, held, schedule = DEFAULT_SCHEDULE) {
  const total = totalClasses(key, schedule);
  if (total === null) return null;
  return Math.max(0, total - Math.max(0, held));
}

/**
 * True when the term has already run past its configured length — a signal that
 * the numbers need updating rather than trusting.
 */
function scheduleOverrun(key, held, schedule = DEFAULT_SCHEDULE) {
  const total = totalClasses(key, schedule);
  return total !== null && held > total;
}

// ---- src/lib/storage.js --------------------------------------------
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


const SETTINGS_KEY = 'settings';
const CACHE_PREFIX = 'cache:';

/** How long the attendance numbers are trusted without asking the portal again.
 *  Long enough to make navigation feel instant, short enough that a class marked
 *  present this morning shows up the same day. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Past this, cached numbers are not shown at all. A week-old figure presented
 *  as current is worse than a blank card — it is what makes someone skip a class
 *  they could not afford. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The subject list and course→semester mapping change rarely; refetching them
 *  on every refresh was ~18% of all requests for data we already had. */
const STRUCTURE_TTL_MS = 12 * 60 * 60 * 1000;

/** Valid range for the attendance target, in percent. One owner; options.js
 *  imports these rather than restating them. */
const TARGET_BOUNDS = Object.freeze({ min: 1, max: 99 });

const DEFAULT_SETTINGS = Object.freeze({
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
  const store = __nstChrome?.storage?.[name];
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
function normalizeSettings(raw) {
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

async function getSettings() {
  const stored = await area('sync').get(SETTINGS_KEY);
  return normalizeSettings(stored?.[SETTINGS_KEY]);
}

async function saveSettings(patch) {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await area('sync').set({ [SETTINGS_KEY]: next });
  return next;
}

/** Target as the fraction the math module expects. */
function targetFraction(settings) {
  return settings.targetPercent / 100;
}

/**
 * Call back when settings change in another context — typically the options
 * page — so an open portal tab re-renders against the new target instead of
 * showing advice the student has just overridden. Returns an unsubscribe.
 */
function onSettingsChanged(handler) {
  const onChanged = __nstChrome?.storage?.onChanged;
  if (!onChanged) return () => {};
  const listener = (changes, areaName) => {
    if (areaName === 'sync' && SETTINGS_KEY in changes) handler();
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

// --- caches -----------------------------------------------------------------

const semesterCacheKey = (courseHash) => `semester:${courseHash}`;
const unitsCacheKey = (semesterHash) => `units:${semesterHash}`;
const subjectsCacheKey = (semesterHash) => `subjects:${semesterHash}`;

/**
 * Read one cache entry.
 * @returns {Promise<null | { ts: number, data: any, stale: boolean }>}
 *   null when absent or older than `maxAgeMs`; `stale` when older than `ttlMs`.
 */
async function readCache(key, { ttlMs = CACHE_TTL_MS, maxAgeMs = CACHE_MAX_AGE_MS } = {}) {
  const full = CACHE_PREFIX + key;
  const stored = await area('local').get(full);
  const entry = stored?.[full];
  if (!entry || typeof entry.ts !== 'number') return null;
  const age = Date.now() - entry.ts;
  if (age > maxAgeMs) return null;
  return { ...entry, stale: age > ttlMs };
}

async function writeCache(key, data) {
  await area('local').set({ [CACHE_PREFIX + key]: { ts: Date.now(), data } });
}

/**
 * The most recently cached *numbers*, whichever semester they came from.
 *
 * The popup has no page context of its own, so it cannot know which course the
 * student was last looking at — it just shows the freshest attendance the
 * content script has stored.
 */
async function readLatestCache() {
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
function onCacheChanged(handler) {
  const onChanged = __nstChrome?.storage?.onChanged;
  if (!onChanged) return () => {};
  const listener = (changes, areaName) => {
    if (areaName === 'local' && Object.keys(changes).some((k) => k.startsWith(CACHE_PREFIX))) {
      handler();
    }
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

async function clearCache() {
  const all = await area('local').get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await area('local').remove(keys);
}

// ---- src/lib/adapters/api-adapter.js -------------------------------
/**
 * Reads attendance out of the portal's own REST API.
 *
 * Endpoint shapes were captured from a live session; see docs/portal-api.md for
 * the observed payloads and the evidence that these are the right fields.
 *
 * The portal nests courses three deep — programme ("NST'25 CS+AI RU") contains
 * semesters ("S3'25 CS+AI RU"), which contain the subjects and labs that
 * actually hold classes. Attendance lives on the leaves, and the subject list
 * hangs off the semester, so everything starts by resolving whichever hash is
 * in the URL up to its semester.
 */

/** Course hashes are short lowercase alphanumerics; anything else is not one. */
const HASH_RE = /^[a-z0-9]{6,32}$/i;
function hashSegment(hash) {
  if (!HASH_RE.test(String(hash))) {
    throw new PortalError(`invalid course hash: ${String(hash).slice(0, 40)}`, { kind: 'shape' });
  }
  return encodeURIComponent(hash);
}

const PATHS = {
  // Works for any course hash and reports the semester ("ADMIN") course it
  // belongs to, so the panel works from a subject page as well as the semester
  // landing page.
  redirection: (hash) => `/api/v1/course/h/${hashSegment(hash)}/course_redirection_details/`,
  learningCourses: (hash) =>
    `/api/v2/course/h/${hashSegment(hash)}/learning_course/all/?pagination=false`,
  selfPerformance: (hash) => `/api/v2/course/h/${hashSegment(hash)}/self_performance/`,
  lectures: (hash) => `/api/v2/course/h/${hashSegment(hash)}/lecture/all/?pagination=false`,
};

/**
 * @typedef {'auth'|'network'|'shape'|'unknown'} PortalErrorKind
 */
class PortalError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, kind?: PortalErrorKind, cause?: unknown }} [options]
   */
  constructor(message, { status, kind, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PortalError';
    this.status = status;
    /** What the UI should say about it; see panel.js errorText. */
    this.kind = kind ?? (status === 401 || status === 403 ? 'auth' : 'unknown');
  }
}

/**
 * How hard the extension leans on the portal. Thousands of students loading
 * the semester page at nine o'clock is the case to design for: each load is a
 * handful of requests, so keep them few, polite, and quick to back off.
 */
const MAX_CONCURRENT = 4;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 15000;

/** A small semaphore so a semester of subjects doesn't fan out all at once. */
let inFlight = 0;
const waiting = [];
function acquire() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else inFlight -= 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter; honours Retry-After when present. */
function retryDelay(attempt, retryAfterHeader = null) {
  const hinted = Number(retryAfterHeader);
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(hinted * 1000, 30000);
  const cap = BASE_DELAY_MS * 2 ** attempt;
  return Math.floor(Math.random() * cap);
}

/**
 * Only relative paths under the portal's own API are allowed. The bearer token
 * read from localStorage rides on every request, so this is the guard that
 * makes it impossible for a bug elsewhere to send it to another host.
 */
function assertApiPath(path) {
  if (typeof path !== 'string' || !/^\/api\/v\d+\//.test(path)) {
    throw new PortalError(`refusing non-API path: ${String(path).slice(0, 80)}`, { kind: 'shape' });
  }
  return path;
}

/**
 * The portal authenticates API calls with a bearer token kept in the page's
 * localStorage. The session cookie alone is NOT enough — verified live: a
 * cookie-only request returns 401. A content script shares the page's origin,
 * so it can read the token; that read happens here and nowhere else, and the
 * value only ever leaves in an Authorization header on a same-origin /api/ path.
 *
 * A missing token is its own failure, distinct from an expired session: it
 * means the portal moved the key (or storage is blocked), and logging in again
 * will not fix it. Saying "session expired" there would send every student on a
 * pointless logout loop.
 */
function authHeaders() {
  let raw = null;
  try {
    raw = localStorage.getItem('auth-token');
  } catch (cause) {
    throw new PortalError('portal storage is not readable', { kind: 'shape', cause });
  }
  if (!raw) {
    throw new PortalError('no portal login token found', { kind: 'shape' });
  }
  // Stored JSON-quoted; accept the bare form too.
  let token = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') token = parsed;
  } catch {
    // Not JSON — use as-is.
  }
  return { Authorization: `Bearer ${token}` };
}

async function fetchOnce(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...authHeaders() },
      signal: controller.signal,
      // Same-origin only; the path guard already enforces it, this makes the
      // browser enforce it too.
      mode: 'same-origin',
      // A redirect from an API path means "go log in". Following it would hand
      // back the login page's HTML as a JSON parse error; failing it would look
      // like a network fault and be retried. Surface it as what it is.
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(path) {
  assertApiPath(path);
  await acquire();
  try {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetchOnce(path);
      } catch (cause) {
        lastError = new PortalError(`network error requesting ${path}`, { cause, kind: 'network' });
        if (attempt < MAX_ATTEMPTS - 1) await sleep(retryDelay(attempt));
        continue;
      }

      if (response.type === 'opaqueredirect' || response.status === 0) {
        throw new PortalError(`${path} redirected (session expired?)`, { status: 401, kind: 'auth' });
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new PortalError(`${path} did not return JSON`, { kind: 'shape' });
        }
      }

      lastError = new PortalError(`${path} returned ${response.status}`, { status: response.status });
      // Auth failures and client errors will not get better by retrying; server
      // trouble and rate limiting will, given a moment.
      if (!RETRY_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS - 1) break;
      await sleep(retryDelay(attempt, response.headers.get('Retry-After')));
    }
    throw lastError ?? new PortalError(`request failed: ${path}`);
  } finally {
    release();
  }
}

/**
 * Whether a URL is a course landing page — the only page with a "Your
 * performance" block for the card to sit under. Shared by the content script
 * (to decide whether to mount) and the popup (to pick a tab that can refresh).
 */
function isCourseDetailsUrl(href) {
  try {
    return /^\/course\/[^/]+\/details\/?$/.test(new URL(href, 'https://my.newtonschool.co').pathname);
  } catch {
    return false;
  }
}

/** Extract the course hash from a portal URL, or null if it isn't a course page. */
function courseHashFromUrl(href = location.href) {
  const hash = new URL(href, location.origin).pathname.match(/\/course\/([^/]+)/)?.[1] ?? null;
  return hash && HASH_RE.test(hash) ? hash : null;
}

/** Resolve any course hash to the semester that owns the subject list. */
async function resolveSemesterHash(courseHash) {
  const details = await getJson(PATHS.redirection(courseHash));
  // Falling back to the given hash covers a student already sitting on the
  // semester page, where the redirection payload points at itself.
  return details?.admin_course?.hash || courseHash;
}

/** The subjects and labs under a semester, in the portal's own sidebar order. */
async function listUnits(semesterHash) {
  const list = await getJson(PATHS.learningCourses(semesterHash));
  if (!Array.isArray(list)) {
    throw new PortalError('subject list was not an array', { kind: 'shape' });
  }
  return list
    .filter((course) => course?.hash)
    .map((course) => ({
      courseHash: course.hash,
      name: course.short_display_name || course.title || course.hash,
    }));
}

/**
 * Class counts for one subject or lab.
 *
 * Verified against the portal's own aggregate: summing these across a
 * semester's subjects reproduces the "Lecture 52/62" figure it shows on the
 * semester page exactly.
 */
async function fetchUnitStats(courseHash) {
  const performance = await getJson(PATHS.selfPerformance(courseHash));
  const held = performance?.total_lectures;
  const attended = performance?.total_lectures_attended;
  // Missing fields must fail loudly. Coercing them to 0 would render a
  // confident 0% — or a huge skip allowance — from data we never received.
  if (!Number.isFinite(held) || !Number.isFinite(attended)) {
    throw new PortalError(`attendance fields missing for ${courseHash}`, { kind: 'shape' });
  }
  return { held, attended };
}

/**
 * Every class held so far for one subject or lab, with whether it was attended.
 *
 * Cross-checked against self_performance on all nine courses of a live
 * semester: the number of lectures returned equals `total_lectures`, and the
 * count with `attended: true` equals `total_lectures_attended`. So this is the
 * same attendance the counts come from, itemised.
 *
 * @returns {Promise<Array<{ hash, title, start, attended, waived }>>} newest first
 */
async function fetchLectures(courseHash) {
  const list = await getJson(PATHS.lectures(courseHash));
  if (!Array.isArray(list)) {
    throw new PortalError(`lecture list for ${courseHash} was not an array`, { kind: 'shape' });
  }
  return list
    .filter((lecture) => lecture?.hash)
    .map((lecture) => ({
      hash: lecture.hash,
      title: lecture.title || null,
      start: lecture.start_timestamp || null,
      attended: lecture.attended === true,
      // Seen in the payload but never set on the account this was built against,
      // so its effect on the counts is unknown. Surfaced, not interpreted.
      waived: lecture.attendance_waived === true,
    }))
    .sort((a, b) => new Date(b.start ?? 0) - new Date(a.start ?? 0));
}

/** Class counts for every unit in a list, in the same order. */
async function fetchAllStats(units) {
  const stats = await Promise.all(units.map((unit) => fetchUnitStats(unit.courseHash)));
  return units.map((unit, i) => ({ ...unit, ...stats[i] }));
}

/**
 * Every subject and lab in the student's semester, with class counts, with no
 * caching of the structural lookups. portal.js layers the caches on top.
 * @param {string} courseHash any course hash from the current URL
 */
async function loadUnits(courseHash) {
  const semesterHash = await resolveSemesterHash(courseHash);
  return fetchAllStats(await listUnits(semesterHash));
}

// ---- src/lib/portal.js ---------------------------------------------
/**
 * Turns raw portal courses into the per-subject verdicts the panel renders.
 *
 * This is the seam between "what the portal knows" and "what the student wants
 * to know": fetch the units, pair each subject with its lab, and run the
 * attendance arithmetic over the combined counts.
 *
 * It also owns the caching of the *structure* — which semester a course belongs
 * to, and which subjects that semester has. Those change once a term; the
 * numbers change daily. Separating the two is what lets a refresh cost only the
 * per-subject stats requests, and lets a subject-page navigation cost nothing.
 */



/**
 * Which semester a course belongs to, cached for the term.
 * @param {string} courseHash
 * @param {{ force?: boolean }} [options] bypass the cache
 */
async function semesterFor(courseHash, { force = false } = {}) {
  const key = semesterCacheKey(courseHash);
  if (!force) {
    const cached = await readCache(key, { ttlMs: STRUCTURE_TTL_MS, maxAgeMs: STRUCTURE_TTL_MS });
    if (cached?.data) return cached.data;
  }
  const semesterHash = await resolveSemesterHash(courseHash);
  await writeCache(key, semesterHash);
  return semesterHash;
}

/**
 * The subject list for a semester, cached for the term.
 * @returns {Promise<Array<{ courseHash: string, name: string }>>}
 */
async function unitsFor(semesterHash, { force = false } = {}) {
  const key = unitsCacheKey(semesterHash);
  if (!force) {
    const cached = await readCache(key, { ttlMs: STRUCTURE_TTL_MS, maxAgeMs: STRUCTURE_TTL_MS });
    if (Array.isArray(cached?.data) && cached.data.length) return cached.data;
  }
  const units = await listUnits(semesterHash);
  await writeCache(key, units);
  return units;
}

/**
 * Every subject and lab in the student's semester, with current class counts.
 *
 * Only the per-unit stats always hit the network; the structure comes from
 * cache unless `force` is set (a manual Refresh), which also heals a semester
 * whose subject list changed mid-term.
 *
 * @param {string} courseHash any course hash from the current URL
 * @returns {Promise<{ semesterHash: string, units: object[] }>}
 */
async function loadUnits(courseHash, { force = false } = {}) {
  const semesterHash = await semesterFor(courseHash, { force });
  const list = await unitsFor(semesterHash, { force });
  return { semesterHash, units: await fetchAllStats(list) };
}

/**
 * Group and score units that have already been fetched.
 *
 * Kept separate from the fetch so cached units can be re-scored against the
 * current settings: a changed target must re-colour the card immediately,
 * and cached numbers must never be rendered against a stale target.
 *
 * @param {Array<{ courseHash: string, name: string, held: number, attended: number }>} units
 * @param {{ targetPercent: number, overrides: Record<string,string>, schedule: object }} settings
 * @returns {Array<{ key, label, units, summary, overrun: boolean }>}
 */
function rehydrate(units, settings) {
  const target = targetFraction(settings);
  return groupUnits(units, settings.overrides).map((group) => {
    const { held } = combine(group.units);
    // `remaining` comes from the student's own stated timetable, never from the
    // portal calendar — that only publishes about a week of slots against a
    // term of months. Null is meaningful: it makes summarize fall back to the
    // consecutive-miss figure, which needs no schedule and can never overstate.
    //
    // A schedule the term has already run past is treated the same way. Feeding
    // "0 remaining" into the projection would declare every below-target
    // subject mathematically lost while classes are still being held — the
    // confidently-wrong answer this whole design exists to avoid.
    const overrun = scheduleOverrun(group.key, held, settings.schedule);
    const remaining = overrun ? null : remainingClasses(group.key, held, settings.schedule);
    const projectable = remaining !== null && remaining > 0;
    return {
      ...group,
      overrun: overrun || (remaining === 0 && settings.schedule?.enabled === true),
      summary: summarize(group.units, { target, remaining: projectable ? remaining : null }),
    };
  });
}

/**
 * The classes a student did not attend, across every component of a subject.
 *
 * Fetched on demand rather than with the counts: it is one request per unit
 * and only matters when someone asks "which ones did I miss".
 *
 * @param {{ units: Array<{ courseHash, name, parsed }> }} subject
 * @returns {Promise<Array<{ hash, title, start, component, waived }>>} newest first
 */
async function loadMissed(subject) {
  const perUnit = await Promise.all(
    subject.units.map(async (unit) => {
      const lectures = await fetchLectures(unit.courseHash);
      const component = componentLabel(unit);
      return lectures
        .filter((lecture) => !lecture.attended)
        .map((lecture) => ({ ...lecture, component }));
    })
  );
  return perUnit.flat().sort((a, b) => new Date(b.start ?? 0) - new Date(a.start ?? 0));
}

// ---- src/content/panel.js ------------------------------------------
/**
 * The attendance card injected into the portal (and reused by the popup).
 *
 * Rendering is a pure function of state, and all styling lives inside a Shadow
 * DOM so the portal's CSS and this card's CSS cannot reach each other. The
 * portal is a Next.js app that re-renders aggressively; anything that leaked
 * styles either way would break on their next deploy.
 *
 * The sentence is the product. Each row leads with the subject and the one
 * instruction the student needs; the percentage sits beside it as evidence.
 *
 * Interaction is delegated: the card marks controls with `data-action` and the
 * host (mount.js or popup.js) supplies handlers. The card never fetches.
 */


/**
 * @typedef {object} PanelState
 * @property {'loading'|'ready'|'empty'|'error'} status
 * @property {Array<{ key: string, label: string, units: object[], summary: object, overrun?: boolean }>} [subjects]
 * @property {number} [targetPercent]
 * @property {number} [updatedAt]      epoch ms of the data being shown
 * @property {boolean} [stale]         data is older than the TTL
 * @property {boolean} [refreshing]    a refresh is in flight
 * @property {string} [error]
 * @property {'auth'|'network'|'shape'|'unknown'} [errorKind]
 * @property {{ kind: 'auth'|'network'|'shape'|'unknown', text?: string }} [notice]  a problem worth showing alongside good cached numbers
 * @property {boolean} [compact]       render for a narrow surface (the popup)
 * @property {boolean} [canExpand]     allow per-subject missed-class lists (needs a portal session)
 * @property {boolean} [canOpenSettings] show the Settings route in the header
 * @property {number} [skeletonCount]  rows to sketch while loading
 * @property {Set<string>} [expanded]  subject keys with the list open
 * @property {Record<string, { status: 'loading'|'ready'|'error', items?: object[], error?: string }>} [missed]
 */

/**
 * @typedef {object} PanelHandlers
 * @property {() => void} [onRefresh]
 * @property {(key: string) => void} [onToggleMissed]
 * @property {() => void} [onOpenSettings]
 */

/*
 * Tokens. Light values on :host; dark redefines the same names, so every rule
 * below is written once. Band colours are semantic only — green at or above
 * target, amber below but recoverable, red when the target is out of reach,
 * grey for no data — and each pair is checked against its surface at 4.5:1 for
 * text and 3:1 for graphics in both schemes.
 *
 * Type scale is a fixed rem ramp of four roles (12 / 14 / 16 / 20, ratio ≈1.2)
 * in one family, as Operate-mode product UI wants: stable, scannable, and it
 * follows the browser's font-size setting.
 */
const STYLES = `
:host {
  all: initial;
  display: block;

  --surface: #ffffff;
  --ink: #111318;
  --ink-2: #4b5563;      /* secondary text, 7.6:1 */
  --ink-3: #5f6672;      /* captions/meta, 5.7:1 */
  --hairline: #e5e7eb;
  --track: #e5e7eb;
  --tick: #6b7280;       /* target tick on the track, 3.0:1+ vs track */
  --focus: #2563eb;

  /* Light fills reuse the band text colours so the bar clears 3:1 on white. */
  --ok: #15803d;   --ok-fill: #15803d;
  --warn: #b45309; --warn-fill: #b45309;
  --bad: #b91c1c;  --bad-fill: #b91c1c;
  --none: #6b7280; --none-fill: #9ca3af;

  --notice-warn-bg: #fef3c7; --notice-warn-ink: #92400e;
  --notice-info-bg: #f3f4f6; --notice-info-ink: #374151;
  --err-bg: #fef2f2; --err-ink: #991b1b;
  --skeleton-a: #f3f4f6; --skeleton-b: #e9eaee;

  --t-meta: 0.75rem;   /* 12 */
  --t-body: 0.875rem;  /* 14 */
  --t-lead: 1rem;      /* 16 */
  --t-title: 1.25rem;  /* 20 */
  --t-figure: 1.25rem; /* 20 */
}
@media (prefers-color-scheme: dark) {
  :host {
    --surface: #17181a;
    --ink: #e8e8ea;
    --ink-2: #b4b8bf;    /* 9.2:1 */
    --ink-3: #a1a5ad;    /* 7.2:1 */
    --hairline: #2a2c30;
    --track: #2a2c30;
    --tick: #9ca3af;
    --focus: #60a5fa;

    --ok: #4ade80;   --ok-fill: #22c55e;
    --warn: #fbbf24; --warn-fill: #f59e0b;
    --bad: #f87171;  --bad-fill: #ef4444;
    --none: #a1a5ad; --none-fill: #4b5563;

    --notice-warn-bg: #2b2410; --notice-warn-ink: #fcd34d;
    --notice-info-bg: #1f2124; --notice-info-ink: #d4d4d8;
    --err-bg: #2a1416; --err-ink: #fca5a5;
    --skeleton-a: #1e2023; --skeleton-b: #26282c;
  }
}

* { box-sizing: border-box; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.card {
  font: var(--t-body)/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  padding: 20px 24px 14px;
  margin: 24px 0;
  font-variant-numeric: tabular-nums;
}
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; }
h2 { font-size: var(--t-title); font-weight: 700; margin: 0; letter-spacing: -0.01em; line-height: 1.25; }
.meta { display: flex; align-items: center; gap: 4px 14px; flex-wrap: wrap; }
.sub { color: var(--ink-3); font-size: var(--t-meta); margin: 2px 0 6px; }

/* Text-styled controls with a real hit area: ≥24px tall without disturbing the line. */
button.link {
  font: inherit; font-size: var(--t-meta); color: var(--ink-2); background: none; border: 0;
  padding: 6px 0; margin: -6px 0; min-height: 24px;
  cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  border-radius: 4px;
}
button.link:hover { color: var(--ink); text-decoration-color: currentColor; }
button.link[aria-busy="true"] { cursor: progress; color: var(--ink-3); text-decoration: none; }
button.link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.notice { display: flex; gap: 8px; align-items: baseline; font-size: var(--t-body); padding: 10px 14px; border-radius: 8px; margin: 10px 0 4px; }
.notice.auth, .notice.shape { background: var(--notice-warn-bg); color: var(--notice-warn-ink); }
.notice.network, .notice.unknown { background: var(--notice-info-bg); color: var(--notice-info-ink); }
.notice strong { font-weight: 700; }

.rows { display: block; margin-top: 6px; }

/* Rows are separated by hairlines, not boxed. Grid: name | figure, sentence | figure, meta, bar. */
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "name pct" "verdict pct" "meta meta" "bar bar" "hint hint" "list list";
  column-gap: 16px;
  padding: 14px 0 12px;
  border-top: 1px solid var(--hairline);
}
.row:first-child { border-top: 0; padding-top: 8px; }
.name { grid-area: name; font-size: var(--t-body); font-weight: 600; color: var(--ink-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
.verdict { grid-area: verdict; font-size: var(--t-lead); font-weight: 600; line-height: 1.35; margin-top: 2px; letter-spacing: -0.005em; }
.verdict strong { font-weight: 700; }
.verdict .rest { font-weight: 400; color: var(--ink); }
.pct { grid-area: pct; align-self: start; font-size: var(--t-figure); font-weight: 600; line-height: 1.3; text-align: right; padding-top: 1px; }
.meta-line { grid-area: meta; display: flex; align-items: baseline; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; margin-top: 6px; color: var(--ink-3); font-size: var(--t-meta); }
.counts { min-width: 0; }
.counts .sep { margin: 0 6px; color: var(--hairline); }
.bar { grid-area: bar; position: relative; height: 4px; border-radius: 2px; background: var(--track); margin-top: 8px; overflow: visible; }
.fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; }
.mark { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--tick); border-radius: 1px; }
.hintline { grid-area: hint; font-size: var(--t-meta); color: var(--notice-warn-ink); margin-top: 6px; }

.ok .verdict, .ok .pct { color: var(--ok); }     .ok .fill { background: var(--ok-fill); }
.warn .verdict, .warn .pct { color: var(--warn); } .warn .fill { background: var(--warn-fill); }
.bad .verdict, .bad .pct { color: var(--bad); }   .bad .fill { background: var(--bad-fill); }
.none .verdict, .none .pct { color: var(--none); } .none .fill { background: var(--none-fill); }

.missed { grid-area: list; margin: 8px 0 0; padding: 0; list-style: none; font-size: var(--t-meta); display: grid; gap: 4px; }
.missed li { display: grid; grid-template-columns: max-content max-content minmax(0, 1fr); gap: 8px; align-items: baseline; color: var(--ink-2); }
.missed .when { white-space: nowrap; }
.missed .what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); }
.missed .tag { font-size: 0.6875rem; color: var(--ink-3); border: 1px solid var(--hairline); border-radius: 999px; padding: 0 6px; white-space: nowrap; line-height: 1.5; }
.missed .tag + .tag { margin-left: 6px; }
.missed .muted { color: var(--ink-3); grid-column: 1 / -1; }
.missed.reveal { animation: reveal 180ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes reveal { from { opacity: 0; transform: translateY(-2px); } }

.note { margin: 12px 0 0; font-size: var(--t-meta); color: var(--ink-3); }
.err { border-color: color-mix(in srgb, var(--err-ink) 30%, var(--hairline)); background: var(--err-bg); color: var(--err-ink); }
.err h2, .err .sub, .err .note { color: var(--err-ink); }
.err .sub { opacity: 0.85; }

.skeleton { height: 58px; border-radius: 8px; margin: 10px 0; background: linear-gradient(90deg, var(--skeleton-a) 25%, var(--skeleton-b) 37%, var(--skeleton-a) 63%); background-size: 400% 100%; animation: sh 1.2s ease infinite; }
@keyframes sh { 0% { background-position: 100% 50% } 100% { background-position: 0 50% } }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { display: inline-block; width: 10px; height: 10px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -1px; margin-right: 5px; }

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; background: var(--skeleton-a); }
  .spin { animation: none; border-right-color: currentColor; opacity: 0.6; }
  .missed.reveal { animation: none; }
}

/* Compact mode — the 360px toolbar popup, where the card is the whole window
   rather than a block inside a wide page. It owns all of the popup's spacing;
   popup.html adds none of its own. */
.card.compact { margin: 0; padding: 14px 16px 8px; border: 0; border-radius: 0; }
.card.compact h2 { font-size: 1.0625rem; }
.card.compact .verdict { font-size: var(--t-body); }
.card.compact .pct { font-size: 1.0625rem; }
.card.compact .row { padding: 12px 0 10px; }
`;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/** Which colour band a subject falls in. */
function tone(summary) {
  if (summary.headline === 'no-data') return 'none';
  if (summary.headline === 'unreachable') return 'bad';
  return summary.meetsTarget ? 'ok' : 'warn';
}

/**
 * The single definition of "this subject needs attention". The card's ordering,
 * its footer count and the toolbar badge all read this, so they cannot drift.
 */
function isAtRisk(summary) {
  const band = tone(summary);
  return band === 'warn' || band === 'bad';
}

/**
 * Subjects that need attention first; everything else in the portal's own
 * order. A stable partition rather than a sort by percentage, so a student
 * comparing the card against the sidebar still finds things where they expect.
 */
function orderSubjects(subjects) {
  const list = subjects ?? [];
  const atRisk = list.filter((s) => isAtRisk(s.summary));
  const rest = list.filter((s) => !isAtRisk(s.summary));
  return [...atRisk, ...rest];
}

/**
 * Where the schedule controls live, which differs by surface: the extension has
 * a Settings page, the phone sheet puts them directly under the list. Copy that
 * points somewhere the reader cannot go is worse than no pointer at all.
 */
let settingsWhere = 'in Settings';

/** @param {string} where e.g. 'in Settings' or 'below' */
function setSettingsWhere(where) {
  settingsWhere = where;
}

/**
 * A recovery streak longer than this is arithmetic, not a plan. Without a
 * schedule the card cannot know whether that many classes are even left, so it
 * says so instead of presenting the number as an instruction.
 */
const PLAUSIBLE_STREAK = 10;

/**
 * The one sentence that answers "so what do I do".
 *
 * Returns HTML: the instruction in <strong>, the qualifier in <span class="rest">.
 * When schedule data is available the term budget is the useful number — "3 of
 * your 12 remaining classes" is actionable in a way that an open-ended skip
 * count is not — so it leads, and the consecutive-miss figure is dropped rather
 * than shown alongside it to compete for attention.
 */
function verdictText(summary) {
  const targetLabel = `${+(summary.target * 100).toFixed(2)}%`;
  // A projection over zero remaining classes has nothing to say; portal.js
  // already withholds it, but never let "Attend all 0 remaining classes" render.
  const projection = summary.projection && summary.projection.remaining > 0 ? summary.projection : null;
  const rest = (text) => `<span class="rest">${text}</span>`;

  switch (summary.headline) {
    case 'no-data':
      return projection
        ? `<strong>No classes yet.</strong> ${rest(`${projection.remaining} to come — you can miss ${projection.skipsLeft} of them.`)}`
        : `<strong>No classes held yet.</strong>`;

    case 'unreachable': {
      if (!projection) {
        return `<strong>Below ${targetLabel}.</strong> ${rest(`Add your term schedule ${settingsWhere} to see whether it is still reachable.`)}`;
      }
      const best = `${(projection.bestReachable * 100).toFixed(1)}%`;
      return `<strong>${targetLabel} is out of reach this term.</strong> ${rest(
        `Attending every remaining class lands at ${best}. Attend what is left to limit the shortfall, and ask your coordinator what your options are.`
      )}`;
    }

    case 'recover': {
      const need = summary.classesToRecover;
      if (projection) {
        // Below target but the term can still carry them: the budget over the
        // remaining classes is more useful than an unbroken attendance streak,
        // and it already accounts for climbing back up.
        if (projection.skipsLeft === 0) {
          return `<strong>Attend all ${plural(projection.remaining, 'remaining class', 'remaining classes')}</strong> ${rest(`to finish at ${targetLabel}.`)}`;
        }
        return `<strong>Miss at most ${projection.skipsLeft} of your ${projection.remaining} remaining classes.</strong> ${rest(
          `You cross ${targetLabel} after ${plural(need, 'class', 'classes')} in a row.`
        )}`;
      }
      if (need > PLAUSIBLE_STREAK) {
        return `<strong>Attend every class from here.</strong> ${rest(
          `Whether ${targetLabel} is still reachable depends on how many classes are left — add your term schedule ${settingsWhere} to find out.`
        )}`;
      }
      return `<strong>Attend the next ${plural(need, 'class', 'classes')} in a row</strong> ${rest(`to reach ${targetLabel}.`)}`;
    }

    case 'skips':
    default: {
      if (projection) {
        return projection.skipsLeft === 0
          ? `<strong>Attend all ${plural(projection.remaining, 'remaining class', 'remaining classes')}</strong> ${rest(`to stay at ${targetLabel}.`)}`
          : `<strong>Can skip ${projection.skipsLeft} of your ${plural(projection.remaining, 'remaining class', 'remaining classes')}.</strong>`;
      }
      return summary.skipsAffordable === 0
        ? `<strong>No room to skip</strong> ${rest(`— you are exactly at ${targetLabel}.`)}`
        : `<strong>Can skip ${plural(summary.skipsAffordable, 'more class', 'more classes')}</strong> ${rest(`and stay above ${targetLabel}.`)}`;
    }
  }
}

/** "Lecture 8/8 · Lab 6/7 attended", or "8/8 classes attended" for a single component. */
function countsText(subject) {
  const s = subject.summary;
  if (subject.units.length <= 1) return `${s.attended}/${s.held} classes attended`;
  return (
    subject.units
      .map((u) => `${escapeHtml(componentLabel(u))} ${Number(u.attended) || 0}/${Number(u.held) || 0}`)
      .join('<span class="sep">·</span>') + ' attended'
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function listId(key) {
  return `missed-${String(key).replace(/[^a-z0-9]+/gi, '-')}`;
}

function renderMissedList(state, subject, justOpened) {
  const entry = state.missed?.[subject.key];
  const cls = `missed${justOpened ? ' reveal' : ''}`;
  const id = listId(subject.key);
  if (!entry || entry.status === 'loading') {
    return `<ul class="${cls}" id="${id}" aria-busy="true"><li class="muted"><span class="spin" aria-hidden="true"></span>Loading missed classes…</li></ul>`;
  }
  if (entry.status === 'error') {
    return `<ul class="${cls}" id="${id}"><li class="muted">Couldn't load the list${
      entry.error ? ` (${escapeHtml(entry.error)})` : ''
    }.</li></ul>`;
  }
  if (!entry.items?.length) {
    return `<ul class="${cls}" id="${id}"><li class="muted">No missed classes recorded.</li></ul>`;
  }
  return `<ul class="${cls}" id="${id}">${entry.items
    .map(
      (m) => `<li>
        <span class="when">${escapeHtml(formatDate(m.start))}</span>
        <span class="tag">${escapeHtml(m.component)}</span>
        <span class="what" title="${escapeHtml(m.title ?? '')}">${m.title ? escapeHtml(m.title) : ''}${
          m.waived ? '<span class="tag">waived</span>' : ''
        }</span>
      </li>`
    )
    .join('')}</ul>`;
}

function renderRow(state, subject, opened) {
  const s = subject.summary;
  const pct = s.percentage === null ? null : s.percentage * 100;
  const width = Math.max(0, Math.min(100, pct ?? 0));
  const markAt = Math.max(0, Math.min(100, s.target * 100));
  const missedCount = Math.max(0, s.held - s.attended);
  const expanded = state.expanded?.has?.(subject.key) === true;
  const band = tone(s);

  let missedControl = '';
  if (s.held > 0) {
    if (missedCount === 0) {
      missedControl = `<span>No classes missed</span>`;
    } else if (state.canExpand) {
      missedControl = `<button class="link" type="button" data-action="missed" data-key="${escapeHtml(subject.key)}" aria-expanded="${expanded}" aria-controls="${listId(subject.key)}">${
        expanded ? 'Hide' : 'Show'
      } ${plural(missedCount, 'missed class', 'missed classes')}</button>`;
    } else {
      missedControl = `<span>${plural(missedCount, 'missed class', 'missed classes')}</span>`;
    }
  }

  // The bar only earns its place where the gap between the fill and the target
  // tick carries information a student acts on.
  const bar = isAtRisk(s)
    ? `<div class="bar" aria-hidden="true"><div class="fill" style="width:${width}%"></div><div class="mark" style="left:${markAt}%"></div></div>`
    : '';

  const overrunLine = subject.overrun
    ? `<div class="hintline">Your term schedule says this subject has ended, but classes are still running — fix it ${settingsWhere}.</div>`
    : '';

  return `
    <div class="row ${band}" data-key="${escapeHtml(subject.key)}">
      <div class="name" title="${escapeHtml(subject.units.map((u) => u.name).join(' + '))}">${escapeHtml(subject.label)}</div>
      <div class="pct" aria-label="${pct === null ? 'no attendance yet' : pct.toFixed(1) + ' percent attendance'}">${pct === null ? '—' : pct.toFixed(1) + '%'}</div>
      <p class="verdict">${verdictText(s)}</p>
      <div class="meta-line"><span class="counts">${countsText(subject)}</span>${missedControl}</div>
      ${bar}
      ${overrunLine}
      ${expanded ? renderMissedList(state, subject, opened === subject.key) : ''}
    </div>`;
}

/** Copy for each kind of problem. Shared by the full error card and the notice strip. */
function problemText(kind, detail) {
  switch (kind) {
    case 'auth':
      return 'Your portal session has expired. Log in to the portal again and this will pick up on its own.';
    case 'network':
      return "Couldn't reach the portal. Check your connection and try Refresh.";
    case 'shape':
      return "The portal's data doesn't look like it used to, so no numbers are shown rather than wrong ones. Check the Chrome Web Store for an update to this extension.";
    default:
      return `Couldn't read your attendance from the portal${
        detail ? ` (${escapeHtml(detail)})` : ''
      }. Try Refresh; if it keeps happening the portal has probably changed.`;
  }
}

function renderNotice(state) {
  if (!state.notice) return '';
  const kind = state.notice.kind ?? 'unknown';
  const lead = kind === 'shape' ? 'Heads up.' : 'Showing saved numbers.';
  return `<div class="notice ${escapeHtml(kind)}" role="status"><strong>${lead}</strong> <span>${
    state.notice.text ? escapeHtml(state.notice.text) : problemText(kind)
  }</span></div>`;
}

function renderBody(state, opened) {
  if (state.status === 'loading') {
    const n = Math.max(1, Math.min(8, state.skeletonCount ?? 3));
    return `<div class="rows" role="status" aria-busy="true"><span class="sr-only">Loading attendance…</span>${'<div class="skeleton" aria-hidden="true"></div>'.repeat(n)}</div>`;
  }

  if (state.status === 'empty') {
    return `<p class="note">Nothing to show yet. Open any course page on the portal and the card there will load your attendance; this popup then shows the same numbers.</p>`;
  }

  if (state.status === 'error') {
    // Deliberately shows nothing numeric. A wrong attendance figure would make
    // someone skip a class they cannot afford, so no data beats guessed data.
    return `<p class="note">${problemText(state.errorKind, state.error)}</p>`;
  }

  if (!state.subjects?.length) {
    return '<p class="note">No subjects found on this page.</p>';
  }

  return `${renderNotice(state)}<div class="rows">${orderSubjects(state.subjects)
    .map((s) => renderRow(state, s, opened))
    .join('')}</div>`;
}

function footer(state) {
  if (state.status !== 'ready') return '';
  const subjects = state.subjects ?? [];
  const bits = [];
  if (state.updatedAt) {
    bits.push(
      `Updated ${new Date(state.updatedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`
    );
  }
  if (state.refreshing) bits.push('refreshing…');
  else if (state.stale) bits.push('may be a few minutes old');

  const anyHeld = subjects.some((s) => s.summary.held > 0);
  const atRisk = subjects.filter((s) => isAtRisk(s.summary)).length;
  if (!anyHeld) bits.push('No classes held yet.');
  else if (atRisk) bits.push(`${plural(atRisk, 'subject needs', 'subjects need')} attention, listed first.`);
  else bits.push('Every subject is on target.');
  return `<p class="note">${escapeHtml(bits.join(' · '))}</p>`;
}

function headerControls(state) {
  const target = state.targetPercent ?? 75;
  const busy = Boolean(state.refreshing);
  const settings = state.canOpenSettings
    ? `<button class="link" type="button" data-action="settings" title="Your attendance target and term schedule">Target ${target}% · Settings</button>`
    : `<span class="sub" style="margin:0">Target ${target}%</span>`;
  // Kept enabled while busy so keyboard focus is not thrown away; the host
  // ignores clicks during a refresh and aria-busy carries the state.
  const refresh = `<button class="link" type="button" data-action="refresh" aria-busy="${busy}">${
    busy ? '<span class="spin" aria-hidden="true"></span>Refreshing…' : 'Refresh'
  }</button>`;
  return `${settings}${refresh}`;
}

function ensureStyles(root) {
  if (!root.querySelector('style[data-nst]')) {
    const style = document.createElement('style');
    style.dataset.nst = '';
    style.textContent = STYLES;
    root.prepend(style);
  }
}

let headingSeq = 0;

/**
 * Render (or re-render) the card into a shadow root and bind its controls.
 *
 * Only the card element is replaced; the stylesheet is attached once so a
 * re-render does not force a style re-parse. Focus on a control survives the
 * re-render, so toggling a list from the keyboard does not lose your place.
 *
 * @param {ShadowRoot} root
 * @param {PanelState} state
 * @param {PanelHandlers} [handlers]
 */
function renderPanel(root, state, handlers = {}) {
  ensureStyles(root);

  const focused = root.activeElement;
  const focusKey = focused?.dataset?.action
    ? `${focused.dataset.action}:${focused.dataset.key ?? ''}`
    : null;
  const opened = root.__nstJustOpened ?? null;
  root.__nstJustOpened = null;

  const existing = root.querySelector('section.card');
  const headingId = existing?.querySelector('h2')?.id || `nst-heading-${++headingSeq}`;

  const section = document.createElement('section');
  section.className = `card ${state.compact ? 'compact' : ''} ${state.status === 'error' ? 'err' : ''}`.trim();
  section.setAttribute('aria-labelledby', headingId);
  section.innerHTML = `
      <div class="head">
        <h2 id="${headingId}">Subject attendance</h2>
        <span class="meta">${headerControls(state)}</span>
      </div>
      <p class="sub">Lectures and labs counted together, per subject.</p>
      ${renderBody(state, opened)}
      ${footer(state)}`;

  if (existing) existing.replaceWith(section);
  else root.append(section);

  section.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    if (state.refreshing) return;
    handlers.onRefresh?.();
  });
  section.querySelector('[data-action="settings"]')?.addEventListener('click', () => {
    handlers.onOpenSettings?.();
  });
  for (const btn of section.querySelectorAll('[data-action="missed"]')) {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') !== 'true') root.__nstJustOpened = btn.dataset.key;
      handlers.onToggleMissed?.(btn.dataset.key);
    });
  }

  if (focusKey) {
    const [action, key] = focusKey.split(':');
    const again = key
      ? section.querySelector(`[data-action="${action}"][data-key="${CSS.escape(key)}"]`)
      : section.querySelector(`[data-action="${action}"]`);
    again?.focus({ preventScroll: true });
  }
}

/** Create the host element and its shadow root, ready for renderPanel. */
function createPanelHost(id = 'nst-attendance-panel') {
  const host = document.createElement('div');
  host.id = id;
  const root = host.attachShadow({ mode: 'open' });
  ensureStyles(root);
  return { host, root };
}

// ---- mobile/storage-page.js ----------------------------------------
/**
 * Settings for the mobile bookmarklet.
 *
 * The extension keeps settings in chrome.storage, which does not exist on a
 * page and cannot be reached from a phone. These live in the portal page's own
 * localStorage instead, under one namespaced key, and are therefore separate
 * from the desktop extension's settings — there is no server to sync them
 * through, and adding one would mean shipping attendance data off the device.
 *
 * Synchronous, because localStorage is, and the sheet re-renders on every edit.
 */

const MOBILE_SETTINGS_KEY = 'nst-attendance:settings';

function getSettingsSync() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(MOBILE_SETTINGS_KEY) ?? 'null');
  } catch {
    // Corrupt or blocked storage falls back to defaults rather than breaking.
  }
  return normalizeSettings(raw);
}

function saveSettingsSync(patch) {
  const next = normalizeSettings({ ...getSettingsSync(), ...patch });
  try {
    localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the sheet still works for this session.
  }
  return next;
}

// ---- mobile/sheet.js -----------------------------------------------
/**
 * The mobile entry point.
 *
 * Runs as a bookmarklet on a my.newtonschool.co page, which is the only way to
 * read attendance on a phone: Chrome has no extensions on Android or iOS, and
 * the portal sends no CORS headers, so nothing hosted on another origin can
 * call its API. Running on the portal's own page means the session already in
 * the browser is the session used — nothing is pasted, nothing is proxied.
 *
 * Everything above this file is the extension's own code, bundled unchanged, so
 * the phone and the desktop card can never disagree about a number.
 */

(function mountSheet() {
  const HOST_ID = 'nst-mobile-sheet';
  // There is no Settings page on a phone; the controls sit under the list.
  setSettingsWhere('below');
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    // Running the bookmarklet again closes it, so the same tap toggles.
    existing.remove();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);

  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="scrim" data-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Subject attendance">
      <header class="grip">
        <span class="handle" aria-hidden="true"></span>
        <button class="x" type="button" data-close aria-label="Close">Done</button>
      </header>
      <div class="body"><div class="panel"></div><div class="prefs"></div></div>
    </section>`;

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .shell { position: fixed; inset: 0; z-index: 2147483647;
      font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .scrim { position: absolute; inset: 0; background: rgba(0,0,0,.45); animation: fade .2s ease; }
    .sheet {
      position: absolute; left: 0; right: 0; bottom: 0;
      max-width: 560px; margin: 0 auto;
      max-height: 88vh; display: flex; flex-direction: column;
      background: #fff; color: #111318;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -8px 40px rgba(0,0,0,.3);
      padding-bottom: env(safe-area-inset-bottom, 0);
      animation: rise .26s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .grip { display: flex; align-items: center; justify-content: center; position: relative;
      padding: 10px 12px 4px; flex: 0 0 auto; }
    .handle { width: 36px; height: 4px; border-radius: 2px; background: #d4d7dd; }
    .x { position: absolute; right: 10px; top: 6px; min-height: 36px; padding: 6px 12px;
      font: inherit; font-size: .875rem; font-weight: 600; color: #4b5563;
      background: none; border: 0; border-radius: 8px; cursor: pointer; }
    .x:active { background: #eef0f3; }
    .body { overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    .prefs { padding: 0 16px 18px; }
    @keyframes rise { from { transform: translateY(100%); } }
    @keyframes fade { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .sheet, .scrim { animation: none; } }
    @media (prefers-color-scheme: dark) {
      .sheet { background: #17181a; color: #e8e8ea; }
      .handle { background: #3a3d42; }
      .x { color: #b4b8bf; } .x:active { background: #26282c; }
    }`;
  root.append(style, shell);

  const close = () => host.remove();
  for (const el of shell.querySelectorAll('[data-close]')) el.addEventListener('click', close);
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);

  const panelSlot = shell.querySelector('.panel');
  const prefsSlot = shell.querySelector('.prefs');
  const { host: cardHost, root: cardRoot } = createPanelHost('nst-mobile-card');
  panelSlot.append(cardHost);

  // --- state ---------------------------------------------------------------

  let settings = getSettingsSync();
  let units = null;
  let updatedAt = null;
  let refreshing = false;
  let notice = null;
  const expanded = new Set();
  const missed = {};

  function subjects() {
    return units ? rehydrate(units, settings) : null;
  }

  function paint(extra = {}) {
    const list = subjects();
    const base = {
      compact: true,
      targetPercent: settings.targetPercent,
      canExpand: true,
      canOpenSettings: false,
      expanded,
      missed,
      refreshing,
      notice,
      skeletonCount: 4,
    };
    renderPanel(
      cardRoot,
      list
        ? { ...base, status: 'ready', subjects: list, updatedAt, stale: false, ...extra }
        : { ...base, status: 'loading', ...extra },
      handlers
    );
    renderPrefs();
  }

  const handlers = {
    onRefresh: () => load({ force: true }),
    onToggleMissed: async (key) => {
      if (expanded.has(key)) { expanded.delete(key); paint(); return; }
      expanded.add(key);
      const subject = subjects()?.find((s) => s.key === key);
      if (!subject) return;
      if (!missed[key] || missed[key].status === 'error') {
        missed[key] = { status: 'loading' };
        paint();
        try {
          missed[key] = { status: 'ready', items: await loadMissed(subject) };
        } catch (error) {
          missed[key] = { status: 'error', error: error?.message };
        }
      }
      paint();
    },
  };

  // --- preferences ---------------------------------------------------------

  /**
   * A phone has no chrome.storage and no way to see the desktop extension's
   * settings, so these live in the portal page's own localStorage and are
   * separate from the extension's. Kept to the two things that change a number:
   * the target, and the term schedule.
   */
  function renderPrefs() {
    const sched = settings.schedule;
    const rows = (subjects() ?? []).map((s) => {
      const per = sched.perSubject?.[s.key] ?? {};
      const total = totalClasses(s.key, { ...sched, enabled: true });
      const held = s.summary.held;
      return `<tr data-key="${escapeAttr(s.key)}">
        <th scope="row">${escapeAttr(s.label)}</th>
        <td><input class="wk" type="number" min="1" inputmode="numeric" placeholder="${sched.weeks}" value="${per.weeks ?? ''}" aria-label="Weeks for ${escapeAttr(s.label)}"></td>
        <td><input class="pw" type="number" min="1" inputmode="numeric" placeholder="${sched.perWeek}" value="${per.perWeek ?? ''}" aria-label="Classes per week for ${escapeAttr(s.label)}"></td>
        <td class="tot">${total === null ? '—' : `${total} total · ${held} held`}</td>
      </tr>`;
    }).join('');

    prefsSlot.innerHTML = `
      <style>
        .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding: 12px 0; border-top: 1px solid #e5e7eb; font-size: .875rem; }
        label { display: flex; align-items: center; gap: 8px; min-height: 32px; }
        input[type=number] { width: 100%; max-width: 68px; min-width: 0; min-height: 32px; padding: 5px 8px;
          font: inherit; border: 1px solid #8a8f98; border-radius: 8px; background: transparent; color: inherit; }
        input[type=checkbox] { width: 20px; height: 20px; }
        details { border-top: 1px solid #e5e7eb; padding: 10px 0 0; font-size: .875rem; }
        summary { min-height: 32px; padding: 4px 0; cursor: pointer; }
        table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 8px; }
        th, td { text-align: left; padding: 4px 6px 4px 0; font-weight: 400;
          overflow: hidden; text-overflow: ellipsis; }
        th[scope=row] { font-weight: 600; }
        thead th { font-size: .75rem; color: #5f6672; }
        .tot { font-size: .75rem; color: #5f6672; }
        .note { margin: 10px 0 0; font-size: .75rem; color: #5f6672; }
        .preset { width: 100%; min-height: 44px; margin: 10px 0 0; padding: 10px 14px;
          font: inherit; font-weight: 600; border: 1px solid #111318; border-radius: 10px;
          background: #111318; color: #fff; cursor: pointer; }
        @media (prefers-color-scheme: dark) {
          .row, details { border-color: #2a2c30; }
          input[type=number] { border-color: #6b7280; }
          thead th, .tot, .note { color: #a1a5ad; }
          .preset { background: #e8e8ea; color: #17181a; border-color: #e8e8ea; }
        }
      </style>
      <div class="row">
        <label>Target
          <input id="t" type="number" min="1" max="99" inputmode="numeric" value="${settings.targetPercent}" aria-label="Attendance target percentage">%
        </label>
        <label><input id="se" type="checkbox" ${sched.enabled ? 'checked' : ''}> I know my term schedule</label>
      </div>
      ${sched.enabled ? '' : `
      <button class="preset" id="sx" type="button">Use ${SCHEDULE_PRESET.weeks} weeks &times; ${SCHEDULE_PRESET.perWeek} classes a week</button>
      <p class="note">That is ${SCHEDULE_PRESET.label}. Tap it to see how many of your remaining classes you can miss, then adjust anything that does not match your timetable.</p>`}
      ${sched.enabled ? `
      <details${rows ? '' : ' hidden'}>
        <summary>Term schedule — ${sched.weeks} weeks × ${sched.perWeek} classes/week by default</summary>
        <div class="row" style="border:0;padding-top:8px">
          <label>Weeks <input id="sw" type="number" min="1" inputmode="numeric" value="${sched.weeks}" aria-label="Weeks in term"></label>
          <label>× <input id="sp" type="number" min="1" inputmode="numeric" value="${sched.perWeek}" aria-label="Classes per week"></label>
        </div>
        <table>
          <thead><tr><th scope="col">Subject</th><th scope="col">Weeks</th><th scope="col">/week</th><th scope="col">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="note">Leave a row blank to use the defaults. These settings are saved on this phone only.</p>
      </details>` : ''}`;

    const num = (el) => {
      const v = Number(el.value);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    prefsSlot.querySelector('#t').addEventListener('change', (e) => {
      save({ targetPercent: num(e.target) ?? DEFAULT_SETTINGS.targetPercent });
    });
    prefsSlot.querySelector('#se').addEventListener('change', (e) => {
      save({ schedule: { ...settings.schedule, enabled: e.target.checked } });
    });
    prefsSlot.querySelector('#sx')?.addEventListener('click', () => {
      save({
        schedule: {
          ...settings.schedule,
          enabled: true,
          weeks: SCHEDULE_PRESET.weeks,
          perWeek: SCHEDULE_PRESET.perWeek,
        },
      });
    });
    prefsSlot.querySelector('#sw')?.addEventListener('change', (e) => {
      save({ schedule: { ...settings.schedule, weeks: num(e.target) ?? 12 } });
    });
    prefsSlot.querySelector('#sp')?.addEventListener('change', (e) => {
      save({ schedule: { ...settings.schedule, perWeek: num(e.target) ?? 4 } });
    });
    for (const tr of prefsSlot.querySelectorAll('tbody tr')) {
      for (const [cls, field] of [['.wk', 'weeks'], ['.pw', 'perWeek']]) {
        tr.querySelector(cls).addEventListener('change', (e) => {
          const perSubject = { ...settings.schedule.perSubject };
          const entry = { ...(perSubject[tr.dataset.key] ?? {}) };
          const v = num(e.target);
          if (v === null) delete entry[field];
          else entry[field] = v;
          if (Object.keys(entry).length) perSubject[tr.dataset.key] = entry;
          else delete perSubject[tr.dataset.key];
          save({ schedule: { ...settings.schedule, perSubject } });
        });
      }
    }
  }

  function save(patch) {
    settings = saveSettingsSync(patch);
    paint();
  }

  function escapeAttr(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // --- data ----------------------------------------------------------------

  async function load({ force = false } = {}) {
    // Screenshot and layout harness only. The bundle refuses to run anywhere
    // but the portal and localhost, so this is unreachable on a real page.
    if (__nstDev && globalThis.__NST_MOBILE_FIXTURE) {
      units = globalThis.__NST_MOBILE_FIXTURE;
      updatedAt = Date.now();
      refreshing = false;
      paint();
      return;
    }
    const courseHash = courseHashFromUrl();
    if (!courseHash) {
      renderPanel(cardRoot, {
        status: 'error', compact: true, errorKind: 'shape',
        error: 'open a course page first', targetPercent: settings.targetPercent,
      }, handlers);
      return;
    }
    refreshing = Boolean(units);
    paint();
    try {
      const result = await loadUnits(courseHash, { force });
      units = result.units;
      updatedAt = Date.now();
      notice = null;
      Object.keys(missed).forEach((k) => delete missed[k]);
    } catch (error) {
      const kind = error?.kind ?? 'unknown';
      if (units) notice = { kind, text: kind === 'unknown' ? error?.message : undefined };
      else {
        refreshing = false;
        renderPanel(cardRoot, {
          status: 'error', compact: true, errorKind: kind,
          error: error?.message, targetPercent: settings.targetPercent,
        }, handlers);
        renderPrefs();
        return;
      }
    }
    refreshing = false;
    paint();
  }

  paint();
  load();
})();

})();
