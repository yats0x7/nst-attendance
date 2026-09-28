/**
 * The attendance card injected into the portal (and reused by the popup).
 *
 * Rendering is a pure function of state, and all styling lives inside a Shadow
 * DOM so the portal's CSS and this card's CSS cannot reach each other. The
 * portal is a Next.js app that re-renders aggressively; anything that leaked
 * styles either way would break on their next deploy.
 *
 * The sentence is the product. Each row leads with the subject and the one
 * instruction the student needs; the percentage sits beside it as evidence.
 *
 * Interaction is delegated: the card marks controls with `data-action` and the
 * host (mount.js or popup.js) supplies handlers. The card never fetches.
 */

import { componentLabel } from '../lib/grouping.js';

/**
 * @typedef {object} PanelState
 * @property {'loading'|'ready'|'empty'|'error'} status
 * @property {Array<{ key: string, label: string, units: object[], summary: object, overrun?: boolean }>} [subjects]
 * @property {number} [targetPercent]
 * @property {number} [updatedAt]      epoch ms of the data being shown
 * @property {boolean} [stale]         data is older than the TTL
 * @property {boolean} [refreshing]    a refresh is in flight
 * @property {string} [error]
 * @property {'auth'|'network'|'shape'|'unknown'} [errorKind]
 * @property {{ kind: 'auth'|'network'|'shape'|'unknown', text?: string }} [notice]  a problem worth showing alongside good cached numbers
 * @property {boolean} [compact]       render for a narrow surface (the popup)
 * @property {boolean} [canExpand]     allow per-subject missed-class lists (needs a portal session)
 * @property {boolean} [canOpenSettings] show the Settings route in the header
 * @property {number} [skeletonCount]  rows to sketch while loading
 * @property {Set<string>} [expanded]  subject keys with the list open
 * @property {Record<string, { status: 'loading'|'ready'|'error', items?: object[], error?: string }>} [missed]
 */

/**
 * @typedef {object} PanelHandlers
 * @property {() => void} [onRefresh]
 * @property {(key: string) => void} [onToggleMissed]
 * @property {() => void} [onOpenSettings]
 */

/*
 * Tokens. Light values on :host; dark redefines the same names, so every rule
 * below is written once. Band colours are semantic only — green at or above
 * target, amber below but recoverable, red when the target is out of reach,
 * grey for no data — and each pair is checked against its surface at 4.5:1 for
 * text and 3:1 for graphics in both schemes.
 *
 * Type scale is a fixed rem ramp of four roles (12 / 14 / 16 / 20, ratio ≈1.2)
 * in one family, as Operate-mode product UI wants: stable, scannable, and it
 * follows the browser's font-size setting.
 */
const STYLES = `
:host {
  all: initial;
  display: block;

  --surface: #ffffff;
  --ink: #111318;
  --ink-2: #4b5563;      /* secondary text, 7.6:1 */
  --ink-3: #5f6672;      /* captions/meta, 5.7:1 */
  --hairline: #e5e7eb;
  --track: #e5e7eb;
  --tick: #6b7280;       /* target tick on the track, 3.0:1+ vs track */
  --focus: #2563eb;

  /* Light fills reuse the band text colours so the bar clears 3:1 on white. */
  --ok: #15803d;   --ok-fill: #15803d;
  --warn: #b45309; --warn-fill: #b45309;
  --bad: #b91c1c;  --bad-fill: #b91c1c;
  --none: #6b7280; --none-fill: #9ca3af;

  --notice-warn-bg: #fef3c7; --notice-warn-ink: #92400e;
  --notice-info-bg: #f3f4f6; --notice-info-ink: #374151;
  --err-bg: #fef2f2; --err-ink: #991b1b;
  --skeleton-a: #f3f4f6; --skeleton-b: #e9eaee;

  --t-meta: 0.75rem;   /* 12 */
  --t-body: 0.875rem;  /* 14 */
  --t-lead: 1rem;      /* 16 */
  --t-title: 1.25rem;  /* 20 */
  --t-figure: 1.25rem; /* 20 */
}
@media (prefers-color-scheme: dark) {
  :host {
    --surface: #17181a;
    --ink: #e8e8ea;
    --ink-2: #b4b8bf;    /* 9.2:1 */
    --ink-3: #a1a5ad;    /* 7.2:1 */
    --hairline: #2a2c30;
    --track: #2a2c30;
    --tick: #9ca3af;
    --focus: #60a5fa;

    --ok: #4ade80;   --ok-fill: #22c55e;
    --warn: #fbbf24; --warn-fill: #f59e0b;
    --bad: #f87171;  --bad-fill: #ef4444;
    --none: #a1a5ad; --none-fill: #4b5563;

    --notice-warn-bg: #2b2410; --notice-warn-ink: #fcd34d;
    --notice-info-bg: #1f2124; --notice-info-ink: #d4d4d8;
    --err-bg: #2a1416; --err-ink: #fca5a5;
    --skeleton-a: #1e2023; --skeleton-b: #26282c;
  }
}

* { box-sizing: border-box; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.card {
  font: var(--t-body)/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  padding: 20px 24px 14px;
  margin: 24px 0;
  font-variant-numeric: tabular-nums;
}
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; }
h2 { font-size: var(--t-title); font-weight: 700; margin: 0; letter-spacing: -0.01em; line-height: 1.25; }
.meta { display: flex; align-items: center; gap: 4px 14px; flex-wrap: wrap; }
.sub { color: var(--ink-3); font-size: var(--t-meta); margin: 2px 0 6px; }

/* Text-styled controls with a real hit area: ≥24px tall without disturbing the line. */
button.link {
  font: inherit; font-size: var(--t-meta); color: var(--ink-2); background: none; border: 0;
  padding: 6px 0; margin: -6px 0; min-height: 24px;
  cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  border-radius: 4px;
}
button.link:hover { color: var(--ink); text-decoration-color: currentColor; }
button.link[aria-busy="true"] { cursor: progress; color: var(--ink-3); text-decoration: none; }
button.link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.notice { display: flex; gap: 8px; align-items: baseline; font-size: var(--t-body); padding: 10px 14px; border-radius: 8px; margin: 10px 0 4px; }
.notice.auth, .notice.shape { background: var(--notice-warn-bg); color: var(--notice-warn-ink); }
.notice.network, .notice.unknown { background: var(--notice-info-bg); color: var(--notice-info-ink); }
.notice strong { font-weight: 700; }

.rows { display: block; margin-top: 6px; }

/* Rows are separated by hairlines, not boxed. Grid: name | figure, sentence | figure, meta, bar. */
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "name pct" "verdict pct" "meta meta" "bar bar" "hint hint" "list list";
  column-gap: 16px;
  padding: 14px 0 12px;
  border-top: 1px solid var(--hairline);
}
.row:first-child { border-top: 0; padding-top: 8px; }
.name { grid-area: name; font-size: var(--t-body); font-weight: 600; color: var(--ink-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
.verdict { grid-area: verdict; font-size: var(--t-lead); font-weight: 600; line-height: 1.35; margin-top: 2px; letter-spacing: -0.005em; }
.verdict strong { font-weight: 700; }
.verdict .rest { font-weight: 400; color: var(--ink); }
.pct { grid-area: pct; align-self: start; font-size: var(--t-figure); font-weight: 600; line-height: 1.3; text-align: right; padding-top: 1px; }
.meta-line { grid-area: meta; display: flex; align-items: baseline; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; margin-top: 6px; color: var(--ink-3); font-size: var(--t-meta); }
.counts { min-width: 0; }
.counts .sep { margin: 0 6px; color: var(--hairline); }
.bar { grid-area: bar; position: relative; height: 4px; border-radius: 2px; background: var(--track); margin-top: 8px; overflow: visible; }
.fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; }
.mark { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--tick); border-radius: 1px; }
.hintline { grid-area: hint; font-size: var(--t-meta); color: var(--notice-warn-ink); margin-top: 6px; }

.ok .verdict, .ok .pct { color: var(--ok); }     .ok .fill { background: var(--ok-fill); }
.warn .verdict, .warn .pct { color: var(--warn); } .warn .fill { background: var(--warn-fill); }
.bad .verdict, .bad .pct { color: var(--bad); }   .bad .fill { background: var(--bad-fill); }
.none .verdict, .none .pct { color: var(--none); } .none .fill { background: var(--none-fill); }

.missed { grid-area: list; margin: 8px 0 0; padding: 0; list-style: none; font-size: var(--t-meta); display: grid; gap: 4px; }
.missed li { display: grid; grid-template-columns: max-content max-content minmax(0, 1fr); gap: 8px; align-items: baseline; color: var(--ink-2); }
.missed .when { white-space: nowrap; }
.missed .what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); }
.missed .tag { font-size: 0.6875rem; color: var(--ink-3); border: 1px solid var(--hairline); border-radius: 999px; padding: 0 6px; white-space: nowrap; line-height: 1.5; }
.missed .tag + .tag { margin-left: 6px; }
.missed .muted { color: var(--ink-3); grid-column: 1 / -1; }
.missed.reveal { animation: reveal 180ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes reveal { from { opacity: 0; transform: translateY(-2px); } }

.note { margin: 12px 0 0; font-size: var(--t-meta); color: var(--ink-3); }
.err { border-color: color-mix(in srgb, var(--err-ink) 30%, var(--hairline)); background: var(--err-bg); color: var(--err-ink); }
.err h2, .err .sub, .err .note { color: var(--err-ink); }
.err .sub { opacity: 0.85; }

.skeleton { height: 58px; border-radius: 8px; margin: 10px 0; background: linear-gradient(90deg, var(--skeleton-a) 25%, var(--skeleton-b) 37%, var(--skeleton-a) 63%); background-size: 400% 100%; animation: sh 1.2s ease infinite; }
@keyframes sh { 0% { background-position: 100% 50% } 100% { background-position: 0 50% } }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { display: inline-block; width: 10px; height: 10px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -1px; margin-right: 5px; }

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; background: var(--skeleton-a); }
  .spin { animation: none; border-right-color: currentColor; opacity: 0.6; }
  .missed.reveal { animation: none; }
}

/* Compact mode — the 360px toolbar popup, where the card is the whole window
   rather than a block inside a wide page. It owns all of the popup's spacing;
   popup.html adds none of its own. */
.card.compact { margin: 0; padding: 14px 16px 8px; border: 0; border-radius: 0; }
.card.compact h2 { font-size: 1.0625rem; }
.card.compact .verdict { font-size: var(--t-body); }
.card.compact .pct { font-size: 1.0625rem; }
.card.compact .row { padding: 12px 0 10px; }
`;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/** Which colour band a subject falls in. */
export function tone(summary) {
  if (summary.headline === 'no-data') return 'none';
  if (summary.headline === 'unreachable') return 'bad';
  return summary.meetsTarget ? 'ok' : 'warn';
}

/**
 * The single definition of "this subject needs attention". The card's ordering,
 * its footer count and the toolbar badge all read this, so they cannot drift.
 */
export function isAtRisk(summary) {
  const band = tone(summary);
  return band === 'warn' || band === 'bad';
}

/**
 * Subjects that need attention first; everything else in the portal's own
 * order. A stable partition rather than a sort by percentage, so a student
 * comparing the card against the sidebar still finds things where they expect.
 */
export function orderSubjects(subjects) {
  const list = subjects ?? [];
  const atRisk = list.filter((s) => isAtRisk(s.summary));
  const rest = list.filter((s) => !isAtRisk(s.summary));
  return [...atRisk, ...rest];
}

/**
 * Where the schedule controls live, which differs by surface: the extension has
 * a Settings page, the phone sheet puts them directly under the list. Copy that
 * points somewhere the reader cannot go is worse than no pointer at all.
 */
let settingsWhere = 'in Settings';

/** @param {string} where e.g. 'in Settings' or 'below' */
export function setSettingsWhere(where) {
  settingsWhere = where;
}

/**
 * A recovery streak longer than this is arithmetic, not a plan. Without a
 * schedule the card cannot know whether that many classes are even left, so it
 * says so instead of presenting the number as an instruction.
 */
const PLAUSIBLE_STREAK = 10;

/**
 * The one sentence that answers "so what do I do".
 *
 * Returns HTML: the instruction in <strong>, the qualifier in <span class="rest">.
 * When schedule data is available the term budget is the useful number — "3 of
 * your 12 remaining classes" is actionable in a way that an open-ended skip
 * count is not — so it leads, and the consecutive-miss figure is dropped rather
 * than shown alongside it to compete for attention.
 */
export function verdictText(summary) {
  const targetLabel = `${+(summary.target * 100).toFixed(2)}%`;
  // A projection over zero remaining classes has nothing to say; portal.js
  // already withholds it, but never let "Attend all 0 remaining classes" render.
  const projection = summary.projection && summary.projection.remaining > 0 ? summary.projection : null;
  const rest = (text) => `<span class="rest">${text}</span>`;

  switch (summary.headline) {
    case 'no-data':
      return projection
        ? `<strong>No classes yet.</strong> ${rest(`${projection.remaining} to come — you can miss ${projection.skipsLeft} of them.`)}`
        : `<strong>No classes held yet.</strong>`;

    case 'unreachable': {
      if (!projection) {
        return `<strong>Below ${targetLabel}.</strong> ${rest(`Add your term schedule ${settingsWhere} to see whether it is still reachable.`)}`;
      }
      const best = `${(projection.bestReachable * 100).toFixed(1)}%`;
      return `<strong>${targetLabel} is out of reach this term.</strong> ${rest(
        `Attending every remaining class lands at ${best}. Attend what is left to limit the shortfall, and ask your coordinator what your options are.`
      )}`;
    }

    case 'recover': {
      const need = summary.classesToRecover;
      if (projection) {
        // Below target but the term can still carry them: the budget over the
        // remaining classes is more useful than an unbroken attendance streak,
        // and it already accounts for climbing back up.
        if (projection.skipsLeft === 0) {
          return `<strong>Attend all ${plural(projection.remaining, 'remaining class', 'remaining classes')}</strong> ${rest(`to finish at ${targetLabel}.`)}`;
        }
        return `<strong>Miss at most ${projection.skipsLeft} of your ${projection.remaining} remaining classes.</strong> ${rest(
          `You cross ${targetLabel} after ${plural(need, 'class', 'classes')} in a row.`
        )}`;
      }
      if (need > PLAUSIBLE_STREAK) {
        return `<strong>Attend every class from here.</strong> ${rest(
          `Whether ${targetLabel} is still reachable depends on how many classes are left — add your term schedule ${settingsWhere} to find out.`
        )}`;
      }
      return `<strong>Attend the next ${plural(need, 'class', 'classes')} in a row</strong> ${rest(`to reach ${targetLabel}.`)}`;
    }

    case 'skips':
    default: {
      if (projection) {
        return projection.skipsLeft === 0
          ? `<strong>Attend all ${plural(projection.remaining, 'remaining class', 'remaining classes')}</strong> ${rest(`to stay at ${targetLabel}.`)}`
          : `<strong>Can skip ${projection.skipsLeft} of your ${plural(projection.remaining, 'remaining class', 'remaining classes')}.</strong>`;
      }
      return summary.skipsAffordable === 0
        ? `<strong>No room to skip</strong> ${rest(`— you are exactly at ${targetLabel}.`)}`
        : `<strong>Can skip ${plural(summary.skipsAffordable, 'more class', 'more classes')}</strong> ${rest(`and stay above ${targetLabel}.`)}`;
    }
  }
}

/** "Lecture 8/8 · Lab 6/7 attended", or "8/8 classes attended" for a single component. */
export function countsText(subject) {
  const s = subject.summary;
  if (subject.units.length <= 1) return `${s.attended}/${s.held} classes attended`;
  return (
    subject.units
      .map((u) => `${escapeHtml(componentLabel(u))} ${Number(u.attended) || 0}/${Number(u.held) || 0}`)
      .join('<span class="sep">·</span>') + ' attended'
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function listId(key) {
  return `missed-${String(key).replace(/[^a-z0-9]+/gi, '-')}`;
}

function renderMissedList(state, subject, justOpened) {
  const entry = state.missed?.[subject.key];
  const cls = `missed${justOpened ? ' reveal' : ''}`;
  const id = listId(subject.key);
  if (!entry || entry.status === 'loading') {
    return `<ul class="${cls}" id="${id}" aria-busy="true"><li class="muted"><span class="spin" aria-hidden="true"></span>Loading missed classes…</li></ul>`;
  }
  if (entry.status === 'error') {
    return `<ul class="${cls}" id="${id}"><li class="muted">Couldn't load the list${
      entry.error ? ` (${escapeHtml(entry.error)})` : ''
    }.</li></ul>`;
  }
  if (!entry.items?.length) {
    return `<ul class="${cls}" id="${id}"><li class="muted">No missed classes recorded.</li></ul>`;
  }
  return `<ul class="${cls}" id="${id}">${entry.items
    .map(
      (m) => `<li>
        <span class="when">${escapeHtml(formatDate(m.start))}</span>
        <span class="tag">${escapeHtml(m.component)}</span>
        <span class="what" title="${escapeHtml(m.title ?? '')}">${m.title ? escapeHtml(m.title) : ''}${
          m.waived ? '<span class="tag">waived</span>' : ''
        }</span>
      </li>`
    )
    .join('')}</ul>`;
}

function renderRow(state, subject, opened) {
  const s = subject.summary;
  const pct = s.percentage === null ? null : s.percentage * 100;
  const width = Math.max(0, Math.min(100, pct ?? 0));
  const markAt = Math.max(0, Math.min(100, s.target * 100));
  const missedCount = Math.max(0, s.held - s.attended);
  const expanded = state.expanded?.has?.(subject.key) === true;
  const band = tone(s);

  let missedControl = '';
  if (s.held > 0) {
    if (missedCount === 0) {
      missedControl = `<span>No classes missed</span>`;
    } else if (state.canExpand) {
      missedControl = `<button class="link" type="button" data-action="missed" data-key="${escapeHtml(subject.key)}" aria-expanded="${expanded}" aria-controls="${listId(subject.key)}">${
        expanded ? 'Hide' : 'Show'
      } ${plural(missedCount, 'missed class', 'missed classes')}</button>`;
    } else {
      missedControl = `<span>${plural(missedCount, 'missed class', 'missed classes')}</span>`;
    }
  }

  // The bar only earns its place where the gap between the fill and the target
  // tick carries information a student acts on.
  const bar = isAtRisk(s)
    ? `<div class="bar" aria-hidden="true"><div class="fill" style="width:${width}%"></div><div class="mark" style="left:${markAt}%"></div></div>`
    : '';

  const overrunLine = subject.overrun
    ? `<div class="hintline">Your term schedule says this subject has ended, but classes are still running — fix it ${settingsWhere}.</div>`
    : '';

  return `
    <div class="row ${band}" data-key="${escapeHtml(subject.key)}">
      <div class="name" title="${escapeHtml(subject.units.map((u) => u.name).join(' + '))}">${escapeHtml(subject.label)}</div>
      <div class="pct" aria-label="${pct === null ? 'no attendance yet' : pct.toFixed(1) + ' percent attendance'}">${pct === null ? '—' : pct.toFixed(1) + '%'}</div>
      <p class="verdict">${verdictText(s)}</p>
      <div class="meta-line"><span class="counts">${countsText(subject)}</span>${missedControl}</div>
      ${bar}
      ${overrunLine}
      ${expanded ? renderMissedList(state, subject, opened === subject.key) : ''}
    </div>`;
}

/** Copy for each kind of problem. Shared by the full error card and the notice strip. */
export function problemText(kind, detail) {
  switch (kind) {
    case 'auth':
      return 'Your portal session has expired. Log in to the portal again and this will pick up on its own.';
    case 'network':
      return "Couldn't reach the portal. Check your connection and try Refresh.";
    case 'shape':
      return "The portal's data doesn't look like it used to, so no numbers are shown rather than wrong ones. Check the Chrome Web Store for an update to this extension.";
    default:
      return `Couldn't read your attendance from the portal${
        detail ? ` (${escapeHtml(detail)})` : ''
      }. Try Refresh; if it keeps happening the portal has probably changed.`;
  }
}

function renderNotice(state) {
  if (!state.notice) return '';
  const kind = state.notice.kind ?? 'unknown';
  const lead = kind === 'shape' ? 'Heads up.' : 'Showing saved numbers.';
  return `<div class="notice ${escapeHtml(kind)}" role="status"><strong>${lead}</strong> <span>${
    state.notice.text ? escapeHtml(state.notice.text) : problemText(kind)
  }</span></div>`;
}

function renderBody(state, opened) {
  if (state.status === 'loading') {
    const n = Math.max(1, Math.min(8, state.skeletonCount ?? 3));
    return `<div class="rows" role="status" aria-busy="true"><span class="sr-only">Loading attendance…</span>${'<div class="skeleton" aria-hidden="true"></div>'.repeat(n)}</div>`;
  }

  if (state.status === 'empty') {
    return `<p class="note">Nothing to show yet. Open any course page on the portal and the card there will load your attendance; this popup then shows the same numbers.</p>`;
  }

  if (state.status === 'error') {
    // Deliberately shows nothing numeric. A wrong attendance figure would make
    // someone skip a class they cannot afford, so no data beats guessed data.
    return `<p class="note">${problemText(state.errorKind, state.error)}</p>`;
  }

  if (!state.subjects?.length) {
    return '<p class="note">No subjects found on this page.</p>';
  }

  return `${renderNotice(state)}<div class="rows">${orderSubjects(state.subjects)
    .map((s) => renderRow(state, s, opened))
    .join('')}</div>`;
}

function footer(state) {
  if (state.status !== 'ready') return '';
  const subjects = state.subjects ?? [];
  const bits = [];
  if (state.updatedAt) {
    bits.push(
      `Updated ${new Date(state.updatedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`
    );
  }
  if (state.refreshing) bits.push('refreshing…');
  else if (state.stale) bits.push('may be a few minutes old');

  const anyHeld = subjects.some((s) => s.summary.held > 0);
  const atRisk = subjects.filter((s) => isAtRisk(s.summary)).length;
  if (!anyHeld) bits.push('No classes held yet.');
  else if (atRisk) bits.push(`${plural(atRisk, 'subject needs', 'subjects need')} attention, listed first.`);
  else bits.push('Every subject is on target.');
  return `<p class="note">${escapeHtml(bits.join(' · '))}</p>`;
}

function headerControls(state) {
  const target = state.targetPercent ?? 75;
  const busy = Boolean(state.refreshing);
  const settings = state.canOpenSettings
    ? `<button class="link" type="button" data-action="settings" title="Your attendance target and term schedule">Target ${target}% · Settings</button>`
    : `<span class="sub" style="margin:0">Target ${target}%</span>`;
  // Kept enabled while busy so keyboard focus is not thrown away; the host
  // ignores clicks during a refresh and aria-busy carries the state.
  const refresh = `<button class="link" type="button" data-action="refresh" aria-busy="${busy}">${
    busy ? '<span class="spin" aria-hidden="true"></span>Refreshing…' : 'Refresh'
  }</button>`;
  return `${settings}${refresh}`;
}

function ensureStyles(root) {
  if (!root.querySelector('style[data-nst]')) {
    const style = document.createElement('style');
    style.dataset.nst = '';
    style.textContent = STYLES;
    root.prepend(style);
  }
}

let headingSeq = 0;

/**
 * Render (or re-render) the card into a shadow root and bind its controls.
 *
 * Only the card element is replaced; the stylesheet is attached once so a
 * re-render does not force a style re-parse. Focus on a control survives the
 * re-render, so toggling a list from the keyboard does not lose your place.
 *
 * @param {ShadowRoot} root
 * @param {PanelState} state
 * @param {PanelHandlers} [handlers]
 */
export function renderPanel(root, state, handlers = {}) {
  ensureStyles(root);

  const focused = root.activeElement;
  const focusKey = focused?.dataset?.action
    ? `${focused.dataset.action}:${focused.dataset.key ?? ''}`
    : null;
  const opened = root.__nstJustOpened ?? null;
  root.__nstJustOpened = null;

  const existing = root.querySelector('section.card');
  const headingId = existing?.querySelector('h2')?.id || `nst-heading-${++headingSeq}`;

  const section = document.createElement('section');
  section.className = `card ${state.compact ? 'compact' : ''} ${state.status === 'error' ? 'err' : ''}`.trim();
  section.setAttribute('aria-labelledby', headingId);
  section.innerHTML = `
      <div class="head">
        <h2 id="${headingId}">Subject attendance</h2>
        <span class="meta">${headerControls(state)}</span>
      </div>
      <p class="sub">Lectures and labs counted together, per subject.</p>
      ${renderBody(state, opened)}
      ${footer(state)}`;

  if (existing) existing.replaceWith(section);
  else root.append(section);

  section.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    if (state.refreshing) return;
    handlers.onRefresh?.();
  });
  section.querySelector('[data-action="settings"]')?.addEventListener('click', () => {
    handlers.onOpenSettings?.();
  });
  for (const btn of section.querySelectorAll('[data-action="missed"]')) {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') !== 'true') root.__nstJustOpened = btn.dataset.key;
      handlers.onToggleMissed?.(btn.dataset.key);
    });
  }

  if (focusKey) {
    const [action, key] = focusKey.split(':');
    const again = key
      ? section.querySelector(`[data-action="${action}"][data-key="${CSS.escape(key)}"]`)
      : section.querySelector(`[data-action="${action}"]`);
    again?.focus({ preventScroll: true });
  }
}

/** Create the host element and its shadow root, ready for renderPanel. */
export function createPanelHost(id = 'nst-attendance-panel') {
  const host = document.createElement('div');
  host.id = id;
  const root = host.attachShadow({ mode: 'open' });
  ensureStyles(root);
  return { host, root };
}
