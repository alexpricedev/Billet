# Flash Cookie Refactor

## Context

Both production projects (realfast, sheffield-hindu-mandir) extracted `getFlashCookieOptions()` as a DRY helper and added a `stateHelpers<T>()` factory for typed flash state in controllers. SpeedLoaf has the core `setFlashCookie`/`getFlashCookie` but inlines cookie options and has no state helpers wrapper.

## Design

### Extract `getFlashCookieOptions()`

In `src/server/utils/flash.ts`, extract the inline cookie options object into a named `getFlashCookieOptions()` function. This is a pure refactor — same behavior, DRY config.

### Add state helpers factory

**File:** `src/server/utils/state.ts`

A `stateHelpers<T>()` factory that returns `{ getFlash, setFlash }`:

```typescript
export const stateHelpers = <T>() => ({
  getFlash: (req: BunRequest): T => getFlashCookie<T>(req, "state"),
  setFlash: (req: BunRequest, state: T): void => setFlashCookie<T>(req, "state", state),
});
```

Controllers create a typed instance at module level:

```typescript
const loginStateHelpers = stateHelpers<LoginState>();
```

Then use `loginStateHelpers.setFlash(req, { error: "..." })` in POST handlers and `loginStateHelpers.getFlash(req)` in GET handlers.

### Add tests

**File:** `src/server/utils/state.test.ts`

Test the state helpers: set/get round-trip, read-once deletion, tampered signature rejection, correct cookie attributes.

### Files Changed

| File | Action |
|------|--------|
| `src/server/utils/flash.ts` | Extract `getFlashCookieOptions()` helper |
| `src/server/utils/state.ts` | New state helpers factory |
| `src/server/utils/state.test.ts` | New tests |
