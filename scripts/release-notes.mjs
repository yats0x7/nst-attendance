/**
 * Print one version's section of CHANGELOG.md.
 *
 * The release workflow pipes this into the GitHub release body, so the
 * changelog stays the single place a change is described. Anything that only
 * ever existed in a release page is lost to anyone reading the repository.
 *
 *   node scripts/release-notes.mjs 1.0.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} version e.g. "1.0.0" */
export function releaseNotes(version, changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')) {
  const lines = changelog.split('\n');
  // Headings look like `## [1.0.0] - 2026-10-09`.
  const isHeading = (line) => /^## /.test(line);
  const start = lines.findIndex((line) => isHeading(line) && line.includes(`[${version}]`));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex(isHeading);
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) throw new Error(`The ${version} section of CHANGELOG.md is empty`);
  return body;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version>');
    process.exit(2);
  }
  try {
    console.log(releaseNotes(version.replace(/^v/, '')));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
