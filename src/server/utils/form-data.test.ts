import { describe, expect, test } from "bun:test";
import { createBunRequest } from "../test-utils/bun-request";
import { readFormValues } from "./form-data";

const postWith = (body: BodyInit) =>
  createBunRequest("http://localhost:3000/forms", { method: "POST", body });

describe("readFormValues", () => {
  test("reads the requested fields", async () => {
    const form = new FormData();
    form.append("name", "Alex");
    form.append("email", "alex@example.com");

    const values = await readFormValues(postWith(form), ["name", "email"]);

    expect(values).toEqual({ name: "Alex", email: "alex@example.com" });
  });

  test("trims whitespace", async () => {
    const form = new FormData();
    form.append("name", "  Alex  ");

    const values = await readFormValues(postWith(form), ["name"]);

    expect(values.name).toBe("Alex");
  });

  test("omits empty and whitespace-only fields", async () => {
    const form = new FormData();
    form.append("name", "");
    form.append("email", "   ");

    const values = await readFormValues(postWith(form), ["name", "email"]);

    expect(values).toEqual({});
  });

  test("ignores fields that were not requested", async () => {
    const form = new FormData();
    form.append("name", "Alex");
    form.append("secret", "nope");

    const values = await readFormValues(postWith(form), ["name"]);

    expect(values).toEqual({ name: "Alex" });
  });

  test("omits fields absent from the body", async () => {
    const form = new FormData();
    form.append("name", "Alex");

    const values = await readFormValues(postWith(form), ["name", "message"]);

    expect(values).toEqual({ name: "Alex" });
  });

  test("reads urlencoded bodies", async () => {
    const req = createBunRequest("http://localhost:3000/forms", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Alex&email=alex%40example.com",
    });

    const values = await readFormValues(req, ["name", "email"]);

    expect(values).toEqual({ name: "Alex", email: "alex@example.com" });
  });

  test("returns an empty object for a non-form body", async () => {
    const req = createBunRequest("http://localhost:3000/forms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alex" }),
    });

    const values = await readFormValues(req, ["name"]);

    expect(values).toEqual({});
  });

  test("returns an empty object when the body was already consumed", async () => {
    const form = new FormData();
    form.append("name", "Alex");
    const req = postWith(form);

    await req.formData();

    expect(await readFormValues(req, ["name"])).toEqual({});
  });

  test("survives CSRF middleware having cloned and parsed the body", async () => {
    const form = new FormData();
    form.append("name", "Alex");
    const req = postWith(form);

    // What csrfProtection does: parse a clone, leaving req itself unconsumed.
    await req.clone().formData();

    expect(await readFormValues(req, ["name"])).toEqual({ name: "Alex" });
  });
});
