/**
 * The gate every push and every tag has to clear.
 *
 * Three things can be wrong in a way no test catches and no reviewer sees:
 * the two version numbers disagreeing, the shipped phone bundle being older
 * than the source it was built from, and a release with nothing written about
 * it. Each one reaches students as a silently wrong build, so each is checked
 * here rather than remembered.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle, BUNDLE_PATH } from './build-mobile.mjs';
import { releaseNotes } from './release-notes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const problems = [];
const fail = (message) => problems.push(message);

const manifest = json('manifest.json');
const pkg = json('package.json');

if (manifest.version !== pkg.version) {
  fail(`manifest.json is ${manifest.version} but package.json is ${pkg.version} — run \`npm run set-version -- <version>\`.`);
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  fail(`"${manifest.version}" is not a three-part semantic version.`);
}

const { bundle } = buildBundle();
let committed = '';
try {
  committed = readFileSync(BUNDLE_PATH, 'utf8');
} catch {
  fail('docs/nst-mobile.js is missing — run `npm run build:mobile`.');
}
if (committed && committed !== bundle) {
  fail('docs/nst-mobile.js is out of date with src/ — run `npm run build:mobile` and commit the result.');
}

try {
  releaseNotes(manifest.version);
} catch (error) {
  fail(`${error.message} — every released version needs an entry.`);
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(`✓ version ${manifest.version}, phone bundle current, changelog entry present`);
