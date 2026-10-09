/**
 * Bundles the extension into one classic script for the mobile bookmarklet.
 *
 * The phone runs the same modules the desktop card does — no reimplementation,
 * so the two cannot drift. Two things have to change for a page context:
 *
 *   1. ES module syntax. A bookmarklet injects a classic <script>, so imports
 *      and exports are stripped and every module shares one IIFE scope.
 *   2. chrome.storage does not exist on a page. `storage.js` reaches for it
 *      through `globalThis.chrome`, which is rewritten to a localStorage-backed
 *      shim. Rewriting beats assigning `window.chrome.storage`, which would
 *      leave the portal's own globals modified after the sheet closes.
 *
 * No minifier and no dependencies: the output is readable, which matters for a
 * script people are asked to load into their logged-in session.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Order matters: a module may only use names defined above it.
const MODULES = [
  'src/lib/math.js',
  'src/lib/grouping.js',
  'src/lib/schedule.js',
  'src/lib/storage.js',
  'src/lib/adapters/api-adapter.js',
  'src/lib/portal.js',
  'src/content/panel.js',
  'mobile/storage-page.js',
  'mobile/sheet.js',
];

/**
 * Strip module syntax, line by line so multi-line import and export lists are
 * handled without a fragile whole-file regex.
 */
function flatten(source) {
  const out = [];
  let skippingUntilFrom = false;
  let skippingExportList = false;

  for (const line of source.split('\n')) {
    if (skippingUntilFrom) {
      if (/from\s*['"][^'"]*['"]\s*;?\s*$/.test(line)) skippingUntilFrom = false;
      continue;
    }
    if (skippingExportList) {
      if (/\}\s*;?\s*$/.test(line)) skippingExportList = false;
      continue;
    }

    // `import x from 'y';` / `import { a, b } from 'y';`, on one line or many.
    if (/^\s*import\b/.test(line)) {
      if (!/from\s*['"][^'"]*['"]\s*;?\s*$/.test(line)) skippingUntilFrom = true;
      continue;
    }
    // Re-exports (`export { a } from './b.js';`) and bare export lists.
    if (/^\s*export\s*\{/.test(line)) {
      if (!/\}\s*(from\s*['"][^'"]*['"])?\s*;?\s*$/.test(line)) skippingExportList = true;
      continue;
    }
    // `export const x` / `export function x` / `export class x` -> plain declaration.
    out.push(line.replace(/^(\s*)export\s+(?=(const|let|var|function|class|async)\b)/, '$1'));
  }
  return out.join('\n');
}

const PRELUDE = `
  /**
   * chrome.storage stand-in, backed by this origin's localStorage.
   *
   * Only the surface storage.js uses is implemented: get(key | null), set and
   * remove, all promise-returning. Keys live under one prefix so clearing the
   * sheet's data never touches the portal's own storage.
   */
  var __nstPrefix = 'nst-attendance:store:';
  var __nstArea = function (area) {
    var full = function (key) { return __nstPrefix + area + ':' + key; };
    var readAll = function () {
      var all = {};
      var prefix = __nstPrefix + area + ':';
      for (var i = 0; i < localStorage.length; i += 1) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) {
          try { all[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
        }
      }
      return all;
    };
    return {
      get: function (key) {
        try {
          if (key === null || key === undefined) return Promise.resolve(readAll());
          var keys = Array.isArray(key) ? key : [key];
          var out = {};
          keys.forEach(function (k) {
            var raw = localStorage.getItem(full(k));
            if (raw !== null) { try { out[k] = JSON.parse(raw); } catch (e) {} }
          });
          return Promise.resolve(out);
        } catch (e) { return Promise.resolve({}); }
      },
      set: function (items) {
        try {
          Object.keys(items).forEach(function (k) {
            localStorage.setItem(full(k), JSON.stringify(items[k]));
          });
        } catch (e) {}
        return Promise.resolve();
      },
      remove: function (keys) {
        try {
          (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
            localStorage.removeItem(full(k));
          });
        } catch (e) {}
        return Promise.resolve();
      },
    };
  };
  var __nstChrome = {
    storage: {
      sync: __nstArea('sync'),
      local: __nstArea('local'),
      onChanged: { addListener: function () {}, removeListener: function () {} },
    },
  };
`;

/**
 * Produce the bundle without touching disk, so CI can rebuild it and compare
 * against the committed copy. A stale `docs/nst-mobile.js` is the one defect
 * nobody notices: the page keeps serving last release's logic to every phone.
 */
export function buildBundle() {
  const parts = MODULES.map((rel) => {
    let code = flatten(readFileSync(join(ROOT, rel), 'utf8'));
    if (rel === 'src/lib/storage.js') {
      // See the header: the page has no chrome.storage, and mutating the page's
      // globals to fake one would outlive the sheet.
      code = code.replace(/globalThis\.chrome/g, '__nstChrome');
    }
    return `// ---- ${rel} ${'-'.repeat(Math.max(0, 62 - rel.length))}\n${code.trim()}\n`;
  });

  const version = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
  const bundle = `/* NST Attendance — mobile bookmarklet, v${version}
 * https://github.com/yats0x7/nst-attendance
 *
 * Built from the extension's own source by scripts/build-mobile.mjs. Runs only
 * on a my.newtonschool.co page, reads only that page's session, sends nothing
 * anywhere. MIT licensed.
 */
(function () {
'use strict';
var __nstDev = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname);
if (!/(^|\\.)my\\.newtonschool\\.co$/.test(location.hostname) && !__nstDev) {
  alert('Open a course page on my.newtonschool.co first, then tap this again.');
  return;
}
${PRELUDE}
${parts.join('\n')}
})();
`;

  return { bundle, version };
}

export const BUNDLE_PATH = join(ROOT, 'docs/nst-mobile.js');

// Only write when run as a script; importing it must stay side-effect free.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { bundle, version } = buildBundle();
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(BUNDLE_PATH, bundle);
  console.log(`docs/nst-mobile.js  ${(bundle.length / 1024).toFixed(1)} KB  (v${version})`);
}
