# Design

<!-- The visual system as shipped, so later work refines it rather than re-inventing it. -->

## World

Operate mode. The card extends the portal's own light, neutral, system-sans product UI and must read as native to that page; the popup and settings follow the OS scheme. No brand accent. Restraint in chrome; the sentence carries the weight.

## Hierarchy rule

The sentence is the product. Every row: **subject name** (14/600, secondary ink) → **instruction** (16, `<strong>` at 700 in the band colour, qualifier at 400 in primary ink) → **figure** (20/600, band colour, right-aligned as evidence) → **meta line** (12, counts left, missed-classes control right) → **bar** only when the subject is at risk, because only then does the gap between fill and target tick carry information. No semester-wide total: no rule uses it, and it can make a student with a failing subject feel safe.

## Type

One family: the platform sans stack. Fixed rem ramp, four roles, ratio ≈1.2:

| Token | Size | Role |
|---|---|---|
| `--t-meta` | 0.75rem (12) | captions, counts, controls, footer |
| `--t-body` | 0.875rem (14) | subject name, notices, base |
| `--t-lead` | 1rem (16) | the instruction sentence |
| `--t-title` / `--t-figure` | 1.25rem (20) | card title; percentage |

Compact (popup): title 1.0625rem, sentence 0.875rem, figure 1.0625rem. Tabular numerals on the card.

## Colour

Semantic only. Tokens are defined once on `:host` and redefined under `prefers-color-scheme: dark`; no rule names a colour literal.

| Band | Meaning | Light text/fill | Dark text / fill |
|---|---|---|---|
| `--ok` | at or above target | `#15803d` (5.0:1) | `#4ade80` / `#22c55e` (10.2:1) |
| `--warn` | below, recoverable | `#b45309` (5.0:1) | `#fbbf24` / `#f59e0b` (10.6:1) |
| `--bad` | target out of reach | `#b91c1c` (6.5:1) | `#f87171` / `#ef4444` |
| `--none` | no classes yet | `#6b7280` / fill `#9ca3af` | `#a1a5ad` / `#4b5563` (7.2:1) |

Neutrals: `--ink` `#111318`/`#e8e8ea`; `--ink-2` `#4b5563`/`#b4b8bf` (secondary, ≥7.6:1); `--ink-3` `#5f6672`/`#a1a5ad` (meta, ≥5.7:1); `--hairline` = `--track` `#e5e7eb`/`#2a2c30`; `--tick` `#6b7280`/`#9ca3af` (≥3:1 vs track). Notices: warn `#fef3c7`/`#92400e` and `#2b2410`/`#fcd34d`; info `#f3f4f6`/`#374151` and `#1f2124`/`#d4d4d8`. Error card `#fef2f2`/`#991b1b` and `#2a1416`/`#fca5a5` — the error body inherits the error ink, never neutral grey. Focus `#2563eb` / `#60a5fa`.

Colour is never the only encoding: every band has a sentence that names the state.

## Layout

Single container (12px radius, 1px hairline) containing rows separated by 1px hairlines — no nested boxes. Row grid: `"name pct" "verdict pct" "meta meta" "bar bar" "hint hint" "list list"`, 16px column gap, 14px/12px vertical padding. Missed-class rows are a three-column grid (`max-content max-content minmax(0,1fr)`) so the title ellipsizes instead of overflowing at any width.

## Controls

Text-styled buttons (`button.link`) carry a ≥24px hit area via padding with negative margins so the line height is unchanged. Refresh stays focusable while busy (`aria-busy`, clicks ignored) so keyboard focus is never thrown to `<body>`. Toggles carry `aria-expanded` and `aria-controls`; lists carry ids and `aria-busy` while loading. The loading skeleton is a `role="status"` region with visually hidden text. Settings is reachable from the card header ("Target 75% · Settings").

## Motion

One authored moment: a missed-class list reveals with a 180ms opacity/2px rise, `cubic-bezier(0.16, 1, 0.3, 1)`. Skeleton shimmer and the busy spinner are state feedback. Under `prefers-reduced-motion: reduce` the shimmer flattens to a solid, the spinner stops (dimmed), the reveal is removed.

## Copy

Controls name their action ("Show 6 missed classes", "Refresh", "Open the portal"). Every error names the fact and the recovery. Numbers are never presented as a plan the card cannot vouch for: a recovery streak over 10 classes without a schedule says so and points to Settings; an unreachable target names a next step. Counts read "Lecture 6/8 · Lab 4/8 attended".

## Refuse (category defaults this card declines)

Nested cards; the hero-metric tile; a semester total; glyphs standing in for icons (native disclosure marker in Settings); colour as decoration; motion that does not convey state; opening a browser tab as a side effect.
