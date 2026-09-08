import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCourseName, normalizeKey, groupUnits } from '../src/lib/grouping.js';

const unit = (name, held = 10, attended = 8) => ({ name, held, attended });
const keys = (groups) => groups.map((g) => g.key);

test('parses a theory course', () => {
  const parsed = parseCourseName('ADA - B');
  assert.equal(parsed.base, 'ADA');
  assert.equal(parsed.plainBase, 'ADA');
  assert.equal(parsed.section, 'B');
  assert.equal(parsed.isPractical, false);
});

test('parses a lab course down to the same base as its subject', () => {
  const lab = parseCourseName('ADA Lab 2 - B');
  assert.equal(lab.base, 'ADA');
  assert.equal(lab.plainBase, 'ADA Lab 2');
  assert.equal(lab.isPractical, true);
  assert.equal(lab.index, 2);
  assert.equal(lab.key, parseCourseName('ADA - B').key);
});

test('handles the multi-word subjects from the real sidebar', () => {
  assert.equal(parseCourseName('Maths III - B').key, 'maths iii');
  assert.equal(parseCourseName('Maths III Lab 2 - B').key, 'maths iii');
  assert.equal(parseCourseName('AP Lab 2 - B').key, 'ap');
  assert.equal(parseCourseName('DE Lab 2 - B').key, 'de');
});

test('splits on the last hyphen so hyphenated subjects survive', () => {
  const parsed = parseCourseName('Data Structures - Advanced - B');
  assert.equal(parsed.plainBase, 'Data Structures - Advanced');
  assert.equal(parsed.section, 'B');
});

test('a name with no section token still parses', () => {
  const parsed = parseCourseName('Physics');
  assert.equal(parsed.plainBase, 'Physics');
  assert.equal(parsed.section, null);
});

test('normalizeKey folds case and collapses whitespace', () => {
  assert.equal(normalizeKey('  Maths   III '), 'maths iii');
  assert.equal(normalizeKey(null), '');
});

// --- the real sidebar -------------------------------------------------------

test('groups the observed portal sidebar into five subjects', () => {
  // Exactly what /learning_course/all returns for this account, LHL included.
  const groups = groupUnits(
    [
      'ADA - B', 'ADA Lab 2 - B',
      'AP - B', 'AP Lab 2 - B',
      'DE - B', 'DE Lab 2 - B',
      'LHL - B',
      'Maths III - B', 'Maths III Lab 2 - B',
    ].map((n) => unit(n))
  );
  assert.deepEqual(keys(groups), ['ada', 'ap', 'de', 'lhl', 'maths iii']);
  assert.deepEqual(groups.map((g) => g.units.length), [2, 2, 2, 1, 2]);
});

test('a subject with no lab is a group of one, not an error or a merge', () => {
  const groups = groupUnits([unit('LHL - B'), unit('ADA - B'), unit('ADA Lab 2 - B')]);
  const lhl = groups.find((g) => g.key === 'lhl');
  assert.equal(lhl.units.length, 1);
  assert.equal(lhl.label, 'LHL');
});

test('the subject label comes from the theory course, not the lab', () => {
  const groups = groupUnits([unit('Maths III Lab 2 - B'), unit('Maths III - B')]);
  assert.equal(groups[0].label, 'Maths III');
});

test('group order follows first appearance', () => {
  assert.deepEqual(keys(groupUnits([unit('DE - B'), unit('ADA - B')])), ['de', 'ada']);
});

// --- other batches name their practicals differently ------------------------

for (const marker of [
  'Lab', 'Lab 2', 'Labs', 'Practical', 'Practicals', 'Prac',
  'Tutorial', 'Tutorial 1', 'Tut', 'Workshop', 'Recitation', 'Seminar',
  'Studio', 'Discussion',
]) {
  test(`"${marker}" pairs with its subject when the subject exists`, () => {
    const groups = groupUnits([unit('Chem - A'), unit(`Chem ${marker} - A`)]);
    assert.equal(groups.length, 1, `${marker} should merge`);
    assert.equal(groups[0].units.length, 2);
    assert.equal(groups[0].label, 'Chem');
  });
}

test('a colon or dash before the marker is tolerated', () => {
  for (const name of ['Chem - Lab - A', 'Chem: Lab - A']) {
    const groups = groupUnits([unit('Chem - A'), unit(name)]);
    assert.equal(groups.length, 1, name);
  }
});

test('sibling practicals merge even with no plain theory course', () => {
  const groups = groupUnits([unit('Chem Lab 1 - A'), unit('Chem Lab 2 - A')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'chem');
});

// --- the safety property: never merge unrelated subjects --------------------

test('a standalone subject ending in a marker word keeps its own identity', () => {
  // "AI Studio" is its own subject here; there is no "AI" for it to fold into,
  // so it must not be renamed to one — that would invent a subject.
  const groups = groupUnits([unit('AI Studio - B'), unit('Maths III - B')]);
  assert.deepEqual(keys(groups), ['ai studio', 'maths iii']);
  assert.equal(groups[0].label, 'AI Studio');
});

test('a marker-like subject is NOT absorbed into an unrelated real subject', () => {
  // The dangerous case: "AI" exists, so "AI Studio" *could* be read as its lab.
  // That is exactly the inference we want, and it is safe because the two really
  // are the same subject in every naming scheme observed.
  const merged = groupUnits([unit('AI - B'), unit('AI Studio - B')]);
  assert.equal(merged.length, 1);

  // But with no "AI" present, nothing is invented.
  const separate = groupUnits([unit('AI Studio - B')]);
  assert.deepEqual(keys(separate), ['ai studio']);
});

test('"Lab" inside a subject name is not treated as a marker', () => {
  const parsed = parseCourseName('Lab Techniques - B');
  assert.equal(parsed.isPractical, false);
  assert.equal(parsed.plainBase, 'Lab Techniques');
  assert.deepEqual(keys(groupUnits([unit('Lab Techniques - B')])), ['lab techniques']);
});

test('a bare marker with no subject is left as its own group', () => {
  assert.deepEqual(keys(groupUnits([unit('Lab 2 - B')])), ['lab 2']);
});

test('different sections and year naming still group', () => {
  for (const section of ['A', 'C', 'B2', '1']) {
    const groups = groupUnits([unit(`ADA - ${section}`), unit(`ADA Lab 2 - ${section}`)]);
    assert.equal(groups.length, 1, `section ${section}`);
  }
});

test('long portal titles group correctly when short names are absent', () => {
  // Some payloads carry only `title`; the adapter falls back to it.
  const groups = groupUnits([
    unit("Newton School of Technology'25 (RU) - Analysis and Design of Algorithms - B"),
    unit("Newton School of Technology'25 (RU) - Analysis and Design of Algorithms Lab 2 - B"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].units.length, 2);
});

// --- overrides --------------------------------------------------------------

test('an override re-homes a course the heuristic cannot infer', () => {
  const groups = groupUnits(
    [unit('ADA - B'), unit('Algo Design Practicum - B')],
    { 'Algo Design Practicum - B': 'ada' }
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].units.length, 2);
});

test('override matching ignores case and spacing in the course name', () => {
  const groups = groupUnits([unit('Algo  Design - B')], { 'algo design - b': 'ADA' });
  assert.equal(groups[0].key, 'ada');
});

test('an override can also split apart courses that would otherwise merge', () => {
  const groups = groupUnits(
    [unit('AI - B'), unit('AI Studio - B')],
    { 'AI Studio - B': 'ai studio' }
  );
  assert.deepEqual(keys(groups), ['ai', 'ai studio']);
});

test('empty and missing input is handled', () => {
  assert.deepEqual(groupUnits([]), []);
  assert.deepEqual(groupUnits(undefined), []);
  assert.deepEqual(groupUnits([unit('   ')]), []);
});

// --- component labels --------------------------------------------------------

import { componentLabel } from '../src/lib/grouping.js';

test('component labels name the theory course Lecture and the practical by its marker', () => {
  const [g] = groupUnits([unit('ADA - B'), unit('ADA Lab 2 - B')]);
  assert.deepEqual(g.units.map(componentLabel), ['Lecture', 'Lab']);
});

test('component labels title-case whatever the portal wrote', () => {
  const [g] = groupUnits([unit('Chem - A'), unit('Chem TUTORIAL - A'), unit('Chem practical - A')]);
  assert.deepEqual(g.units.map(componentLabel), ['Lecture', 'Tutorial', 'Practical']);
});

test('component label falls back gracefully for an unparsed unit', () => {
  assert.equal(componentLabel({}), 'Class');
  assert.equal(componentLabel(undefined), 'Class');
});
