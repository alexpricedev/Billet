import { describe, expect, test } from "bun:test";
import type { ProjectDefinition, ServiceNode } from "railway/iac";

import definition, { partial } from "./railway";

// The Railway CLI, not this repo, is what evaluates railway.ts for real — so the
// only thing a test can protect is the shape of what it hands over: the six
// build and deploy settings the README documents, and the rule that no secret is
// written into source. It catches the drift that `railway config plan` would
// otherwise find for you in front of a production project.
const graph = (await definition(
  // The CLI passes a context (environment name, generators); nothing here reads
  // it, and `project` is imported directly rather than taken from the second
  // argument, so both are stubs.
  {} as never,
  ((name: string, rest: object) => ({ name, ...rest })) as never,
)) as ProjectDefinition;

const app = graph.resources?.find(
  (resource): resource is ServiceNode =>
    "type" in resource && resource.type === "service",
);

describe("railway.ts", () => {
  test("owns a named partial so apply can't delete another service", () => {
    expect(partial).toBeTruthy();
  });

  // Asserted as an invariant rather than against a literal, because the name is
  // meant to be changed: a rename that moved one and not the other would leave
  // the partial owning nothing and the service outside it.
  test("names the service after the partial", () => {
    expect(app?.name).toBe(partial);
    expect(app?.address).toBe(`service.${partial}`);
  });

  test("declares the documented build and deploy settings", () => {
    expect(app?.build).toEqual({
      builder: "RAILPACK",
      buildCommand: "bun install && bun run build",
    });
    expect(app?.deploy).toMatchObject({
      startCommand: "bun run start",
      healthcheckPath: "/health",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 3,
    });
  });

  // Railway drops this one silently — it reads back as null after a successful
  // apply, so declaring it means `railway config plan` never exits clean.
  // "On failure" is the platform default, so the behaviour is right without it.
  test("leaves restartPolicyType to Railway's default", () => {
    expect(app?.deploy).not.toHaveProperty("restartPolicyType");
  });

  test("takes DATABASE_URL by reference rather than by value", () => {
    expect(app?.variables?.DATABASE_URL).toEqual({
      type: "reference",
      resource: "database.Postgres",
      output: "DATABASE_URL",
    });
  });

  // Both halves matter. A literal would commit the secret; a generator would
  // make every plan propose a fresh one, because a sealed variable reads back as
  // `preserve()` and the planner cannot tell "already set" from "not set".
  test("neither writes nor regenerates CRYPTO_PEPPER", () => {
    expect(app?.variables?.CRYPTO_PEPPER).toEqual({ type: "preserve" });
  });

  // The point of the defaults is that one `railway config apply` leaves a
  // service that boots. `validateEnv()` exits the process on any of these, so a
  // `preserve()` here is a crash-loop on a fresh project.
  test("gives every boot-required variable a default", () => {
    for (const key of ["APP_NAME", "EMAIL_PROVIDER", "FROM_EMAIL", "FROM_NAME"]) {
      expect(app?.variables?.[key]).toMatchObject({ type: "literal" });
    }
  });

  // Railway resolves this at deploy time. Without it APP_URL can't be set until
  // the domain exists, and the domain doesn't exist until the service does.
  test("derives APP_URL from the domain Railway assigns", () => {
    expect(app?.variables?.APP_URL).toEqual({
      type: "literal",
      value: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
    });
  });

  // A variable this file omits is one Railway may remove on apply, so the
  // contract is: everything the server reads is named, and anything the operator
  // owns is `preserve()`.
  test("names every variable the server reads", () => {
    const declared = new Set(Object.keys(app?.variables ?? {}));
    for (const key of [
      "APP_NAME",
      "APP_URL",
      "EMAIL_PROVIDER",
      "FROM_EMAIL",
      "FROM_NAME",
      "RESEND_API_KEY",
      "SITE_URL",
      "ALLOW_INDEXING",
      "AUTH_MODE",
      "TEAMS_ENABLED",
      "TRUST_PROXY",
    ]) {
      expect(declared).toContain(key);
    }
  });
});
