# Portal API notes

Captured from a live student session on `my.newtonschool.co`. None of this is
documented by Newton School; it is what the portal's own front end calls, observed via
`performance.getEntriesByType('resource')` and then re-fetched to inspect the payloads.

Treat it as liable to change without notice — that is why `api-adapter.js` fails loudly rather
than defaulting missing fields to zero.

## Course hierarchy

Courses nest three deep, and only the leaves hold classes:

```
Programme                prog00000001    programme   (unit_type: ADMIN)
└─ Semester              smstr00000001    semester    (unit_type: ADMIN)
   ├─ ADA - B            subj0000ada1    subject     (unit_type: LEARNING)
   ├─ ADA Lab 2 - B      subj0000ada2    lab         (unit_type: LEARNING)
   └─ …
```

The sidebar "Subjects" list is the semester's `LEARNING` children. Each entry is a full course
with its own hash — there is no per-subject route, which is why attendance has to be gathered one
request per subject.

## Auth

- `localStorage['auth-token']` — a bearer token, stored **JSON-quoted**, so strip surrounding `"`.
- `refresh-token` sits alongside it.
- Cookie `access_token_ns_student_web` is also present.

A content script shares the page's origin, so it can read both. **The bearer token is required**:
tested live, a request with the cookie but no `Authorization` header returns 401, and so does one
with neither. The adapter sends both, treats a missing token as a "portal changed" error rather than
"session expired" (logging in again would not help), and refuses to send it anywhere but a
same-origin `/api/` path. A 3xx from an API path (`redirect: 'manual'`) is treated as a login
redirect, i.e. an auth failure, and is not retried.

## Endpoints used

### `GET /api/v1/course/h/{anyCourseHash}/course_redirection_details/`

Resolves any course hash to its place in the hierarchy. This is what lets the panel work from a
subject page as well as the semester page.

```json
{
  "course":          { "hash": "subj0000ada1", "short_display_name": "ADA - B",       "unit_type": "LEARNING" },
  "admin_course":    { "hash": "smstr00000001", "short_display_name": "Semester", "unit_type": "ADMIN" },
  "learning_course": { "hash": "subj0000ada1", "short_display_name": "ADA - B",       "unit_type": "LEARNING" }
}
```

`admin_course.hash` is the semester. On the semester page it points at itself.

### `GET /api/v2/course/h/{semesterHash}/learning_course/all/?pagination=false`

The subject list, in sidebar order. Returns a bare array.

```json
[{ "hash": "subj0000ada1",
   "title": "Newton School of Technology - Analysis and Design of Algorithms - B",
   "short_display_name": "ADA - B",
   "topic_template_hash": "tmpl00000001",
   "visible_extra_tabs": [] }]
```

`short_display_name` is exactly the sidebar text and is what the grouping heuristic parses.

### `GET /api/v2/course/h/{courseHash}/self_performance/`

The attendance source. Two fields matter:

```json
{ "total_lectures": 8, "total_lectures_attended": 8,
  "total_assignment_questions": 28, "total_completed_assignment_questions": 2,
  "total_assessments": 7, "total_completed_assessments": 1, "…": "…" }
```

**How these two fields were confirmed.** Two independent checks on a live account:

1. Calling `self_performance` for every subject in a semester and summing `total_lectures` /
   `total_lectures_attended` reproduces *exactly* the "Lecture N/M" the portal itself prints on the
   semester page (which is `self_performance` on the semester hash). So the per-subject figures are
   the same attendance the portal reports — it simply never aggregates them per subject.
2. For each subject, `lecture/all` returns exactly `total_lectures` lectures, all with a
   `start_timestamp` in the past, and exactly `total_lectures_attended` of them have
   `attended: true`. So `total_lectures` counts **classes held so far**, not the whole term.

Shape of the response, with illustrative figures (a subject and its lab are separate courses;
`LHL` has no lab, so subjects are not guaranteed to come in pairs):

| Course | held | attended |
|---|---|---|
| ADA - B | 12 | 12 |
| ADA Lab 2 - B | 10 | 9 |
| AP - B | 12 | 10 |
| AP Lab 2 - B | 10 | 8 |
| DE - B | 11 | 11 |
| DE Lab 2 - B | 11 | 11 |
| LHL - B | 0 | 0 |
| Maths III - B | 12 | 9 |
| Maths III Lab 2 - B | 10 | 6 |
| **total** | **88** | **76** |

## Endpoint deliberately NOT used

### `GET /api/v2/course/h/{hash}/calendar_entity/all/?pagination=false&number_of_days=N`

Returns scheduled slots:

```json
{ "hash": "slot00000001",
  "course": { "hash": "subj0000ada1", "short_display_name": "ADA - B" },
  "start_timestamp": "2026-09-07T14:30:00+05:30",
  "end_timestamp": "2026-09-07T16:00:00+05:30",
  "type": "lecture_slot" }
```

**This cannot support a term projection.** Asked for 180 days, it returned 13 lecture slots
spanning about six days, while the semester's own `end_timestamp` was more than three months out.
The portal simply does not publish the rest of the term's timetable.

Feeding that truncated count into the projection maths produces confidently wrong answers: with
`remaining = 2`, Maths III (10/16) reports "75% is out of reach" when in reality there are almost
four months of classes left in which to recover. So the panel passes no `remaining` at all and
uses the consecutive-miss figure, which needs no schedule and is exact.

`projectTerm()` in `math.js` is therefore fed from the **student's own stated timetable**
(`lib/schedule.js`: weeks x classes per week, per subject), never from this endpoint. That is an
optional setting, off by default; with it off the panel uses the consecutive-miss figure.

The timetable this was built against, as an example of what students enter: lectures Mon/Wed,
labs Tue/Thu — four classes a week per subject over a 12-week term (48 total) — plus a once-weekly
subject over 10 weeks (10 total). That was cross-checked against `lecture/all`: the lecture dates
fell on exactly the stated weekdays, and the observed rate matched the stated one to within the
term's first partial week.

## Other endpoints seen (unused)

`/api/v1/user/me/`, `/api/v1/user/me/info/`, `/api/v2/course/all/applied/`,
`/api/v2/course/h/{hash}/details/`, `/api/v2/course/h/{hash}/lecture/all/?limit=4`,
`/api/v2/course/h/{hash}/lecture/missed/`, `/api/v2/course/h/{hash}/experience_points/`,
`/api/v2/course/h/{hash}/cumulative_content/`, `/api/v2/course/h/{hash}/active_entity/all/`.
