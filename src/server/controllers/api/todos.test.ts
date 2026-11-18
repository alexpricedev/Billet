import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import type { SessionContext } from "../../services/sessions";
import type { Todo, TodoPage } from "../../services/todo";
import { createMockTodo } from "../../test-utils/factories";
import { createMockRequest, expectJsonError } from "../../test-utils/setup";

// Mock the todo service
const mockGetTodoPage = mock(
  async (): Promise<TodoPage> => ({ todos: [], total: 0 }),
);
const mockGetTodoById = mock(async (): Promise<Todo | null> => null);
const mockCreateTodo = mock(async (): Promise<Todo> => createMockTodo());
const mockUpdateTodo = mock(async (): Promise<Todo | null> => null);
const mockDeleteTodo = mock(async (): Promise<boolean> => false);

mock.module("../../services/todo", () => ({
  getTodoPage: mockGetTodoPage,
  getTodoById: mockGetTodoById,
  createTodo: mockCreateTodo,
  updateTodo: mockUpdateTodo,
  deleteTodo: mockDeleteTodo,
}));

// DELETE needs a signed-in session. The cookie is read for real; the lookup is
// mocked, and answers as a signed-in user unless a test says otherwise.
const signedIn: SessionContext = {
  sessionId: "session-1",
  sessionHash: "hash-1",
  sessionType: "authenticated",
  user: {
    id: "user-1",
    email: "alice@example.com",
    role: "user",
    created_at: new Date(),
    email_verified_at: null,
  },
  isGuest: false,
  isAuthenticated: true,
  requiresSetCookie: false,
};
const mockGetSessionContextFromDB = mock(
  async (): Promise<SessionContext | null> => signedIn,
);

mock.module("../../services/sessions", () => ({
  getSessionIdFromRequest: (req: { cookies: Map<string, string> }) =>
    req.cookies.get("session_id") ?? null,
  getSessionContextFromDB: mockGetSessionContextFromDB,
}));

// Import after mocking
import { todosApi } from "./todos";

const SIGNED_IN = { Cookie: "session_id=session-1" };

const BASE = "http://localhost:3000/api/todos";

describe("Todos API", () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mockGetTodoPage.mockClear();
    mockGetTodoById.mockClear();
    mockCreateTodo.mockClear();
    mockUpdateTodo.mockClear();
    mockDeleteTodo.mockClear();
    mockGetSessionContextFromDB.mockClear();
    mockGetSessionContextFromDB.mockResolvedValue(signedIn);
    // The rate-limit log is module state shared by every test in this file.
    clearRateLimitLog();
  });

  describe("GET /api/todos", () => {
    test("returns a page of todos with the total", async () => {
      const mockTodos = [
        createMockTodo({ id: 1, title: "Todo 1" }),
        createMockTodo({ id: 2, title: "Todo 2" }),
      ];
      mockGetTodoPage.mockResolvedValue({ todos: mockTodos, total: 2 });

      const response = await todosApi.index(createMockRequest(BASE));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.json()).toEqual({
        data: mockTodos,
        pagination: { total: 2, limit: 25, offset: 0 },
      });
      expect(mockGetTodoPage).toHaveBeenCalledWith(25, 0);
    });

    test("serialises completed_at as an ISO timestamp or null", async () => {
      mockGetTodoPage.mockResolvedValue({
        todos: [
          createMockTodo({ id: 1 }),
          createMockTodo({
            id: 2,
            completed_at: new Date("2026-01-02T03:04:05.000Z"),
          }),
        ],
        total: 2,
      });

      const body = (await (
        await todosApi.index(createMockRequest(BASE))
      ).json()) as { data: Array<{ completed_at: string | null }> };

      expect(body.data[0].completed_at).toBeNull();
      expect(body.data[1].completed_at).toBe("2026-01-02T03:04:05.000Z");
    });

    test("honours limit and offset", async () => {
      mockGetTodoPage.mockResolvedValue({ todos: [], total: 0 });

      const response = await todosApi.index(
        createMockRequest(`${BASE}?limit=5&offset=10`),
      );

      expect(response.status).toBe(200);
      expect(mockGetTodoPage).toHaveBeenCalledWith(5, 10);
      const data = (await response.json()) as { pagination: unknown };
      expect(data.pagination).toEqual({ total: 0, limit: 5, offset: 10 });
    });

    test("rejects a limit above the maximum rather than clamping it", async () => {
      const response = await todosApi.index(
        createMockRequest(`${BASE}?limit=5000`),
      );

      await expectJsonError(response, 400, "invalid_limit");
      expect(mockGetTodoPage).not.toHaveBeenCalled();
    });

    test.each([["limit=0"], ["limit=abc"], ["limit=-1"], ["limit=1.5"]])(
      "rejects %s",
      async (query) => {
        const response = await todosApi.index(
          createMockRequest(`${BASE}?${query}`),
        );
        await expectJsonError(response, 400, "invalid_limit");
      },
    );

    test("rejects a non-numeric offset", async () => {
      const response = await todosApi.index(
        createMockRequest(`${BASE}?offset=abc`),
      );
      await expectJsonError(response, 400, "invalid_offset");
    });

    test("returns 429 once the per-IP read limit is exceeded", async () => {
      const send = () => todosApi.index(createMockRequest(BASE));

      for (let i = 0; i < 60; i++) {
        expect((await send()).status).toBe(200);
      }

      const throttled = await send();
      await expectJsonError(throttled, 429, "rate_limited");
      expect(throttled.headers.get("Retry-After")).toBeTruthy();
    });
  });

  describe("GET /api/todos/:id", () => {
    test("returns the todo when found", async () => {
      const mockTodo = createMockTodo({ id: 1, title: "Test Todo" });
      mockGetTodoById.mockResolvedValue(mockTodo);

      const response = await todosApi.show(createMockRequest(`${BASE}/1`));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: mockTodo });
      expect(mockGetTodoById).toHaveBeenCalledWith(1);
    });

    test("returns a JSON 404 when not found", async () => {
      mockGetTodoById.mockResolvedValue(null);

      const response = await todosApi.show(createMockRequest(`${BASE}/999`));

      await expectJsonError(response, 404, "not_found");
      expect(mockGetTodoById).toHaveBeenCalledWith(999);
    });

    test.each([["invalid"], ["0"], ["-1"], ["1.5"], ["12abc"], ["9999999999"]])(
      "rejects id %s without querying the database",
      async (id) => {
        const response = await todosApi.show(
          createMockRequest(`${BASE}/${id}`),
        );

        await expectJsonError(response, 400, "invalid_id");
        expect(mockGetTodoById).not.toHaveBeenCalled();
      },
    );
  });

  describe("POST /api/todos", () => {
    test("creates and returns the new todo", async () => {
      const newTodo = createMockTodo({ id: 1, title: "New Todo" });
      mockCreateTodo.mockResolvedValue(newTodo);

      const response = await todosApi.create(
        createMockRequest(BASE, "POST", { title: "New Todo" }),
      );

      expect(response.status).toBe(201);
      expect(response.headers.get("Location")).toBe("/api/todos/1");
      expect(await response.json()).toEqual({ data: newTodo });
      expect(mockCreateTodo).toHaveBeenCalledWith("New Todo", null);
    });

    test("trims the title", async () => {
      mockCreateTodo.mockResolvedValue(createMockTodo());

      await todosApi.create(
        createMockRequest(BASE, "POST", { title: "  Padded  " }),
      );

      expect(mockCreateTodo).toHaveBeenCalledWith("Padded", null);
    });

    test("rejects a body that is not JSON with 400, not a 500", async () => {
      const response = await todosApi.create(
        createMockRequest(BASE, "POST", "{ not json"),
      );

      await expectJsonError(response, 400, "invalid_json");
      expect(mockCreateTodo).not.toHaveBeenCalled();
    });

    test("rejects a non-JSON Content-Type with 415", async () => {
      const response = await todosApi.create(
        createMockRequest(BASE, "POST", "title=New", {
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      );

      await expectJsonError(response, 415, "unsupported_media_type");
      expect(response.headers.get("Accept")).toBe("application/json");
      expect(mockCreateTodo).not.toHaveBeenCalled();
    });

    test("accepts a +json structured-suffix media type", async () => {
      mockCreateTodo.mockResolvedValue(createMockTodo());

      const response = await todosApi.create(
        createMockRequest(
          BASE,
          "POST",
          { title: "Vendor" },
          { "Content-Type": "application/vnd.billet.v1+json; charset=utf-8" },
        ),
      );

      expect(response.status).toBe(201);
    });

    test.each([
      ["a JSON array", "[]"],
      ["a JSON string", '"nope"'],
      ["null", "null"],
    ])("rejects %s as a body", async (_label, body) => {
      const response = await todosApi.create(
        createMockRequest(BASE, "POST", body),
      );

      await expectJsonError(response, 400, "invalid_body");
      expect(mockCreateTodo).not.toHaveBeenCalled();
    });

    test.each([
      ["a missing title", {}],
      ["a blank title", { title: "   " }],
      ["a non-string title", { title: 42 }],
    ])("rejects %s with field-level detail", async (_label, body) => {
      const response = await todosApi.create(
        createMockRequest(BASE, "POST", body),
      );

      const parsed = await expectJsonError(response, 400, "invalid_body");
      expect(parsed.error.fields?.title).toBeTruthy();
      expect(mockCreateTodo).not.toHaveBeenCalled();
    });

    test("returns 429 once the per-IP write limit is exceeded", async () => {
      mockCreateTodo.mockResolvedValue(createMockTodo());
      const send = () =>
        todosApi.create(createMockRequest(BASE, "POST", { title: "Spam" }));

      for (let i = 0; i < 20; i++) {
        expect((await send()).status).toBe(201);
      }

      await expectJsonError(await send(), 429, "rate_limited");
    });
  });

  describe("PUT /api/todos/:id", () => {
    test("renames and returns the todo, leaving completion alone", async () => {
      const updated = createMockTodo({ id: 1, title: "Updated Todo" });
      mockUpdateTodo.mockResolvedValue(updated);

      const response = await todosApi.update(
        createMockRequest(`${BASE}/1`, "PUT", { title: "Updated Todo" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: updated });
      expect(mockUpdateTodo).toHaveBeenCalledWith(1, "Updated Todo", undefined);
    });

    test("passes completed through when given", async () => {
      mockUpdateTodo.mockResolvedValue(
        createMockTodo({ id: 1, completed_at: new Date() }),
      );

      await todosApi.update(
        createMockRequest(`${BASE}/1`, "PUT", {
          title: "Done",
          completed: true,
        }),
      );
      expect(mockUpdateTodo).toHaveBeenCalledWith(1, "Done", true);

      await todosApi.update(
        createMockRequest(`${BASE}/1`, "PUT", {
          title: "Done",
          completed: false,
        }),
      );
      expect(mockUpdateTodo).toHaveBeenCalledWith(1, "Done", false);
    });

    test.each([["yes"], [1], [null]])(
      "rejects completed=%p with field-level detail",
      async (completed) => {
        const response = await todosApi.update(
          createMockRequest(`${BASE}/1`, "PUT", { title: "Done", completed }),
        );

        const parsed = await expectJsonError(response, 400, "invalid_body");
        expect(parsed.error.fields?.completed).toBeTruthy();
        expect(mockUpdateTodo).not.toHaveBeenCalled();
      },
    );

    test("returns a JSON 404 when not found", async () => {
      mockUpdateTodo.mockResolvedValue(null);

      const response = await todosApi.update(
        createMockRequest(`${BASE}/999`, "PUT", { title: "Updated" }),
      );

      await expectJsonError(response, 404, "not_found");
    });

    test("checks the id before reading the body", async () => {
      const response = await todosApi.update(
        createMockRequest(`${BASE}/invalid`, "PUT", "{ not json"),
      );

      await expectJsonError(response, 400, "invalid_id");
      expect(mockUpdateTodo).not.toHaveBeenCalled();
    });

    test("rejects a missing title", async () => {
      const response = await todosApi.update(
        createMockRequest(`${BASE}/1`, "PUT", {}),
      );

      await expectJsonError(response, 400, "invalid_body");
      expect(mockUpdateTodo).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/todos/:id", () => {
    test("deletes and returns 204", async () => {
      mockDeleteTodo.mockResolvedValue(true);

      const response = await todosApi.destroy(
        createMockRequest(`${BASE}/1`, "DELETE", undefined, SIGNED_IN),
      );

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(mockDeleteTodo).toHaveBeenCalledWith(1);
    });

    test("returns a JSON 404 when not found", async () => {
      mockDeleteTodo.mockResolvedValue(false);

      const response = await todosApi.destroy(
        createMockRequest(`${BASE}/999`, "DELETE", undefined, SIGNED_IN),
      );

      await expectJsonError(response, 404, "not_found");
      expect(mockDeleteTodo).toHaveBeenCalledWith(999);
    });

    test("rejects an invalid id without querying the database", async () => {
      const response = await todosApi.destroy(
        createMockRequest(`${BASE}/invalid`, "DELETE", undefined, SIGNED_IN),
      );

      await expectJsonError(response, 400, "invalid_id");
      expect(mockDeleteTodo).not.toHaveBeenCalled();
    });

    test("returns a JSON 401 without a session, and deletes nothing", async () => {
      const response = await todosApi.destroy(
        createMockRequest(`${BASE}/1`, "DELETE"),
      );

      await expectJsonError(response, 401, "unauthenticated");
      expect(mockGetSessionContextFromDB).not.toHaveBeenCalled();
      expect(mockDeleteTodo).not.toHaveBeenCalled();
    });

    test("returns a JSON 401 for a guest session, and deletes nothing", async () => {
      mockGetSessionContextFromDB.mockResolvedValue({
        ...signedIn,
        sessionType: "guest",
        user: null,
        isGuest: true,
        isAuthenticated: false,
      });

      const response = await todosApi.destroy(
        createMockRequest(`${BASE}/1`, "DELETE", undefined, SIGNED_IN),
      );

      await expectJsonError(response, 401, "unauthenticated");
      expect(mockDeleteTodo).not.toHaveBeenCalled();
    });

    test("returns a JSON 401 for an unknown or expired session", async () => {
      mockGetSessionContextFromDB.mockResolvedValue(null);

      const response = await todosApi.destroy(
        createMockRequest(`${BASE}/1`, "DELETE", undefined, SIGNED_IN),
      );

      await expectJsonError(response, 401, "unauthenticated");
      expect(mockDeleteTodo).not.toHaveBeenCalled();
    });
  });
});
