import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { createBunRequest } from "../../test-utils/bun-request";
import { testDatabase } from "../../test-utils/database";
import { cleanupTestData, randomEmail } from "../../test-utils/helpers";

const connection = testDatabase();

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { findOrCreateUser } from "../../services/auth";
import { createAuthenticatedSession } from "../../services/sessions";
import { cmsSignIn } from "./cms-sign-in";

describe("CMS sign-in", () => {
  beforeEach(async () => {
    await cleanupTestData(connection);
  });

  afterEach(() => {
    delete process.env.CMS_URL;
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  test("sends a signed-out visitor through the site's login and back", async () => {
    const response = await cmsSignIn.index(
      createBunRequest("http://localhost:3000/cms/sign-in"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/login?next=%2Fcms%2Fsign-in",
    );
  });

  test("answers 503 to a signed-in user when CMS_URL is unset", async () => {
    const user = await findOrCreateUser(randomEmail());
    const sessionId = await createAuthenticatedSession(user.id);

    const response = await cmsSignIn.index(
      createBunRequest("http://localhost:3000/cms/sign-in", {
        headers: { Cookie: `session_id=${sessionId}` },
      }),
    );

    expect(response.status).toBe(503);
  });
});
