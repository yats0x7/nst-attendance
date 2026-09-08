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

export const DEFAULT_SCHEDULE = Object.freeze({
  /** Off until the student fills in their own timetable. */
  enabled: false,
  weeks: 12,
  /** Classes per week for the whole subject — lectures and labs together. */
  perWeek: 4,
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
export function totalClasses(key, schedule = DEFAULT_SCHEDULE) {
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
export function remainingClasses(key, held, schedule = DEFAULT_SCHEDULE) {
  const total = totalClasses(key, schedule);
  if (total === null) return null;
  return Math.max(0, total - Math.max(0, held));
}

/**
 * True when the term has already run past its configured length — a signal that
 * the numbers need updating rather than trusting.
 */
export function scheduleOverrun(key, held, schedule = DEFAULT_SCHEDULE) {
  const total = totalClasses(key, schedule);
  return total !== null && held > total;
}
