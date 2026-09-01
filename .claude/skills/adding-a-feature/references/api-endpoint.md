# Adding an API endpoint

Same flow as a page, without the template or client layers.
`src/server/controllers/api/projects.ts` is the full CRUD example, and
`src/server/controllers/api/request-guard.ts` holds the guards every endpoint runs.

## 1. Service — `src/server/services/<resource>.ts`

Export functions and their types. If a view route already needs this logic, share the service
rather than having one route call the other over HTTP — routes must not fetch routes.

A collection the API exposes needs a paginated read that returns the total alongside the rows —
see `getProjectPage`. Without the count, a client that receives exactly `limit` rows can't tell
whether it reached the end or the middle.

## 2. Controller — `src/server/controllers/api/<resource>.ts`

Every controller opens with the same short-circuits, cheapest first, so nothing unvalidated
reaches a service. Each guard returns either the value you asked for or the Response to send:

```ts
import { jsonError } from "../../utils/response";
import {
  apiReadLimit,
  apiWriteLimit,
  readIdParam,
  readJsonBody,
  readPagination,
  readStringField,
} from "./request-guard";

export const examplesApi = {
  async index(req: BunRequest) {
    const limited = apiReadLimit(req);
    if (limited) return limited;

    const page = readPagination(req);
    if (!page.ok) return page.response;

    const { examples, total } = await getExamplePage(page.limit, page.offset);
    return Response.json({
      data: examples,
      pagination: { total, limit: page.limit, offset: page.offset },
    });
  },

  async create(req: BunRequest) {
    const limited = apiWriteLimit(req);
    if (limited) return limited;

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const title = readStringField(parsed.body, "title");
    if (title === null) {
      return jsonError(400, "invalid_body", "A non-empty title is required.", {
        fields: { title: "Required." },
      });
    }

    const example = await createExample(title);
    return Response.json(
      { data: example },
      { status: 201, headers: { Location: `/api/examples/${example.id}` } },
    );
  },
};
```

Three rules the shape above encodes:

- **Payloads are wrapped in `data`**, never returned bare. A top-level array or object leaves
  nowhere to put `pagination` — or anything added later — without breaking every client.
- **Errors use `jsonError` from `src/server/utils/response.ts`**, never a bare string body. A
  `new Response("Not found", { status: 404 })` sends `text/plain` from an endpoint whose success
  path is JSON, so a client has to branch on status before it knows how to read the body. `code`
  is the stable identifier a client branches on; `message` is for a human; `fields` carries
  per-field detail on a validation failure.
- **Never let a bad request throw.** `await req.json()` throws on a malformed body, and an
  uncaught throw reaches `handleGuarded`, which answers with the **HTML** 500 page and logs the
  request as a server error — an error page for browsers, sent to a caller that asked for JSON,
  blaming the server for the client's typo. `readJsonBody` turns all three failure modes (wrong
  `Content-Type` → 415, unparseable body → 400, a JSON value that isn't an object → 400) into the
  envelope instead. `readIdParam` does the same job for `:id`.

## 3. Barrel — `src/server/controllers/api/index.ts`

API controllers take an `Api` suffix so they don't collide with the app controller for the same
resource:

```ts
export { examplesApi } from "./examples";
```

## 4. Route — `src/server/routes/api.ts`

```ts
"/api/examples": createApiRouteHandler({ GET: examplesApi.index, POST: examplesApi.create }),
"/api/examples/:id": createApiRouteHandler({
  GET: examplesApi.show,
  PUT: examplesApi.update,
  DELETE: examplesApi.destroy,
}),
```

`createApiRouteHandler` (not `createRouteHandler`, which is for HTML routes) answers an unlisted
method with a JSON 405 and the `Allow` header naming the ones that work. **Use it even for a
single-method resource** — a bare handler in this map answers *every* method, so a read-only
`/api/stats` would serve its payload to a `DELETE`.

## 5. Documentation — `README.md`

Add the endpoint to the **API Reference** table: path, method, what it returns, and any query
parameters. It's the only place an external caller can find out the endpoint exists.

## 6. Test — `src/server/controllers/api/<resource>.test.ts`

See the `writing-tests` skill. `expectJsonError(response, status, code)` from
`src/server/test-utils/setup.ts` asserts the error envelope and returns the parsed body — assert
on `code`, not the message, so a reworded string doesn't fail a test. Cover the guards as well as
the happy path: a bad id, a malformed body, and a missing required field are the cases that used
to reach the database.

## State-changing endpoints

`csrfProtection` validates the request `Origin` against `APP_URL` and expects the token in the
`CSRF_HEADER_NAME` header for AJAX callers (form posts send it in the body instead). An endpoint
called from a browser needs it; one called by an external client needs a deliberate decision about
authentication instead.

Rate limiting is not optional and not per-endpoint guesswork: use `apiReadLimit` (60/min) or
`apiWriteLimit` (20/min) from `request-guard.ts`. Reach for `rateLimit` directly only when an
endpoint is unusually expensive, and say why in a comment — the auth forms use 5/min because every
request there can send mail or burn an argon2 hash.

`rateLimit` takes a **bucket** as its second argument (`RateLimitBucket` in
`middleware/rate-limit.ts`), and it is half the map key. Pass the one that describes the budget
you mean to spend — `api-read`, `api-write`, or `auth` — never someone else's: a limit shared with
a route that isn't yours isn't a limit, it is whichever of the two is stricter. A new bucket is a
new entry in that union, not a free-form string.
