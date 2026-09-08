import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TARGET,
  combine,
  percentage,
  skipsAffordable,
  classesToRecover,
  projectTerm,
  summarize,
} from '../src/lib/math.js';

test('combine sums raw class counts across theory and lab', () => {
  const result = combine([
    { name: 'ADA - B', held: 30, attended: 24 },
    { name: 'ADA Lab 2 - B', held: 8, attended: 8 },
  ]);
  assert.deepEqual(result, { attended: 32, held: 38 });
});

test('combine is a weighted roll-up, not a mean of percentages', () => {
  // 100% over 2 classes and 50% over 30 classes. Averaging the percentages
  // gives 75% and would wrongly clear the bar; the real figure is 53%.
  const { attended, held } = combine([
    { held: 2, attended: 2 },
    { held: 30, attended: 15 },
  ]);
  assert.equal(attended, 17);
  assert.equal(held, 32);
  assert.ok(percentage(attended, held) < 0.75);
});

test('combine ignores junk and never lets attended exceed held', () => {
  assert.deepEqual(combine([{ held: 5, attended: 9 }]), { attended: 5, held: 5 });
  assert.deepEqual(combine([{ held: null, attended: 'x' }]), { attended: 0, held: 0 });
  assert.deepEqual(combine(undefined), { attended: 0, held: 0 });
});

test('percentage returns null rather than 0 when nothing has been held', () => {
  assert.equal(percentage(0, 0), null);
  assert.equal(percentage(0, 4), 0);
});

test('skipsAffordable: exactly at target affords no skips', () => {
  assert.equal(skipsAffordable(15, 20, 0.75), 0); // 75.0%
});

test('skipsAffordable: the skips it reports are all actually affordable', () => {
  const attended = 32;
  const held = 38;
  const k = skipsAffordable(attended, held, 0.75);
  assert.equal(k, 4);
  assert.ok(attended / (held + k) >= 0.75, 'kth skip still clears target');
  assert.ok(attended / (held + k + 1) < 0.75, 'k is maximal');
});

test('skipsAffordable is 0 below target and 0 with no classes held', () => {
  assert.equal(skipsAffordable(10, 20, 0.75), 0);
  assert.equal(skipsAffordable(0, 0, 0.75), 0);
});

test('classesToRecover: attending exactly that many reaches target', () => {
  const attended = 10;
  const held = 20;
  const k = classesToRecover(attended, held, 0.75);
  assert.equal(k, 20);
  assert.ok((attended + k) / (held + k) >= 0.75);
  assert.ok((attended + k - 1) / (held + k - 1) < 0.75, 'k is minimal');
});

test('classesToRecover is 0 when already at or above target', () => {
  assert.equal(classesToRecover(15, 20, 0.75), 0);
  assert.equal(classesToRecover(19, 20, 0.75), 0);
});

test('projectTerm budgets skips across the classes still scheduled', () => {
  const p = projectTerm(15, 20, 10, 0.75);
  assert.equal(p.skipsLeft, 2);
  assert.ok((15 + 10 - 2) / 30 >= 0.75, 'skipping 2 of 10 still clears target');
  assert.ok((15 + 10 - 3) / 30 < 0.75, 'skipping 3 does not');
  assert.equal(p.reachable, true);
});

test('projectTerm flags a target that perfect attendance cannot reach', () => {
  const p = projectTerm(5, 40, 5, 0.75);
  assert.equal(p.reachable, false);
  assert.equal(p.bestReachable, 10 / 45);
  assert.equal(p.skipsLeft, 0);
});

test('projectTerm never offers more skips than there are classes left', () => {
  const p = projectTerm(100, 100, 3, 0.75);
  assert.equal(p.skipsLeft, 3);
});

test('summarize picks the headline number for each regime', () => {
  assert.equal(summarize([{ held: 0, attended: 0 }]).headline, 'no-data');
  assert.equal(summarize([{ held: 20, attended: 18 }]).headline, 'skips');
  assert.equal(summarize([{ held: 20, attended: 10 }]).headline, 'recover');
  assert.equal(
    summarize([{ held: 40, attended: 5 }], { remaining: 5 }).headline,
    'unreachable'
  );
});

test('summarize rolls up units and carries the projection', () => {
  const s = summarize(
    [
      { name: 'ADA - B', held: 30, attended: 24 },
      { name: 'ADA Lab 2 - B', held: 8, attended: 8 },
    ],
    { remaining: 6 }
  );
  assert.equal(s.attended, 32);
  assert.equal(s.held, 38);
  assert.equal(s.meetsTarget, true);
  assert.equal(s.headline, 'skips');
  assert.equal(s.projection.remaining, 6);
  assert.ok(s.projection.skipsLeft >= 0);
});

test('summarize omits the projection when no schedule data is available', () => {
  assert.equal(summarize([{ held: 20, attended: 18 }]).projection, null);
});

test('a non-default target is honoured end to end', () => {
  const s = summarize([{ held: 20, attended: 17 }], { target: 0.85 });
  assert.equal(s.target, 0.85);
  assert.equal(s.meetsTarget, true);
  assert.equal(s.headline, 'skips');
  assert.equal(skipsAffordable(17, 20, 0.85), 0);
});

test('invalid targets are rejected rather than silently coerced', () => {
  assert.throws(() => skipsAffordable(1, 1, 0), RangeError);
  assert.throws(() => skipsAffordable(1, 1, 1), RangeError);
  assert.throws(() => classesToRecover(1, 1, 1.5), RangeError);
  assert.throws(() => summarize([], { target: NaN }), RangeError);
});

test('floating point does not push an exactly-on-target subject under', () => {
  // Every multiple of the 75% rule must read as meeting target, not 1 short.
  for (let held = 4; held <= 400; held += 4) {
    const attended = (held * 3) / 4;
    const s = summarize([{ held, attended }], { target: DEFAULT_TARGET });
    assert.equal(s.meetsTarget, true, `${attended}/${held} should meet target`);
    assert.equal(s.skipsAffordable, 0, `${attended}/${held} affords no skips`);
    assert.equal(s.classesToRecover, 0);
  }
});

test('skipsAffordable and classesToRecover agree across a wide sweep', () => {
  const target = 0.75;
  for (let held = 1; held <= 60; held++) {
    for (let attended = 0; attended <= held; attended++) {
      const k = skipsAffordable(attended, held, target);
      const r = classesToRecover(attended, held, target);
      const meets = attended / held >= target - 1e-9;

      assert.equal(meets, k > 0 || attended / held >= target - 1e-9);
      if (meets) {
        assert.equal(r, 0);
        assert.ok(attended / (held + k) >= target - 1e-9);
        assert.ok(attended / (held + k + 1) < target);
      } else {
        assert.equal(k, 0);
        assert.ok(r > 0);
        assert.ok((attended + r) / (held + r) >= target - 1e-9);
        assert.ok((attended + r - 1) / (held + r - 1) < target);
      }
    }
  }
});
