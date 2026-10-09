/**
 * Toolbar popup.
 *
 * Shows the same card as the injected panel, rendered from whatever the content
 * script last cached. The popup has no access to the portal's session — only a
 * page on the portal's own origin can authenticate — so it deliberately reads
 * cached numbers rather than fetching, and says plainly when it has none.
 *
 * "Refresh" therefore works by asking an open portal course page to refetch,
 * then re-reading the cache; with no such tab, it says so or opens one.
 */

import { renderPanel, createPanelHost } from '../content/panel.js';
import { rehydrate, isCourseDetailsUrl } from '../lib/portal.js';
import { getSettings, saveSettings, readLatestCache, onCacheChanged } from '../lib/storage.js';

const PORTAL_URL = 'https://my.newtonschool.co/';
const PORTAL_MATCH = 'https://my.newtonschool.co/*';
const RELEASES_URL = 'https://github.com/yats0x7/nst-attendance/releases';
/** Deep link, so the prompt lands on the control that answers it. */
const SCHEDULE_SETTINGS = 'src/options/options.html#schedule';

const mountPoint = document.getElementById('panel');
const hint = document.getElementById('hint');
const hintAction = document.getElementById('hint-action');
const setup = document.getElementById('setup');
const { host, root } = createPanelHost();
mountPoint.append(host);

let refreshing = false;

const handlers = {
  onRefresh: refresh,
  onOpenSettings: () => chrome.runtime.openOptionsPage(),
};

/** An explicit follow-up control beside the hint — never a tab opened unasked. */
function offerOpenPortal() {
  hintAction.replaceChildren();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Open the portal';
  btn.addEventListener('click', () => chrome.tabs.create({ url: PORTAL_URL }));
  hintAction.append(btn);
}

/*
 * Term projections are off until a student states their own timetable, so the
 * one feature that answers "can I skip this week" stays invisible unless
 * something points at it. This is that pointer: one line, one route to the
 * control, and it never comes back once answered or waved away.
 *
 * It routes rather than applying a default, because a projection built on a
 * schedule nobody confirmed is exactly the number that gets someone to skip a
 * class they could not afford.
 */
document.getElementById('setup-text').textContent =
  'Set your term schedule to see how many classes you can still miss.';

document.getElementById('setup-go').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL(SCHEDULE_SETTINGS) });
});

document.getElementById('setup-dismiss').addEventListener('click', async () => {
  await saveSettings({ scheduleTipDismissed: true });
  setup.hidden = true;
});

const { version } = chrome.runtime.getManifest();
document.getElementById('version').textContent = `Version ${version}`;
// Loaded unpacked, nothing updates itself — the link is the only way a student
// finds out a newer build exists, so it says what it does rather than claiming
// to know.
document.getElementById('updates').href = RELEASES_URL;

async function paint() {
  const [settings, cached] = await Promise.all([getSettings(), readLatestCache()]);

  setup.hidden = settings.schedule.enabled || settings.scheduleTipDismissed;

  if (!cached?.data) {
    renderPanel(
      root,
      { status: 'empty', compact: true, refreshing, canOpenSettings: true, targetPercent: settings.targetPercent },
      handlers
    );
    return;
  }

  renderPanel(
    root,
    {
      status: 'ready',
      compact: true,
      canExpand: false, // no session here; the portal page has the lists
      canOpenSettings: true,
      refreshing,
      subjects: rehydrate(cached.data, settings),
      targetPercent: settings.targetPercent,
      updatedAt: cached.ts,
      stale: cached.stale, // the card's footer already says so; no echo here
    },
    handlers
  );
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  hint.textContent = '';
  hintAction.replaceChildren();
  await paint();
  try {
    // Only tabs on the portal can hold a session, and host_permissions is what
    // lets this query match on URL without the broader "tabs" permission.
    const tabs = await chrome.tabs.query({ url: PORTAL_MATCH });
    const coursePage = tabs.find((t) => isCourseDetailsUrl(t.url ?? ''));

    if (!coursePage) {
      hint.textContent = tabs.length
        ? 'Open a course page on the portal, then Refresh.'
        : 'The portal is not open.';
      if (!tabs.length) offerOpenPortal();
      return;
    }

    let result;
    try {
      result = await chrome.tabs.sendMessage(coursePage.id, { type: 'nst:refresh' });
    } catch {
      // No content script listening yet (page still loading). Reloading the tab
      // gets it mounted; the card will fetch on its own and write the cache.
      await chrome.tabs.reload(coursePage.id);
      hint.textContent = 'Refreshing the portal tab…';
      return;
    }

    if (!result?.ok) {
      hint.textContent =
        result?.reason === 'auth'
          ? 'Log in to the portal again, then Refresh.'
          : result?.reason === 'not-course-page'
            ? 'Open a course page on the portal, then Refresh.'
            : "Couldn't refresh — see the card on the portal page.";
    } else if (result.reason === 'cooldown') {
      hint.textContent = 'Just refreshed a moment ago.';
    }
  } finally {
    refreshing = false;
    await paint();
  }
}

// The cache is written by the portal tab; re-render when it changes so a
// refresh (or a class marked present) shows up while the popup is open.
onCacheChanged(paint);

await paint();
