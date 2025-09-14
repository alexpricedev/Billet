import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";
import { db } from "./database";

export type Example = {
  id: number;
  name: string;
};

export const getExamples = async (): Promise<Example[]> => {
  const results = await db`SELECT id, name FROM example ORDER BY id`;
  return results as Example[];
};

export const getExampleById = async (id: number): Promise<Example | null> => {
  const results = await db`SELECT id, name FROM example WHERE id = ${id}`;
  return results.length > 0 ? (results[0] as Example) : null;
};

export const createExample = async (name: string): Promise<Example> => {
  const results = await db`
    INSERT INTO example (name) 
    VALUES (${name}) 
    RETURNING id, name
  `;
  return results[0] as Example;
};

export const updateExample = async (
  id: number,
  name: string,
): Promise<Example | null> => {
  const results = await db`
    UPDATE example 
    SET name = ${name} 
    WHERE id = ${id} 
    RETURNING id, name
  `;
  return results.length > 0 ? (results[0] as Example) : null;
};

export const deleteExample = async (id: number): Promise<boolean> => {
  const results = await db`DELETE FROM example WHERE id = ${id}`;
  return hasAffectedRows(results as DatabaseMutationResult);
};
