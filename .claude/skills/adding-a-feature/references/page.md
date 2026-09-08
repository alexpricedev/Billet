# Adding a page

Worked example: a `/dashboard` page. Read `src/server/controllers/app/todos.tsx` and
`src/server/templates/todos.tsx` alongside this — they're the fullest example in the repo
(list, create, toggle, delete, auth, flash messages, a reactive component, fragment responses).

## 1. Service — `src/server/services/dashboard.ts`

Only if the page needs data. Export the functions and the types together; the type is what the
controller and template both import.

## 2. Template — `src/server/templates/dashboard.tsx`

Takes fully resolved data as props, wrapped in the layout:

```tsx
<Layout title="Dashboard" name="dashboard" user={user} csrfToken={csrfToken}>
```

`name` sets `data-page` on `<body>`, which is what dispatches the client script in step 6. Any
form that POSTs needs `<CsrfField token={csrfToken} />`.

This renders once on the server and never hydrates, so don't reach for `useState` here — the
output is a string. Write SVG attributes in kebab-case (`stroke-width`, not `strokeWidth`); Preact
passes camelCase through verbatim and the browser ignores it.

## 3. Controller — `src/server/controllers/app/dashboard.tsx`

```tsx
export const dashboard = {
  async index(req: BunRequest) {
    const data = await getDashboardData();
    return render(<Dashboard data={data} />);
  },
};
```

`render()` and `redirect()` come from `src/server/utils/response.ts`. Don't set security headers —
they're applied centrally. Tokens for the page's forms come from `csrfTokens(ctx)` in
`src/server/utils/csrf-tokens.ts`, minted here and passed as props.

A POST method is a `formAction` handler rather than a bare function:

```tsx
create: formAction<DashboardState>({
  redirectTo: "/dashboard",
  guard: "user",                                  // or "session", or orgRoleGuard("admin")
  onExpired: () => ({ state: "csrf-expired" }),   // the flash for a stale token on a plain post
})(async (req, ctx) => {
  const { name } = await readFormValues(req, ["name"]);
  if (!name) return { reject: 400, flash: { state: "validation-error" } };
  await createWidget(name);
  return { flash: { state: "created" } };         // add `fragment: <Row … />` only for tier 2
}),
```

The wrapper does the session, the guard, the CSRF check with recovery, and the response for both a
plain post and a fragment request. The handler returns an outcome and never builds a Response.
`src/server/controllers/app/todos.tsx` shows every shape.

## 4. Barrel — `src/server/controllers/app/index.ts`

```ts
export { dashboard } from "./dashboard";
```

## 5. Route — `src/server/routes/app.tsx`

Single method:

```ts
"/dashboard": dashboard.index,
```

Multiple methods, or anything that must reject others with a 405:

```ts
"/dashboard": createRouteHandler({ GET: dashboard.index, POST: dashboard.create }),
```

Route params are typed through the handler — `todos.destroy<"/todos/:id/delete">` in
`app.tsx` is the pattern to copy.

## 6. Client script — `src/client/pages/dashboard.ts`

Export `init()`, then register it in `src/client/main.ts`:

```ts
import { init as initDashboard } from "@client/pages/dashboard";
registerPage("dashboard", { init: initDashboard });
```

Skipping the `registerPage` call is the quiet failure: the script builds, ships, and never runs.
The registered name must equal the `name` prop from step 2.

Export `cleanup()` too if the script adds listeners outside its own subtree.

A page script is for one-off wiring. For state that drives the DOM — a filter, a toggle, a
counter — write a component instead, in `src/client/components/<name>.ts`:

```ts
export const dashboardFilter = defineComponent("dashboard-filter", (root) => {
  const query = signal("");
  return { query, count: computed(() => /* … */) };
});
export type DashboardFilter = typeof dashboardFilter;
```

Register it in `main.ts` with `registerComponent(dashboardFilter)` — the same quiet failure as an
unregistered page if you forget — and bind it from the template with typed attributes:

```tsx
import type { DashboardFilter } from "@client/components/dashboard-filter";
import { component } from "@shared/attributes";

const filter = component<DashboardFilter>("dashboard-filter");
// …
<div {...filter.root}>
  <input {...filter.value("query")} />
  <p {...filter.text("count")} />
</div>
```

The `import type` is erased, so the server never loads the component; a name that the component
doesn't return is a type error. `mount()` runs once in `main.ts` for every registered component on
the page, so there is nothing to add to the page script. `src/client/components/todo-list.ts` and
its use in `todos.tsx` are the worked example.

To update the page from the server without a reload, keep the mutation a plain form and add a
fragment branch to the controller: `isFragmentRequest(req)` → `renderFragment(<Row />)` from
`src/server/utils/fragment.ts`, with the row as a server component the page also renders. The
component intercepts the form's `submit`, calls `submitForm(form)`, inserts the row, and calls
`bind(row)`. `todos.tsx` (controller) and `todo-list.ts` show every branch, including the stale
CSRF token refresh.

## 7. Page CSS — `src/client/pages/dashboard.css`

Add `@import "./pages/dashboard.css";` to `src/client/style.css`. It is not picked up otherwise.

## 8. Test — `src/server/controllers/app/dashboard.test.ts`

See the `writing-tests` skill.

## Removing a page

The same list in reverse — template, controller, barrel export, route, nav link
(`src/server/components/nav.tsx`), client script, `registerPage` call in `main.ts`, the CSS file,
its `@import` in `style.css`, and the tests. Miss one and the page half-exists: a route with no
script, or a `registerPage` call for a module that no longer imports.
