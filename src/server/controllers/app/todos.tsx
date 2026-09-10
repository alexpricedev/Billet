import type { BunRequest } from "bun";
import { TodoRow } from "../../components/todo-row";
import { getSessionContext, type SessionContext } from "../../middleware/auth";
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
import { csrfTokens } from "../../utils/csrf-tokens";
import { formAction } from "../../utils/form-action";
import { readFormValues } from "../../utils/form-data";
import { render } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

const { getFlash } = stateHelpers<TodosState>();

const togglePath = (todo: { id: number }) => `/todos/${todo.id}/toggle`;
const deletePath = (todo: { id: number }) => `/todos/${todo.id}/delete`;

// The fragment answer to add and toggle: the row as the page would render it,
// tokens included, so the next action on it is already armed.
const todoRow = async (ctx: SessionContext, todo: Todo) => {
  const tokens = csrfTokens(ctx);
  return (
    <TodoRow
      todo={todo}
      toggleCsrfToken={await tokens.for(togglePath(todo))}
      deleteCsrfToken={await tokens.forUser(deletePath(todo))}
      showActions={ctx.isAuthenticated}
    />
  );
};

const readId = (req: BunRequest): number | null => {
  const id = Number.parseInt(req.params.id ?? "", 10);
  return Number.isNaN(id) ? null : id;
};

export const todos = {
  async index(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);
    const todoList = await getTodos();

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    const tokens = csrfTokens(ctx);
    return render(
      <Todos
        todos={todoList}
        state={getFlash(req)}
        isAuthenticated={ctx.isAuthenticated}
        user={ctx.user}
        csrfToken={await tokens.nav()}
        createCsrfToken={await tokens.for("/todos")}
        toggleCsrfTokens={await tokens.forEach(todoList, togglePath)}
        deleteCsrfTokens={
          await tokens.forEach(todoList, deletePath, {
            usersOnly: true,
          })
        }
      />,
    );
  },

  // Guests may add. A stale token hands the title back rather than losing it.
  create: formAction<TodosState>({
    redirectTo: "/todos",
    onExpired: async (req) => {
      const { title } = await readFormValues(req, ["title"]);
      return fitFlashState<TodosState>({ state: "csrf-expired", title }, [
        "title",
      ]);
    },
  })(async (req, ctx) => {
    const { title } = await readFormValues(req, ["title"]);

    if (!title || title.length < 2) {
      return {
        reject: 400,
        flash: fitFlashState<TodosState>({ state: "validation-error", title }, [
          "title",
        ]),
      };
    }

    const todo = await createTodo(title, ctx.user?.email ?? null);
    return {
      flash: { state: "submission-success" },
      fragment: await todoRow(ctx, todo),
      status: 201,
    };
  }),

  // Guests may toggle too. No flash on the plain path: the change is visible
  // in the row, so there is nothing a banner would add.
  toggle: formAction<TodosState>({
    redirectTo: "/todos",
    onExpired: () => ({ state: "action-csrf-expired" }),
  })(async (req, ctx) => {
    const id = readId(req);
    const todo = id === null ? null : await toggleTodo(id);
    if (!todo) return { reject: 404 };
    return { fragment: await todoRow(ctx, todo) };
  }),

  // Signed-in users only. A stale token is never replayed: the plain post
  // bounces back so the row re-renders with a fresh one and the user confirms
  // with a deliberate second click; the fragment client retries on its own.
  destroy: formAction<TodosState>({
    redirectTo: "/todos",
    guard: "user",
    onExpired: () => ({ state: "action-csrf-expired" }),
  })(async (req) => {
    const id = readId(req);
    const deleted = id === null ? false : await deleteTodo(id);
    if (!deleted) return { reject: 404 };
    return { flash: { state: "deletion-success" }, fragment: null };
  }),
};
