## What this changes

<!-- And, if it is not obvious, why. -->

## How it was checked

<!-- `npm test` is the floor. For anything that renders, say what you looked
     at: the dev harnesses under dev/ cover the card, the popup, the settings
     page and the phone sheet without needing the portal. -->

- [ ] `npm test`
- [ ] `node scripts/check-release.mjs`
- [ ] Looked at it in light and dark

## If it touches a number

<!-- Arithmetic changes need a test that would have failed before. A wrong
     skip count is what gets someone to miss a class they could not afford. -->

- [ ] There is a test covering it
