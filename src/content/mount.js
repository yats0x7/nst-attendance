/**
 * Content script entry point.
 *
 * Declared content scripts cannot be ES modules, so this bootstraps into the
 * real modules with dynamic import. Its job is purely lifecycle: notice which
 * course page we are on, keep the numbers fresh and cached, find the spot on the
 * page, and keep the card there across the SPA's client-side navigations.
 *
 * Fetching does not depend on finding the spot. If the portal renames the
 * heading the card anchors under, the numbers still load and cache — so the
 * popup and badge keep working — and the card falls back to a structural anchor.
 */

(async () => {
  const HOST_ID = 'nst-attendance-panel';
  const load = (path) => import(chrome.runtime.getURL(path));

  let portal;
  let panel;
  let storage;
  try {
    [portal, panel, storage] = await Promise.all([
      load('src/lib/portal.js'),
      load('src/content/panel.js'),
      load('src/lib/storage.js'),
    ]);
  } catch (error) {
    // A silent failure here looks identical to "not installed". Say what broke.
    console.error('[NST Attendance] could not load its modules:', error);
    return;
  }

  // A forced refresh within this window is a no-op. The numbers cannot have
  // changed meaningfully in ten seconds, and a mashed button must not turn into
  // a burst of a dozen requests per click against a shared portal.
  const FORCE_COOLDOWN_MS = 10_000;
  const ANCHOR_TIMEOUT_MS = 20_000;
  // How long to hold out for the "Your performance" heading before placing the
  // card at the structural fallback. The portal's sidebar switches subjects by
  // changing only the query string, and that sub-view may not carry the heading
  // at all; a student must not stare at a blank for 20 seconds. If the heading
  // appears later the card moves under it.
  const ANCHOR_GRACE_MS = 1_200;
  const TICK_MS = 750;

  let mounted = null; // { host, root }
  let renderToken = 0; // guards against slow async work landing after navigation
  let anchorObserver = null;
  let lastFetchAt = 0;
  let lastBadge = null;
  let warnedAnchor = false;
  const inFlight = new Map(); // courseHash -> Promise<{semesterHash, units}>

  // Per-page view state that survives re-renders.
  const view = {
    courseHash: null,
    semesterHash: null,
    units: null,
    updatedAt: null,
    refreshing: false,
    settings: null,
    notice: null,
    expanded: new Set(),
    missed: {}, // key -> { status, items?, error? }
  };

  const isStale = () =>
    !view.updatedAt || Date.now() - view.updatedAt > storage.CACHE_TTL_MS;

  /** Only the course landing pages have a "Your performance" block to sit under. */
  function pageCourseHash() {
    return portal.isCourseDetailsUrl(location.href) ? portal.courseHashFromUrl() : null;
  }

  // --- anchoring -------------------------------------------------------------

  /**
   * The card belongs directly under the portal's own "Your performance"
   * section, which is the block it extends. Anchoring on the visible heading
   * rather than a generated class name is the part least likely to break when
   * the portal is rebuilt.
   */
  function findHeadingAnchor(scope = document) {
    for (const el of scope.querySelectorAll('h1, h2, h3, h4, div, span, p')) {
      if (el.children.length === 0 && el.textContent.trim().toLowerCase() === 'your performance') {
        return el.parentElement ?? el;
      }
    }
    return null;
  }

  /**
   * Somewhere sensible when the heading is gone: the top of the main content
   * column. Degrading in position beats disappearing.
   */
  function findFallbackAnchor() {
    const main = document.querySelector('main') ?? document.querySelector('[role="main"]');
    const first = main?.firstElementChild;
    return first ?? null;
  }

  function stopAnchorWatch() {
    anchorObserver?.disconnect();
    anchorObserver = null;
  }

  /**
   * Call `onFound(anchor)` once, as soon as the heading exists — immediately if
   * it already does. Scans only what each mutation adds, coalesced to one check
   * per frame, and is cancelled by the next navigation: a busy SPA can emit
   * hundreds of mutation batches while hydrating.
   */
  function watchForHeadingAnchor(token, onFound) {
    const existing = findHeadingAnchor();
    if (existing) {
      onFound(existing);
      return;
    }
    stopAnchorWatch();
    let scheduled = false;
    let pendingNodes = [];
    const finish = (value) => {
      stopAnchorWatch();
      clearTimeout(timer);
      if (value && token === renderToken) onFound(value);
    };
    const check = () => {
      scheduled = false;
      if (token !== renderToken) return finish(null);
      for (const node of pendingNodes) {
        if (node.nodeType !== 1) continue;
        if (!node.textContent || !/your performance/i.test(node.textContent)) continue;
        const found = findHeadingAnchor(node) ?? (node.children.length === 0 ? node.parentElement : null);
        if (found) return finish(found);
      }
      pendingNodes = [];
    };
    anchorObserver = new MutationObserver((mutations) => {
      for (const m of mutations) for (const n of m.addedNodes) pendingNodes.push(n);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(check);
      }
    });
    anchorObserver.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), ANCHOR_TIMEOUT_MS);
  }

  function unmount() {
    document.getElementById(HOST_ID)?.remove();
    mounted = null;
  }

  function place(anchor) {
    if (mounted && document.contains(mounted.host)) {
      // Already on the page — move under the heading if we had settled for the fallback.
      if (mounted.host.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', mounted.host);
      return mounted;
    }
    unmount();
    mounted = panel.createPanelHost(HOST_ID);
    anchor.insertAdjacentElement('afterend', mounted.host);
    return mounted;
  }

  /** The portal re-rendering the anchor's parent can orphan the card; put it back. */
  function ensurePlaced() {
    if (!mounted || document.contains(mounted.host)) return;
    const anchor = findHeadingAnchor() ?? findFallbackAnchor();
    if (anchor) anchor.insertAdjacentElement('afterend', mounted.host);
  }

  // --- rendering -------------------------------------------------------------

  const handlers = {
    onRefresh: () => refresh({ force: true }),
    onToggleMissed: (key) => toggleMissed(key),
    // A content script cannot open the options page itself; the worker can.
    onOpenSettings: () => {
      try {
        chrome.runtime.sendMessage({ type: 'nst:open-options' }).catch(() => {});
      } catch {
        // Extension reloaded under us; nothing to do.
      }
    },
  };

  let memo = { units: null, settings: null, subjects: null };
  function subjects() {
    if (!view.units) return null;
    if (memo.units !== view.units || memo.settings !== view.settings) {
      memo = { units: view.units, settings: view.settings, subjects: portal.rehydrate(view.units, view.settings) };
    }
    return memo.subjects;
  }

  function paint(extra = {}) {
    if (!mounted) return;
    ensurePlaced();
    const base = {
      targetPercent: view.settings?.targetPercent,
      canExpand: true,
      canOpenSettings: true,
      skeletonCount: Math.max(3, Math.min(8, subjects()?.length ?? 4)),
      expanded: view.expanded,
      missed: view.missed,
      refreshing: view.refreshing,
      notice: view.notice,
    };
    const list = subjects();
    if (list) {
      panel.renderPanel(
        mounted.root,
        { ...base, status: 'ready', subjects: list, updatedAt: view.updatedAt, stale: isStale(), ...extra },
        handlers
      );
      reportBadge(list);
    } else {
      panel.renderPanel(mounted.root, { ...base, status: 'loading', ...extra }, handlers);
    }
  }

  /**
   * Tell the service worker how many subjects are below target so the toolbar
   * icon can carry a badge. Only when the number changes: every message wakes
   * the worker, and most paints don't move it.
   */
  function reportBadge(list) {
    const atRisk = list.filter((s) => panel.isAtRisk(s.summary)).length;
    if (atRisk === lastBadge) return;
    lastBadge = atRisk;
    try {
      chrome.runtime.sendMessage({ type: 'nst:at-risk', count: atRisk }).catch(() => {});
    } catch {
      // The extension may have been reloaded under us; nothing to do.
    }
  }

  // --- data ------------------------------------------------------------------

  function fetchUnits(courseHash, force) {
    // Several triggers can ask for the same page's data at once (navigation, a
    // settings change, a popup-initiated refresh). Share the request — but only
    // for the same course, or a mid-navigation fetch would hand one semester's
    // numbers to another semester's page.
    if (!inFlight.has(courseHash)) {
      inFlight.set(
        courseHash,
        portal.loadUnits(courseHash, { force }).finally(() => inFlight.delete(courseHash))
      );
    }
    return inFlight.get(courseHash);
  }

  async function refetchExpanded(token) {
    for (const key of view.expanded) {
      const subject = subjects()?.find((s) => s.key === key);
      if (!subject) continue;
      view.missed[key] = { status: 'loading' };
      portal
        .loadMissed(subject)
        .then((items) => {
          if (token !== renderToken) return;
          view.missed[key] = { status: 'ready', items };
          paint();
        })
        .catch((error) => {
          if (token !== renderToken) return;
          view.missed[key] = { status: 'error', error: error?.message };
          paint();
        });
    }
  }

  /**
   * Bring the page's numbers up to date. Cache is trusted while fresh; the
   * network is only touched when it is stale or the student asks — this is
   * what keeps thousands of installs from re-querying the portal on every
   * client-side navigation. Runs whether or not the card is mounted, so the
   * cache (and with it the popup and badge) stays right even if the page has
   * nowhere to put the card.
   *
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async function refresh({ force = false } = {}) {
    const courseHash = pageCourseHash();
    if (!courseHash) return { ok: false, reason: 'not-course-page' };
    const token = renderToken;

    if (!force && view.units && !isStale()) return { ok: true, reason: 'fresh' };
    if (force && view.units && Date.now() - lastFetchAt < FORCE_COOLDOWN_MS) {
      return { ok: true, reason: 'cooldown' };
    }

    view.refreshing = true;
    paint();
    try {
      const { semesterHash, units } = await fetchUnits(courseHash, force);
      lastFetchAt = Date.now();
      await storage.writeCache(storage.subjectsCacheKey(semesterHash), units);
      if (token !== renderToken) return { ok: true, reason: 'superseded' };
      view.semesterHash = semesterHash;
      view.units = units;
      view.updatedAt = Date.now();
      view.notice = null;
      // Missed-class lists are derived from the same data; reload the ones the
      // student has open rather than leaving them on yesterday's list.
      view.missed = {};
      view.refreshing = false;
      paint();
      refetchExpanded(token);
      return { ok: true };
    } catch (error) {
      if (token !== renderToken) return { ok: false, reason: 'superseded' };
      view.refreshing = false;
      const kind = error?.kind ?? 'unknown';
      if (view.units) {
        // Keep the good numbers on screen, but say what went wrong — an expired
        // session must not hide behind a card that looks perfectly healthy.
        view.notice = { kind, text: kind === 'unknown' ? error?.message : undefined };
        paint();
      } else {
        paint({ status: 'error', error: error?.message, errorKind: kind });
      }
      return { ok: false, reason: kind };
    } finally {
      if (token === renderToken) view.refreshing = false;
    }
  }

  async function toggleMissed(key) {
    if (view.expanded.has(key)) {
      view.expanded.delete(key);
      paint();
      return;
    }
    view.expanded.add(key);
    const subject = subjects()?.find((s) => s.key === key);
    if (!subject) return;

    if (!view.missed[key] || view.missed[key].status === 'error') {
      view.missed[key] = { status: 'loading' };
      paint();
      const token = renderToken;
      try {
        const items = await portal.loadMissed(subject);
        if (token !== renderToken) return;
        view.missed[key] = { status: 'ready', items };
      } catch (error) {
        if (token !== renderToken) return;
        view.missed[key] = { status: 'error', error: error?.message };
      }
    }
    paint();
  }

  // --- lifecycle -------------------------------------------------------------

  async function render() {
    const token = ++renderToken;
    stopAnchorWatch();
    unmount();

    const courseHash = pageCourseHash();
    view.courseHash = courseHash;
    view.units = null;
    view.semesterHash = null;
    view.updatedAt = null;
    view.refreshing = false;
    view.notice = null;
    view.expanded = new Set();
    view.missed = {};
    if (!courseHash) return;

    // Settings and the cached numbers for this course's semester (if we already
    // know which semester that is) load together; the heading is watched in
    // parallel and the card is placed as soon as either the heading or the grace
    // period arrives — whichever is first.
    const [settings, semester] = await Promise.all([
      storage.getSettings(),
      storage.readCache(storage.semesterCacheKey(courseHash), {
        ttlMs: storage.STRUCTURE_TTL_MS,
        maxAgeMs: storage.STRUCTURE_TTL_MS,
      }),
    ]);
    if (token !== renderToken) return;
    view.settings = settings;

    if (semester?.data) {
      const cached = await storage.readCache(storage.subjectsCacheKey(semester.data));
      if (token !== renderToken) return;
      if (cached?.data) {
        view.semesterHash = semester.data;
        view.units = cached.data;
        view.updatedAt = cached.ts;
      }
    }

    let placed = false;
    const settle = (anchor, viaFallback) => {
      if (token !== renderToken || !anchor) return;
      place(anchor);
      if (!placed) {
        placed = true;
        paint();
        if (viaFallback && !warnedAnchor) {
          warnedAnchor = true;
          console.warn('[NST Attendance] "Your performance" heading not found yet; card placed at top of main content.');
        }
      }
    };
    watchForHeadingAnchor(token, (anchor) => settle(anchor, false));
    setTimeout(() => {
      if (placed || token !== renderToken) return;
      const fallback = findFallbackAnchor();
      if (fallback) settle(fallback, true);
      else if (!warnedAnchor) {
        warnedAnchor = true;
        console.warn('[NST Attendance] nowhere to place the card on this page; numbers still cached for the popup.');
      }
    }, ANCHOR_GRACE_MS);

    await refresh({ force: false });
  }

  // The portal is a client-routed SPA, so navigation fires no page load.
  // The Navigation API reports same-document navigations from any world; a
  // light href poll is the belt to its braces, and also catches the portal
  // re-rendering the card's parent out from under it. (Patching
  // history.pushState from a content script would not work: the isolated
  // world has its own wrapper, so the page's router never calls the patch.)
  let lastHref = location.href;
  const onNavigate = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    render();
  };
  window.navigation?.addEventListener?.('currententrychange', onNavigate);
  window.addEventListener('popstate', onNavigate);
  setInterval(() => {
    onNavigate();
    if (mounted) ensurePlaced();
  }, TICK_MS);

  // Settings saved in the options page apply immediately — same data, re-scored.
  storage.onSettingsChanged(async () => {
    view.settings = await storage.getSettings();
    paint();
  });

  // The popup cannot reach the portal itself, so it asks this tab to refresh.
  // Only the extension's own contexts can send runtime messages; web pages
  // cannot, so the sender check is belt-and-braces.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return undefined;
    if (message?.type !== 'nst:refresh') return undefined;
    refresh({ force: true }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, reason: error?.kind ?? 'unknown', error: error?.message })
    );
    return true; // async response
  });

  render().catch((error) => console.error('[NST Attendance] failed to render:', error));
})();
