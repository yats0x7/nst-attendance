# Security

This extension runs inside a logged-in session on `my.newtonschool.co` and can
read whatever that session can. That is a meaningful amount of trust, so
problems with it are worth reporting properly.

## Reporting

Use [private vulnerability
reporting](https://github.com/yats0x7/nst-attendance/security/advisories/new).
It is visible only to maintainers.

Please do not open a public issue for anything that could be used against
someone else's account before it is fixed.

Expect a first reply within a week. If a fix is needed, it ships as a patch
release with the advisory published alongside it.

## What is in scope

- Anything that could read or exfiltrate data beyond the student's own
  attendance.
- Anything that sends data off the device. Nothing is supposed to.
- Injection into the portal page: the card renders into a shadow root, and
  course names and titles come from the portal, so escaping bugs count.
- Weaknesses in the phone bundle served from GitHub Pages.
- A path by which a page other than the portal could run extension code.

## What is not

- The portal's own behaviour, or anything requiring an already-compromised
  browser or operating system.
- Being able to see your own attendance. That is the product.
- Installing a modified copy of the extension yourself.

## What the extension is allowed to do

Checkable against `manifest.json`, which is the authority:

- `host_permissions` is `https://my.newtonschool.co/*` and nothing else, so no
  other site can be read or contacted.
- The only permission requested is `storage`.
- No remote code: no CDN, no third-party scripts, no `eval`. Extension pages
  run under `script-src 'self'`.
- Every network call goes through `src/lib/adapters/api-adapter.js`, which
  refuses any path outside `/api/v<n>/` and does not follow redirects.

The phone bookmarklet loads one script from the project's GitHub Pages site and
refuses to run on any host other than the portal. It is built from the same
source and shipped unminified so it can be read before you trust it.
