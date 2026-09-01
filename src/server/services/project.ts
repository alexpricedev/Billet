import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";
import { db } from "./database";

export type Project = {
  id: number;
  title: string;
  created_by: string | null;
};

export const getProjects = async (): Promise<Project[]> => {
  const results =
    await db`SELECT id, title, created_by FROM project ORDER BY id`;
  return results as Project[];
};

export type ProjectPage = {
  projects: Project[];
  total: number;
};

// One page of projects plus the total row count, for the JSON API. The count is
// what makes a page interpretable: without it a client that receives exactly
// `limit` rows cannot tell whether it reached the end or the middle.
//
// Two queries rather than a window function on purpose — `COUNT(*) OVER ()`
// would return no count at all on the empty page past the end, which is where a
// client most needs to be told how far it overshot.
export const getProjectPage = async (
  limit: number,
  offset: number,
): Promise<ProjectPage> => {
  const [rows, counted] = await Promise.all([
    db`
      SELECT id, title, created_by FROM project
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `,
    db`SELECT COUNT(*)::int AS total FROM project`,
  ]);

  return {
    projects: rows as Project[],
    total: (counted[0] as { total: number }).total,
  };
};

export const getProjectById = async (id: number): Promise<Project | null> => {
  const results =
    await db`SELECT id, title, created_by FROM project WHERE id = ${id}`;
  return results.length > 0 ? (results[0] as Project) : null;
};

export const createProject = async (
  title: string,
  createdBy: string | null = null,
): Promise<Project> => {
  const results = await db`
    INSERT INTO project (title, created_by)
    VALUES (${title}, ${createdBy})
    RETURNING id, title, created_by
  `;
  return results[0] as Project;
};

export const updateProject = async (
  id: number,
  title: string,
): Promise<Project | null> => {
  const results = await db`
    UPDATE project
    SET title = ${title}
    WHERE id = ${id}
    RETURNING id, title, created_by
  `;
  return results.length > 0 ? (results[0] as Project) : null;
};

export const deleteProject = async (id: number): Promise<boolean> => {
  const results = await db`DELETE FROM project WHERE id = ${id}`;
  return hasAffectedRows(results as DatabaseMutationResult);
};
