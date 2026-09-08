# Privacy

NST Attendance runs entirely inside your browser.

**What it reads.** On `my.newtonschool.co` only, it calls the same portal API the page itself
uses, with the session you are already logged in with, to read your subject list and your
attendance counts. It reads your portal login token from the page's own storage solely to
authenticate those same-origin requests; the code refuses to send it anywhere but `/api/` paths on
the portal's own host.

**What it stores.** Your settings (target percentage, term schedule, grouping fixes) in Chrome's
sync storage, and a short-lived cache of your attendance counts on this device so the card paints
instantly. Nothing else.

**What it sends.** Nothing, to anyone. There is no server, no analytics, no telemetry, no error
reporting, and no third-party code. The extension has network access to exactly one host:
`https://my.newtonschool.co`.

**What it shows others.** Nothing. The card is visible only in your own browser.

**Removal.** Uninstalling the extension removes its cache. Settings in Chrome sync are removed by
Chrome when you uninstall from all signed-in browsers, or immediately via *Clear cached data* and
resetting settings in the options page.

Source is in this repository; there is nothing in the shipped bundle that is not here.
