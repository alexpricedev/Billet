import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { verifyPassword } from "../utils/crypto";
import {
  FIXTURE_PASSWORD,
  FIXTURE_PASSWORD_HASH,
  PERSONAS,
  TODOS,
  ZOFIA,
} from "./personas";

// The rows of the table in ux/personas.md, as [name, account, platform role, team].
const documented = readFileSync("ux/personas.md", "utf8")
  .split("\n")
  .filter((line) => line.startsWith("|"))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  )
  .filter((cells) => cells[1]?.includes("@"))
  .map(([name, account, role, team]) => ({ name, account, role, team }));

describe("fixture personas", () => {
  test("every documented account is a fixture, and the reverse", () => {
    const accounts = documented.map((row) => row.account).sort();
    const fixtures = [...PERSONAS.map((p) => p.email), ZOFIA.email].sort();
    // ade is documented below the table rather than in it.
    expect(fixtures.filter((email) => email !== "ade@example.com")).toEqual(
      accounts,
    );
  });

  test("platform and org roles match the table", () => {
    for (const row of documented) {
      const persona = PERSONAS.find((p) => p.email === row.account);
      if (!persona) continue;
      expect(persona.role as string).toBe(row.role);
      const team = persona.orgRole ? `Northwind, ${persona.orgRole}` : "none";
      expect(team).toBe(row.team);
    }
  });

  test("the todos cover a done, a 200-character, an emoji and an ownerless one", () => {
    expect(TODOS.some((t) => t.completedAt)).toBe(true);
    expect(TODOS.some((t) => t.title.length === 200)).toBe(true);
    expect(TODOS.some((t) => /\p{Extended_Pictographic}/u.test(t.title))).toBe(
      true,
    );
    expect(TODOS.some((t) => t.createdBy === null)).toBe(true);
  });

  test("the precomputed hash verifies the fixture password", async () => {
    expect(await verifyPassword(FIXTURE_PASSWORD, FIXTURE_PASSWORD_HASH)).toBe(
      true,
    );
  });
});
