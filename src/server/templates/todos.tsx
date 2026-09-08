import type { TodoList } from "@client/components/todo-list";
import { bindings } from "@shared/attributes";
import { remainingLabel } from "@shared/todo";
import type { JSX } from "preact";
import { CsrfField } from "../components/csrf-field";
import { DataTable } from "../components/data-table";
import { Flash } from "../components/flash";
import { Layout } from "../components/layouts";
import { TodoRow } from "../components/todo-row";
import type { Todo } from "../services/todo";
import type { User } from "../services/users";

export interface TodosState {
  state?:
    | "submission-success"
    | "deletion-success"
    | "csrf-expired"
    | "action-csrf-expired"
    | "validation-error";
  title?: string;
}

export type TodosProps = {
  todos: Todo[];
  state: TodosState;
  isAuthenticated: boolean;
  createCsrfToken: string | null;
  // Per row, because a token is bound to its method and path.
  toggleCsrfTokens: Record<number, string>;
  deleteCsrfTokens: Record<number, string>;
  user: User | null;
  csrfToken?: string;
};

// Binding names below are checked against the client component's type, so a
// rename on either side fails `bun run typecheck` rather than going quiet.
const list = bindings<TodoList>("todo-list");

export const Todos = (props: TodosProps): JSX.Element => {
  // Only re-fill the add form when that submit failed.
  const restoredTitle =
    props.state?.state === "csrf-expired" ||
    props.state?.state === "validation-error"
      ? props.state.title
      : undefined;

  const remaining = props.todos.filter((todo) => todo.completed_at === null);

  return (
    <Layout
      title="Todos - Billet"
      description="The classic todo list, server-rendered: plain forms that work without JavaScript, enhanced in place with CSRF-protected fragments."
      canonicalPath="/todos"
      name="todos"
      user={props.user}
      csrfToken={props.csrfToken}
    >
      <h1>Todos</h1>
      <p className="lead">
        Every action here is an ordinary form that works without JavaScript.
        With it, the same forms post in place and the server answers with the
        row instead of a redirect — no client-side templates, no second copy of
        the markup.
      </p>

      {(props.state?.state === "submission-success" ||
        props.state?.state === "deletion-success") && (
        <Flash type="success">
          {props.state.state === "submission-success" &&
            "Todo added successfully."}
          {props.state.state === "deletion-success" &&
            "Todo deleted successfully."}
        </Flash>
      )}

      {props.state?.state === "csrf-expired" && (
        <Flash type="warning">
          Your session timed out — nothing was saved. Check the title and add it
          again.
        </Flash>
      )}

      {props.state?.state === "action-csrf-expired" && (
        <Flash type="warning">
          Your session timed out — nothing changed. Try again.
        </Flash>
      )}

      {props.state?.state === "validation-error" && (
        <Flash type="error">A todo must be at least 2 characters.</Flash>
      )}

      <div {...list.root}>
        <section className="card">
          <form
            method="POST"
            action="/todos"
            className="todo-form"
            {...list.on({ submit: "add" })}
          >
            <CsrfField token={props.createCsrfToken} />
            <label htmlFor="todo-title" className="sr-only">
              New todo
            </label>
            <input
              id="todo-title"
              type="text"
              name="title"
              placeholder="What needs doing?"
              autoComplete="off"
              required
              minLength={2}
              defaultValue={restoredTitle}
            />
            <button type="submit">Add</button>
          </form>
        </section>

        <div className="todos-header">
          <p className="todo-count text-tertiary" {...list.text("remaining")}>
            {remainingLabel(remaining.length)}
          </p>
          {/* Hidden by CSS until the component mounts; the buttons do nothing
              without it. */}
          <fieldset className="todo-filters">
            <legend className="sr-only">Show</legend>
            <button
              type="button"
              className="filter-btn active"
              aria-pressed="true"
              {...list.on({ click: "showAll" })}
              {...list.class({ active: "isAll" })}
              {...list.attr({ "aria-pressed": "isAll" })}
            >
              All
            </button>
            <button
              type="button"
              className="filter-btn"
              aria-pressed="false"
              {...list.on({ click: "showActive" })}
              {...list.class({ active: "isActive" })}
              {...list.attr({ "aria-pressed": "isActive" })}
            >
              Active
            </button>
            <button
              type="button"
              className="filter-btn"
              aria-pressed="false"
              {...list.on({ click: "showCompleted" })}
              {...list.class({ active: "isCompleted" })}
              {...list.attr({ "aria-pressed": "isCompleted" })}
            >
              Completed
            </button>
          </fieldset>
        </div>

        {!props.isAuthenticated && (
          <p className="text-tertiary">
            <a href="/login">Log in</a> to delete todos — the delete column only
            renders for authenticated users, showing how auth gates both
            controller logic and template output.
          </p>
        )}

        <div id="todos-list">
          <DataTable className="todo-list" caption="Todos">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Done</span>
                </th>
                <th scope="col">Todo</th>
                {props.isAuthenticated && (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {props.todos.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  toggleCsrfToken={props.toggleCsrfTokens[todo.id] ?? null}
                  deleteCsrfToken={props.deleteCsrfTokens[todo.id] ?? null}
                  showActions={props.isAuthenticated}
                />
              ))}
              {/* Also shown by the component when a filter matches nothing. */}
              <tr
                className="empty-row"
                hidden={props.todos.length > 0}
                {...list.show("isEmpty")}
              >
                <td
                  colSpan={props.isAuthenticated ? 3 : 2}
                  className="text-tertiary"
                  style={{ textAlign: "center" }}
                >
                  Nothing to show.
                </td>
              </tr>
            </tbody>
          </DataTable>
        </div>
      </div>

      <section className="api-section">
        <h2>API Endpoints</h2>
        <p className="text-tertiary">
          The same service layer backs both the HTML forms above and the JSON
          API below — adding an API is simple when business logic lives in one
          place.
        </p>
        <div className="card">
          <DataTable className="endpoint-table" caption="API endpoints">
            <tbody>
              <tr>
                <td>
                  <span className="method-get">GET</span>
                </td>
                <td className="endpoint-path">/api/todos</td>
                <td className="text-tertiary">
                  List todos (paginated — <code>?limit=</code>,{" "}
                  <code>?offset=</code>)
                </td>
              </tr>
              <tr>
                <td>
                  <span className="method-post">POST</span>
                </td>
                <td className="endpoint-path">/api/todos</td>
                <td className="text-tertiary">Create a todo</td>
              </tr>
              <tr>
                <td>
                  <span className="method-get">GET</span>
                </td>
                <td className="endpoint-path">/api/todos/:id</td>
                <td className="text-tertiary">Get one todo</td>
              </tr>
              <tr>
                <td>
                  <span className="method-put">PUT</span>
                </td>
                <td className="endpoint-path">/api/todos/:id</td>
                <td className="text-tertiary">
                  Rename, and optionally set <code>completed</code>
                </td>
              </tr>
              <tr>
                <td>
                  <span className="method-delete">DELETE</span>
                </td>
                <td className="endpoint-path">/api/todos/:id</td>
                <td className="text-tertiary">Delete a todo</td>
              </tr>
            </tbody>
          </DataTable>
        </div>
      </section>
    </Layout>
  );
};
