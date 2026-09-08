import test from 'node:test';
import assert from 'node:assert/strict';

// The adapter reads `location` at call time in courseHashFromUrl; give it one.
globalThis.location ??= { href: 'https://my.newtonschool.co/', origin: 'https://my.newtonschool.co' };

const { assertApiPath, retryDelay, courseHashFromUrl, PortalError } = await import(
  '../src/lib/adapters/api-adapter.js'
);

test('only relative portal API paths are allowed to carry the token', () => {
  assert.equal(assertApiPath('/api/v2/course/h/abc123/self_performance/'), '/api/v2/course/h/abc123/self_performance/');
  for (const bad of [
    'https://evil.example/api/v1/x',
    '//evil.example/api/v1/x',
    '/apix/v1/x',
    'api/v1/x',
    '/api/vx/y',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.throws(() => assertApiPath(bad), PortalError, String(bad));
  }
});

test('course hashes are validated before being placed in a URL', () => {
  assert.equal(courseHashFromUrl('https://my.newtonschool.co/course/smstr00000001/details'), 'smstr00000001');
  assert.equal(courseHashFromUrl('https://my.newtonschool.co/course/subj0000ada1'), 'subj0000ada1');
  assert.equal(courseHashFromUrl('https://my.newtonschool.co/'), null);
  // Traversal or injection attempts in the URL segment are rejected, not passed through.
  assert.equal(courseHashFromUrl('https://my.newtonschool.co/course/..%2F..%2Fadmin/details'), null);
  assert.equal(courseHashFromUrl('https://my.newtonschool.co/course/<script>/details'), null);
  assert.equal(courseHashFromUrl('https://my.newtonschool.co/course/a/details'), null);
});

test('retry delay backs off exponentially with full jitter', () => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cap = 400 * 2 ** attempt;
    for (let i = 0; i < 50; i += 1) {
      const d = retryDelay(attempt);
      assert.ok(d >= 0 && d < cap, `attempt ${attempt}: ${d} within [0, ${cap})`);
    }
  }
});

test('retry delay honours Retry-After but caps it', () => {
  assert.equal(retryDelay(0, '2'), 2000);
  assert.equal(retryDelay(0, '120'), 30000);
  // Garbage header falls back to jitter.
  const d = retryDelay(0, 'soon');
  assert.ok(d >= 0 && d < 400);
});

test('PortalError classifies auth failures from the status code', () => {
  assert.equal(new PortalError('x', { status: 401 }).kind, 'auth');
  assert.equal(new PortalError('x', { status: 403 }).kind, 'auth');
  assert.equal(new PortalError('x', { status: 500 }).kind, 'unknown');
  assert.equal(new PortalError('x', { kind: 'shape' }).kind, 'shape');
  assert.equal(new PortalError('x', { kind: 'network' }).kind, 'network');
});
