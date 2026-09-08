/**
 * Service worker: keeps the toolbar badge in step with the numbers.
 *
 * The content script reports how many subjects are below target each time it
 * renders; this shows that count on the icon so a student sees trouble without
 * opening anything. It also opens the options page on the card's behalf.
 * Nothing here touches the network or the portal.
 */

const RED = '#b91c1c';

async function setBadge(count) {
  const n = Number(count);
  const text = Number.isFinite(n) && n > 0 ? String(Math.min(n, 99)) : '';
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: RED });
    await chrome.action.setTitle({ title: `NST Attendance — ${n} subject${n === 1 ? '' : 's'} below target` });
  } else {
    await chrome.action.setTitle({ title: 'NST Attendance' });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  // Only accept messages from this extension's own contexts.
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'nst:at-risk') setBadge(message.count);
  // The card's "Target 75% · Settings" control; content scripts cannot open
  // extension pages themselves.
  if (message?.type === 'nst:open-options') chrome.runtime.openOptionsPage();
});

// On install or browser start there is no live tab reporting yet; clear any
// stale badge rather than show yesterday's number as if it were current.
chrome.runtime.onInstalled.addListener(() => setBadge(0));
chrome.runtime.onStartup.addListener(() => setBadge(0));
