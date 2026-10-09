import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SCHEDULE,
  SCHEDULE_PRESET,
  totalClasses,
  remainingClasses,
  scheduleOverrun,
} from '../src/lib/schedule.js';
import { summarize } from '../src/lib/math.js';

// The timetable this was built against: four subjects running 12 weeks with two
// lectures and two labs a week, plus a once-weekly subject running 10 weeks.
const TERM = {
  enabled: true,
  weeks: 12,
  perWeek: 4,
  perSubject: { lhl: { weeks: 10, perWeek: 1 } },
};

test('a schedule is ignored entirely until it is switched on', () => {
  assert.equal(totalClasses('ada', DEFAULT_SCHEDULE), null);
  assert.equal(remainingClasses('ada', 15, DEFAULT_SCHEDULE), null);
  assert.equal(totalClasses('ada', { ...TERM, enabled: false }), null);
});

test('term total is weeks times classes per week', () => {
  assert.equal(totalClasses('ada', TERM), 48);
  assert.equal(totalClasses('maths iii', TERM), 48);
});

test('a per-subject entry overrides both defaults', () => {
  assert.equal(totalClasses('lhl', TERM), 10);
});

test('a per-subject entry can override just one field', () => {
  const s = { ...TERM, perSubject: { chem: { perWeek: 2 } } };
  assert.equal(totalClasses('chem', s), 24); // 12 default weeks x 2
  const t = { ...TERM, perSubject: { chem: { weeks: 6 } } };
  assert.equal(totalClasses('chem', t), 24); // 6 x 4 default per week
});

test('remaining is the term total minus classes already held', () => {
  assert.equal(remainingClasses('ada', 22, TERM), 26);
  assert.equal(remainingClasses('lhl', 0, TERM), 10);
});

test('remaining never goes negative when a term overruns', () => {
  assert.equal(remainingClasses('ada', 60, TERM), 0);
  assert.equal(scheduleOverrun('ada', 60, TERM), true);
  assert.equal(scheduleOverrun('ada', 15, TERM), false);
});

test('null remaining is distinguishable from zero remaining', () => {
  // "I don't know the schedule" and "the term is over" must not look alike:
  // the first falls back to short-range advice, the second is final.
  assert.equal(remainingClasses('ada', 15, DEFAULT_SCHEDULE), null);
  assert.equal(remainingClasses('ada', 48, TERM), 0);
});

test('nonsense values are refused rather than producing a bogus total', () => {
  for (const bad of [0, -5, 'x', null, NaN, Infinity]) {
    assert.equal(totalClasses('a', { enabled: true, weeks: bad, perWeek: 4 }), null, `weeks=${bad}`);
    assert.equal(totalClasses('a', { enabled: true, weeks: 12, perWeek: bad }), null, `perWeek=${bad}`);
  }
});

// --- end to end over a whole term -------------------------------------------

test('a full term produces budgets that are affordable and maximal', () => {
  // Combined per-subject figures for the demo semester.
  const observed = [
    ['ada', 21, 22, 26, 11],
    ['ap', 18, 22, 26, 8],
    ['de', 22, 22, 26, 12],
    ['maths iii', 15, 22, 26, 5],
  ];
  for (const [key, attended, held, wantRemaining, wantSkips] of observed) {
    const remaining = remainingClasses(key, held, TERM);
    assert.equal(remaining, wantRemaining, `${key} remaining`);

    const s = summarize([{ held, attended }], { remaining });
    assert.equal(s.projection.skipsLeft, wantSkips, `${key} skips`);

    // The budget must actually hold: miss that many and finish at or above 75%.
    const finalAttended = attended + remaining - wantSkips;
    const finalHeld = held + remaining;
    assert.ok(finalAttended / finalHeld >= 0.75 - 1e-9, `${key} budget is affordable`);
    assert.ok(
      (finalAttended - 1) / finalHeld < 0.75,
      `${key} budget is maximal`
    );
  }
});

test('the once-weekly subject gets its own, much smaller budget', () => {
  const remaining = remainingClasses('lhl', 0, TERM);
  const s = summarize([{ held: 0, attended: 0 }], { remaining });
  assert.equal(remaining, 10);
  assert.equal(s.projection.skipsLeft, 2);
  assert.equal(s.headline, 'no-data');
  // 8/10 = 80%, and 7/10 = 70% would miss, so 2 is right.
  assert.ok(8 / 10 >= 0.75 && 7 / 10 < 0.75);
});

test('a subject below target is still reachable across the full term', () => {
  // Maths III at 68% reads as "attend 6 in a row" without a schedule; with one,
  // the honest framing is that the term still carries it comfortably.
  const remaining = remainingClasses('maths iii', 22, TERM);
  const s = summarize([{ held: 22, attended: 15 }], { remaining });
  assert.equal(s.meetsTarget, false);
  assert.equal(s.headline, 'recover');
  assert.equal(s.projection.reachable, true);
  assert.ok(s.projection.bestReachable > 0.85); // 41/48 = 85.4%
});

test('overstating the term length is what makes the budget wrong', () => {
  // Guard on the documented failure mode: claim 30 more classes, get 22.
  const claimed = summarize([{ held: 15, attended: 14 }], { remaining: 30 });
  const skips = claimed.projection.skipsLeft;
  const actualAttended = 14 + (22 - skips);
  const actualHeld = 15 + 22;
  assert.ok(actualAttended / actualHeld < 0.75, 'over-long term overstates the budget');
});

test('the offered preset is exactly what the form already pre-fills', () => {
  // The settings page and the phone sheet both label a control with these
  // numbers. If they ever drifted from the defaults the form shows, the button
  // would promise one term and the fields would display another.
  assert.equal(DEFAULT_SCHEDULE.weeks, SCHEDULE_PRESET.weeks);
  assert.equal(DEFAULT_SCHEDULE.perWeek, SCHEDULE_PRESET.perWeek);
  assert.equal(DEFAULT_SCHEDULE.enabled, false, 'a schedule nobody confirmed must stay off');
});

test('the preset produces a usable term, not a placeholder', () => {
  const schedule = { ...DEFAULT_SCHEDULE, ...SCHEDULE_PRESET, enabled: true };
  assert.equal(totalClasses('ada', schedule), 48);
  assert.equal(remainingClasses('ada', 12, schedule), 36);
});
