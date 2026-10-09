/**
 * The mobile entry point.
 *
 * Runs as a bookmarklet on a my.newtonschool.co page, which is the only way to
 * read attendance on a phone: Chrome has no extensions on Android or iOS, and
 * the portal sends no CORS headers, so nothing hosted on another origin can
 * call its API. Running on the portal's own page means the session already in
 * the browser is the session used — nothing is pasted, nothing is proxied.
 *
 * Everything above this file is the extension's own code, bundled unchanged, so
 * the phone and the desktop card can never disagree about a number.
 */

(function mountSheet() {
  const HOST_ID = 'nst-mobile-sheet';
  // There is no Settings page on a phone; the controls sit under the list.
  setSettingsWhere('below');
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    // Running the bookmarklet again closes it, so the same tap toggles.
    existing.remove();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);

  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="scrim" data-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Subject attendance">
      <header class="grip">
        <span class="handle" aria-hidden="true"></span>
        <button class="x" type="button" data-close aria-label="Close">Done</button>
      </header>
      <div class="body"><div class="panel"></div><div class="prefs"></div></div>
    </section>`;

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .shell { position: fixed; inset: 0; z-index: 2147483647;
      font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .scrim { position: absolute; inset: 0; background: rgba(0,0,0,.45); animation: fade .2s ease; }
    .sheet {
      position: absolute; left: 0; right: 0; bottom: 0;
      max-width: 560px; margin: 0 auto;
      max-height: 88vh; display: flex; flex-direction: column;
      background: #fff; color: #111318;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -8px 40px rgba(0,0,0,.3);
      padding-bottom: env(safe-area-inset-bottom, 0);
      animation: rise .26s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .grip { display: flex; align-items: center; justify-content: center; position: relative;
      padding: 10px 12px 4px; flex: 0 0 auto; }
    .handle { width: 36px; height: 4px; border-radius: 2px; background: #d4d7dd; }
    .x { position: absolute; right: 10px; top: 6px; min-height: 36px; padding: 6px 12px;
      font: inherit; font-size: .875rem; font-weight: 600; color: #4b5563;
      background: none; border: 0; border-radius: 8px; cursor: pointer; }
    .x:active { background: #eef0f3; }
    .body { overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    .prefs { padding: 0 16px 18px; }
    @keyframes rise { from { transform: translateY(100%); } }
    @keyframes fade { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .sheet, .scrim { animation: none; } }
    @media (prefers-color-scheme: dark) {
      .sheet { background: #17181a; color: #e8e8ea; }
      .handle { background: #3a3d42; }
      .x { color: #b4b8bf; } .x:active { background: #26282c; }
    }`;
  root.append(style, shell);

  const close = () => host.remove();
  for (const el of shell.querySelectorAll('[data-close]')) el.addEventListener('click', close);
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);

  const panelSlot = shell.querySelector('.panel');
  const prefsSlot = shell.querySelector('.prefs');
  const { host: cardHost, root: cardRoot } = createPanelHost('nst-mobile-card');
  panelSlot.append(cardHost);

  // --- state ---------------------------------------------------------------

  let settings = getSettingsSync();
  let units = null;
  let updatedAt = null;
  let refreshing = false;
  let notice = null;
  const expanded = new Set();
  const missed = {};

  function subjects() {
    return units ? rehydrate(units, settings) : null;
  }

  function paint(extra = {}) {
    const list = subjects();
    const base = {
      compact: true,
      targetPercent: settings.targetPercent,
      canExpand: true,
      canOpenSettings: false,
      expanded,
      missed,
      refreshing,
      notice,
      skeletonCount: 4,
    };
    renderPanel(
      cardRoot,
      list
        ? { ...base, status: 'ready', subjects: list, updatedAt, stale: false, ...extra }
        : { ...base, status: 'loading', ...extra },
      handlers
    );
    renderPrefs();
  }

  const handlers = {
    onRefresh: () => load({ force: true }),
    onToggleMissed: async (key) => {
      if (expanded.has(key)) { expanded.delete(key); paint(); return; }
      expanded.add(key);
      const subject = subjects()?.find((s) => s.key === key);
      if (!subject) return;
      if (!missed[key] || missed[key].status === 'error') {
        missed[key] = { status: 'loading' };
        paint();
        try {
          missed[key] = { status: 'ready', items: await loadMissed(subject) };
        } catch (error) {
          missed[key] = { status: 'error', error: error?.message };
        }
      }
      paint();
    },
  };

  // --- preferences ---------------------------------------------------------

  /**
   * A phone has no chrome.storage and no way to see the desktop extension's
   * settings, so these live in the portal page's own localStorage and are
   * separate from the extension's. Kept to the two things that change a number:
   * the target, and the term schedule.
   */
  function renderPrefs() {
    const sched = settings.schedule;
    const rows = (subjects() ?? []).map((s) => {
      const per = sched.perSubject?.[s.key] ?? {};
      const total = totalClasses(s.key, { ...sched, enabled: true });
      const held = s.summary.held;
      return `<tr data-key="${escapeAttr(s.key)}">
        <th scope="row">${escapeAttr(s.label)}</th>
        <td><input class="wk" type="number" min="1" inputmode="numeric" placeholder="${sched.weeks}" value="${per.weeks ?? ''}" aria-label="Weeks for ${escapeAttr(s.label)}"></td>
        <td><input class="pw" type="number" min="1" inputmode="numeric" placeholder="${sched.perWeek}" value="${per.perWeek ?? ''}" aria-label="Classes per week for ${escapeAttr(s.label)}"></td>
        <td class="tot">${total === null ? '—' : `${total} total · ${held} held`}</td>
      </tr>`;
    }).join('');

    prefsSlot.innerHTML = `
      <style>
        .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding: 12px 0; border-top: 1px solid #e5e7eb; font-size: .875rem; }
        label { display: flex; align-items: center; gap: 8px; min-height: 32px; }
        input[type=number] { width: 100%; max-width: 68px; min-width: 0; min-height: 32px; padding: 5px 8px;
          font: inherit; border: 1px solid #8a8f98; border-radius: 8px; background: transparent; color: inherit; }
        input[type=checkbox] { width: 20px; height: 20px; }
        details { border-top: 1px solid #e5e7eb; padding: 10px 0 0; font-size: .875rem; }
        summary { min-height: 32px; padding: 4px 0; cursor: pointer; }
        table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 8px; }
        th, td { text-align: left; padding: 4px 6px 4px 0; font-weight: 400;
          overflow: hidden; text-overflow: ellipsis; }
        th[scope=row] { font-weight: 600; }
        thead th { font-size: .75rem; color: #5f6672; }
        .tot { font-size: .75rem; color: #5f6672; }
        .note { margin: 10px 0 0; font-size: .75rem; color: #5f6672; }
        .preset { width: 100%; min-height: 44px; margin: 10px 0 0; padding: 10px 14px;
          font: inherit; font-weight: 600; border: 1px solid #111318; border-radius: 10px;
          background: #111318; color: #fff; cursor: pointer; }
        @media (prefers-color-scheme: dark) {
          .row, details { border-color: #2a2c30; }
          input[type=number] { border-color: #6b7280; }
          thead th, .tot, .note { color: #a1a5ad; }
          .preset { background: #e8e8ea; color: #17181a; border-color: #e8e8ea; }
        }
      </style>
      <div class="row">
        <label>Target
          <input id="t" type="number" min="1" max="99" inputmode="numeric" value="${settings.targetPercent}" aria-label="Attendance target percentage">%
        </label>
        <label><input id="se" type="checkbox" ${sched.enabled ? 'checked' : ''}> I know my term schedule</label>
      </div>
      ${sched.enabled ? '' : `
      <button class="preset" id="sx" type="button">Use ${SCHEDULE_PRESET.weeks} weeks &times; ${SCHEDULE_PRESET.perWeek} classes a week</button>
      <p class="note">That is ${SCHEDULE_PRESET.label}. Tap it to see how many of your remaining classes you can miss, then adjust anything that does not match your timetable.</p>`}
      ${sched.enabled ? `
      <details${rows ? '' : ' hidden'}>
        <summary>Term schedule — ${sched.weeks} weeks × ${sched.perWeek} classes/week by default</summary>
        <div class="row" style="border:0;padding-top:8px">
          <label>Weeks <input id="sw" type="number" min="1" inputmode="numeric" value="${sched.weeks}" aria-label="Weeks in term"></label>
          <label>× <input id="sp" type="number" min="1" inputmode="numeric" value="${sched.perWeek}" aria-label="Classes per week"></label>
        </div>
        <table>
          <thead><tr><th scope="col">Subject</th><th scope="col">Weeks</th><th scope="col">/week</th><th scope="col">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="note">Leave a row blank to use the defaults. These settings are saved on this phone only.</p>
      </details>` : ''}`;

    const num = (el) => {
      const v = Number(el.value);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    prefsSlot.querySelector('#t').addEventListener('change', (e) => {
      save({ targetPercent: num(e.target) ?? DEFAULT_SETTINGS.targetPercent });
    });
    prefsSlot.querySelector('#se').addEventListener('change', (e) => {
      save({ schedule: { ...settings.schedule, enabled: e.target.checked } });
    });
    prefsSlot.querySelector('#sx')?.addEventListener('click', () => {
      save({
        schedule: {
          ...settings.schedule,
          enabled: true,
          weeks: SCHEDULE_PRESET.weeks,
          perWeek: SCHEDULE_PRESET.perWeek,
        },
      });
    });
    prefsSlot.querySelector('#sw')?.addEventListener('change', (e) => {
      save({ schedule: { ...settings.schedule, weeks: num(e.target) ?? 12 } });
    });
    prefsSlot.querySelector('#sp')?.addEventListener('change', (e) => {
      save({ schedule: { ...settings.schedule, perWeek: num(e.target) ?? 4 } });
    });
    for (const tr of prefsSlot.querySelectorAll('tbody tr')) {
      for (const [cls, field] of [['.wk', 'weeks'], ['.pw', 'perWeek']]) {
        tr.querySelector(cls).addEventListener('change', (e) => {
          const perSubject = { ...settings.schedule.perSubject };
          const entry = { ...(perSubject[tr.dataset.key] ?? {}) };
          const v = num(e.target);
          if (v === null) delete entry[field];
          else entry[field] = v;
          if (Object.keys(entry).length) perSubject[tr.dataset.key] = entry;
          else delete perSubject[tr.dataset.key];
          save({ schedule: { ...settings.schedule, perSubject } });
        });
      }
    }
  }

  function save(patch) {
    settings = saveSettingsSync(patch);
    paint();
  }

  function escapeAttr(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // --- data ----------------------------------------------------------------

  async function load({ force = false } = {}) {
    // Screenshot and layout harness only. The bundle refuses to run anywhere
    // but the portal and localhost, so this is unreachable on a real page.
    if (__nstDev && globalThis.__NST_MOBILE_FIXTURE) {
      units = globalThis.__NST_MOBILE_FIXTURE;
      updatedAt = Date.now();
      refreshing = false;
      paint();
      return;
    }
    const courseHash = courseHashFromUrl();
    if (!courseHash) {
      renderPanel(cardRoot, {
        status: 'error', compact: true, errorKind: 'shape',
        error: 'open a course page first', targetPercent: settings.targetPercent,
      }, handlers);
      return;
    }
    refreshing = Boolean(units);
    paint();
    try {
      const result = await loadUnits(courseHash, { force });
      units = result.units;
      updatedAt = Date.now();
      notice = null;
      Object.keys(missed).forEach((k) => delete missed[k]);
    } catch (error) {
      const kind = error?.kind ?? 'unknown';
      if (units) notice = { kind, text: kind === 'unknown' ? error?.message : undefined };
      else {
        refreshing = false;
        renderPanel(cardRoot, {
          status: 'error', compact: true, errorKind: kind,
          error: error?.message, targetPercent: settings.targetPercent,
        }, handlers);
        renderPrefs();
        return;
      }
    }
    refreshing = false;
    paint();
  }

  paint();
  load();
})();
