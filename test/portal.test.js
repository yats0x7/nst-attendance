import test from 'node:test';
import assert from 'node:assert/strict';

// portal.js pulls in the adapter, which reads `location` lazily; give it one.
globalThis.location ??= { href: 'https://my.newtonschool.co/', origin: 'https://my.newtonschool.co' };

const { rehydrate, isCourseDetailsUrl } = await import('../src/lib/portal.js');
const { normalizeSettings, DEFAULT_SETTINGS } = await import('../src/lib/storage.js');

const REAL = [
  { name: 'ADA - B', held: 12, attended: 12 },
  { name: 'ADA Lab 2 - B', held: 10, attended: 9 },
  { name: 'LHL - B', held: 0, attended: 0 },
  { name: 'Maths III - B', held: 12, attended: 9 },
  { name: 'Maths III Lab 2 - B', held: 10, attended: 6 },
];

const settings = (schedule) =>
  normalizeSettings({ targetPercent: 75, overrides: {}, schedule });

test('rehydrate with no schedule yields no projection and no overrun', () => {
  for (const s of rehydrate(REAL, settings({ enabled: false }))) {
    assert.equal(s.summary.projection, null, s.label);
    assert.equal(s.overrun, false, s.label);
  }
});

test('rehydrate with a live schedule projects the term', () => {
  const subs = rehydrate(REAL, settings({ enabled: true, weeks: 12, perWeek: 4, perSubject: { lhl: { weeks: 10, perWeek: 1 } } }));
  const maths = subs.find((s) => s.key === 'maths iii');
  assert.equal(maths.summary.projection.remaining, 26);
  assert.equal(maths.summary.projection.skipsLeft, 5);
  assert.equal(maths.summary.headline, 'recover');
  const lhl = subs.find((s) => s.key === 'lhl');
  assert.equal(lhl.summary.projection.remaining, 10);
});

test('a schedule the term has run past is withheld, not fed in as zero remaining', () => {
  // 2 weeks x 4 = 8 total, but every subject here has held more than that.
  const subs = rehydrate(REAL, settings({ enabled: true, weeks: 2, perWeek: 4, perSubject: {} }));
  const maths = subs.find((s) => s.key === 'maths iii');
  assert.equal(maths.overrun, true);
  assert.equal(maths.summary.projection, null, 'no projection from an overrun schedule');
  assert.equal(maths.summary.headline, 'recover', 'falls back to the safe figure, not "unreachable"');
  assert.equal(maths.summary.classesToRecover, 6);
});

test('a schedule exactly used up is also withheld and flagged', () => {
  // 22 held for ADA; 22 total -> remaining 0.
  const subs = rehydrate(REAL, settings({ enabled: true, weeks: 22, perWeek: 1, perSubject: {} }));
  const ada = subs.find((s) => s.key === 'ada');
  assert.equal(ada.summary.projection, null);
  assert.equal(ada.overrun, true);
});

test('isCourseDetailsUrl is anchored to the details page only', () => {
  assert.equal(isCourseDetailsUrl('https://my.newtonschool.co/course/smstr00000001/details'), true);
  assert.equal(isCourseDetailsUrl('https://my.newtonschool.co/course/smstr00000001/details/'), true);
  assert.equal(isCourseDetailsUrl('https://my.newtonschool.co/course/smstr00000001/details/foo'), false);
  assert.equal(isCourseDetailsUrl('https://my.newtonschool.co/course/smstr00000001/leaderboard'), false);
  assert.equal(isCourseDetailsUrl('https://my.newtonschool.co/'), false);
  assert.equal(isCourseDetailsUrl('not a url'), false);
});

test('normalizeSettings clamps and reshapes anything it is given', () => {
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule } });
  assert.equal(normalizeSettings({ targetPercent: 150 }).targetPercent, 75);
  assert.equal(normalizeSettings({ targetPercent: 0 }).targetPercent, 75);
  assert.equal(normalizeSettings({ targetPercent: '85' }).targetPercent, 85);
  assert.deepEqual(normalizeSettings({ overrides: 'junk' }).overrides, {});
  assert.deepEqual(normalizeSettings({ schedule: null }).schedule.perSubject, {});
  assert.equal(normalizeSettings({ schedule: { enabled: true } }).schedule.weeks, 12);
});
