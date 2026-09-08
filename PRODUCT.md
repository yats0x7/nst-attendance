# Product


## Platform

web (Chrome extension: a card injected into a third-party portal page, a 360px toolbar popup, and a settings page)

## Users

Undergraduate students at Newton School of Technology who use the `my.newtonschool.co` portal daily. They check attendance between classes, often on a laptop at speed, sometimes on a phone-sized window. They are technically comfortable but not designers or developers. Their emotional state ranges from idle curiosity ("am I fine?") to genuine anxiety ("am I about to fall below the line?"). A wrong number here has a real cost: skipping a class they could not afford, or an exam bar.

## Product Purpose

Give each student the one attendance figure the portal never shows — the combined percentage for a subject across its lecture and lab — and turn it into a single actionable sentence: how many classes can be missed, or how many must be attended to recover. Success is a student reading the card for two seconds and knowing exactly what to do this week, with total confidence that the number is right.

## Positioning

A calm, exact instrument that lives inside the portal and disappears into the task. It extends the portal's own "Your performance" block rather than competing with it. It never estimates, never decorates, and says plainly when it does not know.

## Operating Context

The card renders inside the portal's light-themed Next.js page under the "Your performance" heading, in the portal's own content column (~1100px wide on desktop). The popup is a fixed 360px column. The settings page is a standalone extension page. Students look at it for seconds, not minutes. It must be legible at a glance, survive the portal's aggressive re-renders, and never look broken when the portal is slow, the session has expired, or a class was held but attendance has not yet been scanned.

## Capabilities and Constraints

- Mode: Operate. Scanability, consistency and trust outrank expression.
- Visual world: inherits the portal's neutral, light, system-sans product UI; the card must read as native to that page. System font stack is correct here.
- Colour is semantic only: green at or above target, amber below but recoverable, red when the target is out of reach, grey for no data. No brand accent.
- Everything is rendered inside a Shadow DOM; the portal's CSS cannot help or hurt it.
- Copy is the product: controls name their action; every error names the problem and the recovery.
- Nothing is invented: if the portal's data cannot be read, the card says so and shows no numbers.
- No third-party fonts, icons or libraries may be loaded; the extension has network access to the portal host only.
- Must work in light and dark colour schemes; the portal is light, the popup and settings follow the OS.
