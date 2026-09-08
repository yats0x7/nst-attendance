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

import {
  courseHashFromUrl,
  isCourseDetailsUrl,
  resolveSemesterHash,
  listUnits,
  fetchAllStats,
  fetchLectures,
} from './adapters/api-adapter.js';
import { groupUnits, componentLabel } from './grouping.js';
import { combine, summarize } from './math.js';
import { remainingClasses, scheduleOverrun } from './schedule.js';
import {
  targetFraction,
  readCache,
  writeCache,
  semesterCacheKey,
  unitsCacheKey,
  STRUCTURE_TTL_MS,
} from './storage.js';

export { courseHashFromUrl, isCourseDetailsUrl };

/**
 * Which semester a course belongs to, cached for the term.
 * @param {string} courseHash
 * @param {{ force?: boolean }} [options] bypass the cache
 */
export async function semesterFor(courseHash, { force = false } = {}) {
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
export async function unitsFor(semesterHash, { force = false } = {}) {
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
export async function loadUnits(courseHash, { force = false } = {}) {
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
export function rehydrate(units, settings) {
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
export async function loadMissed(subject) {
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
