## What & why

<!-- The change, and the problem it solves. Link the issue or runbook section if there is one. -->

## Checks CI can't run

<!-- Delete the lines that don't apply. -->

- [ ] Verified in the browser — CI has none (screenshots welcome for UI changes)
- [ ] New third-party script has a CSP entry, an SRI `integrity` hash, and a `preconnect` in `layouts.tsx`
- [ ] New page is registered in `client/main.ts` and its CSS `@import`ed in `client/style.css`
- [ ] New table is added to `cleanupTestData` in `test-utils/helpers.ts`
- [ ] Changed headers, cookies, metadata, or email delivery → the matching `runbooks/` doc is updated
- [ ] Renamed or deleted files that `START_PROMPT.md` lists → that file still matches reality
