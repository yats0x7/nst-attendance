import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSettings, DEFAULT_SETTINGS, TARGET_BOUNDS } from '../src/lib/storage.js';
import { DEFAULT_SCHEDULE } from '../src/lib/schedule.js';

// normalizeSettings is the only thing standing between stored JSON and every
// calculation downstream. It runs on read *and* on write, so anything it lets
// through is what the card will do arithmetic on.

test('nothing stored yields the shipped defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('corrupt'), DEFAULT_SETTINGS);
});

test('an out-of-range target falls back rather than being clamped silently', () => {
  for (const bad of [0, -5, 100, 1e9, NaN, 'most of them', null]) {
    assert.equal(normalizeSettings({ targetPercent: bad }).targetPercent, DEFAULT_SETTINGS.targetPercent);
  }
  assert.equal(normalizeSettings({ targetPercent: TARGET_BOUNDS.min }).targetPercent, TARGET_BOUNDS.min);
  assert.equal(normalizeSettings({ targetPercent: TARGET_BOUNDS.max }).targetPercent, TARGET_BOUNDS.max);
});

test('a half-written schedule is filled in from the defaults', () => {
  const { schedule } = normalizeSettings({ schedule: { enabled: true } });
  assert.equal(schedule.enabled, true);
  assert.equal(schedule.weeks, DEFAULT_SCHEDULE.weeks);
  assert.equal(schedule.perWeek, DEFAULT_SCHEDULE.perWeek);
  assert.deepEqual(schedule.perSubject, {});
});

test('a non-object where a map belongs becomes an empty map', () => {
  const settings = normalizeSettings({ overrides: 'nope', schedule: { perSubject: 7 } });
  assert.deepEqual(settings.overrides, {});
  assert.deepEqual(settings.schedule.perSubject, {});
});

test('the dismissed-prompt flag is strictly boolean', () => {
  // A truthy leftover from an older build must not read as "already answered",
  // or the one pointer to term projections disappears for that student.
  assert.equal(normalizeSettings({}).scheduleTipDismissed, false);
  assert.equal(normalizeSettings({ scheduleTipDismissed: 'yes' }).scheduleTipDismissed, false);
  assert.equal(normalizeSettings({ scheduleTipDismissed: 1 }).scheduleTipDismissed, false);
  assert.equal(normalizeSettings({ scheduleTipDismissed: true }).scheduleTipDismissed, true);
});

test('normalizing is idempotent, since it runs on both read and write', () => {
  const once = normalizeSettings({ targetPercent: 80, schedule: { enabled: true, weeks: 10 } });
  assert.deepEqual(normalizeSettings(once), once);
});
