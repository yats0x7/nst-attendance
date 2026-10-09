/**
 * Move every version number at once, then rebuild what embeds it.
 *
 *   node scripts/set-version.mjs 1.1.0
 *
 * manifest.json is what Chrome reads, package.json is what the tooling reads,
 * and the phone bundle carries the version in its header — a release where
 * those three disagree is one nobody can report a bug against.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] ?? '').replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/set-version.mjs <major.minor.patch>');
  process.exit(2);
}

for (const file of ['manifest.json', 'package.json']) {
  const path = join(ROOT, file);
  const before = readFileSync(path, 'utf8');
  // Textual, not JSON.parse/stringify: that would reformat the whole file and
  // bury a one-line change in a hundred-line diff.
  const after = before.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`);
  if (after === before) {
    console.error(`${file}: no "version" field to update`);
    process.exit(1);
  }
  writeFileSync(path, after);
  console.log(`${file}  -> ${version}`);
}

execFileSync(process.execPath, [join(ROOT, 'scripts/build-mobile.mjs')], { stdio: 'inherit' });

const changelog = join(ROOT, 'CHANGELOG.md');
if (!readFileSync(changelog, 'utf8').includes(`[${version}]`)) {
  console.log(`\nNext: add the ${version} section to CHANGELOG.md, commit, then \`git tag v${version} && git push --tags\`.`);
}
