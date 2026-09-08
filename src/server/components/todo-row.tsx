import type { TodoList } from "@client/components/todo-list";
import { component } from "@shared/attributes";
import type { Todo } from "../services/todo";
import { CsrfField } from "./csrf-field";

const list = component<TodoList>("todo-list");

interface TodoRowProps {
  todo: Todo;
  // Null when the visitor has no session: the form renders, the post fails
  // the CSRF check, exactly as the create form does.
  toggleCsrfToken: string | null;
  // Only authenticated users may delete, so this is null for everyone else and
  // the cell is left out. `showActions` still has to be passed so a guest's
  // rows line up with a header that has no actions column.
  deleteCsrfToken: string | null;
  showActions: boolean;
}

// One row, rendered by the page and returned on its own by the fragment
// responses to add and toggle — the reason it is a component and not part of
// the template. Every control is a form the browser can post unaided; the
// `data-on` bindings are what let the todo-list component post them in place.
export const TodoRow = ({
  todo,
  toggleCsrfToken,
  deleteCsrfToken,
  showActions,
}: TodoRowProps) => {
  const done = todo.completed_at !== null;
  return (
    <tr
      data-id={todo.id}
      data-completed={done ? "" : undefined}
      className={done ? "done" : undefined}
    >
      <td className="toggle-cell">
        <form
          method="POST"
          action={`/todos/${todo.id}/toggle`}
          className="toggle-form"
          {...list.on({ submit: "toggle" })}
        >
          <CsrfField token={toggleCsrfToken} />
          <button
            type="submit"
            className="toggle-btn"
            aria-pressed={done}
            aria-label={
              done
                ? `Mark "${todo.title}" not done`
                : `Mark "${todo.title}" done`
            }
          >
            {done ? "✓" : ""}
          </button>
        </form>
      </td>
      <td className="todo-title">{todo.title}</td>
      {showActions && (
        <td className="delete-cell">
          {deleteCsrfToken && (
            <form
              method="POST"
              action={`/todos/${todo.id}/delete`}
              className="delete-form"
              {...list.on({ submit: "remove" })}
            >
              <CsrfField token={deleteCsrfToken} />
              <button type="submit" className="delete-btn">
                Delete
              </button>
            </form>
          )}
        </td>
      )}
    </tr>
  );
};
