import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { CSRF_HEADER, FRAGMENT_HEADER } from "@shared/protocol";
import { findOrCreateUser } from "../../services/auth";
import { createCsrfToken, TIME_WINDOW_MINUTES } from "../../services/csrf";
import {
  createAuthenticatedSession,
  createGuestSession,
} from "../../services/sessions";
import type { Todo } from "../../services/todo";
import type { TodosState } from "../../templates/todos";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { testDatabase } from "../../test-utils/database";
import { createMockTodo } from "../../test-utils/factories";
import { cleanupTestData, randomEmail } from "../../test-utils/helpers";
import { stateHelpers } from "../../utils/state";

const connection = testDatabase();

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

const mockGetTodos = mock(async (): Promise<Todo[]> => []);
const mockCreateTodo = mock(async (): Promise<Todo> => createMockTodo());
const mockToggleTodo = mock(async (): Promise<Todo | null> => null);
const mockDeleteTodo = mock(async (): Promise<boolean> => true);

mock.module("../../services/todo", () => ({
  getTodos: mockGetTodos,
  createTodo: mockCreateTodo,
  toggleTodo: mockToggleTodo,
  deleteTodo: mockDeleteTodo,
}));

import { db } from "../../services/database";
import { todos } from "./todos";

const ORIGIN = "http://localhost:3000";

describe("Todos Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
    mockGetTodos.mockClear();
    mockCreateTodo.mockClear();
    mockToggleTodo.mockClear();
    mockDeleteTodo.mockClear();
  });

  afterEach(() => {
    setSystemTime();
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  const createTestSession = async () => {
    const user = await findOrCreateUser(randomEmail());
    return createAuthenticatedSession(user.id);
  };

  // Mint a token as if the page had rendered several windows ago: authentic,
  // but too stale to act on.
  const mintStaleToken = async (
    sessionId: string,
    path: string,
  ): Promise<string> => {
    setSystemTime(new Date(Date.now() - TIME_WINDOW_MINUTES * 3 * 60 * 1000));
    const token = await createCsrfToken(sessionId, "POST", path);
    setSystemTime();
    return token;
  };

  const formBody = (fields: Record<string, string>): FormData => {
    const body = new FormData();
    for (const [name, value] of Object.entries(fields))
      body.append(name, value);
    return body;
  };

  // A plain form post from the page, or — with `fragment` — the same post as
  // the client's submitForm sends it.
  const post = (
    url: string,
    sessionId: string | null,
    fields: Record<string, string>,
    options: { fragment?: boolean; headers?: Record<string, string> } = {},
  ) =>
    createBunRequest(
      url,
      {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          ...(sessionId ? { Cookie: `session_id=${sessionId}` } : {}),
          ...(options.fragment ? { [FRAGMENT_HEADER]: "1" } : {}),
          ...options.headers,
        },
        body: formBody(fields),
      },
      { id: url.split("/")[4] ?? "" },
    );

  describe("GET /todos", () => {
    test("renders the list with the add form for guests", async () => {
      const guestSessionId = await createGuestSession();
      mockGetTodos.mockResolvedValue([
        createMockTodo({ id: 1, title: "Todo 1" }),
        createMockTodo({
          id: 2,
          title: "Todo 2",
          completed_at: new Date("2026-01-01T00:00:00Z"),
        }),
      ]);

      const response = await todos.index(
        createBunRequest(`${ORIGIN}/todos`, {
          headers: { Cookie: `session_id=${guestSessionId}` },
        }),
      );
      const html = await response.text();

      expect(mockGetTodos).toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(html).toContain("<h1>Todos</h1>");
      expect(html).toContain("Todo 1");
      expect(html).toContain("Todo 2");
      expect(html).toContain('action="/todos"');
      expect(html).toContain('name="_csrf"');
      expect(html).toContain("1 item left");
    });

    test("marks completed rows and arms every row's toggle form", async () => {
      const guestSessionId = await createGuestSession();
      mockGetTodos.mockResolvedValue([
        createMockTodo({ id: 1, title: "Open" }),
        createMockTodo({ id: 2, title: "Done", completed_at: new Date() }),
      ]);

      const html = await (
        await todos.index(
          createBunRequest(`${ORIGIN}/todos`, {
            headers: { Cookie: `session_id=${guestSessionId}` },
          }),
        )
      ).text();

      expect(html).toContain('action="/todos/1/toggle"');
      expect(html).toContain('action="/todos/2/toggle"');
      expect(html).toContain('data-id="2" data-completed');
      expect(html).not.toContain('data-id="1" data-completed');
      expect(html).toContain('aria-pressed="true"');
    });

    test("renders the component root and the empty row hidden when there are todos", async () => {
      mockGetTodos.mockResolvedValue([createMockTodo({ id: 1 })]);

      const html = await (
        await todos.index(createBunRequest(`${ORIGIN}/todos`))
      ).text();

      expect(html).toContain('data-component="todo-list"');
      expect(html).toContain('class="empty-row" hidden');
    });

    test("shows the empty row when there are no todos", async () => {
      mockGetTodos.mockResolvedValue([]);

      const html = await (
        await todos.index(createBunRequest(`${ORIGIN}/todos`))
      ).text();

      expect(html).toContain("Nothing to show.");
      expect(html).not.toContain('class="empty-row" hidden');
      expect(html).toContain("0 items left");
    });

    test.each([
      ["submission-success", "Todo added successfully."],
      ["deletion-success", "Todo deleted successfully."],
      ["action-csrf-expired", "nothing changed"],
      ["validation-error", "at least 2 characters"],
    ] as const)("shows the flash for %s", async (state, message) => {
      const sessionId = await createTestSession();
      mockGetTodos.mockResolvedValue([]);

      const request = createBunRequest(`${ORIGIN}/todos`, {
        headers: { Cookie: `session_id=${sessionId}` },
      });
      stateHelpers<TodosState>().setFlash(request, { state });

      const html = await (await todos.index(request)).text();
      expect(html).toContain(message);
    });

    test("restores the title after a stale-token add", async () => {
      const sessionId = await createTestSession();
      mockGetTodos.mockResolvedValue([]);

      const request = createBunRequest(`${ORIGIN}/todos`, {
        headers: { Cookie: `session_id=${sessionId}` },
      });
      stateHelpers<TodosState>().setFlash(request, {
        state: "csrf-expired",
        title: "Kept title",
      });

      const html = await (await todos.index(request)).text();
      expect(html).toContain("nothing was saved");
      expect(html).toContain('value="Kept title"');
    });

    test("shows delete forms for authenticated users only", async () => {
      const sessionId = await createTestSession();
      mockGetTodos.mockResolvedValue([
        createMockTodo({ id: 1 }),
        createMockTodo({ id: 2 }),
      ]);

      const authed = await (
        await todos.index(
          createBunRequest(`${ORIGIN}/todos`, {
            headers: { Cookie: `session_id=${sessionId}` },
          }),
        )
      ).text();
      expect(authed).toContain('action="/todos/1/delete"');
      expect(authed).toContain('action="/todos/2/delete"');

      const guest = await (
        await todos.index(createBunRequest(`${ORIGIN}/todos`))
      ).text();
      expect(guest).not.toContain('/delete"');
      expect(guest).toContain("Log in");
    });
  });

  describe("POST /todos", () => {
    test("a guest creates a todo with a valid token and is redirected", async () => {
      const sessionId = await createGuestSession();
      const token = await createCsrfToken(sessionId, "POST", "/todos");

      const request = post(`${ORIGIN}/todos`, sessionId, {
        title: "Guest Todo",
        _csrf: token,
      });
      const response = await todos.create(request);

      expect(mockCreateTodo).toHaveBeenCalledWith("Guest Todo", null);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/todos");
      expect(findSetCookie(request, "flash_state")).toContain(
        "submission-success",
      );
    });

    test("an authenticated user's email is recorded as created_by", async () => {
      const email = randomEmail();
      const user = await findOrCreateUser(email);
      const sessionId = await createAuthenticatedSession(user.id);
      const token = await createCsrfToken(sessionId, "POST", "/todos");

      await todos.create(
        post(`${ORIGIN}/todos`, sessionId, { title: "Mine", _csrf: token }),
      );

      expect(mockCreateTodo).toHaveBeenCalledWith("Mine", email);
    });

    test("trims the title", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(sessionId, "POST", "/todos");

      await todos.create(
        post(`${ORIGIN}/todos`, sessionId, {
          title: "  Padded  ",
          _csrf: token,
        }),
      );

      expect(mockCreateTodo).toHaveBeenCalledWith("Padded", expect.anything());
    });

    test("rejects a missing, forged, or cross-origin token", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(sessionId, "POST", "/todos");

      const missing = await todos.create(
        post(`${ORIGIN}/todos`, sessionId, { title: "New" }),
      );
      expect(missing.status).toBe(403);
      expect(await missing.text()).toBe("Invalid CSRF token");

      const forged = await todos.create(
        post(`${ORIGIN}/todos`, sessionId, {
          title: "New",
          _csrf: "invalid.token",
        }),
      );
      expect(forged.status).toBe(403);

      const noOrigin = await todos.create(
        createBunRequest(`${ORIGIN}/todos`, {
          method: "POST",
          headers: { Cookie: `session_id=${sessionId}` },
          body: formBody({ title: "New", _csrf: token }),
        }),
      );
      expect(noOrigin.status).toBe(403);
      expect(await noOrigin.text()).toBe("Invalid request origin");

      expect(mockCreateTodo).not.toHaveBeenCalled();
    });

    test("redirects with a validation flash for a short title", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(sessionId, "POST", "/todos");

      const request = post(`${ORIGIN}/todos`, sessionId, {
        title: "x",
        _csrf: token,
      });
      const response = await todos.create(request);

      expect(mockCreateTodo).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain(
        "validation-error",
      );
    });

    test("accepts the token in the header instead of the form", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(sessionId, "POST", "/todos");

      const response = await todos.create(
        post(
          `${ORIGIN}/todos`,
          sessionId,
          { title: "Header Token" },
          { headers: { [CSRF_HEADER]: token } },
        ),
      );

      expect(mockCreateTodo).toHaveBeenCalled();
      expect(response.status).toBe(303);
    });

    test("a visitor with no cookie gets a guest session, then fails the token check", async () => {
      const response = await todos.create(
        post(`${ORIGIN}/todos`, null, { title: "Nobody" }),
      );
      expect(response.status).toBe(403);
      expect(mockCreateTodo).not.toHaveBeenCalled();
    });

    describe("as a fragment request", () => {
      test("answers with the rendered row, armed with its own tokens", async () => {
        const sessionId = await createTestSession();
        const token = await createCsrfToken(sessionId, "POST", "/todos");
        mockCreateTodo.mockResolvedValue(
          createMockTodo({ id: 7, title: "Row" }),
        );

        const response = await todos.create(
          post(
            `${ORIGIN}/todos`,
            sessionId,
            { title: "Row", _csrf: token },
            { fragment: true },
          ),
        );
        const html = await response.text();

        expect(response.status).toBe(201);
        expect(response.headers.get("content-type")).toBe("text/html");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(html.startsWith("<tr")).toBe(true);
        expect(html).toContain('data-id="7"');
        expect(html).toContain("Row");
        expect(html).toContain('action="/todos/7/toggle"');
        expect(html).toContain('data-on="submit:toggle"');
        // Authenticated, so the row carries its delete form too.
        expect(html).toContain('action="/todos/7/delete"');
        expect(html).not.toContain("<html");
      });

      test("leaves the delete cell out of a guest's row", async () => {
        const sessionId = await createGuestSession();
        const token = await createCsrfToken(sessionId, "POST", "/todos");
        mockCreateTodo.mockResolvedValue(createMockTodo({ id: 8 }));

        const html = await (
          await todos.create(
            post(
              `${ORIGIN}/todos`,
              sessionId,
              { title: "Guest row", _csrf: token },
              { fragment: true },
            ),
          )
        ).text();

        expect(html).toContain('action="/todos/8/toggle"');
        expect(html).not.toContain("/delete");
      });

      test("hands back a fresh token for a stale one, and that token works", async () => {
        const sessionId = await createTestSession();
        const stale = await mintStaleToken(sessionId, "/todos");

        const refused = await todos.create(
          post(
            `${ORIGIN}/todos`,
            sessionId,
            { title: "Retry me", _csrf: stale },
            { fragment: true },
          ),
        );

        expect(refused.status).toBe(403);
        expect(mockCreateTodo).not.toHaveBeenCalled();
        const fresh = refused.headers.get(CSRF_HEADER);
        expect(fresh).toBeTruthy();

        const retried = await todos.create(
          post(
            `${ORIGIN}/todos`,
            sessionId,
            { title: "Retry me", _csrf: fresh ?? "" },
            { fragment: true },
          ),
        );
        expect(retried.status).toBe(201);
        expect(mockCreateTodo).toHaveBeenCalledWith(
          "Retry me",
          expect.anything(),
        );
      });

      test("still fails hard on a forged token — no fresh token for that", async () => {
        const sessionId = await createTestSession();

        const response = await todos.create(
          post(
            `${ORIGIN}/todos`,
            sessionId,
            { title: "Forged", _csrf: "invalid.token" },
            { fragment: true },
          ),
        );

        expect(response.status).toBe(403);
        expect(response.headers.get(CSRF_HEADER)).toBeNull();
      });

      test("answers a short title with a 400 rather than a redirect", async () => {
        const sessionId = await createTestSession();
        const token = await createCsrfToken(sessionId, "POST", "/todos");

        const response = await todos.create(
          post(
            `${ORIGIN}/todos`,
            sessionId,
            { title: "x", _csrf: token },
            { fragment: true },
          ),
        );

        expect(response.status).toBe(400);
        expect(mockCreateTodo).not.toHaveBeenCalled();
      });
    });
  });

  describe("POST /todos/:id/toggle", () => {
    test("a guest toggles with a valid token and is redirected", async () => {
      const sessionId = await createGuestSession();
      const token = await createCsrfToken(sessionId, "POST", "/todos/3/toggle");
      mockToggleTodo.mockResolvedValue(
        createMockTodo({ id: 3, completed_at: new Date() }),
      );

      const response = await todos.toggle(
        post(`${ORIGIN}/todos/3/toggle`, sessionId, { _csrf: token }),
      );

      expect(mockToggleTodo).toHaveBeenCalledWith(3);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/todos");
    });

    test("answers a fragment request with the updated row", async () => {
      const sessionId = await createGuestSession();
      const token = await createCsrfToken(sessionId, "POST", "/todos/3/toggle");
      mockToggleTodo.mockResolvedValue(
        createMockTodo({ id: 3, title: "Ticked", completed_at: new Date() }),
      );

      const response = await todos.toggle(
        post(
          `${ORIGIN}/todos/3/toggle`,
          sessionId,
          { _csrf: token },
          { fragment: true },
        ),
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('data-id="3" data-completed');
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain("Ticked");
    });

    test("a stale token flashes and never toggles", async () => {
      const sessionId = await createTestSession();
      const stale = await mintStaleToken(sessionId, "/todos/3/toggle");

      const request = post(`${ORIGIN}/todos/3/toggle`, sessionId, {
        _csrf: stale,
      });
      const response = await todos.toggle(request);

      expect(mockToggleTodo).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain(
        "action-csrf-expired",
      );
    });

    test("a stale token on a fragment request is refreshed instead", async () => {
      const sessionId = await createTestSession();
      const stale = await mintStaleToken(sessionId, "/todos/3/toggle");

      const response = await todos.toggle(
        post(
          `${ORIGIN}/todos/3/toggle`,
          sessionId,
          { _csrf: stale },
          { fragment: true },
        ),
      );

      expect(mockToggleTodo).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(response.headers.get(CSRF_HEADER)).toBeTruthy();
    });

    test("an unknown id redirects, or 404s as a fragment", async () => {
      const sessionId = await createTestSession();
      mockToggleTodo.mockResolvedValue(null);

      const token = await createCsrfToken(
        sessionId,
        "POST",
        "/todos/999/toggle",
      );
      const plain = await todos.toggle(
        post(`${ORIGIN}/todos/999/toggle`, sessionId, { _csrf: token }),
      );
      expect(plain.status).toBe(303);

      const again = await createCsrfToken(
        sessionId,
        "POST",
        "/todos/999/toggle",
      );
      const fragment = await todos.toggle(
        post(
          `${ORIGIN}/todos/999/toggle`,
          sessionId,
          { _csrf: again },
          { fragment: true },
        ),
      );
      expect(fragment.status).toBe(404);
    });

    test("rejects a missing token", async () => {
      const sessionId = await createTestSession();

      const response = await todos.toggle(
        post(`${ORIGIN}/todos/3/toggle`, sessionId, {}),
      );

      expect(response.status).toBe(403);
      expect(mockToggleTodo).not.toHaveBeenCalled();
    });
  });

  describe("POST /todos/:id/delete", () => {
    test("redirects unauthenticated users to login", async () => {
      const response = await todos.destroy(
        post(`${ORIGIN}/todos/42/delete`, null, {}),
      );

      expect(mockDeleteTodo).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("a guest session is not enough", async () => {
      const guestSessionId = await createGuestSession();
      const token = await createCsrfToken(
        guestSessionId,
        "POST",
        "/todos/42/delete",
      );

      const response = await todos.destroy(
        post(`${ORIGIN}/todos/42/delete`, guestSessionId, { _csrf: token }),
      );

      expect(mockDeleteTodo).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBe("/login");
    });

    test("rejects a missing token", async () => {
      const sessionId = await createTestSession();

      const response = await todos.destroy(
        post(`${ORIGIN}/todos/42/delete`, sessionId, {}),
      );

      expect(mockDeleteTodo).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
    });

    test("deletes with a valid token and flashes", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(
        sessionId,
        "POST",
        "/todos/42/delete",
      );
      mockDeleteTodo.mockResolvedValue(true);

      const request = post(`${ORIGIN}/todos/42/delete`, sessionId, {
        _csrf: token,
      });
      const response = await todos.destroy(request);

      expect(mockDeleteTodo).toHaveBeenCalledWith(42);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/todos");
      expect(findSetCookie(request, "flash_state")).toContain(
        "deletion-success",
      );
    });

    test("answers a fragment request with 204", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(
        sessionId,
        "POST",
        "/todos/42/delete",
      );
      mockDeleteTodo.mockResolvedValue(true);

      const response = await todos.destroy(
        post(
          `${ORIGIN}/todos/42/delete`,
          sessionId,
          { _csrf: token },
          { fragment: true },
        ),
      );

      expect(response.status).toBe(204);
      expect(mockDeleteTodo).toHaveBeenCalledWith(42);
    });

    test("an unknown id redirects, or 404s as a fragment", async () => {
      const sessionId = await createTestSession();
      mockDeleteTodo.mockResolvedValue(false);

      const token = await createCsrfToken(
        sessionId,
        "POST",
        "/todos/999/delete",
      );
      const plain = await todos.destroy(
        post(`${ORIGIN}/todos/999/delete`, sessionId, { _csrf: token }),
      );
      expect(plain.status).toBe(303);

      const again = await createCsrfToken(
        sessionId,
        "POST",
        "/todos/999/delete",
      );
      const fragment = await todos.destroy(
        post(
          `${ORIGIN}/todos/999/delete`,
          sessionId,
          { _csrf: again },
          { fragment: true },
        ),
      );
      expect(fragment.status).toBe(404);
    });

    test("redirects when the id is not a number", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(
        sessionId,
        "POST",
        "/todos/invalid/delete",
      );

      const response = await todos.destroy(
        post(`${ORIGIN}/todos/invalid/delete`, sessionId, { _csrf: token }),
      );

      expect(mockDeleteTodo).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
    });

    test("never deletes on a stale token", async () => {
      const sessionId = await createTestSession();
      const stale = await mintStaleToken(sessionId, "/todos/1/delete");

      const request = post(`${ORIGIN}/todos/1/delete`, sessionId, {
        _csrf: stale,
      });
      const response = await todos.destroy(request);

      // The load-bearing assertion: a destructive action must never be
      // replayed off a stale token.
      expect(mockDeleteTodo).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain(
        "action-csrf-expired",
      );

      const fragment = await todos.destroy(
        post(
          `${ORIGIN}/todos/1/delete`,
          sessionId,
          { _csrf: stale },
          { fragment: true },
        ),
      );
      expect(mockDeleteTodo).not.toHaveBeenCalled();
      expect(fragment.status).toBe(403);
      expect(fragment.headers.get(CSRF_HEADER)).toBeTruthy();
    });
  });
});
