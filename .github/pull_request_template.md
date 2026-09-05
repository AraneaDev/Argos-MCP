## What changed

<!-- One or two sentences. What does this do that the repository did not do before? -->

## Why

<!-- The reason the change is worth making. Skip if it is obvious from the above. -->

## Checks

- [ ] `npm run validate` passes (lint, format, type-check, tests)
- [ ] New behaviour has a test, or there is a note below saying why it does not
- [ ] Docs updated if the configuration surface or a tool's contract changed
- [ ] The PR title is a Conventional Commit

<!--
The title matters: main is squash-only, so this PR's title becomes the commit
subject on main, and that subject is what release-please reads to decide the
next version. A title it cannot classify silently skips the release it should
have cut. The `conventional-title` check gates this.
-->
