# Adding an API endpoint

Same flow as a page, without the template or client layers. `src/server/controllers/api/projects.ts`
is the full CRUD example.

## 1. Service — `src/server/services/<resource>.ts`

Export functions and their types. If a view route already needs this logic, share the service
rather than having one route call the other over HTTP — routes must not fetch routes.

## 2. Controller — `src/server/controllers/api/<resource>.ts`

Return JSON with `Response.json()`; handle the error cases explicitly.

```ts
export const examplesApi = {
  async index() {
    return Response.json({ examples: await getExamples() });
  },
  async show(req: BunRequest<"/api/examples/:id">) {
    const example = await getExample(Number(req.params.id));
    if (!example) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ example });
  },
};
```

## 3. Barrel — `src/server/controllers/api/index.ts`

API controllers take an `Api` suffix so they don't collide with the app controller for the same
resource:

```ts
export { examplesApi } from "./examples";
```

## 4. Route — `src/server/routes/api.ts`

```ts
"/api/examples": createRouteHandler({ GET: examplesApi.index, POST: examplesApi.create }),
"/api/examples/:id": createRouteHandler({
  GET: examplesApi.show,
  PUT: examplesApi.update,
  DELETE: examplesApi.destroy,
}),
```

`createRouteHandler` returns 405 for any method not listed.

## 5. Test — `src/server/controllers/api/<resource>.test.ts`

See the `writing-tests` skill.

## State-changing endpoints

`csrfProtection` validates the request `Origin` against `APP_URL` and expects the token in the
`CSRF_HEADER_NAME` header for AJAX callers (form posts send it in the body instead). An endpoint
called from a browser needs it; one called by an external client needs a deliberate decision about
authentication instead. `src/server/middleware/rate-limit.ts` is available for anything
abuse-prone.
