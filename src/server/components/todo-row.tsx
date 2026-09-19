import type { TodoList } from "@client/components/todo-list";
import { bindings } from "@shared/attributes";
import type { Todo } from "../services/todo";
import { CsrfField } from "./csrf-field";

const list = bindings<TodoList>("todo-list");

// Both states are the same 24x24 box with the same circle, so toggling a row
// can't change its height. An empty button and one holding a glyph baseline-align
// differently, which is what used to make the list shift under the one it toggled.
const ToggleIcon = ({ done }: { done: boolean }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    {done && <path d="m16 9-5.5 5.5L8 12" />}
  </svg>
);

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
            <ToggleIcon done={done} />
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
