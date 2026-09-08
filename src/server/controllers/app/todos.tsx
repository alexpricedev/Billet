import type { BunRequest } from "bun";
import { TodoRow } from "../../components/todo-row";
import {
  getSessionContext,
  requireAuth,
  type SessionContext,
} from "../../middleware/auth";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { createCsrfToken } from "../../services/csrf";
import { setSessionCookie } from "../../services/sessions";
import {
  createTodo,
  deleteTodo,
  getTodos,
  type Todo,
  toggleTodo,
} from "../../services/todo";
import type { TodosState } from "../../templates/todos";
import { Todos } from "../../templates/todos";
import { readFormValues } from "../../utils/form-data";
import {
  emptyFragment,
  isFragmentRequest,
  refreshCsrfToken,
  renderFragment,
} from "../../utils/fragment";
import { redirect, render } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<TodosState>();

const togglePath = (id: number) => `/todos/${id}/toggle`;
const deletePath = (id: number) => `/todos/${id}/delete`;

// Every row carries its own tokens — one per method and path — so the page
// and the fragments mint them the same way.
const rowTokens = async (ctx: SessionContext, id: number) => ({
  toggle: ctx.sessionId
    ? await createCsrfToken(ctx.sessionId, "POST", togglePath(id))
    : null,
  delete:
    ctx.isAuthenticated && ctx.sessionId
      ? await createCsrfToken(ctx.sessionId, "POST", deletePath(id))
      : null,
});

// The fragment answer to add and toggle: the row as the page would render it,
// tokens included, so the next action on it is already armed.
const rowFragment = async (
  ctx: SessionContext,
  todo: Todo,
  status = 200,
): Promise<Response> => {
  const tokens = await rowTokens(ctx, todo.id);
  return renderFragment(
    <TodoRow
      todo={todo}
      toggleCsrfToken={tokens.toggle}
      deleteCsrfToken={tokens.delete}
      showActions={ctx.isAuthenticated}
    />,
    { status },
  );
};

const readId = (req: BunRequest): number | null => {
  const id = Number.parseInt(req.params.id ?? "", 10);
  return Number.isNaN(id) ? null : id;
};

// A fragment client asked for a row and there is none to give; the plain
// post just goes back to the list.
const missing = (req: BunRequest): Response =>
  isFragmentRequest(req)
    ? new Response("Not found", { status: 404 })
    : redirect("/todos");

export const todos = {
  async index(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);
    const todoList = await getTodos();

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    let navCsrfToken: string | undefined;
    if (ctx.isAuthenticated && ctx.sessionId) {
      navCsrfToken = await createCsrfToken(
        ctx.sessionId,
        "POST",
        "/auth/logout",
      );
    }

    const state = getFlash(req);

    let createCsrfTokenValue: string | null = null;
    if (ctx.sessionId) {
      createCsrfTokenValue = await createCsrfToken(
        ctx.sessionId,
        "POST",
        "/todos",
      );
    }

    const toggleCsrfTokens: Record<number, string> = {};
    const deleteCsrfTokens: Record<number, string> = {};
    for (const todo of todoList) {
      const tokens = await rowTokens(ctx, todo.id);
      if (tokens.toggle) toggleCsrfTokens[todo.id] = tokens.toggle;
      if (tokens.delete) deleteCsrfTokens[todo.id] = tokens.delete;
    }

    return render(
      <Todos
        createCsrfToken={createCsrfTokenValue}
        toggleCsrfTokens={toggleCsrfTokens}
        deleteCsrfTokens={deleteCsrfTokens}
        todos={todoList}
        isAuthenticated={ctx.isAuthenticated}
        state={state}
        user={ctx.user}
        csrfToken={navCsrfToken}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (!ctx.sessionId) {
      return redirect("/todos");
    }

    const csrf = await checkCsrf(req, { method: "POST", path: "/todos" });
    if (!csrf.ok) {
      // Forged, missing or cross-origin: fail hard.
      if (!isRecoverableCsrfFailure(csrf)) {
        return csrf.response;
      }

      // Stale but authentic. Don't create. A fragment client gets a fresh
      // token to retry with; a plain post gets the title back with one.
      if (isFragmentRequest(req)) {
        return refreshCsrfToken(ctx.sessionId, "POST", "/todos");
      }
      const stale = await readFormValues(req, ["title"]);
      setFlash(
        req,
        fitFlashState<TodosState>(
          { state: "csrf-expired", title: stale.title },
          ["title"],
        ),
      );
      return redirect("/todos");
    }

    const { title } = await readFormValues(req, ["title"]);

    if (!title || title.length < 2) {
      // The fragment client falls back to a plain post on any 4xx, and that
      // post lands here again and gets the flash below.
      if (isFragmentRequest(req)) {
        return new Response("A todo must be at least 2 characters.", {
          status: 400,
        });
      }
      setFlash(
        req,
        fitFlashState<TodosState>({ state: "validation-error", title }, [
          "title",
        ]),
      );
      return redirect("/todos");
    }

    const todo = await createTodo(title, ctx.user?.email ?? null);

    if (isFragmentRequest(req)) {
      return rowFragment(ctx, todo, 201);
    }
    setFlash(req, { state: "submission-success" });
    return redirect("/todos");
  },

  async toggle(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (!ctx.sessionId) {
      return redirect("/todos");
    }

    const path = new URL(req.url).pathname;
    const csrf = await checkCsrf(req, { method: "POST", path });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) {
        return csrf.response;
      }
      if (isFragmentRequest(req)) {
        return refreshCsrfToken(ctx.sessionId, "POST", path);
      }
      setFlash(req, { state: "action-csrf-expired" });
      return redirect("/todos");
    }

    const id = readId(req);
    if (id === null) return missing(req);

    const todo = await toggleTodo(id);
    if (!todo) return missing(req);

    // A plain post just comes back to the list; the change is visible in the
    // row, so there is nothing a flash would add.
    return isFragmentRequest(req) ? rowFragment(ctx, todo) : redirect("/todos");
  },

  async destroy(req: BunRequest): Promise<Response> {
    const authRedirect = await requireAuth(req);
    if (authRedirect) {
      return authRedirect;
    }
    const ctx = await getSessionContext(req);

    const path = new URL(req.url).pathname;
    const csrf = await checkCsrf(req, { method: "POST", path });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) {
        return csrf.response;
      }

      // Stale but authentic. Nothing to preserve, and a delete must never be
      // replayed silently: the fragment client retries with the fresh token
      // it is handed; a plain post bounces back so the row re-renders with
      // one and the user confirms with a deliberate second click.
      if (isFragmentRequest(req) && ctx.sessionId) {
        return refreshCsrfToken(ctx.sessionId, "POST", path);
      }
      setFlash(req, { state: "action-csrf-expired" });
      return redirect("/todos");
    }

    const id = readId(req);
    if (id === null) return missing(req);

    const deleted = await deleteTodo(id);
    if (!deleted) return missing(req);

    if (isFragmentRequest(req)) return emptyFragment();
    setFlash(req, { state: "deletion-success" });
    return redirect("/todos");
  },
};
