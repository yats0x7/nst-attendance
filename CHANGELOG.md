# Changelog

Notable changes to NST Attendance. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Because the extension is installed unpacked, it does not update itself. Each
release here is something you have to download — the popup links to this page
for that reason.

## [Unreleased]

## [1.0.0] - 2026-10-09

First public release.

### Added

- **Combined subject attendance.** The portal lists a subject and its lab as
  two separate courses. The card reads both, adds the raw class counts, and
  shows the one percentage that actually decides eligibility. Pairing is
  automatic from course names, with a manual override for the cases it misses.
- **One sentence per subject**, not a dashboard: how many classes you can still
  miss, or how many you must attend in a row to climb back above the line, or
  that the target is no longer reachable and what to do about it.
- **Term projections.** Tell the extension how long your term runs and how many
  classes a week a subject has, and the card switches from "you can skip 3 more
  right now" to "miss at most 3 of your 12 remaining classes". One control sets
  up the common case; per-subject rows cover anything that runs differently.
- **A phone bookmarklet.** No mobile browser runs extensions, so the same code
  is bundled into a bookmarklet that opens a sheet over the portal page.
  Install it from <https://yats0x7.github.io/nst-attendance/>.
- **Toolbar popup** showing the last loaded numbers, so you can check without
  opening the portal, and a badge counting subjects below target.
- **Missed-class lists.** Expand a subject on the portal page to see the dates
  you were marked absent.
- **Adjustable target** between 1% and 99%, for programmes that do not use 75%.
- `Alt+Shift+A` opens the popup.

### Security and privacy

- No backend, no analytics, no third-party code at runtime. Network access is
  limited to `my.newtonschool.co`, which is the only host the manifest grants.
- Attendance is read through the portal's own API using the session already in
  your browser. Nothing is transmitted anywhere else, and nothing is stored
  outside your own browser profile.
- Full detail in [PRIVACY.md](PRIVACY.md).

[Unreleased]: https://github.com/yats0x7/nst-attendance/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yats0x7/nst-attendance/releases/tag/v1.0.0
