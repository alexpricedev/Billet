import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";
import { db } from "./database";

export type Todo = {
  id: number;
  title: string;
  // When it was ticked off; null while it is still to do.
  completed_at: Date | null;
  created_by: string | null;
};

const COLUMNS = db`id, title, completed_at, created_by`;

export const getTodos = async (): Promise<Todo[]> => {
  const results = await db`SELECT ${COLUMNS} FROM todo ORDER BY id`;
  return results as Todo[];
};

export type TodoPage = {
  todos: Todo[];
  total: number;
};

// One page of todos plus the total row count, for the JSON API. The count is
// what makes a page interpretable: without it a client that receives exactly
// `limit` rows cannot tell whether it reached the end or the middle.
//
// Two queries rather than a window function on purpose — `COUNT(*) OVER ()`
// would return no count at all on the empty page past the end, which is where a
// client most needs to be told how far it overshot.
export const getTodoPage = async (
  limit: number,
  offset: number,
): Promise<TodoPage> => {
  const [rows, counted] = await Promise.all([
    db`
      SELECT ${COLUMNS} FROM todo
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `,
    db`SELECT COUNT(*)::int AS total FROM todo`,
  ]);

  return {
    todos: rows as Todo[],
    total: (counted[0] as { total: number }).total,
  };
};

export const getTodoById = async (id: number): Promise<Todo | null> => {
  const results = await db`SELECT ${COLUMNS} FROM todo WHERE id = ${id}`;
  return results.length > 0 ? (results[0] as Todo) : null;
};

export const createTodo = async (
  title: string,
  createdBy: string | null = null,
): Promise<Todo> => {
  const results = await db`
    INSERT INTO todo (title, created_by)
    VALUES (${title}, ${createdBy})
    RETURNING ${COLUMNS}
  `;
  return results[0] as Todo;
};

// `completed` left undefined keeps the current state; true stamps
// `completed_at` only if it isn't already set, so re-completing doesn't move
// the time.
export const updateTodo = async (
  id: number,
  title: string,
  completed?: boolean,
): Promise<Todo | null> => {
  const results = await db`
    UPDATE todo
    SET title = ${title},
        completed_at = CASE
          WHEN ${completed ?? null}::boolean IS NULL THEN completed_at
          WHEN ${completed ?? null}::boolean THEN COALESCE(completed_at, now())
          ELSE NULL
        END
    WHERE id = ${id}
    RETURNING ${COLUMNS}
  `;
  return results.length > 0 ? (results[0] as Todo) : null;
};

// Flip done/not done in one statement, so two quick clicks can't both read
// "not done" and both mark it done.
export const toggleTodo = async (id: number): Promise<Todo | null> => {
  const results = await db`
    UPDATE todo
    SET completed_at = CASE WHEN completed_at IS NULL THEN now() ELSE NULL END
    WHERE id = ${id}
    RETURNING ${COLUMNS}
  `;
  return results.length > 0 ? (results[0] as Todo) : null;
};

export const deleteTodo = async (id: number): Promise<boolean> => {
  const results = await db`DELETE FROM todo WHERE id = ${id}`;
  return hasAffectedRows(results as DatabaseMutationResult);
};
