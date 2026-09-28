import test from 'node:test';
import assert from 'node:assert/strict';

import { orderSubjects, countsText, verdictText, tone, isAtRisk, problemText } from '../src/content/panel.js';
import { groupUnits } from '../src/lib/grouping.js';
import { summarize } from '../src/lib/math.js';

const subjectsFrom = (units, opts = {}) =>
  groupUnits(units).map((g) => ({ ...g, summary: summarize(g.units, opts) }));

// A demo semester used by the harnesses and screenshots.
const REAL = [
  { name: 'ADA - B', held: 12, attended: 12 },
  { name: 'ADA Lab 2 - B', held: 10, attended: 9 },
  { name: 'AP - B', held: 12, attended: 10 },
  { name: 'AP Lab 2 - B', held: 10, attended: 8 },
  { name: 'DE - B', held: 11, attended: 11 },
  { name: 'DE Lab 2 - B', held: 11, attended: 11 },
  { name: 'LHL - B', held: 0, attended: 0 },
  { name: 'Maths III - B', held: 12, attended: 9 },
  { name: 'Maths III Lab 2 - B', held: 10, attended: 6 },
];

test('tone maps every headline to a colour band', () => {
  assert.equal(tone({ headline: 'no-data' }), 'none');
  assert.equal(tone({ headline: 'unreachable' }), 'bad');
  assert.equal(tone({ headline: 'skips', meetsTarget: true }), 'ok');
  assert.equal(tone({ headline: 'recover', meetsTarget: false }), 'warn');
});

test('at-risk subjects come first, everything else keeps portal order', () => {
  const ordered = orderSubjects(subjectsFrom(REAL)).map((s) => s.label);
  assert.deepEqual(ordered, ['Maths III', 'ADA', 'AP', 'DE', 'LHL']);
});

test('ordering is stable when nothing is at risk', () => {
  const fine = subjectsFrom([
    { name: 'A - B', held: 10, attended: 10 },
    { name: 'B - B', held: 10, attended: 9 },
  ]);
  assert.deepEqual(orderSubjects(fine).map((s) => s.label), ['A', 'B']);
});

test('ordering tolerates empty input', () => {
  assert.deepEqual(orderSubjects([]), []);
  assert.deepEqual(orderSubjects(undefined), []);
});

test('counts text breaks a paired subject down by component', () => {
  const ada = subjectsFrom(REAL).find((s) => s.key === 'ada');
  const text = countsText(ada).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(text, 'Lecture 12/12 · Lab 9/10 attended');
});

test('counts text for a lone subject is just the total', () => {
  const lhl = subjectsFrom(REAL).find((s) => s.key === 'lhl');
  assert.equal(countsText(lhl), '0/0 classes attended');
});

test('counts text names other practical kinds as the portal wrote them', () => {
  const s = subjectsFrom([
    { name: 'Chem - A', held: 10, attended: 9 },
    { name: 'Chem Tutorial 1 - A', held: 4, attended: 4 },
  ])[0];
  assert.match(countsText(s), /Lecture 9\/10/);
  assert.match(countsText(s), /Tutorial 4\/4/);
});

test('verdict wording covers every regime without a schedule', () => {
  const t = (a, h) => verdictText(summarize([{ held: h, attended: a }])).replace(/<[^>]+>/g, '');
  assert.equal(t(0, 0), 'No classes held yet.');
  assert.match(t(15, 20), /No room to skip/);
  assert.match(t(18, 20), /Can skip 4 more classes/);
  assert.match(t(10, 20), /Attend every class from here/, 'a 20-class streak is not presented as a plan');
  assert.match(t(10, 20), /add your term schedule/i);
  assert.match(t(14, 20), /Attend the next 4 classes in a row/, 'a short streak is');
});

test('unreachable always names a next step', () => {
  const t = (a, h, r) => verdictText(summarize([{ held: h, attended: a }], { remaining: r })).replace(/<[^>]+>/g, '');
  assert.match(t(5, 40, 5), /out of reach.*22\.2%.*coordinator/s);
});

test('verdict marks the instruction and the qualifier separately', () => {
  const html = verdictText(summarize([{ held: 20, attended: 18 }]));
  assert.match(html, /^<strong>Can skip 4 more classes<\/strong> <span class="rest">/);
});

test('verdict wording covers every regime with a schedule', () => {
  const t = (a, h, r) => verdictText(summarize([{ held: h, attended: a }], { remaining: r })).replace(/<[^>]+>/g, '');
  assert.match(t(0, 0, 10), /10 to come.*miss 2/);
  assert.match(t(14, 15, 33), /Can skip 11 of your 33 remaining/);
  assert.match(t(10, 16, 32), /Miss at most 6 of your 32 remaining.*after 8 classes in a row/);
  assert.match(t(5, 40, 5), /out of reach.*22\.2%/);
});


test('a projection over zero remaining classes is ignored, never "attend all 0"', () => {
  const t = (a, h, r) => verdictText(summarize([{ held: h, attended: a }], { remaining: r })).replace(/<[^>]+>/g, '');
  assert.match(t(15, 20, 0), /No room to skip/);
  assert.doesNotMatch(t(15, 20, 0), /0 remaining/);
  assert.match(t(18, 20, 0), /Can skip 4 more classes/);
});

test('isAtRisk is the single at-risk rule and matches ordering + footer', () => {
  const subs = subjectsFrom(REAL);
  const risky = subs.filter((s) => isAtRisk(s.summary)).map((s) => s.label);
  assert.deepEqual(risky, ['Maths III']);
  assert.deepEqual(orderSubjects(subs).slice(0, risky.length).map((s) => s.label), risky);
  assert.equal(isAtRisk({ headline: 'no-data' }), false);
  assert.equal(isAtRisk({ headline: 'unreachable' }), true);
});

test('problemText distinguishes an expired session from a changed portal', () => {
  assert.match(problemText('auth'), /Log in/);
  assert.match(problemText('shape'), /update to this extension/);
  assert.match(problemText('network'), /connection/);
  assert.match(problemText('unknown', 'x <b>y</b>'), /x &lt;b&gt;y&lt;\/b&gt;/); // detail is escaped
});

test('verdict never leaks raw HTML from data — only its own markup', () => {
  // Names never reach verdictText; only numbers do. Guard that stays true.
  const html = verdictText(summarize([{ held: 20, attended: 18 }]));
  assert.doesNotMatch(html, /<(?!\/?strong>|\/?span( class="rest")?>)/, 'only <strong> and the qualifier span are emitted');
});

test('the schedule pointer follows the surface it is rendered on', async () => {
  const { setSettingsWhere } = await import('../src/content/panel.js');
  const strip = (s) => verdictText(s).replace(/<[^>]+>/g, '');
  const belowTarget = summarize([{ held: 20, attended: 10 }]);

  assert.match(strip(belowTarget), /add your term schedule in Settings/);
  setSettingsWhere('below');
  assert.match(strip(belowTarget), /add your term schedule below/);
  assert.doesNotMatch(strip(belowTarget), /Settings/);
  setSettingsWhere('in Settings'); // leave the default for other tests
});
