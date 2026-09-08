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
export class PortalError extends Error {
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
export function retryDelay(attempt, retryAfterHeader = null) {
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
export function assertApiPath(path) {
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
export function isCourseDetailsUrl(href) {
  try {
    return /^\/course\/[^/]+\/details\/?$/.test(new URL(href, 'https://my.newtonschool.co').pathname);
  } catch {
    return false;
  }
}

/** Extract the course hash from a portal URL, or null if it isn't a course page. */
export function courseHashFromUrl(href = location.href) {
  const hash = new URL(href, location.origin).pathname.match(/\/course\/([^/]+)/)?.[1] ?? null;
  return hash && HASH_RE.test(hash) ? hash : null;
}

/** Resolve any course hash to the semester that owns the subject list. */
export async function resolveSemesterHash(courseHash) {
  const details = await getJson(PATHS.redirection(courseHash));
  // Falling back to the given hash covers a student already sitting on the
  // semester page, where the redirection payload points at itself.
  return details?.admin_course?.hash || courseHash;
}

/** The subjects and labs under a semester, in the portal's own sidebar order. */
export async function listUnits(semesterHash) {
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
export async function fetchUnitStats(courseHash) {
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
export async function fetchLectures(courseHash) {
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
export async function fetchAllStats(units) {
  const stats = await Promise.all(units.map((unit) => fetchUnitStats(unit.courseHash)));
  return units.map((unit, i) => ({ ...unit, ...stats[i] }));
}

/**
 * Every subject and lab in the student's semester, with class counts, with no
 * caching of the structural lookups. portal.js layers the caches on top.
 * @param {string} courseHash any course hash from the current URL
 */
export async function loadUnits(courseHash) {
  const semesterHash = await resolveSemesterHash(courseHash);
  return fetchAllStats(await listUnits(semesterHash));
}
