# Contributing

This started as one student's problem with one portal. If your batch, your
college or your attendance rules work differently, that is worth an issue even
if you never send code — the pairing heuristics and the schedule model are the
parts most likely to be wrong for someone else.

## Running it

There is no build step and no dependencies. Node 20 or newer, and Chrome.

```bash
git clone https://github.com/yats0x7/nst-attendance.git
cd nst-attendance
npm test
```

To load it: `chrome://extensions` → **Developer mode** → **Load unpacked** →
pick this folder. After editing, press reload on the extension card and
refresh the portal tab.

## Looking at the UI without the portal

Every surface has a harness with fixed demo data, so you never need a real
session or your own attendance to work on the interface.

```bash
python3 dev/serve.py 8731
```

| Page | What it shows |
| --- | --- |
| `dev/preview.html` | The card, in every state it can reach |
| `dev/popup-preview.html` | The toolbar popup, with and without cached data |
| `dev/options-preview.html` | The settings page against a fake `chrome.storage` |
| `dev/shots/mobile.html` | The phone sheet at 390px |

The server sends `no-store`. The default `http.server` does not, and a cached
module silently serving the previous version will cost you an hour.

## What the code is shaped like

- `src/lib/` is pure: arithmetic, grouping, the schedule model, storage
  helpers. No DOM and no `chrome.*` beyond `src/lib/storage.js`, which is why
  `node --test` can run it directly.
- `src/lib/adapters/api-adapter.js` holds every `fetch` in the project.
- `src/content/panel.js` renders; it never fetches. The host passes handlers in.
- `mobile/` is the phone entry point. `scripts/build-mobile.mjs` flattens the
  same modules into one script, so the phone and the desktop card cannot drift.
  Rebuild with `npm run build:mobile` and commit `docs/nst-mobile.js` — CI
  fails if it is stale.

[DESIGN.md](DESIGN.md) records the visual system and, more usefully, the things
this card deliberately refuses. [PRODUCT.md](PRODUCT.md) records who it is for.
Read them before changing how anything looks; both exist so that decisions
already made do not get re-litigated by accident.

## Changes to arithmetic

Anything that moves a number needs a test that fails without the change.
A wrong skip count is not a cosmetic bug — it is what gets someone to miss a
class they could not afford. The same goes for anything that could present
stale data as current.

## Before opening a pull request

```bash
npm test
node scripts/check-release.mjs
```

Describe what you changed and what you looked at. Small pull requests get read
and merged; large ones mostly do not.

## Releasing

Maintainers only.

```bash
node scripts/set-version.mjs 1.1.0   # manifest, package.json, phone bundle
# write the CHANGELOG.md section
git commit -am "Release 1.1.0"
git tag v1.1.0
git push && git push --tags
```

The tag does the rest: tests run, the zip is built, and the release notes come
from the changelog section for that version.
