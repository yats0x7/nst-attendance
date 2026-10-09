import {
  getSettings,
  saveSettings,
  clearCache,
  readLatestCache,
  DEFAULT_SETTINGS,
  TARGET_BOUNDS,
} from '../lib/storage.js';
import { groupUnits, normalizeKey } from '../lib/grouping.js';
import { combine } from '../lib/math.js';
import { totalClasses, SCHEDULE_PRESET } from '../lib/schedule.js';

const range = document.getElementById('target-range');
const number = document.getElementById('target-number');
const tbody = document.getElementById('overrides');
const status = document.getElementById('status');

/** Keep the slider and the number field showing the same value. */
function setTarget(value) {
  const clamped = Math.min(
    TARGET_BOUNDS.max,
    Math.max(TARGET_BOUNDS.min, Math.round(Number(value) || DEFAULT_SETTINGS.targetPercent))
  );
  range.value = String(clamped);
  number.value = String(clamped);
}

for (const el of [range, number]) {
  el.min = String(TARGET_BOUNDS.min);
  el.max = String(TARGET_BOUNDS.max);
}
range.addEventListener('input', () => setTarget(range.value));
number.addEventListener('change', () => setTarget(number.value));

function addRow(name = '', group = '') {
  const tr = document.createElement('tr');

  const nameCell = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.className = 'name';
  nameInput.placeholder = 'e.g. Algo Design Practical - B';
  nameInput.setAttribute('aria-label', 'Course name on the portal');
  nameInput.value = name;
  nameCell.append(nameInput);

  const groupCell = document.createElement('td');
  const groupInput = document.createElement('input');
  groupInput.className = 'group';
  groupInput.placeholder = 'e.g. ADA';
  groupInput.setAttribute('aria-label', 'Belongs to subject');
  groupInput.value = group;
  groupCell.append(groupInput);

  const removeCell = document.createElement('td');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link';
  remove.textContent = 'Remove';
  const describe = () =>
    remove.setAttribute('aria-label', `Remove rule${nameInput.value.trim() ? ` for ${nameInput.value.trim()}` : ''}`);
  describe();
  nameInput.addEventListener('input', describe);
  remove.addEventListener('click', () => tr.remove());
  removeCell.append(remove);

  tr.append(nameCell, groupCell, removeCell);
  tbody.append(tr);
  return nameInput;
}

document.getElementById('add-row').addEventListener('click', () => addRow().focus());

function readOverrides() {
  const overrides = {};
  for (const tr of tbody.querySelectorAll('tr')) {
    const name = tr.querySelector('.name').value.trim();
    const group = tr.querySelector('.group').value.trim();
    // Both halves are needed for a mapping to mean anything; a half-filled row
    // is an in-progress edit, not a rule.
    if (name && group) overrides[name] = normalizeKey(group);
  }
  return overrides;
}

// --- term schedule ---------------------------------------------------------

const schedEnabled = document.getElementById('sched-enabled');
const schedBody = document.getElementById('sched-body');
const schedWeeks = document.getElementById('sched-weeks');
const schedPerWeek = document.getElementById('sched-perweek');
const schedRows = document.getElementById('sched-rows');
const schedNote = document.getElementById('sched-note');

const schedSetup = document.getElementById('sched-setup');
const schedPreset = document.getElementById('sched-preset');

/*
 * The term schedule is the best thing this extension does and it ships off,
 * because a schedule the student never confirmed would produce a budget they
 * might act on. So the prompt is a control that states the numbers it will
 * set: clicking it is the confirmation, and it is the only click needed.
 */
schedPreset.textContent = `Use ${SCHEDULE_PRESET.weeks} weeks \u00d7 ${SCHEDULE_PRESET.perWeek} classes a week`;
document.getElementById('sched-preset-hint').textContent =
  `That is ${SCHEDULE_PRESET.label} for most subjects. Check it against your own timetable — you can change any of it below.`;

/**
 * Off and on are different jobs, so they get different controls. While it is
 * off the section asks one question and offers the two answers to it; once it
 * is on, the checkbox is simply the way back out.
 */
function syncScheduleUi() {
  schedBody.hidden = !schedEnabled.checked;
  schedSetup.hidden = schedEnabled.checked;
  document.getElementById('sched-toggle').hidden = !schedEnabled.checked;
}

schedEnabled.addEventListener('change', syncScheduleUi);

// The other answer: reveal the fields without committing to numbers nobody
// has checked yet. Saving is then the student's own deliberate act.
document.getElementById('sched-own').addEventListener('click', () => {
  schedEnabled.checked = true;
  syncScheduleUi();
  refreshTotals();
  schedWeeks.focus();
});

schedPreset.addEventListener('click', async () => {
  schedEnabled.checked = true;
  schedWeeks.value = String(SCHEDULE_PRESET.weeks);
  schedPerWeek.value = String(SCHEDULE_PRESET.perWeek);
  syncScheduleUi();
  refreshTotals();
  await save('Saved. Open portal pages update on their own.');
  flashInto(
    document.getElementById('sched-status'),
    'Term projections are on. Adjust anything below that does not match your timetable.'
  );
  schedWeeks.focus();
});

/** Read the schedule straight off the form, so previews match what will save. */
function readSchedule() {
  const perSubject = {};
  for (const tr of schedRows.querySelectorAll('tr')) {
    const weeks = tr.querySelector('.weeks').value.trim();
    const perWeek = tr.querySelector('.perweek').value.trim();
    // Blank means "use the default", which is the common case — storing the
    // default explicitly would silently freeze it if the default later changed.
    if (!weeks && !perWeek) continue;
    const entry = {};
    if (weeks) entry.weeks = Number(weeks);
    if (perWeek) entry.perWeek = Number(perWeek);
    perSubject[tr.dataset.key] = entry;
  }
  return {
    enabled: schedEnabled.checked,
    weeks: Number(schedWeeks.value) || DEFAULT_SETTINGS.schedule.weeks,
    perWeek: Number(schedPerWeek.value) || DEFAULT_SETTINGS.schedule.perWeek,
    perSubject,
  };
}

function refreshTotals() {
  const schedule = { ...readSchedule(), enabled: true };
  for (const tr of schedRows.querySelectorAll('tr')) {
    const total = totalClasses(tr.dataset.key, schedule);
    const held = Number(tr.dataset.held) || 0;
    const cell = tr.querySelector('.total');
    // Showing what has already been held is what makes a wrong default
    // noticeable: "48 total · 1 held" on a once-a-week subject looks off.
    cell.textContent =
      total === null
        ? '—'
        : held > total
          ? `${total} total · ${held} held — already over, update this`
          : `${total} total · ${held} held · ${total - held} left`;
  }
}

for (const el of [schedWeeks, schedPerWeek]) el.addEventListener('input', refreshTotals);

function addSubjectRow(key, label, held) {
  const tr = document.createElement('tr');
  tr.dataset.key = key;
  tr.dataset.held = String(held);

  const name = document.createElement('th');
  name.scope = 'row';
  name.style.fontWeight = '500';
  name.style.color = 'inherit';
  name.style.fontSize = 'inherit';
  name.textContent = label;

  const cells = [
    ['weeks', `Weeks for ${label}`],
    ['perweek', `Classes per week for ${label}`],
  ].map(([cls, ariaLabel]) => {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.className = cls;
    input.placeholder = 'default';
    input.setAttribute('aria-label', ariaLabel);
    input.addEventListener('input', refreshTotals);
    td.append(input);
    return td;
  });

  const total = document.createElement('td');
  total.className = 'total';

  tr.append(name, ...cells, total);
  schedRows.append(tr);
  return tr;
}

/**
 * The options page has no portal session, so it lists whatever subjects the
 * content script last cached. That keeps the student from having to retype
 * course names they can see on the portal.
 */
async function buildSubjectRows(settings) {
  const cached = await readLatestCache();
  if (!cached?.data?.length) {
    schedNote.textContent =
      'Open the portal once and reopen this page to list your subjects. Until then the defaults above apply to every subject.';
    return;
  }
  schedNote.textContent =
    'Leave a row blank to use the defaults. Set a subject that runs differently — a once-a-week subject, or a shorter one.';

  for (const group of groupUnits(cached.data, settings.overrides)) {
    const { held } = combine(group.units);
    const tr = addSubjectRow(group.key, group.label, held);
    const saved = settings.schedule.perSubject?.[group.key];
    if (saved?.weeks) tr.querySelector('.weeks').value = String(saved.weeks);
    if (saved?.perWeek) tr.querySelector('.perweek').value = String(saved.perWeek);
  }
  refreshTotals();
}

function flashInto(el, message) {
  el.textContent = message;
  setTimeout(() => {
    if (el.textContent === message) el.textContent = '';
  }, 4000);
}

function flash(message) {
  flashInto(status, message);
}

async function save(message) {
  await saveSettings({
    targetPercent: Number(number.value),
    overrides: readOverrides(),
    schedule: readSchedule(),
    // Reaching this page and saving is itself an answer to the prompt, whether
    // the schedule went on or not.
    scheduleTipDismissed: true,
  });
  flash(message);
}

document.getElementById('save').addEventListener('click', () =>
  save('Saved. Open portal pages update on their own.')
);

document.getElementById('clear-cache').addEventListener('click', async () => {
  await clearCache();
  flash('Cached attendance cleared.');
});

const settings = await getSettings();
setTarget(settings.targetPercent);

const existing = Object.entries(settings.overrides);
for (const [name, group] of existing) addRow(name, group);
// Grouping is collapsed by default because it is advanced and almost never
// needed — but rules that already exist must not be hidden, or they become
// impossible to find and remove.
if (existing.length) document.querySelector('details').open = true;

schedEnabled.checked = settings.schedule.enabled;
schedWeeks.value = String(settings.schedule.weeks);
schedPerWeek.value = String(settings.schedule.perWeek);
syncScheduleUi();
await buildSubjectRows(settings);

// The popup's prompt opens this page at #schedule. Land on the control that
// answers it rather than at the top of the form.
if (location.hash === '#schedule') {
  const target = schedEnabled.checked ? schedWeeks : schedPreset;
  document.getElementById('schedule').scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
}
