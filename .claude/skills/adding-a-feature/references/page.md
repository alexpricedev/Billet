# Adding a page

Worked example: a `/dashboard` page. Read `src/server/controllers/app/projects.tsx` and
`src/server/templates/projects.tsx` alongside this — they're the fullest example in the repo
(list, create, delete, auth, flash messages, a Preact island).

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

This compiles with React's JSX runtime and renders once on the server — it never hydrates. Don't
reach for `useState` here.

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
they're applied centrally.

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

Route params are typed through the handler — `projects.destroy<"/projects/:id/delete">` in
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

## 7. Page CSS — `src/client/pages/dashboard.css`

Add `@import "./pages/dashboard.css";` to `src/client/style.css`. It is not picked up otherwise.

## 8. Test — `src/server/controllers/app/dashboard.test.ts`

See the `writing-tests` skill.

## Removing a page

The same list in reverse — template, controller, barrel export, route, nav link
(`src/server/components/nav.tsx`), client script, `registerPage` call in `main.ts`, the CSS file,
its `@import` in `style.css`, and the tests. `START_PROMPT.md` §5 lists exactly this for the stack
page and is a good checklist to mirror.
