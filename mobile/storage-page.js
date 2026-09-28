/**
 * Settings for the mobile bookmarklet.
 *
 * The extension keeps settings in chrome.storage, which does not exist on a
 * page and cannot be reached from a phone. These live in the portal page's own
 * localStorage instead, under one namespaced key, and are therefore separate
 * from the desktop extension's settings — there is no server to sync them
 * through, and adding one would mean shipping attendance data off the device.
 *
 * Synchronous, because localStorage is, and the sheet re-renders on every edit.
 */

const MOBILE_SETTINGS_KEY = 'nst-attendance:settings';

function getSettingsSync() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(MOBILE_SETTINGS_KEY) ?? 'null');
  } catch {
    // Corrupt or blocked storage falls back to defaults rather than breaking.
  }
  return normalizeSettings(raw);
}

function saveSettingsSync(patch) {
  const next = normalizeSettings({ ...getSettingsSync(), ...patch });
  try {
    localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the sheet still works for this session.
  }
  return next;
}
